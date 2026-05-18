# Symbio Platform — Developer Reference

Computational biology platform for Aspergillus strain screening on industrial waste-stream substrates. Combines ML titer prediction, AI compound discovery, techno-economic analysis, literature mining, ELN, FP&A, and CRM.

**Stack:** FastAPI (Python) + Next.js 14 App Router + PostgreSQL 16 + pgvector + Redis + Celery

**Location:** `/opt/symbio/`
**Start all services:** `cd /opt/symbio && docker compose up -d`
**Public URL:** `https://platform.symbiobc.com`

---

## Directory Layout

```
/opt/symbio/
├── api/
│   └── app/
│       ├── main.py           # FastAPI app, CORS, router registration
│       ├── db.py             # SQLAlchemy engine + get_db() dependency
│       ├── auth.py           # JWT utils, current_user dependency, permission constants
│       ├── models.py         # SQLAlchemy ORM models (or inline in routers)
│       ├── worker.py         # Celery app, task definitions, Beat schedule
│       ├── routers/          # 23 FastAPI routers (one file per domain)
│       └── agents/           # AI agent modules + external API clients
├── frontend/
│   ├── app/                  # Next.js App Router pages
│   │   ├── kb/               # In-app knowledge base (user docs)
│   │   ├── api/              # Next.js API routes (proxy, auth)
│   │   └── _components/      # Shared page-level components
│   ├── components/           # Shared React components
│   │   ├── Shell.tsx         # App shell, sidebar nav, permissions gate
│   │   └── kb/               # KB-specific components (SystemFlowchart etc.)
│   └── lib/                  # Utilities, auth config (NextAuth)
├── sql/
│   ├── schema.sql            # All table DDL (source of truth)
│   └── views.sql             # DB views
├── annotation/               # Host-side genome annotation scripts (NOT in Docker)
├── scripts/
│   └── annotation_queue_daemon.sh   # Host daemon — polls DB via docker exec
├── docs/
│   └── system_spec.docx      # High-level system specification
└── docker-compose.yml
```

---

## Containers

| Container | Role | Internal Port |
|---|---|---|
| symbio_traefik | Traefik reverse proxy | 80 → ext 8080 |
| symbio_api | FastAPI (Uvicorn) | 8000 |
| symbio_frontend | Next.js 14 | 3000 |
| symbio_worker | Celery + Beat | — |
| symbio_postgres | PostgreSQL 16 + pgvector | 5432 |
| symbio_redis | Redis 7 | 6379 |

**Traefik routing:**
- `/api/*` → `symbio_api:8000`
- `/api/proxy/*`, `/api/auth/*` → `symbio_frontend:3000` (Next.js API routes)
- `/*` → `symbio_frontend:3000`

**Note:** Frontend Next.js API routes at `/api/proxy/*` forward requests to `symbio_api:8000/api/*` after injecting the session JWT. Never call the FastAPI directly from client components — always go through `/api/proxy/`.

---

## Environment Variables

Defined in `.env` at `/opt/symbio/.env` and passed via `docker-compose.yml`:

```
ANTHROPIC_API_KEY         # Claude API (all AI agents + dashboard chat)
OPENAI_API_KEY            # OpenAI text-embedding-3-small (RAG embeddings only)
RAG_ENABLED               # true|false — enable semantic RAG in dashboard chat
SECRET_KEY                # FastAPI JWT signing
DB_PASSWORD               # PostgreSQL password
NEXTAUTH_SECRET           # NextAuth session signing
NEXTAUTH_URL              # https://platform.symbiobc.com
DEEPGRAM_API_KEY          # Voice transcription (Notebook, Notes)
GOOGLE_CLIENT_ID          # Google OAuth (Gmail/Calendar sync)
GOOGLE_CLIENT_SECRET
PLAID_CLIENT_ID           # Bank data (FP&A actuals)
PLAID_SANDBOX_SECRET
PLAID_PRODUCTION_SECRET
PLAID_ENV                 # sandbox | production
QBO_CLIENT_ID             # QuickBooks Online (P&L sync)
QBO_CLIENT_SECRET
S2_API_KEY                # Semantic Scholar (literature search)
ATCC_API_KEY              # ATCC strain/genome metadata
```

---

## Auth & Permissions

Authentication is JWT-based (FastAPI) wrapped by NextAuth (frontend).

**FastAPI side** (`api/app/routers/auth.py`):
- `POST /api/auth/login` — returns `access_token` (JWT, 8h expiry)
- `GET /api/users/me` — current user with permissions
- `current_user = Depends(get_current_user)` — injects user into router handlers
- Permissions are stored as a JSONB column on the `users` table

**23 permission keys:**
```
analyses, contacts, projects, literature, queue_upload, queue_approve,
log_runs, strains, enzymes, protocols, notebook, model, model_retrain,
compounds, explore, view_fpa, edit_fpa, manage_users, dev_mode, notes
```

**Three default roles** (role is just a label; actual permissions are stored per-user):
- `admin` — all permissions enabled
- `scientist` — all except `view_fpa`, `edit_fpa`, `manage_users`
- `viewer` — read-only subset

**Frontend side** (`components/Shell.tsx`):
- `can(permission_key)` — checks permissions from NextAuth session
- Nav items with `permission:` field are hidden if user lacks it
- `/admin/*` routes check `manage_users` permission

---

## FastAPI Router Pattern

Every router follows this pattern:

```python
# api/app/routers/example.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..db import get_db
from ..routers.auth import get_current_user, User

router = APIRouter(prefix="/example", tags=["example"])

@router.get("/")
def list_items(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ...

@router.post("/")
def create_item(payload: ItemCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    ...
```

Register in `main.py`:
```python
from .routers import example
app.include_router(example.router)
```

---

## Registered Routers (30)

| Router | Prefix | Key purpose |
|---|---|---|
| auth | /auth | Login, token, permissions |
| users | /users | User CRUD, role assignment |
| substrates | /substrates | Waste-stream registry, archive, TEA trigger |
| strains | /strains | Strain registry, annotation queue, CRISPR edits |
| runs | /runs | Fermentation run logging, next-experiment recommendations |
| queue | /queue | Literature staging: PDF upload, extraction, approve/reject |
| papers | /papers | Literature paper registry, PDF serving |
| compounds | /compounds | Market prices, regulatory status |
| enzymes | /enzymes | Commercial enzyme registry, cost estimation |
| protocols | /protocols | Protocol bank: draft→approved→archived workflow |
| model | /model | ML model status, retrain trigger, SHAP feature importance |
| explore | /explore | UMAP embeddings for substrate/strain visualization |
| fpa | /fpa | FP&A dashboard, Plaid/QBO sync, financial models |
| notebook | /notebook | ELN: notebooks, entries, Deepgram transcription relay |
| notes | /notes | Meeting notes, transcription relay, AI analysis |
| tasks | /tasks | Personal task list (CRUD, due dates, project linking) |
| contacts | /contacts | CRM: contacts, interactions, Gmail/Calendar sync, enrichment |
| advisors | /advisors | Advisor tracking (sub-set of contacts) |
| projects | /projects | Projects: CRUD, stages, status |
| calendar | /calendar | Google Calendar events |
| planner | /planner | AI dashboard chat, daily/weekly plan generation |
| agent_manager | /agent-manager | Per-agent config: model, temp, top_p, top_k, system prompt |
| funding | /funding | Funding opportunities (grants, investors) |
| dilutive | /dilutive | Cap table dilutive events |
| chemicals | /chemicals | Lab chemicals inventory |
| invoices | /invoices | Invoice tracking |
| system_design | /system-design | Bioprocess flowsheet designer |
| portal | /portal | Client data room portals |
| jobs | /jobs | Manual job triggers (retrain, literature sweep, TEA, etc.) |
| reports | /reports | DOCX report download |
| dev | /dev | Dev mode: agent docs, assumptions, execution traces |

---

## Frontend Navigation Structure

Defined in `frontend/components/Shell.tsx`. Five sections + footer KB link:

```
PRIMARY (no header):  Dashboard, Calendar, Notebook, Tasks
OPS:                  Projects, Contacts [→ Relationship Graph], CRM*, Funding*
                      FP&A (view_fpa)
ANALYSIS:             Analyses [→ New Analysis], Model, Literature
SYSTEM DESIGN:        System Design*
LAB:                  Log Run (log_runs), Protocols, Inventory [→ Strains, Enzymes]
Footer:               Knowledge Base
```

`*` = placeholder page, not yet implemented

Permission-gated nav items are filtered via `can(permission_key)`. The `renderSection(header, items)` helper renders each section with a labeled header, filtering out items the user can't access.

---

## Celery / Async Tasks

Worker defined in `api/app/worker.py`. Redis is both broker and result backend.

**Trigger a task from a router:**
```python
from ..worker import run_tea_task
run_tea_task.delay(substrate_id=str(substrate_id))
```

**Beat schedule** (cron tasks, auto-run):
| Schedule | Task |
|---|---|
| 01:00 UTC daily | Refresh AI contact summaries |
| 01:30 UTC daily | **RAG nightly re-embed** — re-embeds rows updated in last 25h |
| 02:00 UTC daily | XGBoost + MAPIE retrain (min 30 rows) |
| 02:30 UTC daily | Relationship inference from email co-occurrence |
| 03:00 UTC daily | Gmail full sync (all users) |
| 03:00 UTC Mon | Literature agent sweep (PubMed + Semantic Scholar) |
| 04:00 UTC Mon | EU Novel Food catalogue refresh |
| 06:00 CST daily | AI daily plan generation (all users) |
| 06:00 CST Mon | AI weekly plan generation |
| 07:00 UTC daily | Plaid bank sync |
| 07:15 UTC daily | QuickBooks Online P&L sync |
| 08:30 UTC daily | Task due reminders |
| 17:30 CST daily | Roll over unstarted plan blocks → skipped |
| Hourly | Incremental Gmail sync, Calendar sync |

**Manual triggers** available via `/api/jobs/*` endpoints (admin/dev use).

---

## Database

PostgreSQL 16 + pgvector extension. Schema in `sql/schema.sql` (source of truth — always check here before assuming column names).

**Key tables:**

| Table | Purpose |
|---|---|
| users | Auth + JSONB permissions |
| strains | Strain registry (NCBI accession, CAZyme annotation status) |
| strain_cazyme_features | CAZyme annotation vectors (dbCAN output) |
| substrates | Waste-stream registry (composition %, TEA config) |
| fermentation_runs | Training data (strain × substrate outcomes: titer, yield) |
| substrate_tea_results | TEA results (MPSP, NPV, recommendation) |
| staging_queue | Literature extraction staging (pending → approved/rejected) |
| strain_compound_opportunities | Compound discovery results |
| model_training_log | XGBoost training history and metrics |
| contacts | Contact records |
| contact_interactions | Email/call/meeting interactions |
| contact_relationships | Inferred contact-to-contact relationships |
| contact_reminders | Follow-up reminders |
| google_oauth_tokens | Google OAuth tokens (Gmail + Calendar) |
| fpa_plaid_tokens | Plaid bank OAuth tokens |
| fpa_qbo_tokens | QuickBooks OAuth tokens |
| protocols | Protocol bank (markdown content, version history) |
| api_usage_log | Claude API call tracking |
| context_chunks | **RAG semantic store** — chunked + embedded content (pgvector 1536-dim) |
| daily_plans | AI-generated daily plans per user per date |
| plan_blocks | Time blocks within a daily plan |
| weekly_plans | AI-generated weekly plans |
| agent_config_overrides | Per-agent model/temp/top_p/top_k/system_prompt overrides |
| project_portals | Client data room portals (linked to projects or standalone) |

**Connect directly (from host):**
```bash
docker exec -it symbio_postgres psql -U symbio -d symbio
```

---

## AI Agent Layer (`api/app/agents/`)

All agents call Claude (`claude-opus-4-5` or `claude-sonnet-4-6`). Usage is logged to `api_usage_log`.

| Module | Purpose |
|---|---|
| `tea_agent.py` | BioSTEAM TEA simulations + DCF + sensitivity |
| `compound_discovery_agent.py` | 4 discovery modes (enzymatic, substrate, enzyme-supplemented) |
| `regulatory_agent.py` | US/EU regulatory analysis for compound opportunities |
| `literature_agent.py` | Weekly PubMed/Scholar sweep → extraction queue |
| `extraction_agent.py` | Structured data extraction from PDF papers |
| `rnd_estimator.py` | R&D timeline + capital cost Monte Carlo |
| `edit_prioritizer.py` | SHAP-driven CRISPR edit candidate ranking |
| `sop_generator.py` | SOP generation for genome edits |
| `composition_agent.py` | Substrate composition research (USDA + Claude fallback) |
| `fuzzy_matcher.py` | Entity matching (strain/substrate names from literature) |
| `paper_summary_agent.py` | Paper summarization |
| `usage_logger.py` | API usage tracking middleware |

---

## Dashboard AI Assistant & RAG Pipeline

The dashboard chat (`POST /api/planner/chat`) uses a **Write→Select→Compress→Isolate (WSCI)** context engineering pipeline with semantic RAG.

### 3-Block System Prompt Architecture

| Block | Content | Cached? |
|---|---|---|
| A (static) | Role + response format instructions | Yes — `cache_control: ephemeral` |
| B (live) | Today's tasks, calendar, FP&A, ELN, notes, strains, contacts, funding | No |
| C (semantic) | RAG-retrieved chunks matching the user's query | No |

Block A is stable across all requests for a user; prompt caching saves ~70% of input tokens on repeat turns.

### RAG Pipeline (`api/app/core/rag.py`)

```
user message
  → embed_query()          OpenAI text-embedding-3-small (1536-dim)
  → retrieve_chunks()      cosine ANN from context_chunks (pgvector IVFFlat)
                           hybrid score: 75% cosine + 15% recency decay + 10% source priority
  → mmr_rerank()           Maximal Marginal Relevance (λ=0.6), 12 candidates → 8 final
  → format_retrieved_context()  assemble into Block C (~6000 chars max)
```

**Source priority:** tasks (1.0) > notes (0.9) > eln_entries (0.85) > contacts (0.7) > papers (0.6)

**Recency:** exponential decay, half-life = 30 days

### Embedding

- `api/app/tasks/embed_task.py` — chunk text at 1600 chars (80-char overlap), embed via OpenAI, upsert to `context_chunks`
- Triggered automatically on create/update in: notes, eln_entries, contacts, tasks, papers
- Nightly beat at 01:30 UTC re-embeds anything updated in the last 25h (safety net)
- **Initial backfill** (run once after migration or to re-index all data):
  ```bash
  docker exec symbio_worker celery -A app.worker call app.worker.backfill_all_embeddings
  ```
- Disable RAG: set `RAG_ENABLED=false` in `.env` (chat falls back to structured context blocks)

---

## Agent Manager (`api/app/core/agent_config.py`)

16 registered AI agents with configurable parameters. Managed via:
- **API:** `GET/POST /api/agent-manager/agents`
- **UI:** `/admin/agent-manager` (requires `manage_users` permission)

**Per-agent configuration:**
- `model` — override Claude model
- `max_tokens` — response token limit
- `temperature` — sampling temperature
- `top_p` — nucleus sampling (don't use with temperature simultaneously)
- `top_k` — top-k sampling
- `system_prompt_override` — prepended to the agent's default system prompt

**Inspecting an agent:** Click "Inspect" on any agent card to see its current system prompt, context sources, and tools.

**Key agents:** `planner_chat` (dashboard AI), `daily_plan`, `weekly_plan`, `note_analyzer`, `entry_analyzer`, `contact_enricher`, `contact_summarizer`, `literature_agent`, `compound_discovery`, `regulatory_agent`, `tea_agent`, `rnd_estimator`, `edit_prioritizer`, `sop_generator`, `extraction_agent`, `paper_summarizer`

---

## Genome Annotation Pipeline

Runs on the **HOST** (not inside Docker) because micromamba + dbCAN v5 are installed host-side only.

```
Host daemon: /opt/symbio/scripts/annotation_queue_daemon.sh
  └── Polls DB every 2 min via: docker exec -i symbio_postgres psql -U symbio -d symbio
  └── Calls: /opt/symbio/annotation/run_full_characterization.sh <strain_uuid>
        └── Downloads genome from NCBI → Prodigal (gene prediction) → dbCAN (CAZyme) → parse → UPDATE strain_cazyme_features
```

**Watch-out:** Shell scripts use `set -euo pipefail`. Commands like `find ... | head -1` on missing directories exit non-zero. Fix with `|| true`.

---

## Adding a New Module

1. **API router:** Create `api/app/routers/newmodule.py`, register in `main.py`
2. **Permission key (if needed):** Add to the `PERMISSIONS` dict in `auth.py`, update role defaults
3. **Frontend page:** Create `frontend/app/newmodule/page.tsx`
4. **Nav item:** Add to the appropriate section array in `Shell.tsx` (`PRIMARY`, `OPS`, `ANALYSIS`, `LAB`)
5. **KB page (optional):** Create `frontend/app/kb/newmodule/page.tsx`, add card to `frontend/app/kb/page.tsx`
6. **DB schema:** Add DDL to `sql/schema.sql`, run migration manually on `symbio_postgres`

---

## Common Patterns

**Frontend data fetch (inside a page/component):**
```typescript
// Always use /api/proxy/ — never call FastAPI directly from the browser
const res = await fetch("/api/proxy/contacts?limit=50");
const data = await res.json();
```

**Protecting a page (permission check):**
```typescript
// In Shell.tsx nav, add permission: "key" to the NavItem
// For page-level protection, use the useSession hook + can() helper
```

**Celery task with DB access:**
```python
@celery.task(name="my_task")
def my_task(entity_id: str):
    db = SessionLocal()
    try:
        ...
    finally:
        db.close()
```

**Running a one-off task manually:**
```bash
docker exec symbio_worker celery -A app.worker call app.worker.run_retrain_task
# Or via the /api/jobs/* endpoints (authenticated)
```

---

## Key Domain Rules

- `substrate_purpose` (not `substrate_category`) drives which section a substrate appears in on the Analyses page: `waste_stream | reference | internal_test`
- Literature queue: only papers with at least one `approved` queue item appear in the Literature Library (`approved_only=True`)
- Archive vs delete: archive is soft (data kept, name reserved); delete is hard (all dependents removed, name freed)
- Uploads (PDFs) are stored in the persistent `uploads_data` Docker volume — they survive container restarts
- Annotation daemon script path must stay at `/opt/symbio/scripts/annotation_queue_daemon.sh`; container name must stay `symbio_postgres`