from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..services.project_service import (
    add_project_terms_payload,
    bind_task_payload,
    create_project_payload,
    create_project_cohort_payload,
    delete_project_cohort_payload,
    delete_project_membership_payload,
    list_project_cohorts_payload,
    list_project_memberships_payload,
    list_project_tasks_payload,
    list_project_terms_payload,
    list_projects_payload,
    update_project_cohort_payload,
    upsert_term_memberships_payload,
)

router = APIRouter()


class CreateProjectBody(BaseModel):
    name: str = Field(min_length=2, max_length=128)
    description: str | None = Field(default=None, max_length=512)


class AddProjectTermsBody(BaseModel):
    words: list[str]
    category: str | None = Field(default=None, max_length=32)


class BindProjectTaskBody(BaseModel):
    task_id: str = Field(min_length=8, max_length=255)


class CreateProjectCohortBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    sort_order: int | None = Field(default=0, ge=0, le=10000)


class UpdateProjectCohortBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, max_length=32)
    rule_json: dict | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class MembershipAssignment(BaseModel):
    term_id: int | None = Field(default=None, gt=0)
    word: str | None = None
    cohort_id: int | None = Field(default=None, gt=0)
    cohort_name: str | None = None
    membership_weight: float | None = Field(default=1.0, ge=0.01, le=10.0)
    confidence: float | None = Field(default=1.0, ge=0.01, le=1.0)
    source: str | None = Field(default="manual", max_length=32)
    note: str | None = Field(default=None, max_length=255)


class UpsertMembershipsBody(BaseModel):
    assignments: list[MembershipAssignment]


class DeleteMembershipBody(BaseModel):
    membership_id: int | None = Field(default=None, gt=0)
    term_id: int | None = Field(default=None, gt=0)
    cohort_id: int | None = Field(default=None, gt=0)


@router.post("/api/projects")
def create_project(body: CreateProjectBody, current_user=Depends(get_optional_user)):
    return create_project_payload(body.name, body.description, current_user=current_user)


@router.get("/api/projects")
def list_projects(limit: int = 100, scope: str | None = None, current_user=Depends(get_optional_user)):
    return list_projects_payload(limit=limit, current_user=current_user, scope=scope)


@router.post("/api/projects/{project_id}/terms")
def add_terms(project_id: int, body: AddProjectTermsBody, current_user=Depends(get_optional_user)):
    return add_project_terms_payload(
        project_id=project_id,
        words=body.words or [],
        category=body.category,
        current_user=current_user,
    )


@router.get("/api/projects/{project_id}/terms")
def list_terms(project_id: int, current_user=Depends(get_optional_user)):
    return list_project_terms_payload(project_id=project_id, current_user=current_user)


@router.get("/api/projects/{project_id}/cohorts")
def list_cohorts(project_id: int, current_user=Depends(get_optional_user)):
    return list_project_cohorts_payload(project_id=project_id, current_user=current_user)


@router.post("/api/projects/{project_id}/cohorts")
def create_cohort(project_id: int, body: CreateProjectCohortBody, current_user=Depends(get_optional_user)):
    return create_project_cohort_payload(
        project_id=project_id,
        name=body.name,
        description=body.description,
        color=body.color,
        sort_order=body.sort_order,
        current_user=current_user,
    )


@router.patch("/api/projects/{project_id}/cohorts/{cohort_id}")
def update_cohort(
    project_id: int,
    cohort_id: int,
    body: UpdateProjectCohortBody,
    current_user=Depends(get_optional_user),
):
    return update_project_cohort_payload(
        project_id=project_id,
        cohort_id=cohort_id,
        name=body.name,
        description=body.description,
        color=body.color,
        rule_json=body.rule_json,
        sort_order=body.sort_order,
        is_active=body.is_active,
        current_user=current_user,
    )


@router.delete("/api/projects/{project_id}/cohorts/{cohort_id}")
def delete_cohort(project_id: int, cohort_id: int, current_user=Depends(get_optional_user)):
    return delete_project_cohort_payload(project_id=project_id, cohort_id=cohort_id, current_user=current_user)


@router.get("/api/projects/{project_id}/memberships")
def list_memberships(project_id: int, current_user=Depends(get_optional_user)):
    return list_project_memberships_payload(project_id=project_id, current_user=current_user)


@router.post("/api/projects/{project_id}/memberships")
def upsert_memberships(project_id: int, body: UpsertMembershipsBody, current_user=Depends(get_optional_user)):
    return upsert_term_memberships_payload(
        project_id=project_id,
        assignments=[a.model_dump() for a in (body.assignments or [])],
        current_user=current_user,
    )


@router.delete("/api/projects/{project_id}/memberships")
def delete_membership(project_id: int, body: DeleteMembershipBody, current_user=Depends(get_optional_user)):
    return delete_project_membership_payload(
        project_id=project_id,
        current_user=current_user,
        membership_id=body.membership_id,
        term_id=body.term_id,
        cohort_id=body.cohort_id,
    )


@router.post("/api/projects/{project_id}/tasks/bind")
def bind_task(project_id: int, body: BindProjectTaskBody, current_user=Depends(get_optional_user)):
    return bind_task_payload(project_id=project_id, task_id=body.task_id, current_user=current_user)


@router.get("/api/projects/{project_id}/tasks")
def list_tasks(project_id: int, limit: int = 100, current_user=Depends(get_optional_user)):
    return list_project_tasks_payload(project_id=project_id, current_user=current_user, limit=limit)
