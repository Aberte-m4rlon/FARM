# Sheep/goat dataset initial quality audit

## Source and class map

- Source archive SHA-256: `86a806dd720e77530be29535fd93ee032c420c28896b7496b0b521822be12832`
- Source video: `C:\Users\asiva\Downloads\capstone-master\ALPASFARM-work\ml-server\datasets\sheep_goat_all_original\sheep_goat_dataset\source\5590.mp4` (1280×720, 15.0005 FPS, 16073 frames)
- Required mapping preserved: class `0 = sheep`, class `1 = goat`.
- Dataset README reports grayscale night-vision footage, 107 frames sampled every 10 seconds from one fixed-camera clip; annotations are approximate and propagated-review labels.

## Inventory

- Images: 107; label files: 107; boxes: 820.
- Sheep boxes: 763; goat boxes: 57.
- Split: train 75 images / {'sheep': 607, 'goat': 39}; validation 32 images / {'sheep': 156, 'goat': 18}.
- Image resolutions: `{'1280x720': 107}`; modes: `{'RGB': 107}`.

## Automated checks

- Missing labels: 0; orphan labels: 0; empty labels: 0.
- Invalid YOLO rows: 0; repeated rows within a label: 0.
- Corrupt images: 0; exact duplicate images: 0; duplicate label-file groups: 5.
- Near-duplicate image pairs (pHash distance ≤ 4): 468; cross-split pairs: 24.
- Labels differing from `metadata.csv` class totals: 0 images.
- Small-box review candidates: 0; image-border boxes: 64; box pairs with IoU ≥ 0.5: 6.

## Split and limitations

- Existing frame index gap between train and validation: 1 frame(s).
- Both original splits come from one video and place adjacent sampled frames on either side of the boundary. They do not provide independent-scene validation; training uses a separate gap-aware temporal copy.
- The source README explicitly calls the boxes approximate, says many heavily occluded rear animals are unlabeled, and notes uncertain species labels for small/partially visible young animals.
- Image-only metrics cannot prove camera deployment readiness. Real Tapo footage and a separate labeled day/night/empty-gate set are still needed.

## Visual review

- Completed: All 107 source images across all 5 contact sheets; full-resolution QA overlays checked for frames 0053, 0058, 0074, 0076, and 0107.
- Findings: No confidently objective invalid box or class assignment was found. Dense overlap, partial bodies, and uncertain young animals remain weak-label limitations; source annotations were not changed.
- The boxes are redrawn from the original YOLO labels for audit only; no label was edited or invented.

## Cleaning decision

The original ZIP and extracted `sheep_goat_all_original/` are preserved. No objectively invalid rows were found, so labels remain unchanged. A separate gap-aware training copy is created for evaluation; excluded gap frames and all original data remain preserved.

## Status

DATASET AUDIT: AUTOMATED STRUCTURE CHECKS AND MANUAL VISUAL REVIEW COMPLETE; LABELS PRESERVED.
