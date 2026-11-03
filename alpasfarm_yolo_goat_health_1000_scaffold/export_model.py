#!/usr/bin/env python3
"""
export_model.py — Export trained YOLO weights to ONNX / TorchScript / TFLite
"""

import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEIGHTS_FILE = ROOT / "runs" / "goat_health_train" / "weights" / "best.pt"
ML_SERVER_MODELS_DIR = ROOT.parent / "ml-server" / "models"

def main():
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[Error] ultralytics not installed. Run: pip install ultralytics")
        sys.exit(1)

    weights_path = WEIGHTS_FILE if WEIGHTS_FILE.exists() else (ROOT / "weights" / "best.pt")
    if not weights_path.exists():
        print(f"[Error] Weights file not found at {weights_path}. Train first using train_yolo.py")
        sys.exit(1)

    print(f"Loading weights from {weights_path}...")
    model = YOLO(str(weights_path))

    print("Exporting to ONNX...")
    onnx_file = model.export(format="onnx", imgsz=640)
    print(f"ONNX Export completed: {onnx_file}")

    # Copy to ML server models
    ML_SERVER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if Path(onnx_file).exists():
        dest = ML_SERVER_MODELS_DIR / "best.onnx"
        shutil.copy(onnx_file, dest)
        print(f"Copied to ML server: {dest}")

if __name__ == "__main__":
    main()
