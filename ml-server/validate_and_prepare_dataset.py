#!/usr/bin/env python3
"""Validate an already human-annotated YOLO dataset; never fabricate labels."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.dataset_pipeline import DatasetValidationError, validate_dataset_yaml


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(__file__).resolve().parent / "datasets" / "species_v1" / "data.yaml",
        help="YOLO data.yaml with real labels and train/val/test splits.",
    )
    parser.add_argument("--report", type=Path, help="Optional JSON path for the validation report.")
    args = parser.parse_args()
    try:
        report = validate_dataset_yaml(args.data)
    except DatasetValidationError as error:
        print(f"DATASET REJECTED: {error}", file=sys.stderr)
        print("No labels were generated and no training was started.", file=sys.stderr)
        return 2
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
