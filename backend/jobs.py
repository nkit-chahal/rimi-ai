"""Background job queue helpers (RQ + Redis)."""
import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from db import db, db_lock
from redis_client import get_redis_url, redis_from_url

REDIS_URL = get_redis_url()
QUEUE_NAME = os.getenv("RQ_QUEUE_NAME", "rimi-ai")
RQ_MAX_RETRIES = int(os.getenv("RQ_MAX_RETRIES", "3"))
RQ_RETRY_INTERVALS = [10, 30, 60]
QWEN_JOB_TYPES = frozenset({"image-layers", "edit-layer", "inpaint-layer"})
QWEN_MAX_CONCURRENT = int(os.getenv("QWEN_MAX_CONCURRENT_JOBS", "2"))
IDEMPOTENCY_WINDOW_SEC = int(os.getenv("JOB_IDEMPOTENCY_WINDOW_SEC", "60"))


def get_queue():
    try:
        from rq import Queue
        redis_conn = redis_from_url(REDIS_URL)
    except ImportError:
        return None, None
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


def _payload_idempotency_hash(user_id, job_type, payload):
    if isinstance(payload, str):
        payload = json.loads(payload)
    canonical = {k: v for k, v in sorted(payload.items()) if k not in ("async", "_idemHash")}
    canonical["userId"] = user_id
    canonical["jobType"] = job_type
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _find_recent_duplicate_job(user_id, job_type, idem_hash):
    cutoff = (
        datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=IDEMPOTENCY_WINDOW_SEC)
    ).isoformat()
    with db_lock:
        conn = db()
        try:
            rows = conn.execute(
                """
                SELECT id, status, result_json, payload_json
                FROM background_jobs
                WHERE user_id = ? AND job_type = ? AND created_at >= ?
                ORDER BY id DESC LIMIT 30
                """,
                (user_id, job_type, cutoff),
            ).fetchall()
            for row in rows:
                try:
                    payload = json.loads(row["payload_json"] or "{}")
                except json.JSONDecodeError:
                    continue
                if payload.get("_idemHash") != idem_hash:
                    continue
                job = dict(row)
                if job["status"] in ("queued", "running", "completed"):
                    return job
        finally:
            conn.close()
    return None


def _count_inflight_qwen_jobs(user_id):
    with db_lock:
        conn = db()
        try:
            row = conn.execute(
                """
                SELECT COUNT(*) AS cnt FROM background_jobs
                WHERE user_id = ?
                  AND job_type IN ('image-layers', 'edit-layer', 'inpaint-layer')
                  AND status IN ('queued', 'running')
                """,
                (user_id,),
            ).fetchone()
            return int(row["cnt"] or 0)
        finally:
            conn.close()


def run_queued_job(job_id):
    """Top-level RQ worker entrypoint (must be importable, not a nested closure)."""
    from workers import run_generation_job

    update_job_record(job_id, "running")
    update_job_progress(job_id, 1, "Starting", status="running")
    try:
        job = get_job_row(job_id)
        if not job:
            raise RuntimeError(f"Job {job_id} not found")

        payload_json = job.get("payload_json") or "{}"
        result = run_generation_job(job_id, payload_json)
        update_job_progress(job_id, 100, "Complete")
        update_job_record(job_id, "completed", result=result)
        return result
    except Exception as exc:
        update_job_record(job_id, "failed", error=str(exc))
        raise


def _run_sync(job_id, worker_fn, worker_arg):
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


def _run_sync_background(job_id, worker_fn, worker_arg):
    """Run a job in a daemon thread so the HTTP request returns immediately.

    The frontend polls /api/jobs/<id> for progress, so this mirrors the
    Redis/RQ flow without requiring a worker process in dev.
    """
    import threading

    def _target():
        try:
            _run_sync(job_id, worker_fn, worker_arg)
        except Exception:
            pass  # _run_sync already recorded the failure

    thread = threading.Thread(
        target=_target,
        name=f"rimi-job-{job_id}",
        daemon=True,
    )
    thread.start()
    return {"jobId": job_id, "status": "queued", "sync": False}


def enqueue_or_run(job_type, user_id, project_id, payload, worker_fn, worker_arg):
    """Enqueue when Redis/RQ is available; background-thread fallback in dev."""
    if isinstance(payload, dict):
        idem_hash = _payload_idempotency_hash(user_id, job_type, payload)
        payload = {**payload, "_idemHash": idem_hash}
        duplicate = _find_recent_duplicate_job(user_id, job_type, idem_hash)
        if duplicate:
            result = None
            if duplicate.get("result_json"):
                try:
                    result = json.loads(duplicate["result_json"])
                except json.JSONDecodeError:
                    result = duplicate["result_json"]
            return {
                "jobId": duplicate["id"],
                "status": duplicate["status"],
                "sync": duplicate["status"] == "completed",
                "duplicate": True,
                "result": result if duplicate["status"] == "completed" else None,
            }

        if job_type in QWEN_JOB_TYPES:
            inflight = _count_inflight_qwen_jobs(user_id)
            if inflight >= QWEN_MAX_CONCURRENT:
                return {
                    "error": "concurrency_limit",
                    "message": f"Maximum {QWEN_MAX_CONCURRENT} Qwen jobs can run at once.",
                    "retryAfterMs": 15000,
                    "inflight": inflight,
                }

    job_id = create_job_record(user_id, project_id, job_type, payload)
    queue, _redis = get_queue()
    is_production = os.getenv("FLASK_ENV") == "production"
    allow_sync = os.getenv("RIMI_SYNC_JOBS", "").lower() in ("1", "true", "yes") or os.getenv(
        "RIMI_ALLOW_SYNC_JOBS", ""
    ).lower() in ("1", "true", "yes")

    if queue is None:
        if is_production and not allow_sync:
            update_job_record(job_id, "failed", error="Job queue unavailable")
            raise RuntimeError("Background job queue unavailable in production")
        if allow_sync:
            result = _run_sync(job_id, worker_fn, worker_arg)
            return {"jobId": job_id, "status": "completed", "sync": True, "result": result}
        return _run_sync_background(job_id, worker_fn, worker_arg)

    if is_production and not allow_sync:
        try:
            from rq import Retry
            retry = Retry(max=RQ_MAX_RETRIES, interval=RQ_RETRY_INTERVALS)
        except ImportError:
            retry = None
        queue.enqueue(
            run_queued_job,
            job_id,
            job_id=f"rimi-{job_id}-{uuid.uuid4().hex[:8]}",
            retry=retry,
        )
        return {"jobId": job_id, "status": "queued", "sync": False}

    if allow_sync:
        try:
            from rq import Worker
            if not Worker.all(connection=_redis):
                result = _run_sync(job_id, worker_fn, worker_arg)
                return {"jobId": job_id, "status": "completed", "sync": True, "result": result}
        except Exception:
            result = _run_sync(job_id, worker_fn, worker_arg)
            return {"jobId": job_id, "status": "completed", "sync": True, "result": result}

    try:
        from rq import Retry
        retry = Retry(max=RQ_MAX_RETRIES, interval=RQ_RETRY_INTERVALS)
    except ImportError:
        retry = None

    queue.enqueue(
        run_queued_job,
        job_id,
        job_id=f"rimi-{job_id}-{uuid.uuid4().hex[:8]}",
        retry=retry,
    )
    return {"jobId": job_id, "status": "queued", "sync": False}
