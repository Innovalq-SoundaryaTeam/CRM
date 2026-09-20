"""
Admin-only routes: dashboard statistics, cross-user candidate management,
and user management. Every route in this file is protected by
`require_admin`, so a USER token can never reach it (403 Forbidden).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.dependencies.auth import require_admin
from app.models.candidate import Candidate, CandidateStatus
from app.models.user import User, UserRole
from app.schemas.candidate import CandidateAdminOut, CandidateUpdate, DashboardStats
from app.schemas.user import UserCreate, UserUpdate, UserOut, UserWithStats, PasswordResetRequest
from app.services.auth_service import hash_password
from app.services.candidate_service import (
    base_candidate_query,
    apply_search_and_filter,
    compute_dashboard_stats,
    candidate_counts_by_user,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=DashboardStats)
def admin_dashboard(db: Session = Depends(get_db)):
    return compute_dashboard_stats(db)


# ---------------------------------------------------------------------------
# Candidates (all users)
# ---------------------------------------------------------------------------

def _to_admin_out(candidate: Candidate) -> CandidateAdminOut:
    data = CandidateAdminOut.model_validate(candidate)
    data.owner_username = candidate.owner.username if candidate.owner else ""
    return data


@router.get("/candidates", response_model=List[CandidateAdminOut])
def admin_list_candidates(
    search: Optional[str] = None,
    status_filter: Optional[CandidateStatus] = None,
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = base_candidate_query(db).options(joinedload(Candidate.owner))
    query = apply_search_and_filter(query, search=search, status_filter=status_filter)
    if user_id is not None:
        query = query.filter(Candidate.user_id == user_id)
    candidates = query.order_by(Candidate.created_at.desc()).all()
    return [_to_admin_out(c) for c in candidates]


@router.get("/candidates/{candidate_id}", response_model=CandidateAdminOut)
def admin_get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = (
        db.query(Candidate)
        .options(joinedload(Candidate.owner))
        .filter(Candidate.id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    return _to_admin_out(candidate)


@router.put("/candidates/{candidate_id}", response_model=CandidateAdminOut)
def admin_update_candidate(candidate_id: int, payload: CandidateUpdate, db: Session = Depends(get_db)):
    candidate = (
        db.query(Candidate)
        .options(joinedload(Candidate.owner))
        .filter(Candidate.id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(candidate, field, value)
    db.commit()
    db.refresh(candidate)
    return _to_admin_out(candidate)


@router.delete("/candidates/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    db.delete(candidate)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[UserWithStats])
def admin_list_users(db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.created_at.desc()).all()
    counts = candidate_counts_by_user(db)
    result = []
    for u in users:
        item = UserWithStats.model_validate(u)
        item.candidate_count = counts.get(u.id, 0)
        result.append(item)
    return result


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserOut)
def admin_update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    updates = payload.model_dump(exclude_unset=True)
    if "username" in updates and updates["username"] != user.username:
        existing = (
            db.query(User)
            .filter(User.username == updates["username"], User.id != user_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    for field, value in updates.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/reset-password", response_model=UserOut)
def admin_reset_password(user_id: int, payload: PasswordResetRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account while logged in",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    db.delete(user)
    db.commit()
    return None
