from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_deps import get_optional_user
from ..services.project_service import (
    add_project_terms_payload,
    bind_task_payload,
    create_project_payload,
    list_project_tasks_payload,
    list_project_terms_payload,
    list_projects_payload,
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


@router.post("/api/projects/{project_id}/tasks/bind")
def bind_task(project_id: int, body: BindProjectTaskBody, current_user=Depends(get_optional_user)):
    return bind_task_payload(project_id=project_id, task_id=body.task_id, current_user=current_user)


@router.get("/api/projects/{project_id}/tasks")
def list_tasks(project_id: int, limit: int = 100, current_user=Depends(get_optional_user)):
    return list_project_tasks_payload(project_id=project_id, current_user=current_user, limit=limit)
