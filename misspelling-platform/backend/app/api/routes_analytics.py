from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..services.analytics_service import cluster_payload, summary_payload

router = APIRouter()


class ClusterBody(BaseModel):
    project_id: int = Field(gt=0)
    k: int = Field(default=3, ge=1, le=8)


@router.post("/api/analytics/cluster")
def cluster(body: ClusterBody, current_user=Depends(get_optional_user)):
    return cluster_payload(project_id=body.project_id, k=body.k, current_user=current_user)


@router.get("/api/analytics/summary")
def summary(project_id: int, current_user=Depends(get_optional_user)):
    return summary_payload(project_id=project_id, current_user=current_user)
