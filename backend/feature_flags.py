"""Lightweight feature flags via environment variables."""
import os


def is_enabled(flag_name, default=False):
    raw = os.getenv(flag_name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


MOCKUP_3D_PREVIEW = is_enabled("FEATURE_MOCKUP_3D_PREVIEW", True)
PRINT_ADVISOR = is_enabled("FEATURE_PRINT_ADVISOR", True)
EMAIL_SIGNUP = is_enabled("FEATURE_EMAIL_SIGNUP", True)
