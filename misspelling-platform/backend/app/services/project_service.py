from fastapi import HTTPException

from ..db.audit_logs_repo import insert_audit_log
from ..db.lexicon_repo import get_or_create_term
from ..db.projects_repo import (
    add_project_terms,
    bind_project_task,
    create_project,
    get_project,
    list_project_tasks,
    list_projects,
    list_project_terms,
)


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _ensure_project_access(project_id: int, current_user: dict | None):
    row = get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="project not found")
    owner_user_id = row.get("owner_user_id")
    uid = _owner_id(current_user)
    if _is_admin(current_user):
        return row
    if uid is None:
        if owner_user_id is not None:
            raise HTTPException(status_code=403, detail="forbidden")
    elif owner_user_id not in (None, uid):
        raise HTTPException(status_code=403, detail="forbidden")
    return row


def create_project_payload(name: str, description: str | None, current_user: dict | None):
    owner_user_id = _owner_id(current_user)
    project_id = create_project(owner_user_id=owner_user_id, name=name, description=description)
    insert_audit_log(
        action="PROJECT_CREATE",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"name": name},
    )
    return {"project_id": project_id, "name": name, "description": description}


def list_projects_payload(limit: int, current_user: dict | None, scope: str | None = None):
    include_all = _is_admin(current_user) and scope == "all"
    owner_user_id = _owner_id(current_user)
    if _is_admin(current_user) and scope == "guest":
        owner_user_id = None
        include_all = False
    rows = list_projects(owner_user_id=owner_user_id, include_all=include_all, limit=max(1, min(limit, 200)))
    return {"items": [dict(r) for r in rows]}


def add_project_terms_payload(project_id: int, words: list[str], category: str | None, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)
    term_ids = []
    for word in words:
        w = str(word or "").strip().lower()
        if not w:
            continue
        term_ids.append(get_or_create_term(w, owner_user_id=owner_user_id, category=category))
    added = add_project_terms(project_id, term_ids, category)
    insert_audit_log(
        action="PROJECT_ADD_TERMS",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"added": added, "category": category},
    )
    return {"project_id": project_id, "added": added}


def list_project_tasks_payload(project_id: int, current_user: dict | None, limit: int = 100):
    _ensure_project_access(project_id, current_user)
    rows = list_project_tasks(project_id, limit=max(1, min(limit, 500)))
    return {"project_id": project_id, "items": [dict(r) for r in rows]}


def list_project_terms_payload(project_id: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    return {"project_id": project_id, "items": [dict(r) for r in list_project_terms(project_id)]}


def bind_task_payload(project_id: int, task_id: str, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    bind_project_task(project_id, task_id)
    insert_audit_log(
        action="PROJECT_BIND_TASK",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={"task_id": task_id},
    )
    return {"project_id": project_id, "task_id": task_id, "ok": True}
