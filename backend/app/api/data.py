from fastapi import APIRouter

from backend.app.services.reference_data_service import application_data


router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/bootstrap")
def bootstrap() -> dict:
    return application_data()
