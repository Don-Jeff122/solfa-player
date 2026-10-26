from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings
from .ocr_engine import OcrEngine
from .schemas import (
    CorrectionsRequest,
    DocumentInfo,
    HealthResponse,
    PageResult,
    ScanRequest,
    ScanStatusResponse,
)
from .service import ScanService, ServiceError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

PAGE_RANGE = re.compile(r"^\s*(\d+)\s*(?:-\s*(\d+))?\s*$")


def _parse_pages(value: str | None) -> list[int] | None:
    if value is None or not value.strip():
        return None
    pages: set[int] = set()
    for part in value.split(","):
        match = PAGE_RANGE.match(part)
        if not match:
            raise ServiceError(400, "Pages must look like 1,3,5-7.")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < start:
            raise ServiceError(400, "Page numbers must start at 1 and be in order.")
        if end - start > 100:
            raise ServiceError(400, "That page range is too large.")
        pages.update(range(start, end + 1))
    return sorted(pages)


def create_app(
    settings: Settings | None = None,
    *,
    engine: OcrEngine | None = None,
    service: ScanService | None = None,
) -> FastAPI:
    app_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service = service or ScanService(app_settings, engine=engine)
        yield
        app.state.service.close()

    app = FastAPI(
        title="Solfa Scan API",
        version="1.0.0",
        description="Layout-aware tonic solfa OCR and correction service.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(ServiceError)
    async def service_error_handler(request: Request, exc: ServiceError) -> JSONResponse:
        payload = {"detail": exc.message}
        if exc.hint:
            payload["hint"] = exc.hint
        return JSONResponse(status_code=exc.status_code, content=payload)

    def scan_service(request: Request) -> ScanService:
        return request.app.state.service

    async def _read_upload(upload: UploadFile, max_bytes: int) -> bytes:
        data = await upload.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ServiceError(
                413,
                f"The file is larger than {app_settings.max_upload_mb} MB.",
                "Choose a smaller file or raise SOLFA_SCAN_MAX_UPLOAD_MB on the backend.",
            )
        return data

    @app.get("/api/health", response_model=HealthResponse)
    def health(request: Request) -> HealthResponse:
        svc = scan_service(request)
        return HealthResponse(
            status="ok",
            service="solfa-scan",
            ocr=svc.ocr_description,
        )

    @app.post("/api/documents", response_model=DocumentInfo, status_code=201)
    async def upload_document(request: Request, file: UploadFile = File(...)) -> DocumentInfo:
        svc = scan_service(request)
        data = await _read_upload(file, app_settings.max_upload_bytes)
        return await run_in_threadpool(svc.create_document, file.filename, data)

    @app.get("/api/documents/{document_id}", response_model=DocumentInfo)
    def get_document(request: Request, document_id: str) -> DocumentInfo:
        svc = scan_service(request)
        return svc.document_info(svc.get_document(document_id))

    @app.delete("/api/documents/{document_id}", status_code=204)
    def delete_document(request: Request, document_id: str) -> None:
        scan_service(request).delete_document(document_id)

    @app.get("/api/documents/{document_id}/pages/{page}/preview")
    def document_preview(request: Request, document_id: str, page: int) -> FileResponse:
        path = scan_service(request).preview_path(document_id, page)
        return FileResponse(
            path,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-store, max-age=0"},
        )

    @app.post("/api/documents/{document_id}/scan", response_model=ScanStatusResponse)
    def scan_document(
        request: Request,
        document_id: str,
        body: ScanRequest | None = None,
    ) -> ScanStatusResponse:
        svc = scan_service(request)
        return svc.start_scan(document_id, body.pages if body else None)

    @app.post("/api/scan", response_model=ScanStatusResponse, status_code=202)
    async def scan_upload(
        request: Request,
        file: UploadFile = File(...),
        pages: str | None = Form(default=None),
    ) -> ScanStatusResponse:
        svc = scan_service(request)
        data = await _read_upload(file, app_settings.max_upload_bytes)
        document = await run_in_threadpool(svc.create_document, file.filename, data)
        return svc.start_scan(document.id, _parse_pages(pages))

    @app.get("/api/scan/{document_id}", response_model=ScanStatusResponse)
    def scan_status(request: Request, document_id: str) -> ScanStatusResponse:
        return scan_service(request).status(document_id)

    @app.get("/api/scan/{document_id}/pages/{page}", response_model=PageResult)
    def page_result(request: Request, document_id: str, page: int) -> PageResult:
        return scan_service(request).get_page(document_id, page)

    @app.get("/api/scan/{document_id}/pages/{page}/image")
    def page_image(request: Request, document_id: str, page: int) -> FileResponse:
        path = scan_service(request).scanned_image_path(document_id, page)
        return FileResponse(
            path,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-store, max-age=0"},
        )

    @app.post(
        "/api/scan/{document_id}/corrections",
        response_model=PageResult,
    )
    def save_corrections(
        request: Request,
        document_id: str,
        body: CorrectionsRequest,
    ) -> PageResult:
        return scan_service(request).save_corrections(document_id, body.corrections)

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": "Solfa Scan API",
            "docs": "/docs",
            "health": "/api/health",
        }

    return app


app = create_app()
