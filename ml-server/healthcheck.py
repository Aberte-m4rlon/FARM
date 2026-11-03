import json
import sys
from urllib.request import urlopen


try:
    with urlopen("http://127.0.0.1:8000/api/v1/detect/health", timeout=8) as response:
        payload = json.load(response)
    ready = payload.get("model_loaded") is True and set(payload.get("classes", [])) == {"goat", "sheep"}
    sys.exit(0 if ready else 1)
except Exception:
    sys.exit(1)
