# AlpasFarm animal detector

This directory is the single source for training the AlpasFarm goat/sheep
detector. It trains **species and object location only**. It does not classify
health, diagnose disease, estimate temperature, or estimate breathing.
Health observations continue to come from the application's image analysis
flow and must remain observation-based.

## Dataset

The trainer reads `Sheep vs Goat.v16i.yolov8.zip` from the repository root. The
archive identifies its source as the Roboflow `sheep-vs-goat` v16 dataset and
states the CC BY 4.0 license. Keep the included dataset attribution with any
redistributed model or dataset copy.

All image variants that share the same source image ID are assigned to the same
split. The trainer creates a deterministic 70% train / 15% validation / 15%
held-out test split so augmented copies cannot leak between splits.

## Train and export

From the repository root on Windows:

```powershell
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
ml/.venv/Scripts/python ml/train_species_detector.py --epochs 10 --imgsz 320 --batch 8 --device cpu
```

The settings above fit a modest CPU. On a CUDA-enabled machine, use
`--epochs 50 --imgsz 640 --batch 16 --device 0`. The first run downloads the small
pretrained YOLO checkpoint used for transfer learning. Training validates the
source annotations, evaluates only on the held-out test split, and exports the
trained model to `public/models/goat_sheep_yolov8n.onnx`. Metrics and run files
are saved under `ml/runs/species-detector/`.

The detector is a visual species gate. It is not an animal identity check: the
QR code remains the authoritative registered-animal reference.

## Production folder map

- `ml/train_species_detector.py`: validates the source annotations, makes a
  grouped train/validation/test split, trains the detector, and exports it.
- `ml/.data/` and `ml/runs/`: local training data and reports; both are ignored
  by Git and excluded from Vercel deployments.
- `public/models/goat_sheep_yolov8n.onnx`: the browser model
  served as a static file at `/models/goat_sheep_yolov8n.onnx`.
- `src/lib/localSpeciesDetector.ts`: ONNX Runtime Web loading, preprocessing,
  inference, and box decoding.
- `src/lib/localAnimalScan.ts`: the QR scan's local visible-observation checks.
- `public/sw.js`: keeps a successfully fetched public model available for
  later offline scans and refreshes it from the network when online.

The production build bundles the matching ONNX Runtime WebAssembly binary from
the installed npm package and copies the model from `public/models/` into `dist/`.
The Vercel ignore rules keep the training environment, source archive, and run
artifacts out of the deployment while explicitly retaining the model asset.

