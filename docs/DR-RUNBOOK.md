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

## Rollback deploy
1. Revert to previous Docker image / git tag
2. Run `alembic downgrade -1` only if the latest migration is reversible
3. Verify `/api/health/ready` returns 200

## Contacts
- On-call engineer: configure in your incident tool
- Razorpay dashboard for payment reconciliation after outage
