import base64
import io
import re
from typing import Any

import pandas as pd
from fastapi import HTTPException

from ..db.audit_logs_repo import insert_audit_log
from ..db.lexicon_repo import get_or_create_term
from ..providers.llm_bailian import strict_json_completion
from ..db.projects_repo import (
    add_project_terms,
    bind_project_task,
    create_project,
    delete_project_cohort,
    delete_project_term_membership,
    get_project,
    get_or_create_project_cohort,
    list_project_cohorts,
    list_project_term_memberships,
    list_project_tasks,
    list_projects,
    list_project_terms,
    update_project_cohort,
    upsert_project_term_memberships,
)
from .task_service import get_task_owner, get_task_payload


def _is_admin(current_user: dict | None) -> bool:
    return bool(current_user and "admin" in set(current_user.get("roles") or []))


def _owner_id(current_user: dict | None) -> int | None:
    if not current_user:
        return None
    return int(current_user.get("id") or 0) or None


def _ensure_project_access(project_id: int, current_user: dict | None):
    if current_user is None:
        raise HTTPException(status_code=403, detail="login required for project workspace")
    row = get_project(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="project not found")
    owner_user_id = row.get("owner_user_id")
    uid = _owner_id(current_user)
    if _is_admin(current_user):
        return row
    if uid is None or owner_user_id != uid:
        raise HTTPException(status_code=403, detail="forbidden")
    return row


def _normalize_category(value: str | None) -> str:
    v = str(value or "").strip().lower()
    return v or "custom"


def _cohort_color(name: str) -> str:
    key = _normalize_category(name)
    palette = {
        "science": "#2f7cf6",
        "technology": "#2f7cf6",
        "tech": "#2f7cf6",
        "brand": "#9c4eff",
        "common": "#30a46c",
        "noun": "#d89614",
        "custom": "#6b7280",
    }
    return palette.get(key, "#4f7cff")


def _decode_import_content(content_base64: str) -> bytes:
    raw = str(content_base64 or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="file content is required")
    try:
        return base64.b64decode(raw, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid base64 payload: {exc}") from exc


def _extract_text_from_import(filename: str, raw_bytes: bytes) -> str:
    lower_name = str(filename or "").strip().lower()
    if lower_name.endswith((".xlsx", ".xls")):
        try:
            workbook = pd.read_excel(io.BytesIO(raw_bytes), sheet_name=None, header=None, dtype=str)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"spreadsheet parse failed: {exc}") from exc
        parts: list[str] = []
        for sheet_name, frame in workbook.items():
            parts.append(f"[sheet:{sheet_name}]")
            for row in frame.fillna("").astype(str).values.tolist():
                line = " | ".join(str(cell or "").strip() for cell in row if str(cell or "").strip())
                if line:
                    parts.append(line)
        return "\n".join(parts)
    for encoding in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            return raw_bytes.decode(encoding)
        except Exception:
            continue
    raise HTTPException(status_code=400, detail="file decode failed")


def _fallback_extract_terms(text: str) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"[A-Za-z][A-Za-z0-9_-]{1,63}", str(text or "")):
        token = match.group(0).strip().lower()
        if len(token) < 2 or token in seen:
            continue
        seen.add(token)
        terms.append(token)
        if len(terms) >= 300:
            break
    return terms


def _llm_extract_terms(text: str, filename: str, actor_user_id: int | None) -> tuple[list[str], str, list[str]]:
    preview = str(text or "")[:12000]
    llm = strict_json_completion(
        prompt=(
            "Return JSON only: {\"terms\": [..]}. "
            "Extract the English terms or keywords that should be added into a research term list. "
            "Keep only concise lexical terms, lowercase them, remove duplicates, ignore prose and metadata. "
            f"Filename: {filename}\nContent:\n{preview}"
        ),
        actor_user_id=actor_user_id,
        action="PROJECT_TERM_IMPORT",
        audit_meta={"filename": filename, "chars": len(preview)},
        temperature=0.1,
        timeout_seconds=25,
    )
    parsed = llm.get("parsed")
    if isinstance(parsed, dict):
        raw_terms = parsed.get("terms") or parsed.get("words") or []
        if isinstance(raw_terms, list):
            terms = []
            seen = set()
            for item in raw_terms:
                token = str(item or "").strip().lower()
                if len(token) < 2 or len(token) > 64 or token in seen:
                    continue
                if not re.fullmatch(r"[a-z][a-z0-9 _-]{1,63}", token):
                    continue
                seen.add(token)
                terms.append(token)
            if terms:
                return terms[:300], str(llm.get("source") or "llm"), [str(w) for w in (llm.get("warnings") or [])]
    fallback = _fallback_extract_terms(text)
    return fallback, "fallback", [str(w) for w in (llm.get("warnings") or [])]


def create_project_payload(name: str, description: str | None, current_user: dict | None):
    if current_user is None:
        raise HTTPException(status_code=403, detail="login required for project workspace")
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
    if current_user is None:
        raise HTTPException(status_code=403, detail="login required for project workspace")
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
    normalized_category = _normalize_category(category)
    term_ids = []
    for word in words:
        w = str(word or "").strip().lower()
        if not w:
            continue
        term_ids.append(get_or_create_term(w, owner_user_id=owner_user_id, category=normalized_category))
    added = add_project_terms(project_id, term_ids, normalized_category)

    cohort = get_or_create_project_cohort(
        project_id=project_id,
        name=normalized_category,
        description=f"Auto cohort from category: {normalized_category}",
        color=_cohort_color(normalized_category),
    )
    if cohort and term_ids:
        upsert_project_term_memberships(
            project_id,
            [
                {
                    "term_id": int(term_id),
                    "cohort_id": int(cohort["id"]),
                    "membership_weight": 1.0,
                    "source": "term-category",
                    "confidence": 0.95,
                    "note": "Auto synced from add terms category",
                }
                for term_id in term_ids
            ],
        )

    insert_audit_log(
        action="PROJECT_ADD_TERMS",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"added": added, "category": normalized_category, "synced_to_cohort": bool(cohort)},
    )
    return {"project_id": project_id, "added": added, "category": normalized_category, "cohort_id": int(cohort["id"]) if cohort else None}


def import_project_terms_payload(
    project_id: int,
    filename: str,
    content_base64: str,
    target_cohort: str | None,
    current_user: dict | None,
):
    _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)
    raw_bytes = _decode_import_content(content_base64)
    extracted_text = _extract_text_from_import(filename, raw_bytes)
    terms, source, warnings = _llm_extract_terms(extracted_text, filename, owner_user_id)
    if not terms:
        raise HTTPException(status_code=400, detail="no importable terms found")
    result = add_project_terms_payload(project_id, terms, target_cohort, current_user)
    insert_audit_log(
        action="PROJECT_IMPORT_TERMS",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={
            "filename": filename,
            "target_cohort": _normalize_category(target_cohort),
            "extracted_count": len(terms),
            "source": source,
            "warnings": warnings,
        },
    )
    return {
        **result,
        "filename": filename,
        "extracted_count": len(terms),
        "extracted_terms": terms[:80],
        "extract_source": source,
        "warnings": warnings,
    }


def list_project_tasks_payload(project_id: int, current_user: dict | None, limit: int = 100):
    project = _ensure_project_access(project_id, current_user)
    project_owner_user_id = project.get("owner_user_id")
    rows = [dict(r) for r in list_project_tasks(project_id, limit=max(1, min(limit, 500)))]
    filtered: list[dict] = []
    for row in rows:
        row_owner_user_id = row.get("owner_user_id")
        if project_owner_user_id is None:
            if row_owner_user_id is None:
                filtered.append(row)
        elif int(row_owner_user_id or 0) == int(project_owner_user_id):
            filtered.append(row)
    return {"project_id": project_id, "items": filtered}


def list_project_terms_payload(project_id: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    terms = [dict(r) for r in list_project_terms(project_id)]
    memberships = [dict(r) for r in list_project_term_memberships(project_id)]
    by_term: dict[int, list[dict]] = {}
    for row in memberships:
        tid = int(row.get("term_id") or 0)
        if tid <= 0:
            continue
        by_term.setdefault(tid, []).append(
            {
                "membership_id": int(row.get("id") or 0),
                "cohort_id": int(row.get("cohort_id") or 0),
                "cohort_name": str(row.get("cohort_name") or ""),
                "cohort_color": row.get("cohort_color"),
                "weight": float(row.get("membership_weight") or 1.0),
                "confidence": float(row.get("confidence") or 1.0),
                "source": str(row.get("source") or "manual"),
            }
        )

    enriched = []
    for term in terms:
        tid = int(term.get("term_id") or 0)
        groups = by_term.get(tid, [])
        term["cohorts"] = groups
        term["cohort_count"] = len(groups)
        term["primary_cohort"] = groups[0]["cohort_name"] if groups else term.get("category")
        enriched.append(term)
    return {"project_id": project_id, "items": enriched}


def bind_task_payload(project_id: int, task_id: str, current_user: dict | None):
    project = _ensure_project_access(project_id, current_user)
    task_payload = get_task_payload(task_id, async_result_factory=None, current_user=current_user)
    if str(task_payload.get("state") or "").upper() == "NOT_FOUND":
        raise HTTPException(status_code=404, detail="task not found")
    project_owner_user_id = project.get("owner_user_id")
    task_owner_user_id = get_task_owner(task_id)
    if project_owner_user_id is None:
        if task_owner_user_id is not None:
            raise HTTPException(status_code=403, detail="task owner does not match project owner")
    elif int(task_owner_user_id or 0) != int(project_owner_user_id):
        raise HTTPException(status_code=403, detail="task owner does not match project owner")
    bind_project_task(project_id, task_id)
    insert_audit_log(
        action="PROJECT_BIND_TASK",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={"task_id": task_id},
    )
    return {"project_id": project_id, "task_id": task_id, "ok": True}


def create_project_cohort_payload(
    project_id: int,
    name: str,
    description: str | None,
    color: str | None,
    sort_order: int | None,
    current_user: dict | None,
):
    _ensure_project_access(project_id, current_user)
    normalized_name = _normalize_category(name)
    row = get_or_create_project_cohort(
        project_id=project_id,
        name=normalized_name,
        description=description,
        color=color or _cohort_color(normalized_name),
        sort_order=int(sort_order or 0),
    )
    if not row:
        raise HTTPException(status_code=400, detail="invalid cohort name")
    insert_audit_log(
        action="PROJECT_COHORT_CREATE",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={"cohort_id": int(row["id"]), "name": normalized_name},
    )
    return {"project_id": project_id, "item": dict(row)}


def list_project_cohorts_payload(project_id: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    rows = [dict(r) for r in list_project_cohorts(project_id)]
    return {"project_id": project_id, "items": rows}


def update_project_cohort_payload(
    project_id: int,
    cohort_id: int,
    *,
    name: str | None,
    description: str | None,
    color: str | None,
    rule_json: dict | None,
    sort_order: int | None,
    is_active: bool | None,
    current_user: dict | None,
):
    _ensure_project_access(project_id, current_user)
    ok = update_project_cohort(
        project_id=project_id,
        cohort_id=cohort_id,
        name=_normalize_category(name) if name else None,
        description=description,
        color=color,
        rule_json=rule_json,
        sort_order=sort_order,
        is_active=is_active,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="cohort not found")
    insert_audit_log(
        action="PROJECT_COHORT_UPDATE",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={"cohort_id": cohort_id},
    )
    return {"project_id": project_id, "cohort_id": cohort_id, "ok": True}


def delete_project_cohort_payload(project_id: int, cohort_id: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    ok = delete_project_cohort(project_id=project_id, cohort_id=cohort_id)
    if not ok:
        raise HTTPException(status_code=404, detail="cohort not found")
    insert_audit_log(
        action="PROJECT_COHORT_DELETE",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={"cohort_id": cohort_id},
    )
    return {"project_id": project_id, "cohort_id": cohort_id, "deleted": True}


def upsert_term_memberships_payload(project_id: int, assignments: list[dict], current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    owner_user_id = _owner_id(current_user)
    prepared: list[dict] = []
    touched_term_ids: set[int] = set()
    for raw in assignments:
        if not isinstance(raw, dict):
            continue

        term_id = int(raw.get("term_id") or 0)
        if term_id <= 0:
            word = str(raw.get("word") or "").strip().lower()
            if not word:
                continue
            term_id = int(get_or_create_term(word, owner_user_id=owner_user_id))
        if term_id <= 0:
            continue

        cohort_id = int(raw.get("cohort_id") or 0)
        if cohort_id <= 0:
            cohort_name = _normalize_category(raw.get("cohort_name"))
            cohort = get_or_create_project_cohort(
                project_id=project_id,
                name=cohort_name,
                description=f"Auto cohort: {cohort_name}",
                color=_cohort_color(cohort_name),
            )
            if not cohort:
                continue
            cohort_id = int(cohort["id"])

        weight = float(raw.get("membership_weight") or raw.get("weight") or 1.0)
        confidence = float(raw.get("confidence") or 1.0)
        prepared.append(
            {
                "term_id": term_id,
                "cohort_id": cohort_id,
                "membership_weight": max(0.01, min(weight, 10.0)),
                "source": str(raw.get("source") or "manual"),
                "confidence": max(0.01, min(confidence, 1.0)),
                "note": raw.get("note"),
            }
        )
        touched_term_ids.add(term_id)

    if touched_term_ids:
        add_project_terms(project_id=project_id, term_ids=list(touched_term_ids), category=None)

    upserted = upsert_project_term_memberships(project_id=project_id, assignments=prepared)
    insert_audit_log(
        action="PROJECT_MEMBERSHIP_UPSERT",
        actor_user_id=owner_user_id,
        target_type="project",
        target_id=str(project_id),
        meta={"upserted": upserted, "input_count": len(assignments)},
    )
    return {"project_id": project_id, "upserted": upserted}


def list_project_memberships_payload(project_id: int, current_user: dict | None):
    _ensure_project_access(project_id, current_user)
    rows = [dict(r) for r in list_project_term_memberships(project_id)]
    return {"project_id": project_id, "items": rows}


def delete_project_membership_payload(
    project_id: int,
    current_user: dict | None,
    membership_id: int | None = None,
    term_id: int | None = None,
    cohort_id: int | None = None,
):
    _ensure_project_access(project_id, current_user)
    deleted = delete_project_term_membership(
        project_id=project_id,
        membership_id=membership_id,
        term_id=term_id,
        cohort_id=cohort_id,
    )
    insert_audit_log(
        action="PROJECT_MEMBERSHIP_DELETE",
        actor_user_id=_owner_id(current_user),
        target_type="project",
        target_id=str(project_id),
        meta={
            "deleted": deleted,
            "membership_id": membership_id,
            "term_id": term_id,
            "cohort_id": cohort_id,
        },
    )
    return {"project_id": project_id, "deleted": deleted}
