"""
Candidate service layer: query building and dashboard aggregation shared by
both the user-scoped routes and the admin routes.
"""
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, Query

from app.models.candidate import Candidate, CandidateStatus
from app.models.user import User


def base_candidate_query(db: Session, user_id: Optional[int] = None) -> Query:
    query = db.query(Candidate)
    if user_id is not None:
        query = query.filter(Candidate.user_id == user_id)
    return query


def apply_search_and_filter(
    query: Query,
    search: Optional[str] = None,
    status_filter: Optional[CandidateStatus] = None,
) -> Query:
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Candidate.candidate_name.ilike(like),
                Candidate.contact_number.ilike(like),
            )
        )
    if status_filter:
        query = query.filter(Candidate.status == status_filter)
    return query


def compute_dashboard_stats(db: Session, user_id: Optional[int] = None) -> dict:
    """
    Dynamically computes candidate counts per status directly from the
    database (never hard-coded). When user_id is provided, stats are
    scoped to that user; otherwise they cover all candidates (admin view).
    """
    query = db.query(Candidate.status, func.count(Candidate.id))
    if user_id is not None:
        query = query.filter(Candidate.user_id == user_id)
    counts = dict(query.group_by(Candidate.status).all())

    def count_for(status: CandidateStatus) -> int:
        return counts.get(status, 0)

    hot = count_for(CandidateStatus.HOT)
    warm = count_for(CandidateStatus.WARM)
    cold = count_for(CandidateStatus.COLD)
    completed = count_for(CandidateStatus.COMPLETED)
    drop = count_for(CandidateStatus.DROP)

    return {
        "total": hot + warm + cold + completed + drop,
        "hot": hot,
        "warm": warm,
        "cold": cold,
        "completed": completed,
        "drop": drop,
    }


def candidate_counts_by_user(db: Session) -> dict[int, int]:
    """Returns {user_id: candidate_count} for all users in one query."""
    rows = (
        db.query(Candidate.user_id, func.count(Candidate.id))
        .group_by(Candidate.user_id)
        .all()
    )
    return dict(rows)
