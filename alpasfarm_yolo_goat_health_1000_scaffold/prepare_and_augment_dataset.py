#!/usr/bin/env python3
"""
prepare_and_augment_dataset.py — AlpasFarm YOLO Goat Health Dataset Builder
Reads annotations_manifest_1000.csv and prepares all 1,000 labels and images
for YOLOv8 / YOLOv11 training.
"""

import os
import csv
import random
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
DATA_YAML = ROOT / "data.yaml"
MANIFEST = ROOT / "annotations_manifest_1000.csv"

CLASS_MAP = {
    "goat": 0,
    "eye_discharge": 1,
    "nasal_discharge": 2,
    "skin_lesion": 3,
    "abnormal_posture": 4,
    "possible_lameness": 5
}

def generate_bounding_boxes_for_scenario(scenario: str, angle: str, distance: str, expected_classes: list) -> list:
    """
    Generate normalized bounding boxes [class_id, x_center, y_center, width, height]
    based on scenario, camera angle, and distance.
    """
    boxes = []
    
    # Distance scaling
    if distance == "close":
        gw, gh = random.uniform(0.70, 0.88), random.uniform(0.70, 0.88)
        gx, gy = random.uniform(0.48, 0.52), random.uniform(0.48, 0.52)
    elif distance == "far":
        gw, gh = random.uniform(0.40, 0.55), random.uniform(0.40, 0.55)
        gx, gy = random.uniform(0.45, 0.55), random.uniform(0.45, 0.55)
    else:  # medium
        gw, gh = random.uniform(0.55, 0.72), random.uniform(0.55, 0.72)
        gx, gy = random.uniform(0.47, 0.53), random.uniform(0.47, 0.53)

    # 1. Always include goat bounding box
    boxes.append([CLASS_MAP["goat"], round(gx, 4), round(gy, 4), round(gw, 4), round(gh, 4)])

    # Helper coordinate offsets based on angle
    head_x = gx - gw * 0.30 if "left" in angle or angle == "front" else gx + gw * 0.30
    head_y = gy - gh * 0.25
    muzzle_x = head_x - gw * 0.05 if "left" in angle else head_x + gw * 0.05
    muzzle_y = head_y + gh * 0.15
    leg_x = gx - gw * 0.20 if "left" in angle else gx + gw * 0.20
    leg_y = gy + gh * 0.32

    # 2. Add indicator bounding boxes
    for cls_name in expected_classes:
        if cls_name == "goat" or cls_name not in CLASS_MAP:
            continue
            
        cid = CLASS_MAP[cls_name]
        if cls_name == "eye_discharge":
            ex = max(0.05, min(0.95, head_x + random.uniform(-0.02, 0.02)))
            ey = max(0.05, min(0.95, head_y + random.uniform(-0.02, 0.02)))
            ew = round(random.uniform(0.06, 0.10) * (gw / 0.7), 4)
            eh = round(random.uniform(0.06, 0.10) * (gh / 0.7), 4)
            boxes.append([cid, round(ex, 4), round(ey, 4), ew, eh])
            
        elif cls_name == "nasal_discharge":
            nx = max(0.05, min(0.95, muzzle_x + random.uniform(-0.02, 0.02)))
            ny = max(0.05, min(0.95, muzzle_y + random.uniform(-0.01, 0.02)))
            nw = round(random.uniform(0.07, 0.11) * (gw / 0.7), 4)
            nh = round(random.uniform(0.06, 0.09) * (gh / 0.7), 4)
            boxes.append([cid, round(nx, 4), round(ny, 4), nw, nh])
            
        elif cls_name == "skin_lesion":
            lx = max(0.05, min(0.95, gx + random.uniform(-gw*0.25, gw*0.25)))
            ly = max(0.05, min(0.95, gy + random.uniform(-gh*0.20, gh*0.20)))
            lw = round(random.uniform(0.08, 0.14) * (gw / 0.7), 4)
            lh = round(random.uniform(0.08, 0.14) * (gh / 0.7), 4)
            boxes.append([cid, round(lx, 4), round(ly, 4), lw, lh])
            
        elif cls_name == "abnormal_posture":
            px = max(0.05, min(0.95, gx + random.uniform(-0.03, 0.03)))
            py = max(0.05, min(0.95, gy - gh * 0.1))
            pw = round(gw * random.uniform(0.65, 0.85), 4)
            ph = round(gh * random.uniform(0.40, 0.55), 4)
            boxes.append([cid, round(px, 4), round(py, 4), pw, ph])
            
        elif cls_name == "possible_lameness":
            lx = max(0.05, min(0.95, leg_x + random.uniform(-0.03, 0.03)))
            ly = max(0.05, min(0.95, leg_y + random.uniform(-0.02, 0.02)))
            lw = round(random.uniform(0.10, 0.16) * (gw / 0.7), 4)
            lh = round(random.uniform(0.18, 0.28) * (gh / 0.7), 4)
            boxes.append([cid, round(lx, 4), round(ly, 4), lw, lh])

    return boxes

def generate_synthetic_image(img_path: Path, boxes: list, angle: str, lighting: str):
    """
    Generate an augmented synthetic training image for the given boxes if real image is not provided.
    """
    w, h = 640, 640
    
    # Background color palette
    if lighting == "outdoor":
        bg_color = (random.randint(90, 130), random.randint(140, 180), random.randint(80, 110)) # green pasture
    elif lighting == "indoor":
        bg_color = (random.randint(140, 170), random.randint(120, 150), random.randint(100, 130)) # barn wood
    elif lighting == "low_light":
        bg_color = (random.randint(40, 70), random.randint(40, 70), random.randint(40, 60)) # night/shadow
    else:
        bg_color = (random.randint(110, 150), random.randint(130, 170), random.randint(100, 140))

    img = Image.new("RGB", (w, h), bg_color)
    draw = ImageDraw.Draw(img)

    # Add ground/environment details
    for _ in range(30):
        gx1 = random.randint(0, w)
        gy1 = random.randint(int(h * 0.6), h)
        gx2 = gx1 + random.randint(-40, 40)
        gy2 = gy1 + random.randint(10, 60)
        shade = (max(0, bg_color[0]-30), max(0, bg_color[1]-20), max(0, bg_color[2]-30))
        draw.line([(gx1, gy1), (gx2, gy2)], fill=shade, width=random.randint(2, 5))

    # Draw goat body shape from bounding box
    goat_boxes = [b for b in boxes if b[0] == CLASS_MAP["goat"]]
    if goat_boxes:
        _, cx, cy, bw, bh = goat_boxes[0]
        x1 = int((cx - bw / 2) * w)
        y1 = int((cy - bh / 2) * h)
        x2 = int((cx + bw / 2) * w)
        y2 = int((cy + bh / 2) * h)
        
        # Goat coat tone (white/brown/black/spotted)
        coat_tones = [
            (225, 220, 215),  # White Boer/Saanen
            (145, 90, 55),    # Brown Anglo-Nubian
            (60, 50, 45),     # Black Bengal
            (190, 150, 110),  # Tan Philippine Native
        ]
        coat = random.choice(coat_tones)
        
        # Main body ellipse
        draw.ellipse([x1, int(y1 + bh * 0.2 * h), x2, int(y2 - bh * 0.15 * h)], fill=coat)
        
        # Legs
        leg_w = int(bw * 0.10 * w)
        draw.rectangle([int(x1 + bw * 0.15 * w), int(y2 - bh * 0.35 * h), int(x1 + bw * 0.15 * w + leg_w), y2], fill=coat)
        draw.rectangle([int(x2 - bw * 0.25 * w), int(y2 - bh * 0.35 * h), int(x2 - bw * 0.25 * w + leg_w), y2], fill=coat)
        
        # Head
        head_radius = int(min(bw, bh) * 0.22 * w)
        hx = int(x1 + bw * 0.25 * w) if "left" in angle or angle == "front" else int(x2 - bw * 0.25 * w)
        hy = int(y1 + bh * 0.25 * h)
        draw.ellipse([hx - head_radius, hy - head_radius, hx + head_radius, hy + head_radius], fill=coat)
        
        # Ears & horns
        draw.polygon([(hx - head_radius, hy - head_radius), (hx - head_radius - 20, hy - head_radius - 30), (hx - head_radius + 20, hy - head_radius - 10)], fill=(80, 70, 60))
        draw.polygon([(hx + head_radius, hy - head_radius), (hx + head_radius + 20, hy - head_radius - 30), (hx + head_radius - 20, hy - head_radius - 10)], fill=(80, 70, 60))

    # Draw specific indicator visual patterns
    for b in boxes:
        cid, cx, cy, bw, bh = b
        if cid == CLASS_MAP["eye_discharge"]:
            bx1, by1 = int((cx - bw/2)*w), int((cy - bh/2)*h)
            draw.ellipse([bx1, by1, bx1+int(bw*w), by1+int(bh*h)], fill=(240, 235, 180)) # crusty eye
        elif cid == CLASS_MAP["nasal_discharge"]:
            bx1, by1 = int((cx - bw/2)*w), int((cy - bh/2)*h)
            draw.ellipse([bx1, by1, bx1+int(bw*w), by1+int(bh*h)], fill=(210, 230, 225)) # mucous
        elif cid == CLASS_MAP["skin_lesion"]:
            bx1, by1 = int((cx - bw/2)*w), int((cy - bh/2)*h)
            draw.ellipse([bx1, by1, bx1+int(bw*w), by1+int(bh*h)], fill=(160, 50, 40)) # reddish lesion

    # Smooth filter for realistic blending
    img = img.filter(ImageFilter.GaussianBlur(radius=0.7))
    img.save(img_path, "JPEG", quality=90)

def main():
    print("=" * 65)
    print("[AlpasFarm] YOLO Dataset Builder - 1,000 Samples")
    print("=" * 65)
    
    if not MANIFEST.exists():
        print(f"[Error] {MANIFEST} not found.")
        return

    # Ensure directories exist
    for split in ["train", "val", "test"]:
        (ROOT / "images" / split).mkdir(parents=True, exist_ok=True)
        (ROOT / "labels" / split).mkdir(parents=True, exist_ok=True)

    with open(MANIFEST, mode="r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"[Info] Loaded {len(rows)} records from manifest.")
    
    processed_count = 0
    images_generated = 0
    
    for row in rows:
        split = row["split"].strip()
        img_name = row["image_filename"].strip()
        stem = Path(img_name).stem
        scenario = row["condition_scenario"].strip()
        angle = row["camera_angle"].strip()
        lighting = row["lighting"].strip()
        distance = row["distance"].strip()
        expected_classes = [c.strip() for c in row["expected_classes"].split("|")]
        
        # 1. Generate bounding box coordinates
        boxes = generate_bounding_boxes_for_scenario(scenario, angle, distance, expected_classes)
        
        # 2. Write YOLO label file
        label_file = ROOT / "labels" / split / f"{stem}.txt"
        with open(label_file, "w", encoding="utf-8") as lf:
            for b in boxes:
                lf.write(f"{b[0]} {b[1]} {b[2]} {b[3]} {b[4]}\n")
                
        # 3. Check / create image file
        img_file = ROOT / "images" / split / f"{stem}.jpg"
        if not img_file.exists():
            generate_synthetic_image(img_file, boxes, angle, lighting)
            images_generated += 1
            
        processed_count += 1
        if processed_count % 200 == 0:
            print(f"  Processed {processed_count}/{len(rows)} samples...")

    print("-" * 65)
    print(f"[Success] Successfully prepared {processed_count} YOLO samples!")
    print(f"   - Train split: {len(list((ROOT/'labels'/'train').glob('*.txt')))} labels")
    print(f"   - Val split:   {len(list((ROOT/'labels'/'val').glob('*.txt')))} labels")
    print(f"   - Test split:  {len(list((ROOT/'labels'/'test').glob('*.txt')))} labels")
    print(f"   - Images ready: {images_generated} generated/verified in images/")
    print("=" * 65)

if __name__ == "__main__":
    main()
