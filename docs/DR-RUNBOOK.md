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

Railway does not create a service per Procfile line. `backend/railway.toml` pins `startCommand`
to `sh start-web.sh`, which starts the RQ workers in the background and then execs gunicorn, so
**both run inside the single `rimi-ai` service** and there is no separate worker service to look
for. Each worker is respawned if it exits, so a crash does not silently leave the queue
unattended.

`RQ_WORKER_COUNT` (default 2) sets how many workers that script starts. Each takes one job at a
time, so at 1 every user's generation serialises behind the one before it. A worker spends most
of a job waiting on Replicate rather than computing, so extra workers cost little CPU — memory is
the ceiling, since a full-resolution composite can hold several hundred MB. Raise it only
alongside the container's memory.

Note that scaling the service to more than one replica multiplies both: every replica runs the
same start command, so N replicas means N gunicorn sets *and* N × `RQ_WORKER_COUNT` workers.

If web and jobs ever need to scale independently — or job memory spikes start taking the API down
with them — split the worker into its own Railway service on the same repo and root directory,
with:

- Start command: `rq worker -c rqsettings rimi-ai`
- The same `REDIS_URL`, `DATABASE_URL`, `REPLICATE_API_TOKEN`, `GROQ_API_KEY` and `AWS_*`
  variables as the web service (it does the actual generating and writes the results)
- No healthcheck path (it serves no HTTP)
- `RQ_WORKER_COUNT=0` on the web service, so the two do not both run workers

`docker-compose.yml` already models that split shape locally.

Verify from outside: `GET /api/health/ready` reports `checks.rq_worker`, `checks.workers` and
`checks.queueDepth`. A `503` with `"rq_worker": "no RQ worker listening on 'rimi-ai'"` means the
workers are missing or crashed; a healthy queue with a climbing `queueDepth` means jobs are
arriving faster than `RQ_WORKER_COUNT` workers can drain them.

## Rollback deploy
1. Revert to previous Docker image / git tag
2. Run `alembic downgrade -1` only if the latest migration is reversible
3. Verify `/api/health/ready` returns 200

## Contacts
- On-call engineer: configure in your incident tool
- Razorpay dashboard for payment reconciliation after outage
