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

logger = logging.getLogger(__name__)


def _is_production():
    return os.getenv("FLASK_ENV") == "production"


def _rate_limit_storage_uri():
    """Pick a rate-limit backend; production requires working Redis."""
    uri = os.getenv("RATELIMIT_STORAGE_URI") or os.getenv("REDIS_URL") or "memory://"
    if not uri.startswith(("redis://", "rediss://")):
        if _is_production():
            raise RuntimeError("Redis rate-limit storage (REDIS_URL) is required in production")
        return uri
    try:
        import redis  # noqa: F401
        from limits.storage import storage_from_string

        storage_from_string(uri)
        return uri
    except Exception as exc:
        if _is_production():
            raise RuntimeError(f"Redis rate-limit storage unavailable in production: {exc}") from exc
        logger.warning(
            "Redis rate-limit storage unavailable (%s); using in-memory rate limiting",
            exc,
        )
        return "memory://"


def _init_rate_limiter(app):
    """Create Flask-Limiter; production fails if Redis storage cannot init."""
    storage_uri = _rate_limit_storage_uri()
    try:
        return Limiter(
            get_remote_address,
            app=app,
            default_limits=["200 per minute"],
            storage_uri=storage_uri,
        )
    except Exception as exc:
        if _is_production():
            raise RuntimeError(f"Rate limiter init failed in production: {exc}") from exc
        logger.warning(
            "Rate limiter init failed for %s (%s); using memory://",
            storage_uri,
            exc,
        )
        return Limiter(
            get_remote_address,
            app=app,
            default_limits=["200 per minute"],
            storage_uri="memory://",
        )


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
    def add_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if _is_production():
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

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

    @app.after_request
    def cache_static_images(response):
        """Long-cache generated images and uploads so the browser doesn't re-fetch on every render."""
        path = request.path or ""
        if (path.startswith("/results/") or path.startswith("/uploads/")) and response.status_code == 200:
            response.headers.setdefault("Cache-Control", "public, max-age=86400, immutable")
        return response

    # Security: enforce max upload size (25 MB)
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

    # Rate limiting (Redis required in production)
    app.limiter = _init_rate_limiter(app)
    from rate_limits import init_rate_limits
    init_rate_limits(app.limiter)

    # Initialize the database (create tables, seed data)
    init_db()

    # Nightly Qwen layer asset cleanup (daemon thread, skips in testing)
    if not app.config.get("TESTING") and os.getenv("RIMI_DISABLE_CLEANUP_SCHEDULER", "").lower() not in ("1", "true", "yes"):
        import threading
        import time as _time

        def _cleanup_loop():
            while True:
                _time.sleep(24 * 3600)
                try:
                    from services.qwen_cleanup import sweep_orphaned_layer_files
                    result = sweep_orphaned_layer_files(max_age_days=30)
                    logger.info("Qwen cleanup sweep: deleted %s files", len(result.get('deleted', [])))
                except Exception as exc:
                    logger.warning("Qwen cleanup sweep failed: %s", exc)

        threading.Thread(target=_cleanup_loop, daemon=True, name="qwen-cleanup").start()

    # Register all route blueprints
    register_all_blueprints(app)

    configure_logging(app)

    from metrics import increment, observe_duration

    @app.before_request
    def _metrics_start():
        request._rimi_start = __import__("time").time()

    @app.after_request
    def _metrics_end(response):
        start = getattr(request, "_rimi_start", None)
        if start is not None:
            observe_duration("http_request_duration_ms", (__import__("time").time() - start) * 1000)
        increment("http_requests_total")
        if response.status_code >= 500:
            increment("http_errors_total")
        return response

    @app.route("/metrics")
    def prometheus_metrics():
        from metrics import render_prometheus
        from flask import Response
        return Response(render_prometheus(), mimetype="text/plain; version=0.0.4")

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
