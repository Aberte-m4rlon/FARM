#!/usr/bin/env python3
"""
Test inference on a real goat test image using Ultralytics YOLO Pose
and generate an annotated diagnostic output image.
"""

import sys
import os
from pathlib import Path
import cv2
from ultralytics import YOLO

def test_inference():
    root = Path(__file__).parent.resolve()
    test_img_path = root / "images" / "test" / "kpimg_0002.png"
    
    if not test_img_path.exists():
        print(f"Error: {test_img_path} not found")
        sys.exit(1)

    print(f"Loading YOLO11n-pose model for test inference...")
    model = YOLO("yolo11n-pose.pt")

    print(f"Running inference on {test_img_path}...")
    results = model(str(test_img_path), conf=0.25)

    res = results[0]
    annotated = res.plot()

    output_path = root / "test_inference_result.png"
    cv2.imwrite(str(output_path), annotated)

    print(f"Inference completed successfully!")
    print(f"Detections count: {len(res.boxes)}")
    print(f"Saved annotated test output to: {output_path}")

if __name__ == '__main__':
    test_inference()
