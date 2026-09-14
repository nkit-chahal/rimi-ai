#!/bin/sh
# Railway runs one process per service, but RIMI needs two: gunicorn for the API, and an RQ worker
# to drain the 'rimi-ai' queue. The async tools (Make Seamless and the Qwen image-layers /
# edit-layer / inpaint-layer jobs) are enqueued by the web process and never execute without a
# worker — jobs sit at 'queued', Replicate is never called, and the UI spins on a progress bar.
# There is deliberately no in-process fallback in production (see jobs.enqueue_or_run), because a
# 30-120s generation inside a gunicorn worker would block a request slot.
#
# docker-compose.yml models web and worker as separate services, which is the cleaner shape. If
# this service ever needs to scale the two independently, split the worker into its own Railway
# service with `rq worker -c rqsettings rimi-ai` and drop this script.
#
# The worker is respawned on exit so a crash doesn't silently leave the queue unattended — gunicorn
# would keep the container "healthy" while nothing processed jobs. /api/health/ready reports
# rq_worker, workers and queueDepth to catch the case where it stays down anyway.

(
  while true; do
    rq worker -c rqsettings rimi-ai
    echo "[start-web] rq worker exited ($?); restarting in 5s" >&2
    sleep 5
  done
) &

exec gunicorn -c gunicorn_config.py server:app
