import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app.dataset_pipeline import DatasetValidationError, validate_dataset_yaml


class SpeciesDatasetValidationTests(unittest.TestCase):
    def make_dataset(self, root: Path):
        for split in ("train", "val", "test"):
            image_dir = root / "images" / split
            label_dir = root / "labels" / split
            image_dir.mkdir(parents=True)
            label_dir.mkdir(parents=True)
            for index, class_id in enumerate((0, 1)):
                name = f"{split}_{index}.jpg"
                split_code = {"train": 0, "val": 30, "test": 60}[split]
                Image.new("RGB", (64, 48), color=(40 + split_code + index, 100, 90)).save(image_dir / name)
                (label_dir / f"{Path(name).stem}.txt").write_text(f"{class_id} 0.5 0.5 0.4 0.5\n", encoding="utf-8")
        (root / "data.yaml").write_text(
            "path: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: 2\nnames: [goat, sheep]\ngroup_manifest: groups.csv\n",
            encoding="utf-8",
        )
        rows = ["split,image,group_id"]
        for split in ("train", "val", "test"):
            for index in range(2):
                rows.append(f"{split},{split}_{index}.jpg,{split}-source-{index}")
        (root / "groups.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")

    def test_accepts_only_real_box_labels_with_separate_splits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            report = validate_dataset_yaml(root / "data.yaml")
            self.assertTrue(report["validation_passed"])
            self.assertEqual(report["total_instances"], {"goat": 3, "sheep": 3})
            self.assertEqual(report["splits"]["test"]["images"], 2)
            self.assertEqual(len(report["dataset_fingerprint_sha256"]), 64)
            self.assertTrue(report["group_isolation"]["verified"])

    def test_preserves_sheep_goat_source_class_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            config = root / "data.yaml"
            config.write_text(
                config.read_text(encoding="utf-8").replace(
                    "names: [goat, sheep]", "names: [sheep, goat]"
                ),
                encoding="utf-8",
            )
            report = validate_dataset_yaml(config)
            self.assertEqual(report["classes"], ["sheep", "goat"])
            self.assertEqual(report["total_instances"], {"sheep": 3, "goat": 3})

    def test_rejects_duplicate_image_content_across_splits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            train_image = root / "images/train/train_0.jpg"
            val_image = root / "images/val/val_0.jpg"
            val_image.write_bytes(train_image.read_bytes())
            with self.assertRaisesRegex(DatasetValidationError, "Identical image content"):
                validate_dataset_yaml(root / "data.yaml")

    def test_rejects_guessed_or_invalid_boxes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            (root / "labels/train/train_0.txt").write_text("0 0.5 0.5 1.2 0.5\n", encoding="utf-8")
            with self.assertRaisesRegex(DatasetValidationError, "normalized YOLO bounds"):
                validate_dataset_yaml(root / "data.yaml")

    def test_rejects_class_folders_that_have_no_real_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("goat", "sheep"):
                folder = root / name
                folder.mkdir()
                Image.new("RGB", (32, 32)).save(folder / "example.jpg")
            with self.assertRaisesRegex(DatasetValidationError, "does not exist"):
                validate_dataset_yaml(root / "data.yaml")

    def test_rejects_source_video_group_leakage_even_when_pixels_differ(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_dataset(root)
            groups = root / "groups.csv"
            rows = groups.read_text(encoding="utf-8").replace("val,val_0.jpg,val-source-0", "val,val_0.jpg,train-source-0")
            groups.write_text(rows, encoding="utf-8")
            with self.assertRaisesRegex(DatasetValidationError, "Source animals/videos occur across"):
                validate_dataset_yaml(root / "data.yaml")

    def make_temporal_dataset(self, root: Path, test_frames=(55, 56)):
        rows = ["split,image,group_id,source_id,frame_index"]
        frames = {"train": (0, 1), "val": (27, 28), "test": test_frames}
        for split, frame_indexes in frames.items():
            image_dir = root / "images" / split
            label_dir = root / "labels" / split
            image_dir.mkdir(parents=True)
            label_dir.mkdir(parents=True)
            for index, frame_index in enumerate(frame_indexes):
                name = f"video_mp4-{frame_index:04d}_jpg.rf.{split}{index}.jpg"
                Image.new("RGB", (64, 48), color=(30 + frame_index, 100, 90)).save(image_dir / name)
                (label_dir / f"{Path(name).stem}.txt").write_text(
                    f"{index} 0.5 0.5 0.4 0.5\n", encoding="utf-8"
                )
                rows.append(f"{split},{name},segment-{split},video_mp4,{frame_index}")
        (root / "data.yaml").write_text(
            "path: .\ntrain: images/train\nval: images/val\ntest: images/test\n"
            "nc: 2\nnames: [goat, sheep]\ngroup_manifest: groups.csv\n"
            "validation_mode: single_video_temporal_holdout\ntemporal_min_gap_frames: 24\n",
            encoding="utf-8",
        )
        (root / "groups.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")

    def test_accepts_temporal_holdout_but_marks_single_video_as_non_independent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_temporal_dataset(root)
            report = validate_dataset_yaml(root / "data.yaml")
            self.assertTrue(report["temporal_holdout"]["verified"])
            self.assertFalse(report["temporal_holdout"]["independent_source_evaluation"])
            self.assertFalse(report["temporal_holdout"]["promotion_eligible"])
            self.assertFalse(report["group_isolation"]["verified"])

    def test_rejects_temporal_splits_without_the_configured_frame_gap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.make_temporal_dataset(root, test_frames=(52, 53))
            with self.assertRaisesRegex(DatasetValidationError, "unused frames"):
                validate_dataset_yaml(root / "data.yaml")


if __name__ == "__main__":
    unittest.main()
