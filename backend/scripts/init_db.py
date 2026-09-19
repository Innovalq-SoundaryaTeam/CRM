"""
Creates all tables (if they don't already exist) using the SQLAlchemy
models directly - a convenient alternative to running schema.sql by hand.

Usage (from the backend/ directory, with the virtual environment active
and .env configured):

    python -m scripts.init_db
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import Base, engine
from app.models import user, candidate  # noqa: F401  (ensures models are registered)


def main():
    print(f"Creating tables on: {engine.url.render_as_string(hide_password=True)}")
    Base.metadata.create_all(bind=engine)
    print("Done. Tables are ready.")


if __name__ == "__main__":
    main()
