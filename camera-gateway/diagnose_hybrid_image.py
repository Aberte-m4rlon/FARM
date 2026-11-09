"""Developer-only audit of one saved CCTV image through the existing pipeline."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("YOLO_PERSON_MODEL_NAME", str(ROOT / "ml-server" / "yolo11n.pt"))
sys.path.insert(0, str(ROOT / "ml-server"))
sys.path.insert(0, str(ROOT / "camera-gateway"))

from app import species_detector  # noqa: E402
from diagnose_hybrid_recording import save_four_panel  # noqa: E402
from inference import LocalCameraCounter  # noqa: E402
from species_detection import DEFAULT_STATIC_BACKGROUND_REGIONS, SpeciesDetectionWorker  # noqa: E402


def _parse_crop(value: str | None, width: int, height: int) -> tuple[int, int, int, int]:
    if not value:
        return 0, 0, width, height
    try:
        x1, y1, x2, y2 = (int(part.strip()) for part in value.split(","))
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("crop must be x1,y1,x2,y2") from None
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        raise argparse.ArgumentTypeError("crop coordinates must fit inside the image")
    return x1, y1, x2, y2


def diagnose(image_path: Path, crop: str | None, output: Path, source_has_ui_overlays: bool) -> dict[str, Any]:
    source = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if source is None or source.size == 0:
        raise RuntimeError(f"Could not read image: {image_path}")
    x1, y1, x2, y2 = _parse_crop(crop, source.shape[1], source.shape[0])
    frame = source[y1:y2, x1:x2].copy()
    height, width = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    response = species_detector.detect(
        Image.fromarray(rgb),
        include_identification=False,
        include_debug=True,
        device="cpu",
    )
    model_status = species_detector.model_status()
    worker = SpeciesDetectionWorker(
        "http://127.0.0.1:8000/api/v1/detect",
        "offline-image-audit",
        str(model_status.get("model_sha256") or "0" * 64),
        excluded_regions=DEFAULT_STATIC_BACKGROUND_REGIONS,
    )
    body = {**response, "success": True, "image": {"width": width, "height": height}}
    camera_filtered, raw_detections, rejected = worker._prepare_predictions(body, width, height)
    developer = response.get("developer_diagnostics", {})
    ml_filtered = developer.get("filtered_detections", response.get("predictions", []))

    counter = LocalCameraCounter(
        hybrid_mode=True,
        hybrid_excluded_regions=worker.excluded_regions,
        outbox_path=output / "offline-crossings-outbox.json",
    )
    track_result = counter.process(
        frame,
        species_detections=list(camera_filtered),
        detector_timestamp=time.monotonic(),
    )
    output.mkdir(parents=True, exist_ok=True)
    save_four_panel(
        output / "diagnostic.jpg",
        frame,
        list(raw_detections),
        list(ml_filtered) if isinstance(ml_filtered, list) else [],
        list(camera_filtered),
        list(rejected),
        track_result.get("predictions", []),
        0.0,
        source_note="UI overlay in source" if source_has_ui_overlays else None,
    )
    report = {
        "source_image": str(image_path.resolve()),
        "crop_xyxy": [x1, y1, x2, y2],
        "source_has_ui_overlays": source_has_ui_overlays,
        "input_overlay_warning": (
            "Visible rectangles/text in this input are baked into the source screenshot; "
            "they are not outputs from this diagnostic pass."
            if source_has_ui_overlays else None
        ),
        "image_size": [width, height],
        "model_version": model_status.get("version"),
        "model_sha256": model_status.get("model_sha256"),
        "confidence_threshold": model_status.get("confidence_threshold"),
        "image_size_inference": model_status.get("image_size"),
        "raw_detections": list(raw_detections),
        "ml_geometry_filtered_detections": ml_filtered,
        "camera_filtered_detections": list(camera_filtered),
        "rejected_detections": list(rejected),
        "opencv_tracking": track_result.get("predictions", []),
        "crossing_events": track_result.get("crossings", []),
    }
    (output / "diagnostic.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--crop", help="Optional image crop as x1,y1,x2,y2")
    parser.add_argument("--source-has-ui-overlays", action="store_true")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "state" / "hybrid-debug" / "still-image",
    )
    args = parser.parse_args()
    if not args.image.is_file():
        parser.error("image must exist")
    report = diagnose(args.image, args.crop, args.output, args.source_has_ui_overlays)
    print(json.dumps({key: value for key, value in report.items() if key not in {
        "raw_detections", "ml_geometry_filtered_detections", "camera_filtered_detections",
        "rejected_detections", "opencv_tracking",
    }}, indent=2))
    print(f"Developer diagnostic view: {(args.output / 'diagnostic.jpg').resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
