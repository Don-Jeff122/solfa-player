from __future__ import annotations

import time
from io import BytesIO
from pathlib import Path

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app.config import Settings
from app.main import create_app
from app.ocr_engine import OcrDetection

FONT_PATH = Path(r"C:\Windows\Fonts\arial.ttf")


class FakeOcrEngine:
    description = "Fake OCR (tests only)"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def recognize(self, image):  # noqa: ANN001
        self.calls += 1
        if self.fail:
            raise RuntimeError("backend test failure")
        return [
            OcrDetection("S: d : d | m : - | s : -", 0.94, (30, 30, 760, 92)),
            OcrDetection("A: m : m | s : - | d : -", 0.54, (30, 145, 760, 207)),
        ]

    def close(self) -> None:
        pass


def png_bytes(width: int = 900, height: int = 260) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype(str(FONT_PATH), 40)
    except OSError:
        font = ImageFont.load_default()
    draw.text((30, 30), "S: d : d | m : - | s : -", fill="black", font=font)
    draw.text((30, 145), "A: m : m | s : - | d : -", fill="black", font=font)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def pdf_bytes(pages: int = 2) -> bytes:
    document = fitz.open()
    for index in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 100), f"Page {index + 1}")
        page.insert_text((72, 140), "S: d : d | m : - | s : -")
    data = document.tobytes()
    document.close()
    return data


def wait_for_scan(client: TestClient, document_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    status: dict = {}
    while time.time() < deadline:
        response = client.get(f"/api/scan/{document_id}")
        assert response.status_code == 200, response.text
        status = response.json()
        if status["status"] not in {"queued", "processing"}:
            return status
        time.sleep(0.05)
    raise AssertionError(f"scan did not finish: {status}")


def make_client(tmp_path: Path, engine: FakeOcrEngine | None = None, **overrides) -> TestClient:
    defaults = {
        "data_dir": tmp_path / "data",
        "ttl_seconds": 3600,
        "max_upload_mb": 2,
        "max_pages": 5,
        "max_image_side": 1600,
        "min_image_long_side": 800,
    }
    defaults.update(overrides)
    settings = Settings(**defaults)
    app = create_app(settings=settings, engine=engine or FakeOcrEngine())
    return TestClient(app)


@pytest.fixture
def engine() -> FakeOcrEngine:
    return FakeOcrEngine()


@pytest.fixture
def client(tmp_path: Path, engine: FakeOcrEngine):
    with make_client(tmp_path, engine=engine) as test_client:
        yield test_client
