# 🐐 ALPASFARM: Smart Goat & Sheep Pose Estimation & Health Screening System

> **Decision-Support & Research Assistance System**  
> *Important Note:* ALPASFARM AI Health Scanner is designed for early screening, record-keeping, and decision-support assistance. It does **not** replace a licensed veterinarian or provide definitive clinical diagnoses.

---

## 📌 1. Overview & Architecture

ALPASFARM AI Health Scanner integrates state-of-the-art Computer Vision (**Ultralytics YOLO Pose**) to track livestock in real-time, detect 14 anatomical landmarks, analyze postural metrics (e.g. kyphosis/hunched spine, head drooping, limb loading asymmetry), and link visual health assessments with farm management records.

```
PHONE / WEBCAM CAMERA
        ↓
REAL-TIME LIVESTOCK DETECTION
        ↓
Is it a GOAT or SHEEP?
  ├── NO ───→ Display Alert: "Hindi ito kambing o tupa."
  └── YES
        ↓
TRACK ANIMAL WITH BOUNDING BOX
        ↓
14 ANATOMICAL KEYPOINT POSE ESTIMATION
        ↓
BODY POSTURE & GAIT SCREENING (Kyphosis, Head Droop, Limb Symmetry)
        ↓
TEMPORAL DEBOUNCE & COOLDOWN FILTER
        ↓
COMBINE WITH FARM LIVESTOCK RECORDS & VETERINARY ADVISORY
```

---

## 🦴 2. Anatomical Keypoint Schema (14 Keypoints)

The dataset and model utilize a 14-keypoint anatomical structure (0-indexed):

| Index | Keypoint Name | Anatomical Region | Mirror Pair (Flip Index) |
|:-----:|:--------------|:------------------|:-------------------------|
| `0` | `nose` | Craniofacial | `0` (Symmetric) |
| `1` | `eye_left` | Left Orbit | `2` (`eye_right`) |
| `2` | `eye_right` | Right Orbit | `1` (`eye_left`) |
| `3` | `hornbase_left`| Left Horn Base | `4` (`hornbase_right`) |
| `4` | `hornbase_right`| Right Horn Base | `3` (`hornbase_left`) |
| `5` | `eartip_left` | Left Pinna Tip | `6` (`eartip_right`) |
| `6` | `eartip_right` | Right Pinna Tip | `5` (`eartip_left`) |
| `7` | `backline_shoulder`| Withers / Shoulder Top | `7` (Symmetric) |
| `8` | `tail_base` | Sacrum / Tail Insertion | `8` (Symmetric) |
| `9` | `tail_tip` | Caudal Extremity | `9` (Symmetric) |
| `10` | `carpus_left` | Left Front Knee (Carpus)| `11` (`carpus_right`) |
| `11` | `carpus_right`| Right Front Knee (Carpus)| `10` (`carpus_left`) |
| `12` | `tarsus_left` | Left Rear Hock (Tarsus) | `13` (`tarsus_right`) |
| `13` | `tarsus_right`| Right Rear Hock (Tarsus) | `12` (`tarsus_left`) |

**Augmentation Flip Index Array:**
```yaml
flip_idx: [0, 2, 1, 4, 3, 6, 5, 7, 8, 9, 11, 10, 13, 12]
kpt_shape: [14, 3] # (x_norm, y_norm, visibility)
```

---

## 📊 3. Dataset Statistics & Conversion

- **Source Dataset:** Dairy Goat Keypoint Dataset (`Dairy-Goat-Dataset-v1-0-0`)
- **Total Processed Images:** 1,107 real images (0 fake/hallucinated images)
- **Total Goat Pose Instances:** 11,162 instances
- **Splits:**
  - `train`: 884 images (8,819 annotations) - 80%
  - `val`: 109 images (1,146 annotations) - 10%
  - `test`: 114 images (1,197 annotations) - 10%
- **YOLO Label Format:** Exactly 47 tokens per line:
  `<class_id> <cx> <cy> <w> <h> <kp0_x> <kp0_y> <kp0_v> ... <kp13_x> <kp13_y> <kp13_v>`

---

## 🚀 4. Quick Start & Execution

### A. Validate Dataset Integrity
```bash
python validate_dataset.py
```
*Validates 100% compliance of all images, bounding boxes, and 47-token label rows.*

### B. Train YOLO Pose Model
```bash
python train.py --epochs 50 --batch 16 --imgsz 640 --device auto
```

### C. Run Real-Time Camera Scanner
```bash
# Webcam live scanner (press 'p' for 9:16 mobile portrait preview, 'q' to quit)
python camera_test.py --source 0 --conf 0.35

# Test on video or image
python camera_test.py --source test_video.mp4 --conf 0.35
```

---

## 🧠 5. Health Screening & Posture Algorithms

1. **Kyphosis / Arched Spine Screening:**
   - Evaluates the spinal triangulation angle between `nose` (0), `backline_shoulder` (7), and `tail_base` (8).
   - Significant acute curvature (< 115°) indicates potential abdominal discomfort, rumen distension, or internal parasitism.
2. **Head Droop / Depression Screening:**
   - Compares the vertical position of `nose` relative to `backline_shoulder` and body height.
   - Detects severe lethargy, dehydration, or weakness.
3. **Limb Symmetry & Mobility:**
   - Evaluates bilateral height and alignment of `carpus` (10, 11) and `tarsus` (12, 13) landmarks to flag weight-bearing reluctance or limping tendencies.
4. **Temporal Debouncing:**
   - Sliding window filter (12 frames) requires consistent evidence over consecutive frames before triggering an alert, eliminating false transient flickers.

---

## 🌐 6. Web & Mobile Integration (React + ONNX Runtime Web)

Exported ONNX model (`best.onnx`) is directly loadable in the web application using `@microsoft/onnxruntime-web`:
- Model inputs: `1 x 3 x 640 x 640` normalized tensor `[0.0, 1.0]`
- Output tensor: `1 x 56 x 8400` containing bounding boxes, goat class score, and 14 landmark triplets.
- Integrated seamlessly with ALPASFARM's Tagalog UI, animal profile records, and audit logs.
