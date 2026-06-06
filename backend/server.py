"""
RIMI AI Backend — Thin App Factory
All routes are in backend/routes/, shared logic in config.py, db.py, auth.py.
"""
import logging
import os
from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from db import init_db
from routes import register_all_blueprints

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')


def create_app():
    app = Flask(__name__)

    # Security: restrict CORS to known origins
    _allowed_origins = os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3001"
    ).split(",")
    CORS(app, resources={r"/api/*": {"origins": _allowed_origins}}, supports_credentials=True)

    # Security: enforce max upload size (25 MB)
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

    # Rate limiting
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per minute"],
        storage_uri="memory://",
    )
    # Store limiter on app so route modules can use it
    app.limiter = limiter

    # Initialize the database (create tables, seed data)
    init_db()

    # Register all route blueprints
    register_all_blueprints(app)

    return app


app = create_app()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    logging.info("=" * 50)
    logging.info("  RIMI AI Backend — Flask + Replicate")
    logging.info(f"  http://localhost:{port}")
    logging.info("=" * 50)
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') != 'production'))
