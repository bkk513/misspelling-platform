from fastapi import APIRouter

from ..services.timeseries_service import get_task_timeseries_points, get_task_timeseries_summary

router = APIRouter()


@router.get("/api/time-series/{task_id}")
def get_time_series(task_id: str):
    return get_task_timeseries_summary(task_id)


@router.get("/api/time-series/{task_id}/points")
def get_time_series_points(task_id: str, variant: str = "correct"):
    return get_task_timeseries_points(task_id, variant)
