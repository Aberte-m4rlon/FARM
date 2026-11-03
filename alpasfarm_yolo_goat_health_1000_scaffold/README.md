# ALPASFARM — YOLO Goat Health Screening Dataset Scaffold (1,000 Samples)

This package contains a **YOLO-ready dataset structure and 1,000-row annotation manifest**.

IMPORTANT:
- The image files are intentionally NOT fabricated.
- The label TXT files are intentionally empty placeholders.
- `annotations_manifest_1000.csv` describes the image that should be collected and annotated.
- This package is therefore a **dataset scaffold**, not a trained-ready 1,000-image ground-truth dataset.
- Do NOT train a YOLO model using the empty labels as if they were real annotations.
- Do NOT present these records as clinical evidence or real disease labels.

## Classes

0 goat
1 eye_discharge
2 nasal_discharge
3 skin_lesion
4 abnormal_posture
5 possible_lameness

These are visible computer-vision targets. They are NOT disease diagnoses.

## Required image collection

For each filename in the manifest, collect a real goat image with:
- one goat whenever possible
- clear full/partial body visibility appropriate to the target
- good lighting
- different breeds, ages, sizes, coat colors, and farm backgrounds
- front/left/right/rear angles
- multiple distances
- realistic camera quality

## Annotation format

Each `.txt` file must contain one line per bounding box:

class_id center_x center_y width height

All coordinates must be normalized to 0–1.

Example:
0 0.52 0.55 0.62 0.70

Do not copy example coordinates onto unrelated images.

## Recommended annotation policy

- `goat`: bounding box around the visible goat.
- `eye_discharge`: tight box around visible discharge/affected eye area.
- `nasal_discharge`: tight box around visible nasal discharge.
- `skin_lesion`: box around each clearly visible lesion.
- `abnormal_posture`: box only when the abnormal posture is visually clear; keep an image-level metadata label too if your pipeline supports it.
- `possible_lameness`: use only when a visual gait/posture abnormality is clearly visible. Prefer video/pose analysis for this signal.

## Dataset split

Train: 800
Validation: 100
Test: 100

## Recommended production architecture

Camera
→ YOLO goat/sign detection
→ image quality check
→ optional pose/activity model
→ combine with temperature/weight/history
→ transparent health-risk scoring
→ veterinary-review recommendation

The model should output "possible health concern" rather than diagnosing a disease.

## Before training

Replace all placeholder images and labels with real, manually reviewed images and bounding boxes. Then run dataset validation and remove:
- duplicate images
- wrong labels
- blurry/ambiguous images
- images with no target when a target is expected
- leakage between train/val/test (same goat appearing across splits)

Also evaluate precision, recall, mAP50, mAP50-95, and per-class performance.
