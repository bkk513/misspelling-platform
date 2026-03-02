from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services.auth_service import authenticate_user, issue_access_token, register_user
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


@router.post("/api/auth/login")
def login(body: LoginBody):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = issue_access_token(user["id"], user["username"], user["roles"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "username": user["username"], "roles": user["roles"]},
    }


@router.post("/api/auth/register")
def register(body: RegisterBody):
    try:
        user = register_user(body.username, body.password, body.display_name, body.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
