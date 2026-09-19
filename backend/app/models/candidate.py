"""
Candidate ORM model.

Each candidate belongs to exactly one user (the recruiter who owns the
follow-up). Admins can see candidates across all users.
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CandidateStatus(str, enum.Enum):
    HOT = "HOT"
    WARM = "WARM"
    COLD = "COLD"
    COMPLETED = "COMPLETED"
    DROP = "DROP"


class Candidate(Base):
    __tablename__ = "candidates"
    __table_args__ = (
        Index("ix_candidates_status", "status"),
        Index("ix_candidates_user_id_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    candidate_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    contact_number: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[CandidateStatus] = mapped_column(
        SAEnum(CandidateStatus, name="candidate_status", native_enum=True),
        nullable=False,
        default=CandidateStatus.WARM,
    )
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    owner: Mapped["User"] = relationship("User", back_populates="candidates")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Candidate id={self.id} name={self.candidate_name!r} status={self.status}>"
