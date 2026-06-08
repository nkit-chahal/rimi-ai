import multiprocessing
import os

# Railway injects PORT; bind all interfaces so the edge proxy can reach the app.
port = os.getenv("PORT", "5000")
bind = f"0.0.0.0:{port}"

# Cap workers on small containers; mockup routes are CPU/IO heavy.
workers = min(4, max(2, multiprocessing.cpu_count() + 1))
threads = 2

# AI mockup generation can take 60–120s per product (Replicate + download).
timeout = 300
graceful_timeout = 60
keepalive = 5

wsgi_app = "server:app"
accesslog = "-"
errorlog = "-"
loglevel = "info"
