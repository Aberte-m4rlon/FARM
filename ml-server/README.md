# ALPASFARM camera ML

## Current architecture

The Smart Gate supports a browser device camera for interactive use and a farm RTSP camera through `camera-gateway/`. In production, the persistent gateway is intended to run on AWS; the workstation gateway is for development only. Device-camera frames use the authenticated `/api/gate/detect` route. Both paths detect goats/sheep and track movement. The farm RTSP gateway does not run QR/eartag reading and never sends permanent animal identifiers. Any optional eartag scan from a device camera is a separate action and does not run on the Tapo CCTV stream.

The RTSP gateway is not a public browser stream: it keeps camera credentials on the gateway host and sends resized frames and bounded goat/sheep detections to the ALPASFARM API over HTTPS. Run the gateway on the same local network as the Tapo camera; the camera's RTSP port must not be exposed to the public internet. The Smart Gate may use camera detections for temporary movement tracks and aggregate gate counts, without QR/eartag reading or exact animal identification. Verify the actual stream before reporting live camera performance.

Administrator-only diagnostics on Camera Monitoring show the detector version, weights fingerprint, real inference count, errors, recent FPS, and latency. The counters are served through a separate admin-authorized diagnostics route, not the regular farm-user health response. Camera permission/state and model readiness remain separate.

## New species detector slot

The app is configured to load the next goat/sheep detector from `models/active/best.pt` (or the private path set in `YOLO_SPECIES_MODEL_PATH`). The previous Tapo checkpoint is no longer selected by the app or Hostinger Compose configuration. Historical candidate artifacts may remain in their folders, but they are not mounted into the running service.

Until a new checkpoint is placed in the active folder, species inference correctly reports `model_unavailable` and detection requests return unavailable. Other app routes and the separate sheep-activity model remain independent. The detector accepts an Ultralytics `.pt` model whose classes are exactly `goat` and `sheep`; training data must use class index `0=goat`, `1=sheep`. The API response format, tracking, eartag reading, and diagnostics stay unchanged.

The training command now starts from Ultralytics' generic `yolo11n.pt` weights by default, not from a previous ALPASFARM goat/sheep model. You can also provide another supported Ultralytics base model with `--weights`. Training still produces a reviewable candidate only; it does not silently replace the active model. Validate it on held-out labeled frames and separate Tapo day/night/empty-gate footage before enabling farm detection.

The photos in `../public/training_angles/` are smoke inputs only. They are not a held-out test set. Do not use them to claim model accuracy. The private, admin-only diagnostics response includes the configured model version, SHA-256 fingerprint, and bounded real counters once a model is loaded.

### Latest species candidate: `goats-sheeps-20261020-v1`

The private Roboflow export `GOATS-SHEEPS.v1i.yolov8.zip` contains 125 labeled frames from `4280.mp4`. `prepare_goats_sheeps_dataset.py` validates the YOLO boxes, normalizes `GOATS`/`SHEEP` to `goat`/`sheep`, and creates chronological splits with six unused frames between them: 78 train, 22 validation, and 13 test images. Twelve boundary frames are excluded. Training used generic COCO `yolo11n.pt` weights for 50 epochs at 512px on CPU; the previous ALPASFARM species checkpoint was not used.

The candidate's same-video chronological test scored mAP50 0.569 and mAP50-95 0.248 at confidence 0.001. A separate test on the 139-image `My First Project` source video scored mAP50 0.332 at confidence 0.001; at the configured 0.25 operating threshold, goat recall was only 0.138. That cross-video result is too weak for farm use, so this model remains at `models/candidates/goats-sheeps-20261020-v1/` and is not copied to `models/active/best.pt`. Full evaluation details are in `models/candidates/goats-sheeps-20261020-v1/manifest.json` and `external-validation-my-first-project.json`. Validate future candidates on more labeled camera sessions, including empty gates, people, dogs, and day/night footage, before promotion.

## Sheep activity baseline

`app/artifacts/sheep_activity_v1.npz` predicts five source labels for **sheep only**: grazing, running, sitting, standing, or walking. Its group-separated held-out accuracy is 54.7% and macro F1 is 0.532. It is not trained to detect abnormal gait, lameness, disease, or goats, and it must not independently trigger a medical alert. Any future use for abnormal movement needs its own representative, farm-labeled sequence dataset and evaluation.

Training footage was downloaded from the two CC BY 4.0 sources listed in `models/sheep_activity_v1_metrics.json`. To train a new activity candidate without overwriting the existing version:

```powershell
python train_sheep_activity.py --seed 2026 --epochs 600 `
  --model-out models/candidates/sheep_activity_v2.npz `
  --metrics-out models/candidates/sheep_activity_v2_metrics.json
```

The command refuses to overwrite an existing artifact. Candidate activity weights are not copied into `app/artifacts/` automatically.

The 2026-10-04 retrain (`sheep_activity_v2`) used all 409 decodable labeled clips from 137 source-animal/clip groups, with groups separated across train, validation, and test. Its held-out set contains 161 clips from 41 groups. It scored 54.7% accuracy and 0.532 macro-F1, exactly matching the previous baseline; the learned tensors differ only by floating-point rounding. It did not demonstrate an improvement and remains an unpromoted candidate at `models/candidates/sheep_activity_v2.npz` (SHA-256 `1000def6cc1db3c4cca745398fd5a40fc1b142836775f145957955b44f833bd1`). The production API still loads `app/artifacts/sheep_activity_v1.npz`. Neither version is an abnormal-gait or health model.

## Species dataset format

The species trainer requires an existing detection dataset with real human-reviewed YOLO boxes. It does not make boxes from class-folder names. All three splits are mandatory and must use class `0=goat`, `1=sheep`:

```text
datasets/species_v2/
  data.yaml
  groups.csv
  images/train/...
  images/val/...
  images/test/...
  labels/train/...
  labels/val/...
  labels/test/...
```

Every image has a matching `.txt` label file; an empty file is a real negative example. `groups.csv` has columns `split,image,group_id`, with one row for each image. Use the source video, animal, or original source-image group as `group_id`; the validator rejects source groups that cross splits, missing labels, corrupt images, invalid boxes, class-only folders, duplicate image content across splits, and incomplete class coverage.

Example `data.yaml`:

```yaml
path: .
train: images/train
val: images/val
test: images/test
nc: 2
names: [goat, sheep]
group_manifest: groups.csv
```

## Reproducible species candidate workflow

Run from `ml-server/` in the Python environment that has the pinned service requirements installed:

```powershell
python validate_and_prepare_dataset.py `
  --data datasets/species_v2/data.yaml `
  --report models/candidates/species_v2_dataset_report.json

python train_species_detector.py `
  --data datasets/species_v2/data.yaml `
  --version goat-sheep-v2 `
  --epochs 50 --batch 8 --imgsz 640 --device 0 --confidence 0.60
```

The trainer validates data before starting. By default it uses generic Ultralytics `yolo11n.pt` weights, then creates a versioned candidate under `models/candidates/<version>/`; it does not overwrite or promote the active weights. Use `--weights <model>` to select another Ultralytics checkpoint or architecture. Its manifest records the dataset fingerprint, starting-model hash when available, training arguments, per-class test precision/recall and mAP, false-positive/false-negative and class-confusion counts, CPU PyTorch/ONNX latency, export test comparison, artifact hashes, and explicit CCTV-validation status. The standard test mAP pass and the configured-threshold confusion matrix are reported separately.

The configured threshold is a starting operating point, not a proven optimum. Set it using validation results and real empty-gate/person/dog/object footage. Do not treat another dataset's metrics as evidence for the farm's Tapo view.

To prepare the current GOATS-SHEEPS export with temporal holdouts:

```powershell
python prepare_goats_sheeps_dataset.py `
  --archive "C:\Users\asiva\Downloads\GOATS-SHEEPS.v1i.yolov8.zip"

python validate_and_prepare_dataset.py `
  --data datasets/goats_sheeps_2026-10-20/data.yaml
```

## Candidate selection

After a candidate passes its labeled test set **and** a separately labeled Tapo C320WS day/night/empty-gate test, place its `best.pt` in `models/active/best.pt` and set the private deployment configuration:

```dotenv
YOLO_MODEL_VERSION=goat-sheep-v2
YOLO_SPECIES_MODEL_DIR=./ml-server/models/active
YOLO_SPECIES_MODEL_PATH=/models/active/best.pt
```

Keep `best.pt` and candidate model files outside Git and outside the public web directory. No candidate is production-ready solely because its dataset test or ONNX comparison passed.

## API and checks

- `GET /api/v1/detect/health`: class readiness, model version/hash, and configured inference threshold.
- `GET /api/v1/detect/diagnostics`: aggregate counters and timing; reachable only from the Node API using its private key and restricted to active system administrators.
- `POST /api/v1/detect`: authenticated image inference; returns real boxes, per-class counts, model version, and inference latency.
- `GET /api/v1/activity/health` and `POST /api/v1/activity/predict`: separate experimental sheep-activity endpoint.

Run checks:

```powershell
python -m pip install -r requirements-test.txt
python -m unittest discover -s tests -v
python -m compileall -q app train_species_detector.py validate_and_prepare_dataset.py train_sheep_activity.py
```

No dataset is currently checked into `ml-server/datasets/species_v2/`. Species retraining fails closed until real annotated splits and their group manifest are supplied. No claim of Tapo camera accuracy should be made before testing the actual RTSP stream and labeled farm footage.
