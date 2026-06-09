"""RQ worker entrypoints for long-running AI jobs."""
from job_runners import run_extract_design_single_job, run_make_seamless_job


def run_generation_job(job_id, payload_json: str):
    payload = __import__("json").loads(payload_json)
    tool = payload.get("toolKey") or payload.get("tool")
    if tool in ("extract", "extract-design-single"):
        return run_extract_design_single_job(job_id, payload_json)
    if tool == "make-seamless":
        return run_make_seamless_job(job_id, payload_json)
    return {"status": "completed", "tool": tool, "message": "Job finished"}
