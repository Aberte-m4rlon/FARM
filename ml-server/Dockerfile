FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libxcb1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bundle the small COCO model used to reject people misclassified as livestock.
# This keeps runtime detection independent from a first-use download.
RUN python -c "from ultralytics import YOLO; model = YOLO('yolo11n.pt'); assert 0 in model.names"

# Copy application source
COPY app/ ./app/
COPY healthcheck.py ./healthcheck.py

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Start uvicorn — use PORT env var (Cloud Run sets this), default 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
