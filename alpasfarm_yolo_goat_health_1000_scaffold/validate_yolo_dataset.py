from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent
data = yaml.safe_load((ROOT / "data.yaml").read_text())
classes = data["names"]

for split in ["train", "val", "test"]:
    image_dir = ROOT / "images" / split
    label_dir = ROOT / "labels" / split
    images = list(image_dir.glob("*.jpg")) + list(image_dir.glob("*.jpeg")) + list(image_dir.glob("*.png"))
    missing = []
    bad = []
    for img in images:
        label = label_dir / (img.stem + ".txt")
        if not label.exists():
            missing.append(img.name)
            continue
        for line in label.read_text().splitlines():
            parts = line.split()
            if len(parts) != 5:
                bad.append((img.name, line))
                continue
            c, x, y, w, h = map(float, parts)
            if not (0 <= int(c) < len(classes) and 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
                bad.append((img.name, line))
    print(split, "images:", len(images), "missing labels:", len(missing), "bad labels:", len(bad))
