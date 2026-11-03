# AlpasFarm — Camera Health Screening Feature
## Implementation Report

---

## 1. Files Created

| File | Purpose |
|------|---------|
| `src/lib/cameraML.ts` | Core ML engine — TF.js MobileNetV2, quality check, inference, training |
| `src/lib/useCameraScreenings.ts` | React hooks + Supabase CRUD for screening records |
| `src/components/CameraScreeningModal.tsx` | Full camera/upload UI with ML inference |
| `src/components/ScreeningHistoryPanel.tsx` | Screening history list for an animal |
| `src/pages/CameraScreeningPage.tsx` | Farm-wide screening history + stats page |
| `supabase/migrations/20260826000001_create_camera_health_screenings_table.sql` | DB table migration |
| `supabase/migrations/20260826000002_create_animal_screenings_storage_bucket.sql` | Storage bucket + RLS policies |

---

## 2. Files Modified

| File | Change |
|------|--------|
| `src/App.tsx` | Added `/camera-screening` route |
| `src/lib/icons.ts` | Added `Camera` icon |
| `src/components/AppShell.tsx` | Added Camera Screening nav item + page title |
| `src/pages/AnimalProfilePage.tsx` | Added Camera tab, screening card in Overview, Camera button in header, modal |
| `src/lib/myai.ts` | Added `cameraScreenings` to buildFarmContext, updated SYSTEM_PROMPT |
| `src/components/FloatingAICloud.tsx` | Passes camera screenings to AI context, added quick prompts |
| `src/types.ts` | Added `CameraScreeningRecord` and `ScreeningPrediction` types |
| `myai_service/farm_tools.py` | Added `get_camera_screenings()` + camera section in `build_context()` |
| `vite.config.ts` | TF.js code-split into separate async chunk |
| `package.json` | Added `@tensorflow/tfjs@4.22.0` |

---

## 3. ML Architecture

```
Phone Camera / Webcam / Uploaded Photo
        ↓
Image Quality Check (brightness, blur, resolution)
        ↓
  Quality Score < 40 → Reject → "Image quality insufficient"
        ↓
TensorFlow.js (lazy-loaded, split chunk)
        ↓
Preprocess: resize to 224×224, normalize [0,1]
        ↓
MobileNetV2 Feature Extractor (TF Hub, pretrained ImageNet)
        ↓
1280-dimensional feature vector
        ↓
  ┌──────────────────────────────────────────────┐
  │  Trained logistic regression head?           │
  │  YES → use saved weights from localStorage  │
  │  NO  → heuristic activation analysis        │
  └──────────────────────────────────────────────┘
        ↓
Confidence threshold check (< 0.55 → low_confidence)
        ↓
ScreeningResult { prediction, confidence, modelVersion, qualityReport }
        ↓
Save to Supabase (camera_health_screenings table)
Image → Supabase Storage (private bucket: animal-screenings)
        ↓
Display in AnimalProfilePage + CameraScreeningPage
        ↓
AI Cloud can explain results using real DB data
```

---

## 4. Model Used

- **Base**: MobileNetV2 (pretrained on ImageNet) via TensorFlow Hub
  - URL: `tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/feature_vector/5/default/1`
  - Input: 224×224 RGB image
  - Output: 1280-dim feature vector
- **Head**: Logistic regression (JavaScript, trained in-browser on farm's own images)
- **Default**: Heuristic activation analysis (when no labeled dataset is provided)
- **Version**: `goat-health-v1`

---

## 5. Dataset

**No goat/sheep health image dataset is included.** The system is built to accept one.

To train the classifier head:

```typescript
import { trainCameraModel, type TrainingImage } from './src/lib/cameraML';

const trainingImages: TrainingImage[] = [
  // Load your labeled images
  { imageElement: imgElement1, label: 'normal_appearance' },
  { imageElement: imgElement2, label: 'possible_health_concern' },
  // ... minimum 50 images per class recommended
];

const weights = await trainCameraModel(trainingImages);
// Weights saved automatically to localStorage
// All future predictions use these weights
```

**Recommended dataset**:
- Source: Collect photos of your actual goats/sheep
- Labels: `normal_appearance` and `possible_health_concern`
- Minimum: 50 images per class
- Format: JPEG or PNG, any resolution (resized to 224×224 automatically)

**Dataset location** (once collected):
- Place in: `/datasets/goat-health/normal_appearance/` and `/datasets/goat-health/possible_health_concern/`
- Use the training script in `src/lib/cameraML.ts` → `trainCameraModel()`

---

## 6. Model Metrics

Without a labeled dataset, formal metrics cannot be reported.

Once trained on labeled data, the model reports:
- **Accuracy**: fraction of correct predictions on test split
- **Precision**: TP / (TP + FP)
- **Recall**: TP / (TP + FN) — critical metric for health screening
- **F1 Score**: harmonic mean of precision and recall

These are displayed in the model metadata and stored with each screening record.

**Note on false negatives**: The heuristic fallback is intentionally conservative — it returns `low_confidence` rather than `normal_appearance` when uncertain, to avoid missing a health concern.

---

## 7. API Endpoints (Supabase, not REST)

All data operations go through Supabase RLS-enforced direct queries:

| Operation | Supabase Table/Storage |
|-----------|----------------------|
| Save screening result | `INSERT camera_health_screenings` |
| Upload screening image | `storage.from('animal-screenings').upload(...)` |
| Get animal screenings | `SELECT camera_health_screenings WHERE animal_id = ? AND user_id = ?` |
| Get all farm screenings | `SELECT camera_health_screenings WHERE user_id = ?` |
| Delete screening | `DELETE camera_health_screenings WHERE id = ? AND user_id = ?` |
| Get signed image URL | `storage.from('animal-screenings').createSignedUrl(...)` |

---

## 8. Database Changes

### New table: `camera_health_screenings`

```sql
id            uuid PRIMARY KEY
user_id       uuid NOT NULL (FK auth.users, RLS enforced)
animal_id     uuid NOT NULL (FK animals ON DELETE CASCADE)
image_path    text          -- Supabase Storage path
image_url     text          -- Signed URL (7 days)
prediction    text          -- 'normal_appearance' | 'possible_health_concern' | 'low_confidence'
confidence    numeric(5,4)  -- 0.0000 – 1.0000
model_version text          -- 'goat-health-v1' (preserved forever)
quality_score int           -- 0–100
quality_issues jsonb        -- array of issue strings
notes         text          -- optional farm manager note
created_at    timestamptz
```

RLS: owner-scoped (auth.uid() = user_id)

### New storage bucket: `animal-screenings`

- Private (not public)
- Path structure: `screenings/{user_id}/{uuid}.jpg`
- RLS: users can only read/write/delete their own files

---

## 9. Environment Variables

No new environment variables required. Uses the existing:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## 10. Vercel Deployment Requirements

1. **Run the SQL migrations** in Supabase Dashboard → SQL Editor:
   - `20260826000001_create_camera_health_screenings_table.sql`
   - `20260826000002_create_animal_screenings_storage_bucket.sql`

2. **No new environment variables** needed on Vercel.

3. **TF.js runs in-browser** — no server-side ML compute, no additional Vercel functions.

4. **MobileNet model** is loaded from TF Hub CDN on first camera screening use.
   - Requires internet access on first load (model is ~16MB, cached in browser after)
   - Subsequent loads are served from browser cache

5. **Deploy**: `npm run build` then deploy `dist/` to Vercel as usual.

---

## 11. How to Train / Retrain the Model

### In-browser training (recommended for farm-specific data)

```typescript
// In browser console or a dev tool page
import { trainCameraModel } from './src/lib/cameraML';

// Prepare labeled images
const images = [
  { imageElement: document.getElementById('img1'), label: 'normal_appearance' },
  { imageElement: document.getElementById('img2'), label: 'possible_health_concern' },
  // ... more images
];

const result = await trainCameraModel(images, {
  epochs: 500,         // training iterations
  learningRate: 0.01,  // gradient descent step size
  l2Reg: 0.001,        // L2 regularization
});

console.log('Accuracy:', result.accuracy);
console.log('Recall:', result.recall);
console.log('F1:', result.f1);
// Weights automatically saved to localStorage
```

### Clear trained weights (reset to heuristic mode)

```typescript
import { clearSavedWeights } from './src/lib/cameraML';
clearSavedWeights();
```

### Check if weights exist

```typescript
import { loadSavedWeights } from './src/lib/cameraML';
const w = loadSavedWeights();
console.log(w ? `Trained: ${w.trainingSamples} samples, acc: ${w.accuracy}` : 'No trained weights');
```

---

## 12. How to Test Camera Screening

1. Open AlpasFarm and log in as Farm Manager
2. Go to **Animals** → click any animal
3. Click **📷 Screen** button in the header, OR go to the **📷 Camera Screening** tab
4. Choose **Use Camera** or **Upload Photo**
5. Capture/upload a photo
6. Click **Analyze** — the ML model runs in-browser
7. Review result: prediction, confidence %, quality score, disclaimer
8. Click **Save Result** to persist to Supabase
9. View history in the **Camera Screening** tab or at `/camera-screening`

---

## 13. AI Cloud Integration

The AI Cloud (FloatingAICloud + MyAI) now receives camera screening data as context.

**How it works**:
- `FloatingAICloud.tsx` calls `buildFarmContext({ ...farmData, cameraScreenings }, message)`
- If the question matches camera/screening/photo keywords, `[CAMERA SCREENINGS]` section is injected into the LLM prompt
- The AI NEVER invents screening results — it only explains what's in the real DB data

**Example prompts that trigger camera screening context**:
- "Explain this animal's camera screening"
- "Which animals have possible health concerns from camera screening?"
- "Show me the camera screening results"
- "Ipakita mo yung mga screening results"

**AI response example**:
> "According to AlpasFarm's camera screening, Basil was flagged with a Possible Health Concern at 84% ML confidence (model: goat-health-v1). This is a preliminary visual screening only and does not replace veterinary diagnosis. Please review Basil's health records and consult a licensed veterinarian."

---

## 14. Known Limitations

1. **No labeled dataset** — Without farm-specific training data, the model uses heuristic activation analysis which produces conservative (often `low_confidence`) results. This is intentional.

2. **MobileNet is ImageNet-trained** — The feature extractor was trained on general images, not goat/sheep health images. Classification accuracy improves significantly once trained on domain-specific data.

3. **Single animal per screening** — The system assumes one animal per photo. Multiple animals in frame may reduce accuracy (flagged as a quality issue).

4. **Lighting-sensitive** — Poor lighting significantly reduces quality score and may prevent inference.

5. **First-use latency** — MobileNetV2 (~16MB) loads from TF Hub CDN on first use. Subsequent uses are cached.

6. **localStorage for weights** — Trained classifier weights are stored in localStorage. Clearing browser data resets the model to heuristic mode.

7. **Camera requires HTTPS** — Camera access only works on HTTPS or localhost. Upload fallback is always available.

8. **Not a veterinary tool** — All results carry the mandatory disclaimer. The system is designed for preliminary screening support only.

---

## Medical / Veterinary Disclaimer

> Camera screening results from AlpasFarm are **preliminary machine-learning assessments only**.
> They do **not** constitute a veterinary diagnosis.
> Always consult a **licensed veterinarian** for animal health diagnosis and treatment.
> The system is designed as a farm management support tool, not a medical device.
