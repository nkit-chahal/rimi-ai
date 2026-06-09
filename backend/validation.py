"""Shared Pydantic validation helpers for Flask routes."""
from functools import wraps

from flask import jsonify, request
from pydantic import BaseModel, ValidationError


def validate_json(model: type[BaseModel]):
    """Decorator that validates request JSON against a Pydantic model."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            payload = request.get_json(silent=True) or {}
            try:
                validated = model.model_validate(payload)
            except ValidationError as exc:
                return jsonify({"success": False, "error": exc.errors()}), 400
            return view(validated, *args, **kwargs)

        return wrapped

    return decorator
