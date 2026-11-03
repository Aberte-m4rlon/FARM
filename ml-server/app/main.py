# ── main.py ── AlpasFarm ML Inference Server ──────────────────────────────────
# NOTE: The Python 3.14 monkey-patch is NOT applied here because the Docker
#       image uses Python 3.10-slim. The patch would break _eval_type on 3.10.
#       It is only needed when running locally with Python 3.14+.

import os
import sys
import logging
import threading

# Apply monkey-patch ONLY on Python 3.14+
if sys.version_info >= (3, 14):
    import typing
    _orig_eval_type = getattr(typing, "_eval_type", None)
    if _orig_eval_type:
        def _patched_eval_type(t, globalns=None, localns=None, type_params=None, *args, **kwargs):
            kwargs.pop("prefer_fwd_module", None)
            try:
                return _orig_eval_type(t, globalns, localns, type_params, *args, **kwargs)
            except TypeError:
                return _orig_eval_type(t, globalns, localns)
        typing._eval_type = _patched_eval_type

from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from app.species_detector import (
    MAX_IMAGE_BYTES,
    InvalidImage,
    SpeciesModelUnavailable,
    decode_image,
    detect as detect_goat_sheep,
    load_species_model,
    load_person_guard_model,
    inference_diagnostics as species_inference_diagnostics,
    model_status as goat_sheep_model_status,
    verify_species_api_key,
)
from app.activity_classifier import InvalidActivityClip, model_status as sheep_activity_model_status, predict_activity
from app import config

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-server")

app = FastAPI(
    title="AlpasFarm ML Inference Server",
    description="Private camera service for goat/sheep detection and sheep activity analysis.",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Background model loading — non-blocking so Cloud Run health check passes immediately
def _load_species_detector_background():
    try:
        load_species_model()
        logger.info("Strict goat/sheep detector loaded in background.")
    except SpeciesModelUnavailable as e:
        logger.info("Strict goat/sheep detector is unavailable: %s", e)
    try:
        load_person_guard_model()
        logger.info("COCO person guard loaded in background.")
    except SpeciesModelUnavailable as e:
        logger.error("Person guard is unavailable; animal inference will stay disabled: %s", e)

@app.on_event("startup")
async def startup_event():
    logger.info("FastAPI server starting — launching background model loader...")
    thread = threading.Thread(target=_load_species_detector_background, daemon=True)
    thread.start()
    logger.info("ML server startup completed (model loading in background).")

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "species_model": goat_sheep_model_status(), "activity_model": sheep_activity_model_status()}


@app.get("/api/v1/detect/health")
async def species_detector_health():
    """Load and report only the configured goat/sheep detector; no fallback is reported as ready."""
    model = goat_sheep_model_status()
    if model["weights_present"] and not model["model_loaded"]:
        try:
            await run_in_threadpool(load_species_model)
        except SpeciesModelUnavailable:
            pass
    model = goat_sheep_model_status()
    return {
        "status": "ready" if model["model_loaded"] else "model_unavailable",
        "model_loaded": model["model_loaded"],
        "weights_present": model["weights_present"],
        "model_error": model["model_error"],
        "model_version": model["version"],
        "classes": model["classes"],
        "model_sha256": model["model_sha256"],
        "image_size": model["image_size"],
        "confidence_threshold": model["confidence_threshold"],
    }


@app.get("/api/v1/detect/diagnostics")
async def species_detector_diagnostics(x_api_key: str | None = Header(default=None)):
    """Expose aggregate server inference telemetry only through the private API key."""
    try:
        verify_species_api_key(x_api_key)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key.")
    except SpeciesModelUnavailable:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Species detector is not configured.")
    model = goat_sheep_model_status()
    return {
        "model_loaded": model["model_loaded"],
        "model_version": model["version"],
        "model_sha256": model["model_sha256"],
        "image_size": model["image_size"],
        "confidence_threshold": model["confidence_threshold"],
        "diagnostics": species_inference_diagnostics(),
    }


@app.post("/api/v1/detect")
async def detect_registered_species(
    image: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
):
    """Detect goat/sheep boxes only when the configured private weights are available."""
    try:
        verify_species_api_key(x_api_key)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key.")
    except SpeciesModelUnavailable:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Species detector is not configured.")

    contents = await image.read(MAX_IMAGE_BYTES + 1)
    await image.close()
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image exceeds the upload limit.")
    try:
        decoded = decode_image(contents, image.content_type)
    except InvalidImage as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))

    try:
        return await run_in_threadpool(detect_goat_sheep, decoded)
    except SpeciesModelUnavailable:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Species detector is not configured.")
    except RuntimeError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Species inference failed.")


@app.get("/api/v1/activity/health")
async def sheep_activity_health():
    """Report the optional sheep-only activity baseline independently of species readiness."""
    return sheep_activity_model_status()


@app.post("/api/v1/activity/predict")
async def predict_sheep_activity(
    request: Request,
    x_api_key: str | None = Header(default=None),
):
    """Estimate one of five sheep activities from a short camera frame sequence."""
    try:
        verify_species_api_key(x_api_key)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key.")
    except SpeciesModelUnavailable:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Activity model service is not configured.")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Activity request must be valid JSON.")
    try:
        return await run_in_threadpool(predict_activity, payload)
    except InvalidActivityClip as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Sheep activity model is not configured.")
    except RuntimeError:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Sheep activity inference failed.")
