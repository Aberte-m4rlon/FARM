# ALPASFARM detector audit

Date: 2026-10-04

## Active Smart Gate flow

1. `src/pages/LivestockMonitoringPage.tsx` starts the browser camera and waits for a real frame.
2. `src/lib/gateDetection.ts` sends camera frames to `/api/gate/detect` with the signed-in Supabase token.
3. `api/gate/detect.ts` verifies that user and forwards the image and server-only ML key to the private FastAPI service.
4. `ml-server/app/species_detector.py` loads only the configured YOLO checkpoint, checks its exact `goat`/`sheep` labels, performs inference, and returns actual boxes/counts/confidences.
5. `src/lib/gateTracking.ts` assigns temporary track IDs and estimates line crossings from detections. QR reading and registered animal lookup are separate; identity/event persistence only follows QR verification.
6. The existing gate service and migrations persist verified camera crossings, QR identity, and movement observations.

The web camera is a phone/laptop browser camera only. No Tapo C320WS RTSP capture or background camera gateway exists in this repository. The page must remain active and authorized by the browser for this path to work.

## Previous detector (retired)

- Historical private checkpoint: `ml-server/models/best.pt`, YOLO11n, classes `goat`, `sheep`.
- SHA-256: `b3fb34569081c821b7338f4823f2d123b4a4529b191a26f2ed5181e02fe8621b`.
- Checkpoint metadata: 50 epochs, 640 image size, batch 8, source config `/content/AlpasFarm_SplitV2/data.yaml`, saved 2026-10-01.
- Checkpoint metadata is not the original dataset or a held-out evaluation. `AlpasFarm_SplitV2` data/config and a compatible report are absent from this checkout.
- The repository's training-angle photos confirm only basic loading/smoke inference. They do not establish precision, recall, mAP, empty-gate rejection, or real-farm performance.

This checkpoint is no longer selected by the app. Runtime now expects the next reviewed detector in `ml-server/models/active/best.pt`; until then, species inference reports `model_unavailable`. The prior private weights remain as historical local files and are not mounted by the Hostinger configuration.

The user reported goat/sheep boxes on an empty room/bed camera view. Treat that as a real false-positive failure case. The raw, labeled camera clip needed to build a repeatable hard-negative test set is not available here. Do not tune the confidence threshold or promote weights based only on screenshots or random frames.

`public/models/goat_sheep_yolov8n.onnx` is a different, older training artifact and is not the active detector. Historical metrics for it must not be presented as metrics for the previous YOLO11n checkpoint or a future model.

## Separate sheep activity model

`sheep_activity_v1.npz` is a five-label sheep activity classifier, not a goat/sheep detector and not an abnormal-gait model. Its held-out accuracy is 54.7% and macro F1 is 0.532. It is not authorized to create a disease or gait diagnosis. The QR-linked movement observations remain a separate track-position screening and always require a verified QR before attaching an alert to a registered animal.

## Current gaps and safeguards

- The detector source dataset and per-camera false-positive test set are missing; species retraining stops until a real annotated YOLO train/val/test set and source-group manifest are supplied.
- The former class-folder preparation tool generated guessed center boxes; it has been replaced with a strict validator that rejects missing/invalid labels, cross-split source-group leakage, and duplicate image content.
- The candidate trainer writes a versioned private candidate, a test report, an ONNX export/comparison, and benchmark. It never replaces production weights or marks a model production-ready.
- Admin diagnostics now use a separate authenticated endpoint. Aggregate inference counts/latency are not returned to ordinary farm-user health checks.
- Production quality is unverified until labeled Tapo C320WS day/night, empty-gate, people/dog/object, multi-animal, partial-occlusion, and animal-crossing footage passes.

See [`ml-server/README.md`](ml-server/README.md) for the complete dataset format, run commands, version selection, and new model setup.
