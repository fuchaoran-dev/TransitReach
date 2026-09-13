from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.reliability import router as reliability_router


app = FastAPI(title="TransitReach Reliability API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(reliability_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
