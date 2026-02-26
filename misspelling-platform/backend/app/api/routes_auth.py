from fastapi import APIRouter, Header, HTTPException

from ..services.auth_service import get_me_from_token, login_user

router = APIRouter()


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    prefix = "bearer "
    return authorization[len(prefix) :].strip() if authorization.lower().startswith(prefix) else ""


@router.post("/api/auth/login")
def login(payload: dict):
    result = login_user(str(payload.get("username") or ""), str(payload.get("password") or ""))
    if not result:
        raise HTTPException(status_code=401, detail="invalid username or password")
    return result


@router.get("/api/auth/me")
def me(authorization: str | None = Header(default=None)):
    user = get_me_from_token(_extract_bearer(authorization))
    if not user:
        raise HTTPException(status_code=401, detail="invalid or expired token")
    return {"user": user}

