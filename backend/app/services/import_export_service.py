"""
Import/Export service: Excel parsing with smart header detection, phone-based
duplicate checking, and status-filtered Excel generation.

Design notes (so future changes stay consistent with the rest of the app):
  * Every imported candidate is created with status COLD and a server-side
    created_at timestamp - these two values are NEVER read from the
    spreadsheet, even if a "Status" or "Created Date" column is present.
  * Duplicate checking is phone-number based and GLOBAL (it looks across
    every user's candidates, not just the uploader's own), so the same
    person can't be entered twice by two different recruiters. The
    imported row itself is still owned by the uploading user, exactly like
    a candidate they would have added by hand through "Add Candidate" -
    this keeps the existing per-user ownership model (and the Admin
    cross-user view) completely intact.
  * Export respects whatever scope the caller passes in: a regular USER
    exports only their own candidates (matching their "My Candidates"
    view); an ADMIN exports every candidate across all users (matching
    "All Candidates"). Both are filtered by status the same way the
    existing list endpoints are.
"""
import io
import re
from datetime import datetime, timezone
from typing import Optional

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy.orm import Session, joinedload

from app.models.candidate import Candidate, CandidateStatus
from app.models.user import User

MAX_NAME_LEN = 150
MAX_PHONE_LEN = 20
MAX_EMAIL_LEN = 255

PHONE_REGEX = re.compile(r"^[0-9+\-\s()]{7,20}$")
EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Header text (lower-cased, punctuation collapsed to single spaces) that is
# recognized as meaning each logical field. Extend these sets, not the
# matching logic, if a new alias shows up in a real spreadsheet.
NAME_ALIASES = {
    "name", "candidate name", "candidatename", "full name", "fullname",
    "applicant name", "applicant", "candidate", "student name", "resource name",
}
PHONE_ALIASES = {
    "phone", "phone number", "phonenumber", "contact", "contact number",
    "contactnumber", "mobile", "mobile number", "mobile no", "phone no",
    "cell", "cell number", "cell no", "whatsapp", "whatsapp number",
    "contact no", "number",
}
EMAIL_ALIASES = {
    "email", "email address", "e mail", "mail", "email id", "emailid", "mail id",
}


class ImportValidationError(ValueError):
    """Raised when the file itself can't be processed (bad format, no
    recognizable Name/Phone columns, etc). The route turns this into a 400."""


def _normalize_header(value) -> str:
    text = "" if value is None else str(value)
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def detect_columns(header_row: list) -> dict:
    """Given the raw header row (list of cell values), return
    {"name": idx, "phone": idx, "email": idx or None}. Raises
    ImportValidationError if Name or Phone can't be found."""
    name_idx = phone_idx = email_idx = None
    for idx, cell in enumerate(header_row):
        header = _normalize_header(cell)
        if not header:
            continue
        if name_idx is None and header in NAME_ALIASES:
            name_idx = idx
        elif phone_idx is None and header in PHONE_ALIASES:
            phone_idx = idx
        elif email_idx is None and header in EMAIL_ALIASES:
            email_idx = idx

    missing = []
    if name_idx is None:
        missing.append("a Name column (e.g. 'Name' or 'Candidate Name')")
    if phone_idx is None:
        missing.append("a Phone column (e.g. 'Phone', 'Contact Number' or 'Mobile')")
    if missing:
        raise ImportValidationError(
            "Could not find " + " and ".join(missing) + " in the file's header row. "
            "Please make sure the first row contains column headings."
        )
    return {"name": name_idx, "phone": phone_idx, "email": email_idx}


def normalize_phone(raw) -> str:
    """Returns a comparison key: digits only, last 10 digits (tolerates
    +91/leading-0/spacing differences between otherwise-identical numbers).
    Returns '' for anything that doesn't contain enough digits to compare."""
    if raw is None:
        return ""
    text = str(raw).strip()
    if text.endswith(".0"):  # Excel sometimes stores phone numbers as floats
        text = text[:-2]
    digits = re.sub(r"[^0-9]", "", text)
    return digits[-10:] if len(digits) >= 7 else digits


def _clean_email(raw) -> Optional[str]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if len(text) > MAX_EMAIL_LEN or not EMAIL_REGEX.match(text):
        return None  # invalid email never fails the row - it's optional
    return text


def _read_rows(content: bytes, filename: str) -> list:
    """Returns a list of rows (each a list of cell values), header included,
    from an .xlsx/.xlsm or legacy .xls file."""
    lower = (filename or "").lower()
    if lower.endswith(".xls") and not lower.endswith(".xlsx"):
        try:
            import xlrd
        except ImportError:  # pragma: no cover
            raise ImportValidationError("Legacy .xls support is not available on the server.")
        try:
            book = xlrd.open_workbook(file_contents=content)
        except Exception:
            raise ImportValidationError("Could not read this .xls file. It may be corrupted.")
        sheet = book.sheet_by_index(0)
        return [sheet.row_values(r) for r in range(sheet.nrows)]

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except (InvalidFileException, Exception):
        raise ImportValidationError(
            "Could not read this file. Please upload a valid .xlsx or .xls Excel file."
        )
    sheet = workbook.worksheets[0]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    workbook.close()
    return rows


def import_candidates(db: Session, content: bytes, filename: str, current_user: User) -> dict:
    rows = _read_rows(content, filename)
    # Skip any fully-blank leading rows before treating a row as the header.
    header_row = None
    data_start = 0
    for i, row in enumerate(rows):
        if row and any(cell is not None and str(cell).strip() != "" for cell in row):
            header_row = row
            data_start = i + 1
            break
    if header_row is None:
        raise ImportValidationError("The uploaded file appears to be empty.")

    columns = detect_columns(header_row)
    name_idx, phone_idx, email_idx = columns["name"], columns["phone"], columns["email"]

    # Global duplicate check: every phone number already in the CRM,
    # regardless of which user owns it.
    existing_keys = {
        normalize_phone(p) for (p,) in db.query(Candidate.contact_number).all()
    }
    existing_keys.discard("")

    total = 0
    imported = 0
    duplicate_in_db = 0
    duplicate_in_file = 0
    failed = 0
    failed_records = []
    seen_in_file = set()
    to_add = []

    for row in rows[data_start:]:
        if not row or all(cell is None or str(cell).strip() == "" for cell in row):
            continue  # fully blank row - not counted at all
        total += 1

        raw_name = row[name_idx] if name_idx < len(row) else None
        raw_phone = row[phone_idx] if phone_idx < len(row) else None
        raw_email = row[email_idx] if (email_idx is not None and email_idx < len(row)) else None

        name = "" if raw_name is None else str(raw_name).strip()
        phone_display = "" if raw_phone is None else str(raw_phone).strip()
        if phone_display.endswith(".0"):
            phone_display = phone_display[:-2]

        if not name or not phone_display:
            failed += 1
            failed_records.append({
                "row": data_start + total,
                "name": name, "phone": phone_display, "email": raw_email or "",
                "reason": "Missing candidate name or phone number",
            })
            continue

        if len(name) < 2 or len(name) > MAX_NAME_LEN:
            failed += 1
            failed_records.append({
                "row": data_start + total, "name": name, "phone": phone_display,
                "email": raw_email or "", "reason": "Candidate name length is invalid",
            })
            continue

        key = normalize_phone(phone_display)
        if len(key) < 7 or len(phone_display) > MAX_PHONE_LEN or not PHONE_REGEX.match(phone_display):
            failed += 1
            failed_records.append({
                "row": data_start + total, "name": name, "phone": phone_display,
                "email": raw_email or "", "reason": "Invalid phone number format",
            })
            continue

        if key in seen_in_file:
            duplicate_in_file += 1
            continue
        if key in existing_keys:
            duplicate_in_db += 1
            continue

        seen_in_file.add(key)
        email_val = _clean_email(raw_email)

        to_add.append(Candidate(
            candidate_name=name,
            contact_number=phone_display,
            email=email_val,
            status=CandidateStatus.COLD,  # always Cold on import - never from the file
            comments=None,
            user_id=current_user.id,
            created_at=datetime.now(timezone.utc),  # always server time - never from the file
        ))
        imported += 1

    try:
        if to_add:
            db.add_all(to_add)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "total": total,
        "imported": imported,
        "duplicate_in_db": duplicate_in_db,
        "duplicate_in_file": duplicate_in_file,
        "failed": failed,
        "failed_records": failed_records,
    }


EXPORT_HEADERS_OWN = ["Candidate Name", "Contact Number", "Email", "Status", "Comments", "Created Date"]
EXPORT_HEADERS_ALL = ["Candidate Name", "Contact Number", "Email", "Status", "Comments", "Added By", "Created Date"]


def export_candidates(db: Session, status_filter: Optional[CandidateStatus], scope_user_id: Optional[int]):
    """Returns (xlsx_bytes, filename) for every candidate matching the given
    status, scoped to one user (regular USER) or across all users (ADMIN,
    when scope_user_id is None)."""
    query = db.query(Candidate)
    if scope_user_id is not None:
        query = query.filter(Candidate.user_id == scope_user_id)
    else:
        query = query.options(joinedload(Candidate.owner))
    if status_filter is not None:
        query = query.filter(Candidate.status == status_filter)
    candidates = query.order_by(Candidate.created_at.desc()).all()

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Candidates"
    headers = EXPORT_HEADERS_OWN if scope_user_id is not None else EXPORT_HEADERS_ALL
    sheet.append(headers)

    for c in candidates:
        created = c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else ""
        row = [c.candidate_name, c.contact_number, c.email or "", c.status.value, c.comments or ""]
        if scope_user_id is None:
            row.append(c.owner.username if c.owner else "")
        row.append(created)
        sheet.append(row)

    for col_cells in sheet.columns:
        sheet.column_dimensions[col_cells[0].column_letter].width = 22

    buffer = io.BytesIO()
    workbook.save(buffer)
    workbook.close()

    status_label = status_filter.value.capitalize() if status_filter is not None else "All"
    filename = f"Candidate_CRM_{status_label}.xlsx"
    return buffer.getvalue(), filename
