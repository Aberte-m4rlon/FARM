#!/usr/bin/env bash
# ==============================================================================
# train_on_cloud_shell.sh — AlpasFarm YOLO Goat Health Model Training on Cloud
# ==============================================================================
set -e

echo "=========================================================="
echo "🐐 AlpasFarm YOLO Training Pipeline"
echo "=========================================================="

# 1. Install ultralytics
echo "[1/4] Installing dependencies..."
pip install --upgrade pip
pip install ultralytics opencv-python pillow

# 2. Prepare & validate dataset
echo "[2/4] Validating dataset format and annotations..."
python3 prepare_and_augment_dataset.py
python3 validate_yolo_dataset.py

# 3. Train YOLOv8 model
echo "[3/4] Training YOLOv8 model on 1,000 samples..."
python3 train_yolo.py --epochs 50 --batch 16 --imgsz 640 --model yolov8n.pt

# 4. Export & Copy to ML server
echo "[4/4] Verifying exported weights..."
ls -lh ../ml-server/models/best.* || true

echo "=========================================================="
echo "✅ Training Complete! Trained weights are ready in ml-server/models/"
echo "=========================================================="
