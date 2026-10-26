from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .imaging import (
    ImageInputError,
    attach_underlines,
    detect_rules,
    inspect_source,
    prepare_page,
    write_preview,
)
from .layout import apply_corrections, compose_text, make_line, page_statistics
from .ocr_engine import OcrEngine, OcrUnavailableError, PaddleOcrEngine
from .schemas import (
    CorrectionItem,
    DocumentInfo,
    PageResult,
    PageSummary,
    ScanLine,
    ScanStatusResponse,
)

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".png": "image", ".jpg": "image", ".jpeg": "image", ".pdf": "pdf"}
MAGIC = {"pdf": b"%PDF-", "png": b"\x89PNG\r\n\x1a\n", "jpeg": b"\xff\xd8\xff"}


class ServiceError(RuntimeError):
    def __init__(self, status_code: int, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.hint = hint


@dataclass
class DocumentRecord:
    id: str
    filename: str
    kind: str
    page_count: int
    path: Path
    page_sizes: list[tuple[int, int]]
    created_at: float
    directory: Path


@dataclass
class JobRecord:
    document_id: str
    status: str = "queued"
    stage: str = "Waiting for a free OCR worker"
    progress: int = 0
    selected_pages: list[int] = field(default_factory=list)
    pages: dict[int, PageSummary] = field(default_factory=dict)
    error: str | None = None
    error_hint: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


def _now_iso(timestamp: float | None = None) -> str:
    value = datetime.fromtimestamp(timestamp or time.time(), tz=UTC)
    return value.isoformat().replace("+00:00", "Z")


def _clean_filename(filename: str | None, extension: str) -> str:
    candidate = Path(filename or f"document{extension}").name
    candidate = "".join(char for char in candidate if char.isprintable() and char not in "\r\n\t")
    candidate = candidate.strip() or f"document{extension}"
    return candidate[:180]


def _magic_kind(data: bytes) -> str | None:
    if data.startswith(MAGIC["pdf"]):
        return "pdf"
    if data.startswith(MAGIC["png"]):
        return "png"
    if data.startswith(MAGIC["jpeg"]):
        return "jpeg"
    return None


class ScanService:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        engine: OcrEngine | None = None,
        start_cleanup: bool = True,
    ) -> None:
        self.settings = settings or Settings()
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine = engine or PaddleOcrEngine(
            lang=self.settings.ocr_lang,
            score_threshold=self.settings.ocr_score_threshold,
        )
        self.documents: dict[str, DocumentRecord] = {}
        self.jobs: dict[str, JobRecord] = {}
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="solfa-ocr")
        self._stop = threading.Event()
        self._cleanup_thread: threading.Thread | None = None
        self.cleanup_expired()
        if start_cleanup:
            self._cleanup_thread = threading.Thread(
                target=self._cleanup_loop,
                name="solfa-scan-cleanup",
                daemon=True,
            )
            self._cleanup_thread.start()

    # ------------------------------------------------------------------ upload

    def create_document(self, filename: str | None, data: bytes) -> DocumentInfo:
        if not data:
            raise ServiceError(400, "The selected file is empty.")
        if len(data) > self.settings.max_upload_bytes:
            raise ServiceError(
                413,
                f"The file is larger than {self.settings.max_upload_mb} MB.",
                "Choose a smaller file or raise SOLFA_SCAN_MAX_UPLOAD_MB on the backend.",
            )
        extension = Path(filename or "").suffix.lower()
        kind = ALLOWED_EXTENSIONS.get(extension)
        if kind is None:
            raise ServiceError(
                415,
                "Unsupported file type. Upload a PNG, JPG, JPEG or PDF file.",
            )
        magic = _magic_kind(data)
        if kind == "pdf" and magic != "pdf":
            raise ServiceError(400, "This file is not a valid PDF.")
        if kind == "image" and magic not in {"png", "jpeg"}:
            raise ServiceError(400, "This file is not a valid PNG or JPEG image.")

        document_id = uuid.uuid4().hex
        directory = self.settings.data_dir / document_id
        directory.mkdir(parents=True, exist_ok=False)
        source = directory / f"source{extension}"
        source.write_bytes(data)
        try:
            info = inspect_source(source, kind, self.settings)
        except ImageInputError as exc:
            shutil.rmtree(directory, ignore_errors=True)
            raise ServiceError(400, str(exc)) from exc
        except Exception as exc:
            shutil.rmtree(directory, ignore_errors=True)
            logger.exception("Unreadable upload")
            raise ServiceError(400, "This file could not be read.") from exc

        record = DocumentRecord(
            id=document_id,
            filename=_clean_filename(filename, extension),
            kind=info.kind,
            page_count=info.page_count,
            path=source,
            page_sizes=info.page_sizes,
            created_at=time.time(),
            directory=directory,
        )
        with self.lock:
            self.documents[document_id] = record
        return self.document_info(record)

    def document_info(self, document: DocumentRecord) -> DocumentInfo:
        preview_urls = [
            f"/api/documents/{document.id}/pages/{page}/preview"
            for page in range(1, document.page_count + 1)
        ]
        pages = [
            PageSummary(page=page, width=width, height=height)
            for page, (width, height) in enumerate(document.page_sizes, start=1)
        ]
        return DocumentInfo(
            id=document.id,
            filename=document.filename,
            kind=document.kind,  # type: ignore[arg-type]
            page_count=document.page_count,
            pages=pages,
            max_pages=self.settings.max_pages,
            max_upload_mb=self.settings.max_upload_mb,
            preview_urls=preview_urls,
        )

    def get_document(self, document_id: str) -> DocumentRecord:
        with self.lock:
            document = self.documents.get(document_id)
        if document is None:
            raise ServiceError(404, "This document is no longer available. Upload it again.")
        return document

    def delete_document(self, document_id: str) -> None:
        with self.lock:
            document = self.documents.get(document_id)
            if document is None:
                raise ServiceError(404, "This document is no longer available. Upload it again.")
            job = self.jobs.get(document_id)
            if job and job.status in {"queued", "processing"}:
                raise ServiceError(409, "This document is being scanned and cannot be removed yet.")
            self.documents.pop(document_id, None)
            self.jobs.pop(document_id, None)
        shutil.rmtree(document.directory, ignore_errors=True)

    # ------------------------------------------------------------------- scans

    def start_scan(self, document_id: str, pages: list[int] | None) -> ScanStatusResponse:
        with self.lock:
            document = self.documents.get(document_id)
            if document is None:
                raise ServiceError(404, "This document is no longer available. Upload it again.")
            selected = sorted(set(pages if pages is not None else range(1, document.page_count + 1)))
            if not selected:
                raise ServiceError(400, "Select at least one page to scan.")
            if len(selected) > self.settings.max_pages:
                raise ServiceError(400, f"Select no more than {self.settings.max_pages} pages.")
            if selected[0] < 1 or selected[-1] > document.page_count:
                raise ServiceError(400, f"Page numbers must be between 1 and {document.page_count}.")
            existing = self.jobs.get(document_id)
            if existing and existing.status in {"queued", "processing"}:
                raise ServiceError(409, "This document is already being scanned.")

            results = document.directory / "results"
            previews = document.directory / "pages"
            shutil.rmtree(results, ignore_errors=True)
            shutil.rmtree(previews, ignore_errors=True)
            results.mkdir(parents=True, exist_ok=True)
            previews.mkdir(parents=True, exist_ok=True)
            summaries = {
                page: PageSummary(page=page, width=width, height=height)
                for page, (width, height) in enumerate(document.page_sizes, start=1)
            }
            job = JobRecord(document_id=document_id, selected_pages=selected, pages=summaries)
            self.jobs[document_id] = job
        self.executor.submit(self._run_scan, document, job)
        return self.status(document_id)

    def _update_job(self, job: JobRecord, **changes: Any) -> None:
        with self.lock:
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = time.time()

    def _run_scan(self, document: DocumentRecord, job: JobRecord) -> None:
        total = len(job.selected_pages)
        self._update_job(
            job,
            status="processing",
            stage="Starting OCR engine (the first scan may download models)",
            progress=3,
            error=None,
            error_hint=None,
        )
        try:
            for index, page_number in enumerate(job.selected_pages):
                base = 6 + (index / max(total, 1)) * 86
                self._update_job(
                    job,
                    stage=f"Preparing page {page_number} ({index + 1} of {total} selected)",
                    progress=round(base),
                )
                prepared = prepare_page(
                    document.path,
                    document.kind,
                    page_number,
                    self.settings,
                )
                image_path = document.directory / "pages" / f"page-{page_number}.jpg"
                write_preview(image_path, prepared.image)
                self._update_job(
                    job,
                    stage=f"Recognizing page {page_number} ({index + 1} of {total} selected)",
                    progress=round(base + 55 / max(total, 1)),
                )
                rules = detect_rules(prepared.gray)
                detections = self.engine.recognize(prepared.image)
                detections.sort(key=lambda item: (round(item.bbox[1] / 8), item.bbox[0]))
                lines: list[ScanLine] = []
                for line_index, detection in enumerate(detections):
                    lines.append(
                        make_line(
                            detection.text,
                            detection.bbox,
                            detection.confidence,
                            page_number,
                            line_index,
                            self.settings.uncertain_threshold,
                        )
                    )
                remaining_rules = attach_underlines(lines, rules)
                text = compose_text(lines)
                mean, uncertain_count = page_statistics(lines)
                image_url = f"/api/scan/{document.id}/pages/{page_number}/image"
                result = PageResult(
                    page=page_number,
                    width=prepared.width,
                    height=prepared.height,
                    lines=lines,
                    rules=remaining_rules,
                    text=text,
                    mean_confidence=mean,
                    uncertain_count=uncertain_count,
                    image_url=image_url,
                )
                self._write_page(document, result)
                with self.lock:
                    summary = job.pages[page_number]
                    summary.width = prepared.width
                    summary.height = prepared.height
                    summary.status = "completed"
                    summary.line_count = len(lines)
                    summary.uncertain_count = uncertain_count
                    summary.image_url = image_url
                    job.progress = round(base + 82 / max(total, 1))
                    job.updated_at = time.time()
            self._update_job(
                job,
                status="completed",
                stage="Scan complete",
                progress=100,
            )
        except (ImageInputError, OcrUnavailableError) as exc:
            hint = (
                "Check that the backend virtual environment is installed and the PaddleOCR models are available."
                if isinstance(exc, OcrUnavailableError)
                else "Try re-uploading the document or scanning one page at a time."
            )
            self._fail_job(job, str(exc), hint)
        except Exception as exc:
            logger.exception("Scan failed for %s", document.id)
            self._fail_job(
                job,
                "The scan could not be completed.",
                "Check the backend log, then retry. The uploaded file may be damaged.",
            )

    def _fail_job(self, job: JobRecord, message: str, hint: str) -> None:
        with self.lock:
            for summary in job.pages.values():
                if summary.page in job.selected_pages and summary.status != "completed":
                    summary.status = "failed"
            job.status = "failed"
            job.stage = "Scan failed"
            job.error = message
            job.error_hint = hint
            job.updated_at = time.time()

    def _write_page(self, document: DocumentRecord, page: PageResult) -> None:
        path = document.directory / "results" / f"page-{page.page}.json"
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(page.model_dump_json(), encoding="utf-8")
        temporary.replace(path)

    def status(self, document_id: str) -> ScanStatusResponse:
        document = self.get_document(document_id)
        with self.lock:
            job = self.jobs.get(document_id)
            if job is None:
                return ScanStatusResponse(
                    id=document.id,
                    filename=document.filename,
                    kind=document.kind,  # type: ignore[arg-type]
                    page_count=document.page_count,
                    selected_pages=[],
                    status="uploaded",
                    stage="Ready to scan",
                    progress=0,
                    pages=[
                        PageSummary(page=page, width=width, height=height)
                        for page, (width, height) in enumerate(document.page_sizes, start=1)
                    ],
                    created_at=_now_iso(document.created_at),
                    updated_at=_now_iso(document.created_at),
                )
            return ScanStatusResponse(
                id=document.id,
                filename=document.filename,
                kind=document.kind,  # type: ignore[arg-type]
                page_count=document.page_count,
                selected_pages=list(job.selected_pages),
                status=job.status,  # type: ignore[arg-type]
                stage=job.stage,
                progress=job.progress,
                error=job.error,
                error_hint=job.error_hint,
                pages=list(job.pages.values()),
                created_at=_now_iso(job.created_at),
                updated_at=_now_iso(job.updated_at),
            )

    def get_page(self, document_id: str, page_number: int) -> PageResult:
        document = self.get_document(document_id)
        path = document.directory / "results" / f"page-{page_number}.json"
        if not path.exists():
            with self.lock:
                job = self.jobs.get(document_id)
            if job and job.status in {"queued", "processing"}:
                raise ServiceError(409, "This page is still being scanned.")
            raise ServiceError(404, f"Page {page_number} has not been scanned.")
        try:
            return PageResult.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ServiceError(500, "The saved scan result is unreadable.") from exc

    # ------------------------------------------------------------- corrections

    def save_corrections(
        self, document_id: str, corrections: list[CorrectionItem]
    ) -> PageResult:
        if not corrections:
            raise ServiceError(400, "No corrections were supplied.")
        first = corrections[0]
        page_number = _page_from_char_id(first.char_id)
        if page_number is None:
            raise ServiceError(400, "A correction has an invalid character id.")
        page = self.get_page(document_id, page_number)
        page, missing = apply_corrections(page, corrections)
        if missing:
            raise ServiceError(
                400,
                f"{len(missing)} corrected character(s) no longer exist on this page. Rescan and try again.",
            )
        document = self.get_document(document_id)
        self._write_page(document, page)
        with self.lock:
            job = self.jobs.get(document_id)
            if job and page_number in job.pages:
                job.pages[page_number].line_count = len(page.lines)
                job.pages[page_number].uncertain_count = page.uncertain_count
                job.updated_at = time.time()
        return page

    # ------------------------------------------------------------------ images

    def preview_path(self, document_id: str, page_number: int) -> Path:
        document = self.get_document(document_id)
        if page_number < 1 or page_number > document.page_count:
            raise ServiceError(404, f"Page {page_number} does not exist.")
        scanned = document.directory / "pages" / f"page-{page_number}.jpg"
        if scanned.exists():
            return scanned
        cached = document.directory / "previews" / f"page-{page_number}.jpg"
        if cached.exists():
            return cached
        try:
            prepared = prepare_page(document.path, document.kind, page_number, self.settings)
        except ImageInputError as exc:
            raise ServiceError(400, str(exc)) from exc
        write_preview(cached, prepared.image)
        return cached

    def scanned_image_path(self, document_id: str, page_number: int) -> Path:
        document = self.get_document(document_id)
        path = document.directory / "pages" / f"page-{page_number}.jpg"
        if not path.exists():
            raise ServiceError(404, f"There is no scanned image for page {page_number}.")
        return path

    # ----------------------------------------------------------------- cleanup

    def cleanup_expired(self) -> None:
        cutoff = time.time() - self.settings.ttl_seconds
        expired: list[DocumentRecord] = []
        with self.lock:
            active_documents = {
                job.document_id
                for job in self.jobs.values()
                if job.status in {"queued", "processing"}
            }
            for document_id, document in list(self.documents.items()):
                if document.created_at < cutoff and document_id not in active_documents:
                    expired.append(document)
                    self.documents.pop(document_id, None)
                    self.jobs.pop(document_id, None)
        for document in expired:
            shutil.rmtree(document.directory, ignore_errors=True)
        if self.settings.data_dir.exists():
            for child in self.settings.data_dir.iterdir():
                try:
                    if not child.is_dir() or len(child.name) != 32:
                        continue
                    int(child.name, 16)
                    if child.stat().st_mtime < cutoff:
                        with self.lock:
                            known = child.name in self.documents
                        if not known:
                            shutil.rmtree(child, ignore_errors=True)
                except (OSError, ValueError):
                    continue

    def _cleanup_loop(self) -> None:
        interval = max(30, min(300, self.settings.ttl_seconds // 2))
        while not self._stop.wait(interval):
            try:
                self.cleanup_expired()
            except Exception:
                logger.exception("Temporary scan cleanup failed")

    def close(self) -> None:
        self._stop.set()
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.engine.close()

    @property
    def ocr_description(self) -> str:
        return getattr(self.engine, "description", type(self.engine).__name__)


def _page_from_char_id(char_id: str) -> int | None:
    try:
        prefix = char_id.split("-l", 1)[0]
        if not prefix.startswith("p"):
            return None
        page = int(prefix[1:])
        return page if page > 0 else None
    except (ValueError, IndexError):
        return None
