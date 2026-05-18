# Collective ERP

An open-source ERP and Operations system for entrepreneurs, a free resource for members of The Collective Entrepreneur Group. Built by Elliott Notrica @ Symbio Bioculinary. 

---

## Stack

| Layer | Technology |
|---|---|
| API | FastAPI (Python) + Uvicorn |
| Frontend | Next.js 14 App Router |
| Database | PostgreSQL 16 + pgvector |
| Queue / Cache | Redis 7 + Celery |
| AI | Claude (Anthropic) + OpenAI embeddings |
| Proxy | Traefik |

---

## Quick Start

```bash
git clone git@github.com:elliott-symbiobc/Symbio-Platform-.git
cd Symbio-Platform-
cp .env.example .env        # fill in your keys
docker compose up -d
```

The app will be available at `http://localhost:8080`.

---

## Directory Layout

```
├── api/
│   └── app/
│       ├── main.py           # FastAPI app entry point
│       ├── routers/          # 30 API routers (one file per domain)
│       ├── agents/           # AI agent modules
│       └── worker.py         # Celery tasks + Beat schedule
├── frontend/
│   ├── app/                  # Next.js pages (App Router)
│   ├── components/           # Shared React components
│   └── lib/                  # Auth config (NextAuth), utilities
├── sql/
│   ├── schema.sql            # Database schema (source of truth)
│   └── views.sql             # DB views
├── scripts/                  # Host-side daemon scripts
├── annotation/               # Genome annotation pipeline (runs on host)
├── docs/                     # System specification
└── docker-compose.yml
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
SECRET_KEY                # FastAPI JWT signing
DB_PASSWORD               # PostgreSQL password
NEXTAUTH_SECRET           # NextAuth session signing
NEXTAUTH_URL              # e.g. https://platform.symbiobc.com
ANTHROPIC_API_KEY         # Claude AI (all agents + dashboard chat)
OPENAI_API_KEY            # text-embedding-3-small (RAG only)
DEEPGRAM_API_KEY          # Voice transcription
GOOGLE_CLIENT_ID          # Gmail + Calendar OAuth
GOOGLE_CLIENT_SECRET
PLAID_CLIENT_ID           # Bank data (FP&A)
PLAID_SANDBOX_SECRET
PLAID_PRODUCTION_SECRET
PLAID_ENV                 # sandbox | production
QBO_CLIENT_ID             # QuickBooks Online
QBO_CLIENT_SECRET
S2_API_KEY                # Semantic Scholar (literature)
```

---

## Common Commands

```bash
# Start all services
docker compose up -d

# Rebuild after code changes
docker compose up -d --build api frontend

# View logs
docker compose logs -f api
docker compose logs -f frontend

# Connect to database
docker exec -it symbio_postgres psql -U symbio -d symbio

# Run a Celery task manually
docker exec symbio_worker celery -A app.worker call app.worker.run_retrain_task

# Run tests
docker exec symbio_api pytest
```

---

## Auth & Roles

Email/password login via NextAuth + FastAPI JWT. Three built-in roles:

| Role | Access |
|---|---|
| `admin` | Everything |
| `scientist` | All except finance and user management |
| `viewer` | Read-only |

Admins can create accounts and adjust permissions at `/admin/users`.

---

## Contributing

1. Branch off `master`
2. Make your changes locally with `docker compose up -d`
3. Push your branch and open a PR
4. Changes are deployed on the server with `git pull && docker compose up -d --build api frontend`

For a full developer reference (router patterns, module structure, agent layer, RAG pipeline), see [CLAUDE.md](CLAUDE.md).
