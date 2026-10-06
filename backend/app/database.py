from __future__ import annotations

import os
import atexit
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from threading import Lock

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


ROOT = Path(__file__).resolve().parents[2]
_pool: ConnectionPool | None = None
_pool_lock = Lock()


def database_url() -> str:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env.local", override=False)
    except ImportError:
        pass
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is required; PostgreSQL is the application data source")
    return value


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as database:
        yield database


def get_pool() -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            url = database_url()
            minimum = int(os.getenv("DB_POOL_MIN_SIZE", "1"))
            maximum = int(os.getenv("DB_POOL_MAX_SIZE", "4"))
            if not 0 <= minimum <= maximum or maximum < 1:
                raise ValueError("Invalid DB_POOL_MIN_SIZE / DB_POOL_MAX_SIZE")
            pool = ConnectionPool(
                conninfo=url, min_size=minimum, max_size=maximum, open=False,
                timeout=10, max_waiting=32, max_idle=300, max_lifetime=1800,
                kwargs={"connect_timeout": 10, "row_factory": dict_row, "prepare_threshold": None},
                check=ConnectionPool.check_connection,
            )
            pool.open(wait=False)
            _pool = pool
        return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        pool.close()


atexit.register(close_pool)
