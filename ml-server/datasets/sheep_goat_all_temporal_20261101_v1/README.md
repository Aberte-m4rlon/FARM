# Sheep/goat temporal training copy

This is a separate copy made from `sheep_goat_all_original`; image and YOLO label contents were copied unchanged. The original ZIP and extraction remain preserved.

Class order is `0=sheep`, `1=goat`. Frames are split chronologically into train (1–58), validation (64–72), and test (99–107); sampled frames 59–63 and 73–98 are intentionally omitted between partitions. The source README says frames were sampled every 10 seconds.

This dataset contains only one fixed-camera video. The time gap reduces adjacent-frame leakage, but its test metrics are not evidence of performance on another camera session or on the live Tapo camera. Labels are approximate and include propagated boxes, occlusion, and uncertain young-animal classes.
