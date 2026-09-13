"""
Shared configuration constants for the RIMI AI backend.
All route modules import from here instead of server.py.
"""
import os
from dotenv import load_dotenv
from groq import Groq

# Load root env first, then backend/.env so backend-only secrets win.
BASE_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.dirname(BASE_DIR)
load_dotenv(os.path.join(ROOT_DIR, '.env'))
load_dotenv(os.path.join(BASE_DIR, '.env'), override=True)

# Directories
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
RESULTS_DIR = os.path.join(BASE_DIR, 'results')
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

# File constraints
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp'}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB

# API clients
os.environ.setdefault("REPLICATE_API_TOKEN", os.getenv("REPLICATE_API_TOKEN", ""))
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

# Groq vision model used for captioning, OCR, semantic select and prompt building.
# Hosted models get retired without warning: meta-llama/llama-4-scout-17b-16e-instruct was
# removed and every Groq call started returning 404 model_not_found. Keep this in one place
# and overridable by env so a future retirement is a config change, not a code change.
# Any replacement must accept multimodal content (an image_url part) and return clean text —
# reasoning models that emit <think> blocks break the JSON parsing in layer OCR.
GROQ_VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")

# Replicate upscaler for Super Resolution. google/upscaler was a thin wrapper over Google's
# imagen-4.0-upscale-preview, which Google removed: the Replicate model page still resolves but
# every run fails with a 404 from Vertex AI. real-esrgan is a stable, self-contained model.
# Kept overridable so the next retirement is a config change rather than a code change.
REPLICATE_UPSCALE_MODEL = os.getenv("REPLICATE_UPSCALE_MODEL", "nightmareai/real-esrgan")

# Database – PostgreSQL on Railway (DATABASE_URL), SQLite locally
DATABASE_URL = os.getenv('DATABASE_URL')
DB_PATH = os.path.join(BASE_DIR, 'rimi_ai.sqlite3')

# S3-compatible Bucket (Railway Object Storage)
S3_ENDPOINT = os.getenv('AWS_ENDPOINT_URL')
S3_BUCKET = os.getenv('AWS_S3_BUCKET_NAME')
S3_REGION = os.getenv('AWS_DEFAULT_REGION', 'auto')
S3_ACCESS_KEY = os.getenv('AWS_ACCESS_KEY_ID')
S3_SECRET_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
USE_S3 = bool(S3_ENDPOINT and S3_BUCKET and S3_ACCESS_KEY)

if os.getenv("FLASK_ENV") == "production" and not USE_S3:
    import logging
    logging.getLogger(__name__).warning(
        "S3 storage is not configured; uploads/results will use local disk only"
    )


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def safe_filename(filename):
    """Sanitize a filename to prevent path traversal."""
    if not filename:
        return None
    return os.path.basename(filename).lstrip('.')
