"""RQ worker entrypoints for long-running AI jobs."""
import json


def run_generation_job(payload_json: str):
    """Example worker used when Redis/RQ is available."""
    payload = json.loads(payload_json)
    return {"status": "completed", "tool": payload.get("toolKey"), "message": "Job finished"}
