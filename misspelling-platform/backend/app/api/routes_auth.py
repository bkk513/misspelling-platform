from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from ..db.audit_logs_repo import insert_audit_log
from ..services.captcha_service import issue_captcha, verify_captcha
from ..services.auth_service import (
    authenticate_user,
    hash_password,
    issue_access_token,
    register_user,
    validate_password_strength,
)
from ..db.users_repo import update_user_password
from ..services.turnstile_service import is_turnstile_configured, verify_turnstile_token
from .auth_deps import get_current_user

router = APIRouter()


class LoginBody(BaseModel):
    username: str
    password: str


class RegisterBody(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    email: str | None = None
    captcha_id: str
    captcha_code: str


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str


@router.get("/api/auth/captcha")
def captcha():
    return issue_captcha()


@router.post("/api/auth/login")
def login(body: LoginBody, request: Request, turnstile_token: str | None = Header(default=None, alias="X-Turnstile-Token")):
    if is_turnstile_configured():
        client_ip = request.client.host if request.client else None
        ok, errors = verify_turnstile_token(turnstile_token or "", remote_ip=client_ip)
        if not ok:
            insert_audit_log(
                action="AUTH_LOGIN_FAILED",
                target_type="user",
                target_id=body.username,
                meta={"reason": "turnstile_invalid", "turnstile_errors": errors},
            )
            raise HTTPException(status_code=400, detail="Turnstile verification failed")
    user = authenticate_user(body.username, body.password)
    if not user:
        insert_audit_log(action="AUTH_LOGIN_FAILED", target_type="user", target_id=body.username, meta={"reason": "invalid_credentials"})
        raise HTTPException(status_code=401, detail="Invalid credentials")
    insert_audit_log(action="AUTH_LOGIN", actor_user_id=user["id"], target_type="user", target_id=str(user["id"]))
    token = issue_access_token(user["id"], user["username"], user["roles"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"], "roles": user["roles"]},
    }


@router.post("/api/auth/register")
def register(body: RegisterBody):
    if not verify_captcha(body.captcha_id, body.captcha_code):
        insert_audit_log(
            action="AUTH_REGISTER_FAILED",
            target_type="user",
            target_id=body.username,
            meta={"reason": "captcha_invalid"},
        )
        raise HTTPException(status_code=400, detail="captcha invalid or expired")
    try:
        user = register_user(body.username, body.password, body.display_name, body.email)
    except ValueError as exc:
        insert_audit_log(
            action="AUTH_REGISTER_FAILED",
            target_type="user",
            target_id=body.username,
            meta={"reason": str(exc)},
        )
        raise HTTPException(status_code=400, detail=str(exc))
    insert_audit_log(action="AUTH_REGISTER", actor_user_id=user["id"], target_type="user", target_id=str(user["id"]))
    token = issue_access_token(user["id"], user["username"], user["roles"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"], "roles": user["roles"]},
    }


@router.get("/api/auth/me")
def me(current=Depends(get_current_user)):
    return {
        "id": current["id"],
        "username": current["username"],
        "roles": current["roles"],
        "is_active": current["is_active"],
    }


@router.post("/api/auth/change-password")
def change_password(body: ChangePasswordBody, current=Depends(get_current_user)):
    if not authenticate_user(str(current["username"]), body.old_password):
        raise HTTPException(status_code=400, detail="old password is incorrect")
    weak_reason = validate_password_strength(body.new_password)
    if weak_reason:
        raise HTTPException(status_code=400, detail=weak_reason)
    update_user_password(int(current["id"]), hash_password(body.new_password))
    insert_audit_log(
        action="AUTH_CHANGE_PASSWORD",
        actor_user_id=int(current["id"]),
        target_type="user",
        target_id=str(current["id"]),
    )
    return {"ok": True}
