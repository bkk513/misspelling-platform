from fastapi import APIRouter, Depends

from .auth_deps import get_optional_user
from ..services.report_service import (
    create_project_report_payload,
    create_task_report_payload,
    get_report_payload,
    list_reports_payload,
)

router = APIRouter()


@router.post("/api/reports/export/task/{task_id}")
def export_task_report(task_id: str, current_user=Depends(get_optional_user)):
    return create_task_report_payload(task_id=task_id, current_user=current_user)


@router.post("/api/reports/export/project/{project_id}")
def export_project_report(project_id: int, current_user=Depends(get_optional_user)):
    return create_project_report_payload(project_id=project_id, current_user=current_user)


@router.get("/api/reports")
def list_reports(limit: int = 100, scope: str | None = None, current_user=Depends(get_optional_user)):
    return list_reports_payload(limit=limit, scope=scope, current_user=current_user)


@router.get("/api/reports/{report_id}")
def get_report(report_id: int, current_user=Depends(get_optional_user)):
    return get_report_payload(report_id=report_id, current_user=current_user)
