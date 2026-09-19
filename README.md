# Candidate CRM

A lightweight, production-ready CRM for managing candidates and tracking
their follow-up status (Hot / Warm / Cold / Completed / Drop).

Stack: **HTML5 + CSS3 + Vanilla JavaScript → FastAPI REST API → PostgreSQL**,
with JWT authentication and USER / ADMIN roles.

```
Frontend (static HTML/CSS/JS)  →  FastAPI (JWT auth, REST API)  →  PostgreSQL
```

---

## 1. Project structure

```
crm/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, CORS, exception handlers, routers
│   │   ├── config.py          Settings loaded from environment variables
│   │   ├── database.py        SQLAlchemy engine/session/base
│   │   ├── models/            SQLAlchemy ORM models (user, candidate)
│   │   ├── schemas/            Pydantic request/response schemas
│   │   ├── routes/             auth.py, candidates.py, admin.py
│   │   ├── services/           auth_service.py, candidate_service.py
│   │   └── dependencies/       auth.py (JWT decode, role guards)
│   ├── scripts/
│   │   ├── init_db.py                 Creates tables from the ORM models
│   │   └── create_seed_accounts.py    Creates a starter admin + user account
│   ├── schema.sql              Equivalent raw SQL (manual setup / DBA use)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── login.html
│   ├── dashboard.html           USER dashboard
│   ├── admin.html               ADMIN dashboard
│   ├── css/style.css
│   └── js/{api.js, login.js, dashboard.js, admin.js}
└── README.md
```

---

## 2. Prerequisites

* Python 3.11+
* PostgreSQL 14+ (running locally or reachable over the network)
* A modern browser
* Optionally, a simple static file server for the frontend (Python's
  built-in one is enough - see step 6)

---

## 3. Database setup

Create the database and a role for the app to use (adjust names/passwords
as you like):

```bash
# using psql
psql -U postgres -c "CREATE DATABASE candidate_crm;"
psql -U postgres -c "CREATE USER crm_user WITH PASSWORD 'crm_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE candidate_crm TO crm_user;"

# PostgreSQL 15+ locks down the "public" schema by default, so also run
# this (note -d candidate_crm - it must target the new database itself):
psql -U postgres -d candidate_crm -c "GRANT ALL ON SCHEMA public TO crm_user;"
```

You then have two ways to create the tables - pick one:

**Option A - let SQLAlchemy create them (recommended for a quick start):**
see step 5 (`python -m scripts.init_db`).

**Option B - run the raw SQL yourself:**

```bash
psql -U crm_user -d candidate_crm -f backend/schema.sql
```

Both create the same two tables: `users` and `candidates`, related by
`users.id → candidates.user_id`, with the `user_role` and
`candidate_status` enums, and indexes on the columns used for search/filter
(`candidate_name`, `contact_number`, `status`, `user_id`).

---

## 4. Backend configuration

```bash
cd backend
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://crm_user:crm_password@localhost:5432/candidate_crm
SECRET_KEY=<generate one - see below>
ACCESS_TOKEN_EXPIRE_MINUTES=120
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

Generate a strong secret key:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Never commit `.env` or reuse the example secret key in production.

---

## 5. Install dependencies and initialize the database

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m scripts.init_db                 # creates the tables
python -m scripts.create_seed_accounts    # prompts for admin & user passwords
```

`create_seed_accounts.py` creates:

* an **ADMIN** account (default username `admin`, or pass `--admin-username`)
* a **USER** account (default username `recruiter1`, or pass `--user-username`)

You will be prompted to set each password securely (not stored in shell
history or hard-coded). Re-running the script is safe - it skips accounts
that already exist. Additional users can also be created later from the
Admin → User Management screen.

---

## 6. Run the application

**Start the API:**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

The interactive API docs are then available at `http://localhost:8000/docs`.

**Serve the frontend** (any static file server works; example using Python):

```bash
cd frontend
python -m http.server 5500
```

Open `http://localhost:5500/login.html` in your browser.

> The frontend calls the API at `http://localhost:8000` by default when
> served from `localhost`/`127.0.0.1` (see the top of `frontend/js/api.js`).
> If you deploy the two apart, update `API_BASE_URL` there, and make sure
> the deployed frontend origin is included in `CORS_ORIGINS`.

---

## 7. Using the system

1. Log in with the admin or user account created in step 5.
2. **USER** → redirected to the Dashboard: add candidates, search/filter
   your list, and view/edit/delete them.
3. **ADMIN** → redirected to the Admin Dashboard: five live summary cards
   (Hot/Warm/Cold/Completed/Drop) and a status distribution chart, a
   cross-user candidate table (search, status filter, user filter, view/
   edit/delete), and User Management (create users, change roles,
   activate/deactivate, reset passwords, see candidate counts per user).

---

## 8. API summary

All endpoints (except `/api/auth/login`) require a JWT bearer token:
`Authorization: Bearer <token>`.

```
POST   /api/auth/login              Get a JWT (role-aware)
POST   /api/auth/logout             Client discards the token
GET    /api/auth/me                 Current user info

POST   /api/candidates              Create a candidate (owned by caller)
GET    /api/candidates              List own candidates (?search=&status_filter=)
GET    /api/candidates/{id}         Get one own candidate
PUT    /api/candidates/{id}         Update one own candidate
DELETE /api/candidates/{id}         Delete one own candidate

GET    /api/admin/dashboard         Live counts: total/hot/warm/cold/completed/drop
GET    /api/admin/candidates        All candidates (?search=&status_filter=&user_id=)
GET    /api/admin/candidates/{id}   Get any candidate
PUT    /api/admin/candidates/{id}   Update any candidate
DELETE /api/admin/candidates/{id}   Delete any candidate

GET    /api/admin/users             List users with candidate counts
POST   /api/admin/users             Create a user
PUT    /api/admin/users/{id}        Update role / active status
PUT    /api/admin/users/{id}/reset-password   Reset a user's password
DELETE /api/admin/users/{id}        Delete a user
```

Admin routes are protected by a `require_admin` dependency - a USER token
receives `403 Forbidden`, never CRM data. Candidate routes for regular
users always filter by `user_id == current_user.id`, so a USER can never
see or modify another user's candidates.

---

## 9. Security notes

* Passwords are hashed with **bcrypt** (via passlib) - never stored or
  logged in plain text.
* Authentication uses **JWT** (HS256), signed with `SECRET_KEY` from the
  environment, with a configurable expiry.
* All input is validated with **Pydantic** (field lengths, phone number
  format, enum status values, etc.) and rejected with `422` plus a clear
  message on failure.
* All database access goes through **SQLAlchemy ORM** with parameter
  binding - no raw string-built SQL, so standard SQL injection vectors
  are not applicable.
* Centralized exception handlers return consistent JSON error bodies and
  correct HTTP status codes (`400/401/403/404/409/422/500`).
* CORS is restricted to the origins listed in `CORS_ORIGINS`.

---

## 10. Candidate status values

`HOT`, `WARM`, `COLD`, `COMPLETED`, `DROP` - enforced at the database
level (PostgreSQL enum) and validated at the API level (Pydantic enum),
so invalid statuses can never be stored.
