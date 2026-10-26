from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np


class OcrUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class OcrDetection:
    text: str
    confidence: float
    bbox: tuple[float, float, float, float]


class OcrEngine(Protocol):
    def recognize(self, image: np.ndarray) -> list[OcrDetection]: ...

    def close(self) -> None: ...


def _payload(result: Any) -> dict[str, Any]:
    data = getattr(result, "json", None)
    if callable(data):
        data = data()
    if isinstance(data, dict):
        nested = data.get("res")
        return nested if isinstance(nested, dict) else data
    data = getattr(result, "to_dict", None)
    if callable(data):
        data = data()
        if isinstance(data, dict):
            nested = data.get("res")
            return nested if isinstance(nested, dict) else data
    return {}


def _bbox_from_poly(poly: Any) -> tuple[float, float, float, float] | None:
    try:
        points = np.asarray(poly, dtype=float).reshape(-1, 2)
    except (TypeError, ValueError):
        return None
    if points.size == 0:
        return None
    return (
        float(points[:, 0].min()),
        float(points[:, 1].min()),
        float(points[:, 0].max()),
        float(points[:, 1].max()),
    )


class PaddleOcrEngine:
    """Lazy PaddleOCR adapter. Model download happens on the first scan."""

    description = "PaddleOCR 3.x (PP-OCRv6, CPU)"

    def __init__(
        self,
        *,
        lang: str = "en",
        score_threshold: float = 0.0,
        use_textline_orientation: bool = False,
    ) -> None:
        self.lang = lang
        self.score_threshold = score_threshold
        self.use_textline_orientation = use_textline_orientation
        self._ocr: Any = None
        self._init_error: str | None = None
        self._lock = threading.Lock()

    def _ensure_model(self) -> Any:
        if self._ocr is not None:
            return self._ocr
        if self._init_error:
            raise OcrUnavailableError(self._init_error)
        with self._lock:
            if self._ocr is not None:
                return self._ocr
            if self._init_error:
                raise OcrUnavailableError(self._init_error)
            os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            # PP-OCRv6 + oneDNN fails on some Windows CPU builds. The plain
            # Paddle backend is slower but portable and produces the same result.
            os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "False")
            try:
                from paddleocr import PaddleOCR

                self._ocr = PaddleOCR(
                    lang=self.lang,
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=self.use_textline_orientation,
                    text_det_limit_side_len=2600,
                    text_det_limit_type="max",
                    text_rec_score_thresh=self.score_threshold,
                    text_recognition_batch_size=6,
                )
            except Exception as exc:
                self._init_error = (
                    "PaddleOCR could not be started. Install backend/requirements.txt "
                    f"and allow the PP-OCR models to download on the first scan ({exc})."
                )
                raise OcrUnavailableError(self._init_error) from exc
        return self._ocr

    def recognize(self, image: np.ndarray) -> list[OcrDetection]:
        ocr = self._ensure_model()
        try:
            with self._lock:
                results = ocr.predict(np.ascontiguousarray(image))
        except Exception as exc:
            raise OcrUnavailableError(f"PaddleOCR failed while reading this page: {exc}") from exc
        detections: list[OcrDetection] = []
        for result in results or []:
            payload = _payload(result)
            texts = payload.get("rec_texts") or []
            scores = payload.get("rec_scores") or []
            boxes = payload.get("rec_boxes")
            polys = payload.get("rec_polys") or payload.get("dt_polys") or []
            for index, raw_text in enumerate(texts):
                text = str(raw_text)
                if not text.strip():
                    continue
                box = None
                if boxes is not None and index < len(boxes):
                    try:
                        values = np.asarray(boxes[index], dtype=float).reshape(-1)
                        if values.size >= 4:
                            box = (float(values[0]), float(values[1]), float(values[2]), float(values[3]))
                    except (TypeError, ValueError):
                        box = None
                if box is None and index < len(polys):
                    box = _bbox_from_poly(polys[index])
                if box is None:
                    continue
                try:
                    score = float(scores[index]) if index < len(scores) else 0.0
                except (TypeError, ValueError):
                    score = 0.0
                detections.append(OcrDetection(text=text, confidence=score, bbox=box))
        return detections

    def close(self) -> None:
        self._ocr = None
