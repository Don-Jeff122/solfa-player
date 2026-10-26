from __future__ import annotations

import os
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.ocr_engine import PaddleOcrEngine

RUN = os.environ.get("SOLFA_RUN_OCR_TESTS") == "1"


@pytest.mark.skipif(not RUN, reason="set SOLFA_RUN_OCR_TESTS=1 to run PaddleOCR")
def test_real_paddle_ocr_reads_solfa(tmp_path: Path):
    image_path = tmp_path / "solfa.png"
    image = Image.new("RGB", (1100, 320), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 46)
    draw.text((40, 35), "Key: C", fill="black", font=font)
    draw.text((40, 125), "S: d : d | m : - | s : -", fill="black", font=font)
    draw.text((40, 215), "A: m : m | s : - | d : -", fill="black", font=font)
    image.save(image_path)

    engine = PaddleOcrEngine(lang="en", score_threshold=0.0)
    try:
        detections = engine.recognize(__import__("cv2").imread(str(image_path)))
    finally:
        engine.close()
    text = "\n".join(item.text for item in detections)
    assert "d" in text.lower()
    assert "|" in text
    assert ":" in text
