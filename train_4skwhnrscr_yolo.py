#!/usr/bin/env python3
"""
train_4skwhnrscr_yolo.py — AlpasFarm YOLOv8 4skwhnrscr Anatomical & Health Trainer
Trains YOLOv8 on the 4skwhnrscr-2 goat dataset (2,991 images, 15,072 bounding boxes).
Supports CUDA GPUs, Apple MPS, and CPU.
"""

import os
import sys
import shutil
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_YAML = ROOT / "yolo_dataset" / "data.yaml"
ML_SERVER_MODELS_DIR = ROOT.parent.parent / "ml-server" / "models" if (ROOT.parent.parent / "ml-server").exists() else ROOT.parent / "ml-server" / "models"

def parse_args():
    parser = argparse.ArgumentParser(description="Train YOLOv8 on AlpasFarm 4skwhnrscr Goat Dataset")
    parser.add_argument("--epochs", type=int, default=50, help="Number of training epochs (default: 50)")
    parser.add_argument("--batch", type=int, default=16, help="Batch size (default: 16)")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size (default: 640)")
    parser.add_argument("--model", type=str, default="yolov8n.pt", help="Base model (yolov8n.pt, yolov8s.pt, yolov8m.pt)")
    parser.add_argument("--device", type=str, default="auto", help="Device to use: '0', 'cpu', 'mps', or 'auto'")
    parser.add_argument("--export-onnx", action="store_true", default=True, help="Export best model to ONNX format")
    return parser.parse_args()

def main():
    args = parse_args()
    
    print("=" * 75)
    print("  AlpasFarm 4skwhnrscr-2 YOLOv8 Goat Anatomical & Health Model Trainer")
    print("=" * 75)
    print(f"  Base Model:       {args.model}")
    print(f"  Dataset Config:   {DATA_YAML}")
    print(f"  Epochs:           {args.epochs}")
    print(f"  Batch Size:       {args.batch}")
    print(f"  Image Size:       {args.imgsz}")
    print(f"  Device:           {args.device}")
    print("-" * 75)

    try:
        from ultralytics import YOLO
    except ImportError:
        print("\n[Error] 'ultralytics' is not installed.")
        print("Please install it using:  pip install ultralytics\n")
        sys.exit(1)

    # 1. Initialize Base Model
    print(f"[1/4] Initializing pretrained base model: {args.model}...")
    model = YOLO(args.model)

    # Determine device
    device = args.device
    if device == "auto":
        import torch
        if torch.cuda.is_available():
            device = "0"
            print(f"  [Auto-Device] NVIDIA CUDA GPU detected ({torch.cuda.get_device_name(0)})! Training with GPU acceleration.")
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
            print("  [Auto-Device] Apple Silicon MPS detected! Training on GPU.")
        else:
            device = "cpu"
            print("  [Auto-Device] Training on CPU.")

    # 2. Train Model
    print(f"\n[2/4] Starting training for {args.epochs} epochs on 4skwhnrscr dataset...")
    results = model.train(
        data=str(DATA_YAML),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        device=device,
        patience=15,          # Early stopping patience
        save=True,
        plots=True,
        project=str(ROOT / "runs"),
        name="4skwhnrscr_goat_train",
        exist_ok=True,
        workers=2,
    )

    # 3. Validate
    print("\n[3/4] Evaluating model performance on validation / test split...")
    metrics = model.val(data=str(DATA_YAML), split="val")
    
    print("\n" + "=" * 55)
    print("  Validation Metrics on 4skwhnrscr Dataset:")
    print("=" * 55)
    print(f"  mAP@0.5:      {metrics.box.map50:.4f}")
    print(f"  mAP@0.5:0.95: {metrics.box.map:.4f}")
    print(f"  Precision:    {metrics.box.mp:.4f}")
    print(f"  Recall:       {metrics.box.mr:.4f}")
    print("-" * 55)

    # 4. Export & Copy Weights to ml-server
    print("\n[4/4] Exporting model artifacts and deploying to ML server...")
    best_weights_src = ROOT / "runs" / "4skwhnrscr_goat_train" / "weights" / "best.pt"
    
    weights_dest_dir = ROOT / "weights"
    weights_dest_dir.mkdir(parents=True, exist_ok=True)
    
    if best_weights_src.exists():
        # Copy to local weights
        shutil.copy(best_weights_src, weights_dest_dir / "best.pt")
        print(f"  [Saved] Copied best weights to: {weights_dest_dir / 'best.pt'}")

        # Copy to ml-server/models/
        ML_SERVER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy(best_weights_src, ML_SERVER_MODELS_DIR / "best.pt")
        print(f"  [Deployed] Copied weights to ML server: {ML_SERVER_MODELS_DIR / 'best.pt'}")

        # Export to ONNX
        if args.export_onnx:
            try:
                print("  [Export] Exporting best model to ONNX format...")
                onnx_path = model.export(format="onnx", imgsz=args.imgsz)
                print(f"  [Export] ONNX model ready: {onnx_path}")
                if Path(onnx_path).exists():
                    shutil.copy(onnx_path, ML_SERVER_MODELS_DIR / "best.onnx")
                    print(f"  [Deployed] Copied ONNX to ML server: {ML_SERVER_MODELS_DIR / 'best.onnx'}")
            except Exception as e:
                print(f"  [Warning] ONNX export skipped: {e}")

    print("\n" + "=" * 75)
    print("  [SUCCESS] 4skwhnrscr YOLOv8 model is trained and deployed to ML server!")
    print("=" * 75)

if __name__ == "__main__":
    main()
