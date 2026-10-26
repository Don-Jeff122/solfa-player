from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "SOLFA_SCAN_DATA_DIR",
                str(Path(tempfile.gettempdir()) / "solfa-scan"),
            )
        )
    )
    max_upload_mb: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_MAX_UPLOAD_MB", 25))
    max_pages: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_MAX_PAGES", 40))
    max_image_side: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_MAX_IMAGE_SIDE", 2600))
    min_image_long_side: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_MIN_IMAGE_LONG_SIDE", 1400))
    pdf_dpi: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_PDF_DPI", 220))
    ttl_seconds: int = field(default_factory=lambda: _int_env("SOLFA_SCAN_TTL_SECONDS", 7200))
    uncertain_threshold: float = field(
        default_factory=lambda: _float_env("SOLFA_SCAN_UNCERTAIN_THRESHOLD", 0.72)
    )
    ocr_lang: str = field(default_factory=lambda: os.environ.get("SOLFA_OCR_LANG", "en"))
    ocr_score_threshold: float = field(
        default_factory=lambda: _float_env("SOLFA_OCR_SCORE_THRESHOLD", 0.0)
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in os.environ.get(
                "SOLFA_SCAN_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173,"
                "http://localhost:4173,http://127.0.0.1:4173",
            ).split(",")
            if origin.strip()
        )
    )

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024
