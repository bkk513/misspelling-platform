from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..services.analytics_service import (
    cluster_payload,
    cohort_compare_payload,
    explainability_payload,
    summary_payload,
    temporal_patterns_payload,
)

router = APIRouter()


class ClusterBody(BaseModel):
    project_id: int = Field(gt=0)
    k: int = Field(default=3, ge=1, le=8)
    method: str = Field(default="kmeans_advanced", max_length=64)


class CohortCompareBody(BaseModel):
    project_id: int = Field(gt=0)
    cohort_a: str = Field(min_length=1, max_length=64)
    cohort_b: str = Field(min_length=1, max_length=64)
    permutations: int = Field(default=1000, ge=100, le=8000)
    bootstrap: int = Field(default=1000, ge=100, le=5000)


class TemporalPatternsBody(BaseModel):
    project_id: int = Field(gt=0)
    n_clusters: int = Field(default=3, ge=2, le=12)
    limit_terms: int = Field(default=160, ge=20, le=400)


class ExplainabilityBody(BaseModel):
    project_id: int = Field(gt=0)
    target_cohort: str | None = Field(default=None, max_length=64)


@router.post("/api/analytics/cluster")
def cluster(body: ClusterBody, current_user=Depends(get_optional_user)):
    return cluster_payload(project_id=body.project_id, k=body.k, method=body.method, current_user=current_user)


@router.post("/api/analytics/cohort-compare")
def cohort_compare(body: CohortCompareBody, current_user=Depends(get_optional_user)):
    return cohort_compare_payload(
        project_id=body.project_id,
        cohort_a=body.cohort_a,
        cohort_b=body.cohort_b,
        permutations=body.permutations,
        bootstrap=body.bootstrap,
        current_user=current_user,
    )


@router.post("/api/analytics/temporal-patterns")
def temporal_patterns(body: TemporalPatternsBody, current_user=Depends(get_optional_user)):
    return temporal_patterns_payload(
        project_id=body.project_id,
        n_clusters=body.n_clusters,
        limit_terms=body.limit_terms,
        current_user=current_user,
    )


@router.post("/api/analytics/explainability")
def explainability(body: ExplainabilityBody, current_user=Depends(get_optional_user)):
    return explainability_payload(
        project_id=body.project_id,
        target_cohort=body.target_cohort,
        current_user=current_user,
    )


@router.get("/api/analytics/summary")
def summary(project_id: int, current_user=Depends(get_optional_user)):
    return summary_payload(project_id=project_id, current_user=current_user)
