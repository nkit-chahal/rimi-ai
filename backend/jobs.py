"""Background job queue helpers (RQ + Redis)."""
import json
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
    if not isinstance(payload, str):
        payload = json.dumps(payload)
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db_lock:
        conn = db()
        try:
            cur = conn.execute(
                """
                INSERT INTO background_jobs (user_id, project_id, job_type, status, payload_json, progress_pct, stage, created_at)
                VALUES (?, ?, ?, 'queued', ?, 0, 'Queued', ?)
                """,
                (user_id, project_id, job_type, payload, now),
            )
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def _serialize_result(result):
    if result is None:
        return None
    if isinstance(result, str):
        return result
    return json.dumps(result)


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
                (status, _serialize_result(result), error, now, job_id),
            )
            conn.commit()
        finally:
            conn.close()


def update_job_progress(job_id, progress_pct, stage, status=None):
    with db_lock:
        conn = db()
        try:
            if status:
                conn.execute(
                    "UPDATE background_jobs SET progress_pct = ?, stage = ?, status = ? WHERE id = ?",
                    (int(progress_pct), stage, status, job_id),
                )
            else:
                conn.execute(
                    "UPDATE background_jobs SET progress_pct = ?, stage = ? WHERE id = ?",
                    (int(progress_pct), stage, job_id),
                )
            conn.commit()
        finally:
            conn.close()


def get_job_row(job_id):
    conn = db()
    try:
        row = conn.execute("SELECT * FROM background_jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def enqueue_or_run(job_type, user_id, project_id, payload, worker_fn, worker_arg):
    """Enqueue when Redis/RQ is available; otherwise run synchronously."""
    job_id = create_job_record(user_id, project_id, job_type, payload)
    queue, _redis = get_queue()

    def _run():
        update_job_record(job_id, "running")
        update_job_progress(job_id, 1, "Starting", status="running")
        try:
            result = worker_fn(job_id, worker_arg)
            update_job_progress(job_id, 100, "Complete")
            update_job_record(job_id, "completed", result=result)
            return result
        except Exception as exc:
            update_job_record(job_id, "failed", error=str(exc))
            raise

    if queue is None or os.getenv("RIMI_SYNC_JOBS", "").lower() in ("1", "true", "yes"):
        try:
            result = _run()
            return {"jobId": job_id, "status": "completed", "sync": True, "result": result}
        except Exception:
            raise

    try:
        from rq import Worker

        if not Worker.all(connection=_redis):
            result = _run()
            return {"jobId": job_id, "status": "completed", "sync": True, "result": result}
    except Exception:
        result = _run()
        return {"jobId": job_id, "status": "completed", "sync": True, "result": result}

    queue.enqueue(_run, job_id=f"rimi-{job_id}-{uuid.uuid4().hex[:8]}")
    return {"jobId": job_id, "status": "queued", "sync": False}
