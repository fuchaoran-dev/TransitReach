from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse
from psycopg_pool import PoolTimeout
from contextlib import asynccontextmanager
from time import perf_counter
import logging

from backend.app.database import get_pool, close_pool

from backend.app.api.reliability import router as reliability_router
from backend.app.api.data import router as data_router
from backend.app.api.meetings import router as meetings_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_pool()  # Bounded pool warms in the background; health need not wait for PostgreSQL.
    try:
        yield
    finally:
        close_pool()


class RequestTimingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        start = perf_counter()

        async def timed_send(message):
            if message["type"] == "http.response.start":
                elapsed = (perf_counter() - start) * 1000
                message.setdefault("headers", []).append((b"server-timing", f"app;dur={elapsed:.1f}".encode()))
                # Do not log query strings, coordinates, tokens or connection details.
                logging.getLogger("uvicorn.error").info(
                    "request path=%s status=%s app_ms=%.1f", scope["path"], message["status"], elapsed)
            await send(message)
        await self.app(scope, receive, timed_send)


app = FastAPI(title="TransitReach Reliability API", version="0.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
app.add_middleware(RequestTimingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(reliability_router)
app.include_router(data_router)
app.include_router(meetings_router)


@app.exception_handler(PoolTimeout)
async def database_busy(_request, _error):
    return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable. Please retry."}, headers={"Retry-After": "5", "Cache-Control": "no-store"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
