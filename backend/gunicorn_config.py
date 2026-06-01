import multiprocessing

bind = "127.0.0.1:5000"
workers = multiprocessing.cpu_count() * 2 + 1
threads = 2
timeout = 120
wsgi_app = "server:app"
accesslog = "-"
errorlog = "-"
loglevel = "info"
