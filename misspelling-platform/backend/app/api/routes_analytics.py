"""文件说明：分析接口路由模块，负责接收 HTTP 请求并调用对应服务层。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..services.meso_service import build_project_meso_clusters_payload, run_project_micro_tasks_payload
from ..services.analytics_service import (
    cluster_payload,
    cohort_compare_payload,
    explainability_payload,
    summary_payload,
    temporal_patterns_payload,
)
from ..tasks import deltat_null, mrnmr_steady, pcmci_causal

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


class ProjectMicroRunBody(BaseModel):
    project_id: int = Field(gt=0)
    cohort_names: list[str] = Field(default_factory=list)
    term_ids: list[int] = Field(default_factory=list)


class ProjectMesoClusterBody(BaseModel):
    project_id: int = Field(gt=0)
    cohort_names: list[str] = Field(default_factory=list)
    term_ids: list[int] = Field(default_factory=list)
    cluster_k: int = Field(default=3, ge=2, le=12)


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


@router.post("/api/analytics/project-micro/run")
def project_micro_run(body: ProjectMicroRunBody, current_user=Depends(get_optional_user)):
    return run_project_micro_tasks_payload(
        project_id=body.project_id,
        cohort_names=body.cohort_names or [],
        term_ids=body.term_ids or [],
        current_user=current_user,
        celery_task_map={
            "pcmci-causal": pcmci_causal,
            "mrnmr-steady": mrnmr_steady,
            "deltaT-null": deltat_null,
            "deltat-null": deltat_null,
        },
    )


@router.post("/api/analytics/project-meso/cluster")
def project_meso_cluster(body: ProjectMesoClusterBody, current_user=Depends(get_optional_user)):
    return build_project_meso_clusters_payload(
        project_id=body.project_id,
        cohort_names=body.cohort_names or [],
        term_ids=body.term_ids or [],
        cluster_k=int(body.cluster_k),
        current_user=current_user,
    )
