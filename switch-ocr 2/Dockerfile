# Production container — CPU-only, PaddleOCR backend.
FROM python:3.11-slim

# libgomp1: OpenMP runtime required by paddlepaddle; libgl/glib for OpenCV.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY switch_ocr ./switch_ocr
RUN pip install --no-cache-dir ".[paddle]"

# Pre-download the OCR models at build time so containers start instantly
# and can run with the network disabled.
RUN python -c "from switch_ocr import SwitchTextReader; SwitchTextReader().warmup()"

# Drop root.
RUN useradd -m ocr && mkdir -p /data && chown -R ocr:ocr /data /home/ocr
USER ocr

ENTRYPOINT ["switch-ocr"]
CMD ["--help"]
# Usage:
#   docker build -t switch-ocr .
#   docker run --rm -v "$PWD/photos:/data" switch-ocr /data -o /data/out --csv
