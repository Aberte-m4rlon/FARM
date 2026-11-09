"""Offline developer replay for the existing Tapo hybrid detector/tracker.

This utility reads a local recording, runs the configured ML model and the same
camera filtering/OpenCV tracking classes as the gateway, and writes diagnostics
under state/hybrid-debug. It never opens a camera or contacts the ALPASFARM API.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import cv2
from PIL import Image
try:
    import psutil
except ImportError:  # Optional measurement; inference itself has no psutil dependency.
    psutil = None


ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("YOLO_PERSON_MODEL_NAME", str(ROOT / "ml-server" / "yolo11n.pt"))
sys.path.insert(0, str(ROOT / "ml-server"))
sys.path.insert(0, str(ROOT / "camera-gateway"))

from app import species_detector  # noqa: E402
from inference import LocalCameraCounter  # noqa: E402
from species_detection import (  # noqa: E402
    DEFAULT_STATIC_BACKGROUND_REGIONS,
    DetectionSnapshot,
    SpeciesDetectionWorker,
)


def draw_boxes(
    frame: np.ndarray,
    detections: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    color: tuple[int, int, int],
    *,
    reason: str = "",
) -> np.ndarray:
    image = frame.copy()
    for item in detections:
        bbox = item.get("bbox", {})
        try:
            x1, y1, x2, y2 = (int(round(float(bbox[key]))) for key in ("x1", "y1", "x2", "y2"))
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        label = f"{item.get('class', '?')} {float(item.get('confidence', 0)):.2f}"
        label += f" {item.get('rejection_reason', reason)}" if item.get("rejection_reason") or reason else ""
        cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
        cv2.putText(image, label, (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)
    return image


def save_four_panel(
    output: Path,
    frame: np.ndarray,
    raw: list[dict[str, Any]],
    ml_filtered: list[dict[str, Any]],
    camera_filtered: list[dict[str, Any]],
    rejected: list[dict[str, Any]],
    tracks: list[dict[str, Any]],
    seconds: float,
    source_note: str | None = None,
) -> None:
    raw_view = draw_boxes(frame, raw, (255, 160, 0))
    ml_view = draw_boxes(frame, ml_filtered, (0, 210, 0))
    camera_view = draw_boxes(frame, rejected, (0, 0, 255))
    camera_view = draw_boxes(camera_view, camera_filtered, (0, 210, 0))
    track_view = frame.copy()
    for item in tracks:
        bbox = item.get("bbox", {})
        if not isinstance(bbox, dict):
            continue
        try:
            x1, y1, x2, y2 = (int(float(bbox[key])) for key in ("x1", "y1", "x2", "y2"))
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        state = str(item.get("tracking_state", item.get("state", "TRACKED")))
        color = (0, 200, 255) if state in {"TEMPORARILY_STATIONARY", "WAITING_TO_CROSS", "TEMPORARILY_OCCLUDED"} else (0, 255, 0)
        cv2.rectangle(track_view, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            track_view,
            f"T-{item.get('tracking_id', '?')} {item.get('class', '?')} {state}",
            (x1, max(14, y1 - 4)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            color,
            1,
            cv2.LINE_AA,
        )
    source_title = f"Source / {source_note}" if source_note else "Original"
    panels = [
        (source_title, frame),
        ("Raw ML (blue)", raw_view),
        ("After ML geometry", ml_view),
        ("Camera filtered / tracks; rejected red", cv2.addWeighted(track_view, 0.75, camera_view, 0.25, 0)),
    ]
    tiles = []
    for title, image in panels:
        tile = image.copy()
        cv2.rectangle(tile, (0, 0), (tile.shape[1], 24), (12, 20, 26), -1)
        cv2.putText(tile, f"{title} | t={seconds:.1f}s", (8, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)
    composite = cv2.vconcat([cv2.hconcat(tiles[:2]), cv2.hconcat(tiles[2:])])
    cv2.imwrite(str(output), composite, [cv2.IMWRITE_JPEG_QUALITY, 88])


def replay(recording: Path, start: float, duration: float, infer_every: int, output: Path, diagnostic_seconds: set[int]) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(recording))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open recording: {recording}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 10.0)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    start_frame = max(0, int(start * fps))
    end_frame = min(total_frames, int((start + duration) * fps))
    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    status = species_detector.model_status()
    if not status.get("model_loaded"):
        species_detector.load_species_model()
        status = species_detector.model_status()
    if status.get("classes") != ["goat", "sheep"]:
        raise RuntimeError(f"Expected goat/sheep class order, got {status.get('classes')}")
    weights_sha256 = str(status.get("model_sha256") or "")
    worker = SpeciesDetectionWorker(
        "http://127.0.0.1:8000/api/v1/detect",
        "offline-replay",
        weights_sha256 or "0" * 64,
        excluded_regions=DEFAULT_STATIC_BACKGROUND_REGIONS,
    )
    worker._debug_enabled = False
    worker._debug_dir = output
    counter = LocalCameraCounter(
        hybrid_mode=True,
        hybrid_excluded_regions=worker.excluded_regions,
        outbox_path=output / "offline-crossings-outbox.json",
    )
    counter._debug_enabled = True
    counter._debug_dir = output
    counter.set_gate_settings(0.57, "top-to-bottom")

    last_detections: list[dict[str, Any]] = []
    last_detector_timestamp: float | None = None
    next_sequence = 0
    processed = 0
    inference_samples: list[dict[str, Any]] = []
    track_ids: set[str] = set()
    total_raw = 0
    total_after_ml_filter = 0
    total_after_camera_filter = 0
    total_static_rejections = 0
    last_result: dict[str, Any] = {"predictions": [], "crossings": []}
    process = psutil.Process() if psutil is not None else None
    cpu_started = process.cpu_times() if process is not None else None
    peak_rss_bytes = process.memory_info().rss if process is not None else None
    replay_started = time.perf_counter()

    for frame_index in range(start_frame, end_frame):
        ok, frame = capture.read()
        if not ok:
            break
        offset = frame_index - start_frame
        video_seconds = frame_index / fps
        height, width = frame.shape[:2]
        snapshot_for_frame: DetectionSnapshot | None = None
        if offset % max(1, infer_every) == 0:
            captured_at = time.monotonic()
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            response = species_detector.detect(
                Image.fromarray(rgb),
                include_identification=False,
                include_debug=True,
                device="cpu",
            )
            completed_at = time.monotonic()
            filtered, raw, rejected = worker._prepare_predictions(response, width, height)
            next_sequence += 1
            snapshot_for_frame = DetectionSnapshot(
                next_sequence,
                captured_at,
                completed_at,
                filtered,
                float(response.get("inference_ms", 0.0)),
                str(response.get("model_version") or status.get("version") or "unknown"),
                raw,
                rejected,
            )
            raw_total = len(raw)
            rejected_camera = [item for item in rejected if str(item.get("rejection_reason", "")).startswith("static_background_region_")]
            ml_filtered = response.get("predictions", [])
            total_raw += raw_total
            total_after_ml_filter += len(ml_filtered) if isinstance(ml_filtered, list) else 0
            total_after_camera_filter += len(filtered)
            total_static_rejections += len(rejected_camera)
            inference_samples.append({
                "video_seconds": round(video_seconds, 2),
                "raw_ml_detections": raw,
                "ml_filtered_detections": ml_filtered,
                "camera_filtered_detections": filtered,
                "rejected_detections": rejected,
                "inference_ms": response.get("inference_ms"),
            })
            last_detections = list(filtered)
            last_detector_timestamp = captured_at

        last_result = counter.process(
            frame,
            species_detections=last_detections,
            detector_timestamp=last_detector_timestamp,
        )
        if snapshot_for_frame is not None and inference_samples:
            inference_samples[-1]["tracked_predictions"] = last_result.get("predictions", [])
            inference_samples[-1]["tracking_states"] = counter._last_motion_diagnostics.get("states", {})
            inference_samples[-1]["tracking_diagnostics"] = {
                key: counter._last_motion_diagnostics.get(key)
                for key in ("optical_flow_tracks", "static_background_rejections", "detector_timeout_expirations")
            }
        processed += 1
        if process is not None and processed % 100 == 0:
            peak_rss_bytes = max(peak_rss_bytes or 0, process.memory_info().rss)
        for prediction in last_result.get("predictions", []):
            track_ids.add(str(prediction.get("tracking_id")))

        rounded_second = round(video_seconds)
        if rounded_second in diagnostic_seconds and snapshot_for_frame is not None:
            debug = response.get("developer_diagnostics", {})
            raw = list(snapshot_for_frame.raw_detections)
            ml_filtered = debug.get("filtered_detections", response.get("predictions", []))
            save_four_panel(
                output / f"diagnostic-t{rounded_second:03d}s.jpg",
                frame,
                raw,
                ml_filtered if isinstance(ml_filtered, list) else [],
                list(snapshot_for_frame.detections),
                list(snapshot_for_frame.rejected_detections),
                last_result.get("predictions", []),
                video_seconds,
            )
            counter._last_debug_write_at = 0.0
            counter._save_hybrid_debug(frame, last_result.get("predictions", []), time.monotonic())

    capture.release()
    replay_wall_seconds = max(time.perf_counter() - replay_started, 1e-6)
    cpu_finished = process.cpu_times() if process is not None else None
    process_cpu_seconds = (
        (cpu_finished.user + cpu_finished.system) - (cpu_started.user + cpu_started.system)
        if cpu_started is not None and cpu_finished is not None else None
    )
    inference_latencies = sorted(
        float(sample["inference_ms"])
        for sample in inference_samples
        if isinstance(sample.get("inference_ms"), (int, float))
    )
    report = {
        "recording": str(recording.resolve()),
        "start_seconds": start,
        "duration_seconds_requested": duration,
        "video_fps": fps,
        "frames_processed": processed,
        "replay_wall_seconds": round(replay_wall_seconds, 2),
        "replay_processing_fps": round(processed / replay_wall_seconds, 2),
        "process_cpu_percent_of_one_core": round(process_cpu_seconds / replay_wall_seconds * 100, 1)
        if process_cpu_seconds is not None else None,
        "process_peak_rss_mb": round((peak_rss_bytes or 0) / (1024 * 1024), 1)
        if peak_rss_bytes is not None else None,
        "ml_image_size": status.get("image_size"),
        "ml_confidence_threshold": status.get("confidence_threshold"),
        "model_version": status.get("version"),
        "model_sha256": weights_sha256,
        "default_background_regions": DEFAULT_STATIC_BACKGROUND_REGIONS,
        "inference_samples": len(inference_samples),
        "mean_ml_inference_ms": round(sum(inference_latencies) / len(inference_latencies), 2)
        if inference_latencies else None,
        "p95_ml_inference_ms": inference_latencies[min(len(inference_latencies) - 1, int(len(inference_latencies) * 0.95))]
        if inference_latencies else None,
        "raw_model_boxes_total": total_raw,
        "after_ml_geometry_total": total_after_ml_filter,
        "after_camera_filter_total": total_after_camera_filter,
        "static_background_rejections_total": total_static_rejections,
        "unique_displayed_track_ids": sorted(track_ids),
        "last_count_result": last_result,
        "samples": inference_samples,
    }
    (output / "replay-summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("--start", type=float, default=110.0, help="Starting time in seconds")
    parser.add_argument("--duration", type=float, default=80.0, help="Replay duration in seconds")
    parser.add_argument("--infer-every", type=int, default=10, help="Run ML every N decoded frames")
    parser.add_argument("--debug-dir", type=Path, default=Path(__file__).resolve().parent / "state" / "hybrid-debug")
    parser.add_argument("--diagnostic-seconds", default="115,120,125,130,135,165,180")
    args = parser.parse_args()
    if not args.recording.is_file() or args.start < 0 or args.duration <= 0 or args.infer_every < 1:
        parser.error("recording must exist and start/duration/infer-every must be valid")
    diagnostic_seconds = {int(part) for part in args.diagnostic_seconds.split(",") if part.strip().isdigit()}
    args.debug_dir.mkdir(parents=True, exist_ok=True)
    report = replay(args.recording, args.start, args.duration, args.infer_every, args.debug_dir, diagnostic_seconds)
    print(json.dumps({key: value for key, value in report.items() if key != "samples" and key != "last_count_result"}, indent=2))
    print(f"Developer diagnostics written to: {args.debug_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
