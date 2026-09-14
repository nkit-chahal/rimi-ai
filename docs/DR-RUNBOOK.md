# Disaster Recovery Runbook

## RTO / RPO targets
- **RPO:** 24 hours (daily Postgres backups)
- **RTO:** 4 hours (restore + redeploy)

## Postgres backup (production)
```bash
pg_dump "$DATABASE_URL" -Fc -f "rimi-backup-$(date +%Y%m%d).dump"
```
Store dumps off-site (S3 bucket with versioning enabled).

## Postgres restore
```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists rimi-backup-YYYYMMDD.dump
```

## Object storage (uploads / results)
- Enable S3 versioning on the production bucket
- `AWS_*` / Railway bucket credentials must be backed up in secrets manager
- Local `backend/uploads` and `backend/results` are ephemeral when S3 is primary

## Redis
- Job queue state is transient; failed jobs are recorded in `background_jobs`
- After Redis loss: restart workers; re-enqueue failed jobs manually if needed

## Background worker (required, separate from the web service)
Async tools — Make Seamless, and the Qwen `image-layers` / `edit-layer` / `inpaint-layer` jobs —
do **not** run inside the web process. With `FLASK_ENV=production`, `enqueue_or_run` pushes them
onto the `rimi-ai` RQ queue and returns a job id immediately. If nothing is consuming that queue
the jobs stay `queued` forever: the API looks healthy, Replicate is never called, and the UI sits
on a progress bar. There is no in-process fallback in production — that is deliberate, because a
long generation inside a gunicorn worker would block a request slot.

`backend/Procfile` declares both processes:

```
web:    gunicorn -c gunicorn_config.py server:app
worker: rq worker -c rqsettings rimi-ai
```

Railway does not create a service per Procfile line, and `backend/railway.toml` pins
`startCommand` to the web process. **The worker must be a second Railway service** on the same
repo and root directory, with:

- Start command: `rq worker -c rqsettings rimi-ai`
- The same `REDIS_URL`, `DATABASE_URL`, `REPLICATE_API_TOKEN`, `GROQ_API_KEY` and `AWS_*`
  variables as the web service (it does the actual generating and writes the results)
- No healthcheck path (it serves no HTTP)

Verify from outside: `GET /api/health/ready` reports `checks.rq_worker`, `checks.workers` and
`checks.queueDepth`. A `503` with `"rq_worker": "no RQ worker listening on 'rimi-ai'"` means the
worker service is missing or crashed; a healthy queue with a climbing `queueDepth` means the same.

## Rollback deploy
1. Revert to previous Docker image / git tag
2. Run `alembic downgrade -1` only if the latest migration is reversible
3. Verify `/api/health/ready` returns 200

## Contacts
- On-call engineer: configure in your incident tool
- Razorpay dashboard for payment reconciliation after outage
