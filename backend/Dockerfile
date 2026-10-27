FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    PADDLE_PDX_CACHE_HOME=/app/.paddlex \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT=False \
    SOLFA_SCAN_DATA_DIR=/tmp/solfa-scan \
    SOLFA_SCAN_CORS_ORIGINS=https://don-jeff122.github.io,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 user

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

COPY app ./app

RUN python - <<'PY'
import numpy as np
from paddleocr import PaddleOCR

ocr = PaddleOCR(
    lang="en",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    text_det_limit_side_len=2600,
    text_det_limit_type="max",
    text_rec_score_thresh=0.0,
    text_recognition_batch_size=6,
)
list(ocr.predict(np.full((96, 640, 3), 255, dtype=np.uint8)))
PY

RUN chown -R user:user /app

USER user

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
