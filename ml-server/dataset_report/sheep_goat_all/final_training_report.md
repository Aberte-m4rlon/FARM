# Sheep/goat dataset and candidate training report

## Dataset audit

- Original archive SHA-256: `86a806dd720e77530be29535fd93ee032c420c28896b7496b0b521822be12832`.
- Original archive and `sheep_goat_all_original/` were preserved.
- 107 images and 107 YOLO labels at 1280×720; 820 boxes total: 763 sheep and 57 goats.
- Class order remains `0=sheep`, `1=goat` in the training copy.
- No corrupt images, missing/orphan/empty label files, malformed YOLO rows, repeated rows within labels, or exact duplicate images were found.
- The five identical-label groups, 64 border-touching boxes, and six overlapping same-class box pairs were reviewed as potentially expected in this crowded pen; they were not changed without objective proof of an annotation error.
- Visual review covered all 107 images on five contact sheets. No confidently objective invalid box or class assignment was found. The source author warns that boxes are approximate, many heavily occluded animals are unlabeled, and young animals may be difficult to classify.

## Leakage-aware evaluation copy

The separate `sheep_goat_all_temporal_20261101_v1` copy carries original image and label contents unchanged. Its chronological partitions use 58 train images (513 sheep / 31 goats), 9 validation images (51 sheep / 7 goats), and 9 test images (41 sheep / 18 goats). Sampled frames 59–63 and 73–98 were left out to create at least 50 seconds between partitions. Automated dataset validation passed with no exact image duplicates between splits.

All partitions still come from one fixed-camera source video. The later test partition is not independent camera-session evidence, and the labels remain weak labels.

## Candidate trained and tested

- Candidate only: `models/candidates/sheep-goat-all-20261101-v3/`.
- Starting checkpoint was the current goat/sheep model. The output channels were safely aligned to the dataset's `sheep, goat` order before training; the candidate and inference metadata report `0=sheep`, `1=goat`.
- CPU-only Intel N100, YOLO11n, 640px, 12 epochs, batch 8; feature layers frozen. No GPU was available.
- Test partition: 9 images containing 41 sheep and 18 goats.
- PyTorch test: overall precision at best F1 `0.757`, recall `0.146`, mAP50 `0.261`, mAP50-95 `0.109`. Per-class mAP50-95: sheep `0.152`, goat `0.066`. Goat recall at best F1 was `0.000`.
- ONNX test: overall precision at best F1 `0.777`, recall `0.136`, mAP50 `0.283`, mAP50-95 `0.109`. PyTorch-to-ONNX differences passed the configured 0.03 tolerance; this verifies export consistency, not useful field accuracy.
- At confidence `0.60`, a direct IoU≥0.5 test-set error count found sheep TP/FP/FN `11/12/30` and goat TP/FP/FN `0/0/18`. Three goats were matched to sheep predictions; no goat was correctly detected.
- Lowering confidence to `0.05` found sheep TP/FP/FN `24/454/17` and goat TP/FP/FN `2/7/16`. Eleven goats were matched to sheep predictions. The additional recall comes with hundreds of sheep false detections.
- CPU inference benchmark: PyTorch average `182 ms/image` (~`5.49` images/s), ONNX average `253 ms/image` (~`3.95` images/s) on this laptop. This is a still-image benchmark, not a complete live-stream throughput result.

The independent per-image JSON/CSV and prediction overlays are in the candidate's `error_analysis/` directory. The overlays show the high false-detection count at low confidence and the missed/misclassified goats at the operating confidence.

## Real Tapo check and decision

**REAL TAPO VALIDATION NOT PERFORMED.** `camera-gateway/gateway.py --diagnostics` reported that the ALPASFARM API was unavailable or not configured, the Tapo camera network was unreachable, and no Tapo stream could be decoded from this workstation. The packaged `5590.mp4` is only the dataset source video and was not treated as real-time Tapo validation.

**Do not promote or deploy this candidate.** Goat recall is inadequate, low-confidence inference creates too many false positives, the dataset has severe class imbalance (763 sheep vs 57 goats), and independent live Tapo footage was unreachable. The current active model was not overwritten; keep it in place until a better candidate is trained and evaluated on real, labeled Tapo sessions (including empty gate, people, day, and night examples).
