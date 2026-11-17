"""
FastAPI application entry point.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routes import auth, candidates, admin, import_export

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crm")

app = FastAPI(
    title="Candidate CRM API",
    description="REST API for the Candidate Follow-up CRM system",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS - the frontend (served separately as static files) talks to this API
# over HTTP, so its origin(s) must be explicitly allowed.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Centralized exception handling
# ---------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "message": "Validation failed"},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error while processing %s %s", request.method, request.url)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred. Please try again later."},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(auth.router)
# import_export must be registered before candidates: both share the
# "/api/candidates" prefix, and candidates.py has a generic
# "/{candidate_id}" route. Without this ordering, a request to
# /api/candidates/import or /export would match {candidate_id} first and
# fail with a 422 (can't parse "import" as an int) instead of reaching
# these routes.
app.include_router(import_export.router)
app.include_router(candidates.router)
app.include_router(admin.router)


@app.get("/api/health", tags=["health"])
def health_check():
    return {"status": "ok"}
