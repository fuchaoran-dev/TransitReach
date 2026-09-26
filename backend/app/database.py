from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row


ROOT = Path(__file__).resolve().parents[2]


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
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as database:
        yield database
