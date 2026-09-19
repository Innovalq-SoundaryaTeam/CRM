"""Authentication routes: login, logout, current user info."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.user import LoginRequest, TokenResponse, CurrentUser
from app.services.auth_service import authenticate_user, create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, credentials.username, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(data={"sub": user.username, "role": user.role.value})
    return TokenResponse(access_token=token, role=user.role, username=user.username)


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """
    JWTs are stateless, so logout is enforced by the client discarding the
    token. This endpoint exists for a clean API contract and for clients
    that want a server round-trip to confirm the session ended.
    """
    return {"detail": "Logged out successfully"}


@router.get("/me", response_model=CurrentUser)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user
