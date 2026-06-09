"""Structured logging and request correlation IDs."""
import logging
import uuid
from flask import g, request


class RequestIdFilter(logging.Filter):
    def filter(self, record):
        record.request_id = getattr(g, "request_id", "-")
        return True


def configure_logging(app):
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] [req=%(request_id)s] %(name)s: %(message)s"
    ))
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)

    @app.before_request
    def assign_request_id():
        g.request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])

    @app.after_request
    def echo_request_id(response):
        response.headers["X-Request-ID"] = getattr(g, "request_id", "-")
        return response
