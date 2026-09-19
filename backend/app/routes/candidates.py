"""
Candidate routes for regular USERS.

A user can only ever see, create, edit or delete candidates that belong
to them - enforced by filtering every query on `user_id == current_user.id`
and by re-checking ownership before update/delete.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.candidate import Candidate, CandidateStatus
from app.models.user import User
from app.schemas.candidate import CandidateCreate, CandidateUpdate, CandidateOut
from app.services.candidate_service import base_candidate_query, apply_search_and_filter

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


def _get_owned_candidate_or_404(db: Session, candidate_id: int, user: User) -> Candidate:
    candidate = (
        db.query(Candidate)
        .filter(Candidate.id == candidate_id, Candidate.user_id == user.id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    return candidate


@router.post("", response_model=CandidateOut, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate = Candidate(**payload.model_dump(), user_id=current_user.id)
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return candidate


@router.get("", response_model=List[CandidateOut])
def list_candidates(
    search: Optional[str] = None,
    status_filter: Optional[CandidateStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = base_candidate_query(db, user_id=current_user.id)
    query = apply_search_and_filter(query, search=search, status_filter=status_filter)
    return query.order_by(Candidate.created_at.desc()).all()


@router.get("/{candidate_id}", response_model=CandidateOut)
def get_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_owned_candidate_or_404(db, candidate_id, current_user)


@router.put("/{candidate_id}", response_model=CandidateOut)
def update_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate = _get_owned_candidate_or_404(db, candidate_id, current_user)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(candidate, field, value)
    db.commit()
    db.refresh(candidate)
    return candidate


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate = _get_owned_candidate_or_404(db, candidate_id, current_user)
    db.delete(candidate)
    db.commit()
    return None
