"""
Creates a sample ADMIN account and a sample USER account so you can log in
immediately after setup. Safe to re-run - it skips accounts that already
exist.

Usage (from the backend/ directory, with the virtual environment active
and .env configured, after running init_db.py):

    python -m scripts.create_seed_accounts

You will be prompted for passwords so they are never hard-coded or left
in shell history. Pass --non-interactive with env vars for CI/scripted
setup instead (see the bottom of this file).
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models.user import User, UserRole
from app.services.auth_service import hash_password


def create_user_if_missing(db, username: str, password: str, role: UserRole) -> None:
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        print(f"  - '{username}' already exists, skipping.")
        return
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    print(f"  - Created {role.value} account '{username}'.")


def main():
    parser = argparse.ArgumentParser(description="Seed an initial admin and user account.")
    parser.add_argument("--admin-username", default="admin")
    parser.add_argument("--user-username", default="recruiter1")
    parser.add_argument("--admin-password", default=None, help="Omit to be prompted securely.")
    parser.add_argument("--user-password", default=None, help="Omit to be prompted securely.")
    args = parser.parse_args()

    admin_password = args.admin_password or getpass.getpass(
        f"Password for admin account '{args.admin_username}': "
    )
    user_password = args.user_password or getpass.getpass(
        f"Password for user account '{args.user_username}': "
    )

    db = SessionLocal()
    try:
        print("Seeding accounts...")
        create_user_if_missing(db, args.admin_username, admin_password, UserRole.ADMIN)
        create_user_if_missing(db, args.user_username, user_password, UserRole.USER)
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
