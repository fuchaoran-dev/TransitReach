"""Read-only local FastAPI smoke/benchmark against configured cloud PostgreSQL.

Run: .venv/bin/python -m scripts.benchmark-performance
No writes, no credential output. Results measure this machine, not Render production.
"""
import gzip
import json
from statistics import median
from time import perf_counter

from fastapi.testclient import TestClient

from backend.app.database import get_pool
from backend.app.main import app
from backend.app.services.reference_data_service import _bootstrap_cache
from backend.app.services.model_registry import _metadata_cache, _prediction_cache


def timed(call):
    start = perf_counter()
    value = call()
    return value, round((perf_counter() - start) * 1000, 2)


def main():
    _bootstrap_cache.clear()
    _metadata_cache.clear()
    _prediction_cache.clear()
    with TestClient(app) as client:
        first, cold_ms = timed(lambda: client.get("/api/data/bootstrap"))
        first.raise_for_status()
        data = first.json()
        warm_ms = []
        for _ in range(5):
            response, duration = timed(lambda: client.get("/api/data/bootstrap"))
            response.raise_for_status()
            assert response.content == first.content
            warm_ms.append(duration)
        revalidated = client.get("/api/data/bootstrap", headers={"If-None-Match": first.headers["etag"]})
        assert revalidated.status_code == 304
        params = {"mode": "BUS", "line_id": "U1510", "stop_id": "1007614", "datetime": "2026-10-06T09:00:00+08:00"}
        prediction, prediction_cold = timed(lambda: client.get("/api/reliability/predict", params=params))
        prediction.raise_for_status()
        warm_prediction, prediction_warm = timed(lambda: client.get("/api/reliability/predict", params=params))
        assert prediction.json() == warm_prediction.json()
        assert prediction.json().get("supported") is True
        print(json.dumps({
            "scope": "local FastAPI + configured cloud PostgreSQL; not Render latency",
            "bootstrap_first_ms": cold_ms,
            "bootstrap_cached_median_ms": median(warm_ms),
            "bootstrap_cached_samples_ms": warm_ms,
            "bootstrap_bytes": len(first.content),
            "bootstrap_gzip_bytes": len(gzip.compress(first.content, compresslevel=5)),
            "etag_revalidation_status": revalidated.status_code,
            "prediction_first_ms": prediction_cold,
            "prediction_cached_ms": prediction_warm,
            "counts": {key: len(data[key]) for key in ("railStops", "busStops", "places", "essentialServices")},
            "pool_stats": get_pool().get_stats(),
        }, indent=2))


if __name__ == "__main__":
    main()
