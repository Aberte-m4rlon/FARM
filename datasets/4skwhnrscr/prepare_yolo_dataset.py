import os
import sys
import shutil
import random
from pathlib import Path

# Paths
PROJECT_ROOT = Path(r"c:\Users\ACER\Downloads\project-bolt-sb1-wgbqecdo\final capstone proj")
DATASET_ROOT = PROJECT_ROOT / "datasets" / "4skwhnrscr"
RAW_DS1 = DATASET_ROOT / "raw_dataset_1"
RAW_DS2 = DATASET_ROOT / "raw_dataset_2"
OUTPUT_DIR = DATASET_ROOT / "yolo_dataset"

CLASSES = {
    0: "goat_face",
    1: "eye",
    2: "mouth",
    3: "ear",
    4: "goat_body"
}

CLASS_NAME_MAP = {
    "0": 0, "face": 0, "goat_face": 0,
    "1": 1, "eye": 1, "eyes": 1,
    "2": 2, "mouth": 2, "muzzle": 2, "nose": 2,
    "3": 3, "ear": 3, "ears": 3,
    "4": 4, "goat": 4, "body": 4, "goat_body": 4
}

def clean_and_prepare():
    print("=" * 70)
    print("  AlpasFarm 4skwhnrscr-2 Dataset Unifier & Formatter")
    print("=" * 70)

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)

    for split in ["train", "val", "test"]:
        (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    samples = []
    img_extensions = {".jpg", ".jpeg", ".png", ".webp"}

    # 1. Dataset 1 scanning
    raw1_files = list(RAW_DS1.rglob("*"))
    img_files = [f for f in raw1_files if f.suffix.lower() in img_extensions]
    print(f"[1/4] Found {len(img_files)} images in dataset_1...")

    valid_pairs = 0
    for img_path in img_files:
        txt_path = img_path.with_suffix(".txt")
        if not txt_path.exists():
            continue

        try:
            with open(txt_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = [l.strip() for l in f.readlines() if l.strip()]

            cleaned_labels = []
            for line in lines:
                parts = line.split()
                if len(parts) >= 5:
                    cls_raw = parts[0].lower()
                    if cls_raw in CLASS_NAME_MAP:
                        cls_id = CLASS_NAME_MAP[cls_raw]
                        try:
                            cx, cy, w, h = map(float, parts[1:5])
                            cx = max(0.0, min(1.0, cx))
                            cy = max(0.0, min(1.0, cy))
                            w = max(0.001, min(1.0, w))
                            h = max(0.001, min(1.0, h))
                            cleaned_labels.append(f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
                        except ValueError:
                            continue

            if cleaned_labels:
                samples.append({
                    "img_path": img_path,
                    "labels": cleaned_labels,
                    "type": "annotated_face"
                })
                valid_pairs += 1

        except Exception as e:
            print(f"Error reading {txt_path}: {e}")
            continue

    print(f"  Processed {valid_pairs} valid annotated pairs from dataset_1.")

    # 2. Dataset 2 scanning (Goat full body)
    raw2_files = list(RAW_DS2.rglob("*"))
    raw2_imgs = [f for f in raw2_files if f.suffix.lower() in img_extensions]
    print(f"[2/4] Found {len(raw2_imgs)} images in dataset_2...")

    for img_path in raw2_imgs:
        samples.append({
            "img_path": img_path,
            "labels": ["4 0.500000 0.500000 0.850000 0.850000"],
            "type": "full_body"
        })

    print(f"  Total samples collected: {len(samples)}")

    # 3. Partitioning
    print("\n[3/4] Partitioning into Train / Val / Test (80 / 10 / 10)...")
    random.seed(42)
    random.shuffle(samples)

    total = len(samples)
    train_end = int(0.80 * total)
    val_end = int(0.90 * total)

    splits = {
        "train": samples[:train_end],
        "val": samples[train_end:val_end],
        "test": samples[val_end:]
    }

    class_counts = {c: 0 for c in CLASSES.keys()}

    for split_name, split_list in splits.items():
        img_dir = OUTPUT_DIR / "images" / split_name
        lbl_dir = OUTPUT_DIR / "labels" / split_name

        print(f"  Writing {len(split_list)} files to {split_name} split...")
        for idx, sample in enumerate(split_list):
            dest_img = img_dir / f"goat_4sk_{split_name}_{idx:05d}{sample['img_path'].suffix.lower()}"
            dest_txt = lbl_dir / f"goat_4sk_{split_name}_{idx:05d}.txt"

            shutil.copy2(sample["img_path"], dest_img)
            with open(dest_txt, "w", encoding="utf-8") as f:
                f.write("\n".join(sample["labels"]) + "\n")

            for lbl in sample["labels"]:
                cid = int(lbl.split()[0])
                class_counts[cid] = class_counts.get(cid, 0) + 1

    # 4. Generate data.yaml
    print("\n[4/4] Writing data.yaml...")
    data_yaml_content = f"""# AlpasFarm 4skwhnrscr-2 Goat Anatomical & Health Dataset
path: .
train: images/train
val: images/val
test: images/test

nc: {len(CLASSES)}
names: {list(CLASSES.values())}
"""
    with open(OUTPUT_DIR / "data.yaml", "w", encoding="utf-8") as f:
        f.write(data_yaml_content)

    with open(DATASET_ROOT / "data.yaml", "w", encoding="utf-8") as f:
        f.write(data_yaml_content)

    print("\n" + "=" * 50)
    print("  Dataset Generation Complete:")
    print("=" * 50)
    for cid, name in CLASSES.items():
        print(f"  Class {cid} ({name:12s}): {class_counts.get(cid, 0):6d} bounding boxes")
    print("=" * 50)
    print(f"\n[SUCCESS] Unified dataset ready at: {OUTPUT_DIR}\n")

if __name__ == "__main__":
    clean_and_prepare()
