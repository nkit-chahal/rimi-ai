"""
Shared configuration constants for the RIMI AI backend.
All route modules import from here instead of server.py.
"""
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv()

# Directories
BASE_DIR = os.path.dirname(__file__)
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

# Database
DB_PATH = os.path.join(BASE_DIR, 'rimi_ai.sqlite3')


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
