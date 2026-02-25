from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class TaskCreateResponse(BaseModel):
    task_id: str


class TaskListItem(BaseModel):
    task_id: str
    task_type: str
    status: str
    params_json: Any = None
    created_at: Any = None
    updated_at: Any = None


class TaskListResponse(BaseModel):
    items: List[TaskListItem]


class TaskDetailResponse(BaseModel):
    task_id: str
    state: str
    params: Any = None
    result: Any = None
    error: Optional[str] = None
    progress: Optional[Any] = None


class HealthResponse(BaseModel):
    status: str
    db: bool


class FileNotFoundResponse(BaseModel):
    error: str
