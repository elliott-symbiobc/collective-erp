# Collective ERP

**An integrated open-source operations system for entrepreneurs.**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/YXAJ36?referralCode=ZNUWDi)

Collective ERP gives you the operational backbone of a modern company — contacts, projects, financials, documents, and team tools — in a single self-hostable platform. No per-seat fees. No vendor lock-in. Fully open source. The core architecture was built by Symbio BC as an operations wrapper around our computational biology pipeline, in order to avoid SaaS subscriptions and have greater data control and customization. This version of the software is built to be relatively industry-agnostic, with core functionality across typical ops segments.  As a member of The Collective, you can use and customize the software for your own use case. Elliott can assist with basic customization or troubleshooting, and can help with additional feature buildout if needed ($). 

## How to Depoly 

The easiest way to deploy is using the preconfigured railway template. You can click the button above and will be prompted to create an account and deploy the software. Railway gives new users a free 30 day trial, after which there is a small paid hosting fee based on usage. In order to connect the system with other data sources, you will prompted to connect API keys from several other systems. See below for more information. 

If you are technical, the codebase is available under a BLS license 1.1 and can be self-hosted on your own server. 

Claude code is the easiest way to customize the system, and allows configuration of most features relatively easily even for non-technical users. 

---

## What's included

### For your team
| Module | What it does |
|---|---|
| **Dashboard** | At-a-glance view of tasks, activity, and key metrics across the business |
| **Tasks** | Assign, track, and complete work items. Get notified when something lands in your queue |
| **Calendar** | See your schedule and team events in one place, synced with Google Calendar |
| **Notebook** | Rich-text notes with voice transcription, diagrams, and task embedding. Your team's shared memory |
| **Protocols / SOPs** | A versioned library of standard operating procedures — attach them to projects, reference them in notes |
| **Time Tracking** | Log hours against tasks and projects. Understand where time actually goes |

### For sales & clients
| Module | What it does |
|---|---|
| **CRM** | Full customer relationship management — deals, pipeline stages, notes, and follow-up reminders |
| **Contacts** | A unified contact database synced automatically from Gmail. Relationship graph shows who knows who |
| **Projects** | Track client engagements from kickoff to delivery, with milestones, Gantt view, and document sharing |
| **Portals** | Give clients their own secure room — share files, updates, and communicate without email chains |
| **Marketing** | Internal asset library for brand files, pitch decks, key messaging, and website copy |

### For your finances
| Module | What it does |
|---|---|
| **FP&A** | Connect your bank accounts via Plaid and QuickBooks. See cash position, burn rate, and P&L in real time |
| **Receivables** | Create and send invoices. Track payment status. Build a reusable product/service catalog |
| **Payables** | Track what you owe and when it's due |
| **Funding** | Log funding rounds, investor commitments, and deal status |
| **Cap Table** | Track equity ownership, share classes, and dilution across rounds |

### For operations
| Module | What it does |
|---|---|
| **Inventory** | Manage consumables, materials, and equipment. Track stock levels and reorder needs |
| **Reports** | Generate and export operational reports across any module |
| **Email** | Gmail integration — see all email history for any contact in one place |
| **Settings** | User management, roles, permissions, integrations |
| **Admin** | Manage team members, AI agent configuration, and background job monitoring |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS v4, TypeScript |
| Backend API | FastAPI (Python), Celery (background jobs) |
| Database | PostgreSQL 16 with pgvector |
| Cache / Queue | Redis 7 |
| Auth | NextAuth.js (JWT sessions) |
| AI | Anthropic Claude (SOPs, summaries, contact insights) |
| Deployment | Docker Compose (self-host) or Railway (one-click cloud) |

---

## One-click deploy on Railway

Click the button at the top of this page, or visit:

> **[railway.app/new/template?template=https://github.com/elliott-symbiobc/collective-erp](https://railway.com/deploy/YXAJ36?referralCode=ZNUWDi)**

Railway will provision 5 services automatically:
- **API** — the backend (FastAPI)
- **Frontend** — the web interface (Next.js)
- **Worker** — background jobs and scheduled tasks (Celery)
- **PostgreSQL** — your database (managed by Railway)
- **Redis** — job queue and caching (managed by Railway)

### Required environment variables

| Variable | Description |
|---|---|
| `SECRET_KEY` | Random secret for API token signing. Generate: `openssl rand -hex 32` |
| `NEXTAUTH_SECRET` | Random secret for session encryption. Generate: `openssl rand -hex 32` |
| `NEXTAUTH_URL` | Your frontend URL, e.g. `https://your-app.up.railway.app` |
| `NEXT_PUBLIC_API_URL` | Your API URL, e.g. `https://your-api.up.railway.app/api` |
| `ALLOWED_ORIGINS` | Same as `NEXTAUTH_URL` |

### Optional integrations

| Variable | What it unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | AI-powered SOPs, contact summaries, and notebook assistance |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Gmail sync and Google Calendar integration |
| `PLAID_CLIENT_ID` + `PLAID_*_SECRET` | Bank account connectivity for FP&A |
| `QBO_CLIENT_ID` + `QBO_CLIENT_SECRET` | QuickBooks Online P&L sync |
| `DEEPGRAM_API_KEY` | Voice transcription in Notebook |
| `OPENAI_API_KEY` | Alternative AI provider |

---

## Self-host with Docker Compose

```bash
# 1. Clone the repo
git clone https://github.com/elliott-symbiobc/collective-erp.git
cd collective-erp

# 2. Copy and fill in your environment variables
cp .env.example .env
# Edit .env — at minimum set: DB_PASSWORD, SECRET_KEY, NEXTAUTH_SECRET

# 3. Start everything
docker compose up -d

# 4. Open the app at http://localhost:8080
```

The database is initialized automatically on first start from `sql/schema.sql`.

---

## Project structure

```
collective-erp/
├── api/                    # FastAPI backend
│   ├── app/
│   │   ├── routers/        # One file per module (contacts, projects, fpa, ...)
│   │   ├── agents/         # AI agents (SOP generator, usage logger)
│   │   ├── core/           # RAG, agent config, tracing
│   │   └── worker.py       # Celery tasks and beat schedule
│   ├── Dockerfile
│   ├── railway.toml        # Railway deploy config for API service
│   └── requirements.txt
├── frontend/               # Next.js frontend
│   ├── app/                # Pages (one directory per route)
│   ├── components/         # Shared components (Shell, CRM, Notebook, ...)
│   ├── Dockerfile
│   └── railway.toml        # Railway deploy config for Frontend service
├── sql/
│   ├── schema.sql          # Database schema (auto-applied on first start)
│   ├── views.sql           # Database views
│   └── migrations/         # Incremental migration files
├── docker-compose.yml      # Local development stack
└── .env.example            # All environment variables with descriptions
```

---

## Extending the platform

Adding a new module takes four steps:

1. **API** — Add a router in `api/app/routers/your_module.py` and register it in `api/app/main.py`
2. **Frontend** — Add a page in `frontend/app/your-module/page.tsx`
3. **Navigation** — Add your route to the appropriate section in `frontend/components/Shell.tsx`
4. **Database** — Add your tables to `sql/migrations/` with the next sequential number

---

## License

Business Source License 1.1 — free to use, modify, and self-host. Commercial resale as a hosted service is not permitted. Converts to MIT on 2030-05-18.
