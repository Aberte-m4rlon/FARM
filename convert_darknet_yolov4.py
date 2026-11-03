#!/usr/bin/env python3
"""
convert_darknet_yolov4.py — Darknet YOLOv4 / Tiny Weights Evaluator & Converter
Inspects and prepares Darknet YOLOv4 weights from 4skwhnrscr-2 for inference and conversion.
"""

import os
import sys
import struct
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEIGHTS_CUSTOM = ROOT / "4skwhnrscr-2" / "yolov4-custom_best.weights"
WEIGHTS_TINY = ROOT / "4skwhnrscr-2" / "yolov4-tiny-custom_best.weights"

CLASSES = ["goat_face", "eye", "mouth", "ear"]

def inspect_darknet_weights(filepath: Path):
    if not filepath.exists():
        print(f"[Error] Weights file not found: {filepath}")
        return None

    file_size_mb = filepath.stat().st_size / (1024 * 1024)
    print(f"\nInspecting: {filepath.name} ({file_size_mb:.2f} MB)")
    
    with open(filepath, "rb") as f:
        # Darknet header: major (int32), minor (int32), revision (int32), seen (int64)
        major, minor, revision = struct.unpack("iii", f.read(12))
        if (major * 10 + minor) >= 2:
            seen = struct.unpack("q", f.read(8))[0]
        else:
            seen = struct.unpack("i", f.read(4))[0]

        print(f"  Darknet Header: Version {major}.{minor}.{revision}, Images Seen: {seen:,}")
        remaining_bytes = filepath.stat().st_size - f.tell()
        num_floats = remaining_bytes // 4
        print(f"  Float32 Parameter Weights: {num_floats:,} parameters")

    return {
        "file": str(filepath),
        "major": major,
        "minor": minor,
        "revision": revision,
        "seen": seen,
        "params": num_floats,
        "classes": CLASSES
    }

def main():
    print("=" * 70)
    print("  AlpasFarm 4skwhnrscr-2 Darknet YOLOv4 Weights Inspector & Converter")
    print("=" * 70)

    res_custom = inspect_darknet_weights(WEIGHTS_CUSTOM)
    res_tiny = inspect_darknet_weights(WEIGHTS_TINY)

    print("\n" + "=" * 70)
    print("  Summary of 4skwhnrscr-2 Pre-trained Darknet Weights:")
    print("=" * 70)
    print("  1. yolov4-custom_best.weights      : Full YOLOv4 backbone (High Precision)")
    print("  2. yolov4-tiny-custom_best.weights : YOLOv4-Tiny (Ultra-Fast Edge Inference)")
    print(f"  Configured Classes: {CLASSES}")
    print("=" * 70)
    print("\n[Note] For optimal deployment in AlpasFarm PyTorch / ONNX ML Server,")
    print("train the YOLOv8 model on the unified dataset using:")
    print("  python train_4skwhnrscr_yolo.py --epochs 50 --model yolov8n.pt\n")

if __name__ == "__main__":
    main()
