"""RQ worker settings — always connect with RESP2 (see redis_client)."""
from redis_client import get_redis_url

REDIS_URL = get_redis_url()
