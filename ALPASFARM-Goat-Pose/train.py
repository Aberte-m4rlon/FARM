#!/usr/bin/env python3
"""
ALPASFARM: YOLO Pose Model Training and ONNX Export Script
Trains YOLO11n-pose (or YOLOv8n-pose) on the ALPASFARM Dairy Goat Pose Dataset.
Exports the trained model to ONNX format for web deployment and real-time inference.

Usage:
    python train.py --epochs 50 --batch 16 --imgsz 640 --device auto
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from datetime import datetime

def train_and_export(args):
    root_dir = Path(__file__).parent.resolve()
    yaml_path = root_dir / "data.yaml"

    if not yaml_path.exists():
        print(f"Error: data.yaml not found at {yaml_path}. Run convert_coco_to_yolo.py first.")
        sys.exit(1)

    try:
        import torch
        from ultralytics import YOLO
    except ImportError:
        print("Error: ultralytics or torch is not installed. Please install them first.")
        sys.exit(1)

    device = args.device
    if device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'

    print("="*60)
    print("ALPASFARM GOAT POSE MODEL TRAINING")
    print("="*60)
    print(f"Dataset YAML: {yaml_path}")
    print(f"Base Model: {args.model}")
    print(f"Epochs: {args.epochs}")
    print(f"Batch Size: {args.batch}")
    print(f"Image Size: {args.imgsz}")
    print(f"Device: {device}")
    print(f"Learning Rate: {args.lr}")
    print("="*60)

    # Initialize YOLO Pose model
    model = YOLO(args.model)

    output_dir = root_dir / "runs" / "pose" / "alpasfarm_goat_pose"
    if output_dir.exists() and args.overwrite:
        shutil.rmtree(output_dir, ignore_errors=True)

    # Train model
    results = model.train(
        data=str(yaml_path),
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        lr0=args.lr,
        device=device,
        project=str(root_dir / "runs" / "pose"),
        name="alpasfarm_goat_pose",
        exist_ok=True,
        pretrained=True,
        pose=12.0,       # High priority for 14 keypoint anatomical accuracy
        box=7.5,
        cls=0.5,
        fliplr=0.5,      # Left-right symmetric anatomical flipping
        flipud=0.0,      # No vertical upside-down flip for goats
        verbose=True
    )

    best_pt = root_dir / "runs" / "pose" / "alpasfarm_goat_pose" / "weights" / "best.pt"
    if not best_pt.exists():
        best_pt = root_dir / "runs" / "pose" / "alpasfarm_goat_pose" / "weights" / "last.pt"

    dest_best_pt = root_dir / "best.pt"
    if best_pt.exists():
        shutil.copy2(best_pt, dest_best_pt)
        print(f"\nSaved best PyTorch weights to: {dest_best_pt}")

    # Export to ONNX
    print("\n" + "="*60)
    print("EXPORTING TO ONNX FOR WEB & REAL-TIME SCANNER")
    print("="*60)
    
    export_model = YOLO(str(dest_best_pt if dest_best_pt.exists() else best_pt))
    onnx_path = export_model.export(
        format='onnx',
        imgsz=args.imgsz,
        dynamic=False,
        simplify=True,
        opset=12
    )

    dest_onnx = root_dir / "best.onnx"
    if os.path.exists(str(onnx_path)) and str(onnx_path) != str(dest_onnx):
        shutil.copy2(str(onnx_path), dest_onnx)

    print(f"\nExport complete! ONNX model saved to: {dest_onnx}")

    summary = {
        'model_name': args.model,
        'epochs': args.epochs,
        'imgsz': args.imgsz,
        'batch': args.batch,
        'device': device,
        'weights_pt': str(dest_best_pt),
        'model_onnx': str(dest_onnx),
        'timestamp': datetime.now().isoformat()
    }

    with open(root_dir / "training_summary.json", 'w') as f:
        json.dump(summary, f, indent=2)

    print("Training summary saved to training_summary.json")
    print("="*60)

def main():
    parser = argparse.ArgumentParser(description="Train ALPASFARM YOLO Pose model")
    parser.add_argument("--model", default="yolo11n-pose.pt", help="Pretrained YOLO pose model (yolo11n-pose.pt or yolov8n-pose.pt)")
    parser.add_argument("--epochs", type=int, default=30, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Image resolution")
    parser.add_argument("--lr", type=float, default=0.01, help="Initial learning rate")
    parser.add_argument("--device", default="auto", help="Device: auto, cpu, cuda, or device index")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite previous run")

    args = parser.parse_args()
    train_and_export(args)

if __name__ == '__main__':
    main()
