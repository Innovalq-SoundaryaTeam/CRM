"""
Excel Import / Export routes.

Available to any authenticated user (USER or ADMIN) - these live on both
the regular dashboard and the admin console. Import always attributes new
candidates to the uploader and checks duplicates globally; Export is scoped
to "my candidates" for a USER and "all candidates" for an ADMIN, mirroring
the existing /api/candidates vs /api/admin/candidates split.

Registered in main.py BEFORE the generic candidates router so that the
literal /import and /export paths are matched before the
/api/candidates/{candidate_id} route can intercept them.
"""
import io
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.candidate import CandidateStatus
from app.models.user import User, UserRole
from app.schemas.candidate import ImportSummary
from app.services import import_export_service as svc

router = APIRouter(prefix="/api/candidates", tags=["import-export"])

ALLOWED_EXTENSIONS = (".xlsx", ".xlsm", ".xls")
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post("/import", response_model=ImportSummary)
async def import_candidates_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = file.filename or ""
    if not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload an Excel file (.xlsx or .xls).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is too large (max 15 MB).",
        )

    try:
        result = svc.import_candidates(db, content, filename, current_user)
    except svc.ImportValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return result


@router.get("/export")
def export_candidates_endpoint(
    status_filter: Optional[CandidateStatus] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scope_user_id = None if current_user.role == UserRole.ADMIN else current_user.id
    content, filename = svc.export_candidates(db, status_filter, scope_user_id)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
