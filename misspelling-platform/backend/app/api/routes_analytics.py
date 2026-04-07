from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..db.audit_logs_repo import insert_audit_log
from ..db.projects_repo import bind_project_task
from ..services.analytics_service import (
    bootstrap_demo_cohorts_payload,
    cluster_payload,
    cohort_compare_payload,
    explainability_payload,
    summary_payload,
    temporal_patterns_payload,
)
from ..services.meso_service import (
    ensure_meso_project_access,
    prepare_meso_tasks_payload,
)
from ..services.task_service import create_meso_analysis_task
from ..tasks import deltat_null, demo_analysis, meso_analysis_run, mrnmr_steady, pcmci_causal, simulation_run

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


class MesoBody(BaseModel):
    project_id: int = Field(gt=0)
    cohort_names: list[str] = Field(default_factory=list)
    term_ids: list[int] = Field(default_factory=list)
    cluster_k: int = Field(default=3, ge=1, le=8)
    include_simulation: bool = Field(default=False)
    data_source: str = Field(default="gbnc", max_length=16)


@router.post("/api/analytics/cluster")
def cluster(body: ClusterBody, current_user=Depends(get_optional_user)):
    return cluster_payload(project_id=body.project_id, k=body.k, method=body.method, current_user=current_user)


@router.post("/api/analytics/bootstrap-demo-cohorts")
def bootstrap_demo_cohorts(body: ClusterBody, current_user=Depends(get_optional_user)):
    return bootstrap_demo_cohorts_payload(project_id=body.project_id, k=body.k, method=body.method, current_user=current_user)


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


@router.post("/api/analytics/meso/prepare")
def meso_prepare(body: MesoBody, current_user=Depends(get_optional_user)):
    return prepare_meso_tasks_payload(
        project_id=body.project_id,
        cohort_names=body.cohort_names,
        term_ids=body.term_ids,
        include_simulation=bool(body.include_simulation),
        data_source=body.data_source,
        current_user=current_user,
        celery_task_map={
            "word-analysis": demo_analysis,
            "pcmci-causal": pcmci_causal,
            "mrnmr-steady": mrnmr_steady,
            "deltaT-null": deltat_null,
            "simulation-run": simulation_run,
        },
    )


@router.post("/api/analytics/meso/analyze")
def meso_analyze(body: MesoBody, current_user=Depends(get_optional_user)):
    project = ensure_meso_project_access(body.project_id, current_user)
    owner_user_id = int(project.get("owner_user_id") or 0) or None
    params = {
        "project_id": int(body.project_id),
        "owner_user_id": owner_user_id,
        "cohort_names": [str(name).strip() for name in (body.cohort_names or []) if str(name).strip()],
        "term_ids": [int(term_id) for term_id in (body.term_ids or []) if int(term_id) > 0],
        "cluster_k": int(body.cluster_k),
        "include_simulation": bool(body.include_simulation),
        "data_source": str(body.data_source or "gbnc"),
    }
    result = create_meso_analysis_task(params, meso_analysis_run, owner_user_id=owner_user_id, guest_key=None)
    bind_project_task(body.project_id, str(result["task_id"]))
    insert_audit_log(
        action="MESO_ANALYZE",
        actor_user_id=int(current_user["id"]) if current_user else None,
        target_type="project",
        target_id=str(body.project_id),
        meta={**params, "task_id": result["task_id"]},
    )
    return result
