from __future__ import annotations

from backend.app.schemas.reliability import ServiceCapability, TransitMode
from backend.app.services.model_registry import service_catalog


def _capabilities() -> tuple[ServiceCapability, ...]:
    return (
      *(ServiceCapability(
        mode=TransitMode.BUS, line_id=item["line_id"], name=item["name"],
        historical_operational_data_available=True, model_available=True,
        prediction_available=True, reason=None, stops=item["stops"],
    ) for item in service_catalog()),
    ServiceCapability(mode=TransitMode.LRT, line_id="AG", name="LRT Ampang Line"),
    ServiceCapability(mode=TransitMode.LRT, line_id="KJ", name="LRT Kelana Jaya Line"),
    ServiceCapability(mode=TransitMode.LRT, line_id="PH", name="LRT Sri Petaling Line"),
    ServiceCapability(mode=TransitMode.LRT, line_id="SA", name="LRT Shah Alam Line"),
    ServiceCapability(mode=TransitMode.MRT, line_id="KGL", name="MRT Kajang Line"),
    ServiceCapability(mode=TransitMode.MRT, line_id="PYL", name="MRT Putrajaya Line"),
      ServiceCapability(mode=TransitMode.BRT, line_id="BRT", name="BRT Sunway Line"),
    )


def list_capabilities() -> tuple[ServiceCapability, ...]:
    return _capabilities()


def get_capability(mode: TransitMode, line_id: str) -> ServiceCapability | None:
    return next((item for item in _capabilities() if item.mode == mode and item.line_id == line_id), None)
