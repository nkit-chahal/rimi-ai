"""
RIMI AI Backend — Thin App Factory
All routes are in backend/routes/, shared logic in config.py, db.py, auth.py.
"""
import logging
import os
from flask import Flask, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from db import init_db
from logging_config import configure_logging
from routes import register_all_blueprints


def create_app():
    app = Flask(__name__)
    jwt_secret = os.getenv("JWT_SECRET", "")
    if os.getenv("FLASK_ENV") == "production" and (
        not jwt_secret or jwt_secret == "rimi-ai-dev-secret-change-in-production"
    ):
        raise RuntimeError("JWT_SECRET must be configured in production")

    # Security: restrict CORS to known origins (always allow production frontend)
    _default_origins = [
        "http://localhost:5173",
        "http://localhost:3001",
        "https://rimiai.pro",
        "https://www.rimiai.pro",
    ]
    _env_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    _allowed_origins = list(dict.fromkeys((_env_origins or _default_origins) + _default_origins[-2:]))
    CORS(
        app,
        resources={r"/api/*": {"origins": _allowed_origins}},
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    @app.after_request
    def add_cors_headers(response):
        """Keep production CORS headers present even on error responses."""
        origin = request.headers.get("Origin")
        if origin in _allowed_origins:
            response.headers.setdefault("Access-Control-Allow-Origin", origin)
            response.headers.setdefault("Access-Control-Allow-Credentials", "true")
            response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Authorization")
            response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        return response

    # Security: enforce max upload size (25 MB)
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

    # Rate limiting
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per minute"],
        storage_uri=os.getenv("RATELIMIT_STORAGE_URI") or os.getenv("REDIS_URL") or "memory://",
    )
    # Store limiter on app so route modules can use it
    app.limiter = limiter

    # Initialize the database (create tables, seed data)
    init_db()

    # Register all route blueprints
    register_all_blueprints(app)

    configure_logging(app)

    sentry_dsn = os.getenv("SENTRY_DSN", "")
    if sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.flask import FlaskIntegration

            sentry_sdk.init(dsn=sentry_dsn, integrations=[FlaskIntegration()], traces_sample_rate=0.1)
        except Exception as exc:
            logging.getLogger(__name__).warning("Sentry init failed: %s", exc)

    return app


app = create_app()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    logging.info("=" * 50)
    logging.info("  RIMI AI Backend — Flask + Replicate")
    logging.info(f"  http://localhost:{port}")
    logging.info("=" * 50)
    app.run(host='0.0.0.0', port=port, debug=(os.getenv('FLASK_ENV') != 'production'))
