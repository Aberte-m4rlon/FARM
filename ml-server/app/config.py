import os
from dotenv import load_dotenv

load_dotenv()

_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "https://alpasfarm.site,https://www.alpasfarm.site",
)
ALLOWED_ORIGINS = [origin.strip().rstrip("/") for origin in _origins.split(",") if origin.strip() and origin.strip() != "*"]
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = ["https://alpasfarm.site", "https://www.alpasfarm.site"]
