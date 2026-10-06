from fastapi import APIRouter, Request, Response

from backend.app.services.reference_data_service import bootstrap_payload


router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/bootstrap")
def bootstrap(request: Request) -> Response:
    body, etag = bootstrap_payload()
    # No shared CDN freshness extension: the origin cache alone sets the 60s bound.
    # This endpoint contains only public reference datasets, never meeting-room data.
    headers = {"ETag": etag, "Cache-Control": "public, no-cache", "Vary": "Accept-Encoding"}
    candidates = request.headers.get("if-none-match", "").split(",")
    if any(value.strip() == "*" or value.strip().removeprefix("W/") == etag.removeprefix("W/") for value in candidates):
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)
