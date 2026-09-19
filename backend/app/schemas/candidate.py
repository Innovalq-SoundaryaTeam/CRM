"""Pydantic schemas for candidate CRUD and admin views."""
import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict, field_validator

from app.models.candidate import CandidateStatus

PHONE_REGEX = re.compile(r"^[0-9+\-\s()]{7,20}$")


class CandidateBase(BaseModel):
    candidate_name: str = Field(..., min_length=2, max_length=150)
    contact_number: str = Field(..., min_length=7, max_length=20)
    status: CandidateStatus = CandidateStatus.WARM
    comments: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("candidate_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Candidate name cannot be blank")
        return v

    @field_validator("contact_number")
    @classmethod
    def valid_phone(cls, v: str) -> str:
        v = v.strip()
        if not PHONE_REGEX.match(v):
            raise ValueError(
                "Contact number must be 7-20 characters and may contain digits, "
                "spaces, +, -, ( and )"
            )
        return v


class CandidateCreate(CandidateBase):
    pass


class CandidateUpdate(BaseModel):
    candidate_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    contact_number: Optional[str] = Field(default=None, min_length=7, max_length=20)
    status: Optional[CandidateStatus] = None
    comments: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("contact_number")
    @classmethod
    def valid_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not PHONE_REGEX.match(v):
            raise ValueError("Contact number format is invalid")
        return v


class CandidateOut(CandidateBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


class CandidateAdminOut(CandidateOut):
    owner_username: str = ""


class DashboardStats(BaseModel):
    total: int
    hot: int
    warm: int
    cold: int
    completed: int
    drop: int
