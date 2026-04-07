"""文件说明：时序接口路由模块，负责接收 HTTP 请求并调用对应服务层。"""

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel

from .auth_deps import get_optional_user
from ..services.timeseries_service import (
    bulk_delete_series_payload,
    get_task_timeseries_points,
    get_task_timeseries_summary,
    list_series_catalog_payload,
)

router = APIRouter()


class BulkDeleteSeriesBody(BaseModel):
    series_ids: list[int]


@router.get("/api/time-series/{task_id}")
def get_time_series(
    task_id: str,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    return get_task_timeseries_summary(task_id, current_user=current_user, guest_key=guest_key)


@router.get("/api/time-series/{task_id}/points")
def get_time_series_points(
    task_id: str,
    variant: str = "correct",
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    return get_task_timeseries_points(task_id, variant, current_user=current_user, guest_key=guest_key)


@router.get("/api/time-series")
def list_time_series(
    limit: int = 100,
    scope: str | None = None,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    return list_series_catalog_payload(limit=limit, current_user=current_user, scope=scope, guest_key=guest_key)


@router.post("/api/time-series/bulk-delete")
def bulk_delete_series(
    body: BulkDeleteSeriesBody,
    current_user=Depends(get_optional_user),
    guest_key: str | None = Header(default=None, alias="X-Guest-Key"),
):
    return bulk_delete_series_payload(body.series_ids or [], current_user=current_user, guest_key=guest_key)
