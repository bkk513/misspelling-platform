from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..services.auth_service import authenticate_user, issue_access_token
from .auth_deps import get_current_user

router = APIRouter()


class LoginBody(BaseModel):
    username: str
    password: str


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


@router.get("/api/auth/me")
def me(current=Depends(get_current_user)):
    return {
        "id": current["id"],
        "username": current["username"],
        "roles": current["roles"],
        "is_active": current["is_active"],
    }
