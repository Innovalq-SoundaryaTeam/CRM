"""Pydantic schemas for authentication and user management."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.models.user import UserRole


# ---------- Auth ----------

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    username: str


class CurrentUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    is_active: bool


# ---------- User management (admin) ----------

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=128)
    role: UserRole = UserRole.USER

    @field_validator("username")
    @classmethod
    def username_no_spaces(cls, v: str) -> str:
        if " " in v:
            raise ValueError("Username must not contain spaces")
        return v.strip()


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

    @field_validator("username")
    @classmethod
    def username_no_spaces(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if " " in v:
            raise ValueError("Username must not contain spaces")
        return v.strip()


class PasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    is_active: bool
    created_at: datetime


class UserWithStats(UserOut):
    candidate_count: int = 0
