#!/usr/bin/env python3
"""
ALPASFARM: Smart Goat & Sheep Farm Management System
COCO Keypoints to Ultralytics YOLO Pose Dataset Converter

Converts the Dairy Goat Keypoint Dataset (COCO format) into standard YOLO Pose format.
Preserves real images and annotations without fabrication or hallucination.

Anatomical Keypoint Schema (14 Keypoints, 0-indexed):
    0: nose
    1: eye_left, 2: eye_right
    3: hornbase_left, 4: hornbase_right
    5: eartip_left, 6: eartip_right
    7: backline_shoulder
    8: tail_base, 9: tail_tip
    10: carpus_left, 11: carpus_right
    12: tarsus_left, 13: tarsus_right

YOLO Pose Label Format (47 values per line):
    <class_id> <cx> <cy> <w> <h> <kp0_x> <kp0_y> <kp0_v> ... <kp13_x> <kp13_y> <kp13_v>
"""

import os
import json
import random
import shutil
from pathlib import Path
from collections import defaultdict

KEYPOINT_NAMES = [
    "nose", "eye_left", "eye_right", "hornbase_left", "hornbase_right",
    "eartip_left", "eartip_right", "backline_shoulder", "tail_base",
    "tail_tip", "carpus_left", "carpus_right", "tarsus_left", "tarsus_right"
]
NUM_KEYPOINTS = 14
FLIP_IDX = [0, 2, 1, 4, 3, 6, 5, 7, 8, 9, 11, 10, 13, 12]
SKELETON = [
    [0, 1], [0, 2],
    [1, 3], [2, 4],
    [1, 5], [2, 6],
    [3, 5], [4, 6],
    [0, 7],
    [7, 8], [8, 9],
    [7, 10], [7, 11],
    [8, 12], [8, 13]
]

def stratified_split(image_ids, annotations, train_pct=80, val_pct=10, test_pct=10, seed=42):
    random.seed(seed)
    ann_count_per_image = defaultdict(int)
    for ann in annotations:
        ann_count_per_image[ann['image_id']] += 1

    bins = defaultdict(list)
    for img_id in image_ids:
        count = ann_count_per_image.get(img_id, 0)
        if count == 0:
            bin_k = 0
        elif count <= 2:
            bin_k = 1
        elif count <= 5:
            bin_k = 2
        elif count <= 10:
            bin_k = 3
        else:
            bin_k = 4
        bins[bin_k].append(img_id)

    train_ids, val_ids, test_ids = [], [], []
    for bin_k in sorted(bins.keys()):
        bin_images = bins[bin_k]
        random.shuffle(bin_images)
        n = len(bin_images)
        n_train = int(n * train_pct / 100)
        n_val = int(n * val_pct / 100)
        
        train_ids.extend(bin_images[:n_train])
        val_ids.extend(bin_images[n_train:n_train + n_val])
        test_ids.extend(bin_images[n_train + n_val:])

    random.shuffle(train_ids)
    random.shuffle(val_ids)
    random.shuffle(test_ids)
    return train_ids, val_ids, test_ids

def main():
    source_dataset_dir = Path(r"C:\Users\ACER\Downloads\Dairy-Goat-Dataset-v1-0-0")
    kp_ann_path = source_dataset_dir / "annotations" / "kp-annotations.json"
    images_source_dir = source_dataset_dir / "images" / "keypoint"
    
    target_dir = Path(__file__).parent.resolve()
    print(f"ALPASFARM YOLO Pose Converter Starting...")
    print(f"Source Annotations: {kp_ann_path}")
    print(f"Source Images: {images_source_dir}")
    print(f"Target Output Directory: {target_dir}")

    with open(kp_ann_path, 'r') as f:
        coco_data = json.load(f)

    images = coco_data.get('images', [])
    annotations = coco_data.get('annotations', [])
    image_dict = {img['id']: img for img in images}
    
    anns_by_img = defaultdict(list)
    for ann in annotations:
        anns_by_img[ann['image_id']].append(ann)

    image_ids = list(image_dict.keys())
    train_ids, val_ids, test_ids = stratified_split(image_ids, annotations, 80, 10, 10, seed=42)

    splits = {
        'train': train_ids,
        'val': val_ids,
        'test': test_ids
    }

    conversion_stats = {
        'total_images_processed': 0,
        'total_annotations_converted': 0,
        'invalid_skipped': 0,
        'splits': {}
    }

    for split_name, split_image_ids in splits.items():
        img_out_dir = target_dir / "images" / split_name
        lbl_out_dir = target_dir / "labels" / split_name
        img_out_dir.mkdir(parents=True, exist_ok=True)
        lbl_out_dir.mkdir(parents=True, exist_ok=True)

        split_imgs_count = 0
        split_anns_count = 0

        for img_id in split_image_ids:
            img_info = image_dict[img_id]
            file_name = img_info['file_name']
            w = img_info['width']
            h = img_info['height']

            src_img_file = images_source_dir / file_name
            if not src_img_file.exists():
                continue

            dst_img_file = img_out_dir / file_name
            if not dst_img_file.exists():
                shutil.copy2(src_img_file, dst_img_file)

            img_anns = anns_by_img.get(img_id, [])
            label_lines = []

            for ann in img_anns:
                bbox = ann.get('bbox', [])
                if len(bbox) != 4 or bbox[2] <= 0 or bbox[3] <= 0:
                    conversion_stats['invalid_skipped'] += 1
                    continue

                bx, by, bw, bh = bbox
                # YOLO Bounding Box normalized: center_x, center_y, width, height
                cx = (bx + bw / 2.0) / w
                cy = (by + bh / 2.0) / h
                norm_w = bw / w
                norm_h = bh / h

                cx = max(0.0, min(1.0, cx))
                cy = max(0.0, min(1.0, cy))
                norm_w = max(0.0, min(1.0, norm_w))
                norm_h = max(0.0, min(1.0, norm_h))

                raw_kpts = ann.get('keypoints', [])
                if len(raw_kpts) != NUM_KEYPOINTS * 3:
                    conversion_stats['invalid_skipped'] += 1
                    continue

                kpt_tokens = []
                for k in range(NUM_KEYPOINTS):
                    kx = raw_kpts[k * 3]
                    ky = raw_kpts[k * 3 + 1]
                    kv = int(raw_kpts[k * 3 + 2])

                    if kv > 0:
                        norm_kx = max(0.0, min(1.0, kx / w))
                        norm_ky = max(0.0, min(1.0, ky / h))
                        kpt_tokens.append(f"{norm_kx:.6f} {norm_ky:.6f} {kv}")
                    else:
                        kpt_tokens.append("0 0 0")

                line = f"0 {cx:.6f} {cy:.6f} {norm_w:.6f} {norm_h:.6f} " + " ".join(kpt_tokens)
                
                # Check 47 values rule
                assert len(line.strip().split()) == 47, f"Line must have 47 tokens, got {len(line.strip().split())}"
                label_lines.append(line)
                split_anns_count += 1
                conversion_stats['total_annotations_converted'] += 1

            lbl_txt_path = lbl_out_dir / (Path(file_name).stem + ".txt")
            with open(lbl_txt_path, 'w') as f:
                f.write("\n".join(label_lines) + "\n" if label_lines else "")

            split_imgs_count += 1
            conversion_stats['total_images_processed'] += 1

        conversion_stats['splits'][split_name] = {
            'images': split_imgs_count,
            'annotations': split_anns_count
        }

    # Generate data.yaml
    data_yaml_content = f"""# ALPASFARM YOLO Pose Dataset Configuration
path: {target_dir.as_posix()}
train: images/train
val: images/val
test: images/test

# 14 Keypoints Schema:
# 0: nose, 1: eye_left, 2: eye_right, 3: hornbase_left, 4: hornbase_right,
# 5: eartip_left, 6: eartip_right, 7: backline_shoulder, 8: tail_base,
# 9: tail_tip, 10: carpus_left, 11: carpus_right, 12: tarsus_left, 13: tarsus_right
kpt_shape: [14, 3]
flip_idx: [0, 2, 1, 4, 3, 6, 5, 7, 8, 9, 11, 10, 13, 12]

names:
  0: goat
"""
    yaml_file = target_dir / "data.yaml"
    with open(yaml_file, 'w') as f:
        f.write(data_yaml_content)

    # Save reports
    with open(target_dir / "conversion_report.json", 'w') as f:
        json.dump(conversion_stats, f, indent=2)

    with open(target_dir / "dataset_report.json", 'w') as f:
        json.dump({
            'dataset_name': 'ALPASFARM Dairy Goat Pose Estimation Dataset',
            'classes': ['goat'],
            'num_classes': 1,
            'keypoints_count': 14,
            'keypoint_names': KEYPOINT_NAMES,
            'skeleton': SKELETON,
            'flip_idx': FLIP_IDX,
            'splits': conversion_stats['splits'],
            'total_images': conversion_stats['total_images_processed'],
            'total_annotations': conversion_stats['total_annotations_converted']
        }, f, indent=2)

    print("\n" + "="*50)
    print("=== ALPASFARM CONVERSION COMPLETE ===")
    print("="*50)
    print(f"Total Images Processed: {conversion_stats['total_images_processed']}")
    print(f"Total Annotations Converted: {conversion_stats['total_annotations_converted']}")
    for s_name, s_data in conversion_stats['splits'].items():
        print(f"Split [{s_name}]: {s_data['images']} images, {s_data['annotations']} annotations")
    print(f"YAML config created at: {yaml_file}")
    print(f"Conversion report saved to: {target_dir / 'conversion_report.json'}")
    print("="*50)

if __name__ == '__main__':
    main()
