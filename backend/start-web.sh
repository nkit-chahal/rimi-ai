#!/bin/sh
# Railway runs one process per service, but RIMI needs two kinds: gunicorn for the API, and RQ
# workers to drain the 'rimi-ai' queue. The async tools (Make Seamless, mockup batches, and the
# Qwen image-layers / edit-layer / inpaint-layer jobs) are enqueued by the web process and never
# execute without a worker — jobs sit at 'queued', Replicate is never called, and the UI spins on
# a progress bar. There is deliberately no in-process fallback in production (see
# jobs.enqueue_or_run), because a 30-120s generation inside a gunicorn worker would block a
# request slot.
#
# docker-compose.yml models web and worker as separate services, which is the cleaner shape. If
# this service ever needs to scale the two independently, split the worker into its own Railway
# service with `rq worker -c rqsettings rimi-ai` and drop this script.
#
# Each worker takes one job at a time, so a single worker serialises every user's generation: the
# second person to hit Generate waits out the first person's whole job. Two workers is the default
# because a worker spends most of a job waiting on Replicate rather than computing, so the extra
# process costs little CPU. Memory is the real ceiling — a full-resolution composite can hold
# several hundred MB — so raise this only alongside the container's memory, and watch `workers` and
# `queueDepth` on /api/health/ready to decide.
RQ_WORKER_COUNT="${RQ_WORKER_COUNT:-2}"

# A non-numeric value would make the loop condition below error out and start no workers at all,
# which looks like a healthy container with a queue nothing drains. Fail back to the default and
# say so, rather than going silently dark.
case "$RQ_WORKER_COUNT" in
  ''|*[!0-9]*)
    echo "[start-web] RQ_WORKER_COUNT='$RQ_WORKER_COUNT' is not a number; using 2" >&2
    RQ_WORKER_COUNT=2
    ;;
esac

# Each worker is respawned on exit so a crash doesn't silently leave the queue unattended —
# gunicorn would keep the container "healthy" while nothing processed jobs. /api/health/ready
# reports rq_worker, workers and queueDepth to catch the case where it stays down anyway.
#
# The supervisor forwards the container's shutdown to the worker itself. A runtime signals only
# PID 1, so while this script exec'd into gunicorn the workers never saw SIGTERM: they were
# SIGKILLed with the container, never ran RQ's warm shutdown, and left their Redis registration to
# rot for the full 420s worker TTL. Those ghosts are counted by /api/health/ready, so a deploy
# whose workers failed to start could pass its healthcheck on the registrations of the container
# it replaced. A signalled worker deregisters and its key expires in 60s instead.
supervisors=""
n=1
while [ "$n" -le "$RQ_WORKER_COUNT" ]; do
  (
    rq_pid=""
    # Stop respawning once we are shutting down, or the loop would start a worker the container is
    # about to kill anyway.
    trap 'kill -TERM "$rq_pid" 2>/dev/null; wait "$rq_pid" 2>/dev/null; exit 0' TERM INT
    while true; do
      rq worker -c rqsettings rimi-ai &
      rq_pid=$!
      wait "$rq_pid"
      echo "[start-web] rq worker $n exited ($?); restarting in 5s" >&2
      sleep 5
    done
  ) &
  supervisors="$supervisors $!"
  n=$((n + 1))
done

# Not exec'd, so this script stays PID 1 and can fan the signal out. gunicorn is still the process
# whose exit ends the container: if it dies, wait returns and we stop, leaving Railway to restart.
gunicorn -c gunicorn_config.py server:app &
gunicorn_pid=$!

trap 'echo "[start-web] shutting down" >&2; kill -TERM $supervisors "$gunicorn_pid" 2>/dev/null; wait "$gunicorn_pid" 2>/dev/null; exit 0' TERM INT

wait "$gunicorn_pid"
