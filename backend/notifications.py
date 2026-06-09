"""Transactional email helpers (Resend/SMTP when configured)."""
import logging
import os

logger = logging.getLogger(__name__)


def send_low_credits_email(email: str, remaining: int, limit: int) -> bool:
    api_key = os.getenv("RESEND_API_KEY", "")
    if not api_key:
        logger.info("Low-credits notification skipped (RESEND_API_KEY not set) for %s: %s/%s", email, remaining, limit)
        return False

    try:
        import requests

        response = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.getenv("EMAIL_FROM", "RIMI AI <noreply@rimiai.pro>"),
                "to": [email],
                "subject": "RIMI AI — credits running low",
                "html": f"<p>You have <strong>{remaining}</strong> of {limit} AI credits remaining.</p>",
            },
            timeout=15,
        )
        response.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Failed to send low-credits email: %s", exc)
        return False
