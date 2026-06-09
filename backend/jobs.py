"""Background job queue helpers (RQ + Redis)."""
import os
import uuid
from datetime import datetime, timezone

from db import db, db_lock

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "rimi-ai")


def get_queue():
    try:
        from redis import Redis
        from rq import Queue
    except ImportError:
        return None, None
    redis_conn = Redis.from_url(REDIS_URL)
    return Queue(QUEUE_NAME, connection=redis_conn), redis_conn


def create_job_record(user_id, project_id, job_type, payload):
    import json as _json
    if not isinstance(payload, str):
        payload = _json.dumps(payload)
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO background_jobs (user_id, project_id, job_type, status, payload_json, created_at)
                VALUES (?, ?, ?, 'queued', ?, ?)
                """,
                (user_id, project_id, job_type, payload, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def update_job_record(job_id, status, result=None, error=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            conn.execute(
                """
                UPDATE background_jobs
                SET status = ?, result_json = ?, error = ?, completed_at = ?
                WHERE id = ?
                """,
                (status, result, error, now, job_id),
            )
            conn.commit()
        finally:
            conn.close()


def enqueue_or_run(job_type, user_id, project_id, payload, worker_fn, *args, **kwargs):
    """Enqueue when Redis/RQ is available; otherwise run synchronously."""
    job_id = create_job_record(user_id, project_id, job_type, payload)
    queue, _redis = get_queue()
    if queue is None:
        try:
            result = worker_fn(*args, **kwargs)
            update_job_record(job_id, "completed", result=str(result))
            return {"jobId": job_id, "status": "completed", "sync": True, "result": result}
        except Exception as exc:
            update_job_record(job_id, "failed", error=str(exc))
            raise

    from rq import get_current_job

    def _wrapped():
        try:
            result = worker_fn(*args, **kwargs)
            update_job_record(job_id, "completed", result=str(result))
            return result
        except Exception as exc:
            update_job_record(job_id, "failed", error=str(exc))
            raise

    queue.enqueue(_wrapped, job_id=f"rimi-{job_id}-{uuid.uuid4().hex[:8]}")
    return {"jobId": job_id, "status": "queued", "sync": False}
