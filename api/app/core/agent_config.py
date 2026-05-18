"""
Agent configuration registry + DB overlay.

Usage:
    from app.core.agent_config import get_agent_config, AGENT_REGISTRY

    cfg = get_agent_config("planner_generate")
    model     = cfg["model"]
    max_tokens = cfg["max_tokens"]
    # system_prompt_override is set only if admin stored one in DB
    extra_instructions = cfg.get("system_prompt_override") or ""

Admins can override model, max_tokens, temperature, top_p, top_k, and
system_prompt_override via the Agent Manager UI (/admin/agent-manager).
Overrides are stored in the agent_config_overrides table and merged at call time.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# ── Registry ─────────────────────────────────────────────────────────────────
# Hardcoded defaults for every known AI agent.
# Keys: display_name, description, module, pages, file, model, max_tokens,
#       temperature, top_p, top_k, wired (bool — True if agent actually reads
#       from get_agent_config()), context_sources, tools, default_system_prompt

AGENT_REGISTRY: dict[str, dict[str, Any]] = {
    "planner_generate": {
        "display_name": "Daily Plan Generator",
        "description": "Generates prioritized daily work blocks from tasks, calendar, and context",
        "module": "Planner",
        "pages": ["/dashboard"],
        "file": "routers/planner.py",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": True,
        "context_sources": [
            "Open tasks (up to 60) — due date, estimated time, project, contact, revenue",
            "Contact reminders (up to 40) — urgency flags, type, linked contact",
            "Active/at-risk projects (up to 20) — revenue, stage, deadline",
            "FP&A actuals — cash balance, burn rate, runway months",
            "QBO revenue — last 3 months P&L",
            "Yesterday's plan completion stats (done/total blocks)",
            "User's standing planner instructions (from profile)",
            "Google Calendar events — today's committed time blocks",
            "Weekly plan summary (for daily context)",
        ],
        "tools": [],
        "default_system_prompt": (
            "You are an elite executive assistant and strategic planning expert. "
            "Create a realistic, prioritized daily schedule.\n\n"
            "DATE: {dow}, {plan_date}\n"
            "WORKING HOURS: 8:00 AM – 9:00 PM Central Time\n\n"
            "=== EXISTING CALENDAR (schedule AROUND these — no overlaps) ===\n"
            "[calendar events]\n\n"
            "=== OPEN TASKS ===\n"
            "[tasks with due dates, time estimates, project & contact]\n\n"
            "=== CONTACT REMINDERS ===\n"
            "[reminders with urgency]\n\n"
            "=== ACTIVE PROJECTS ===\n"
            "[projects with status, revenue, deadline]\n\n"
            "=== FINANCIAL CONTEXT ===\n"
            "[cash, burn, runway, last-month revenue]\n\n"
            "PRIORITY RULES:\n"
            "0. ABSOLUTE: Tasks with BOTH due date AND estimated time\n"
            "1. CRITICAL: Overdue >7d, funding, money, contracts\n"
            "2. HIGH: Due today/tomorrow, high-value clients, at-risk projects\n"
            "3. ELEVATED: Due this week, new prospects, old follow-ups\n"
            "4. NORMAL: Regular tasks <2 weeks\n"
            "5. LOW: Admin, research, low-value\n\n"
            "Return ONLY valid JSON: { health_summary, blocks[] }"
        ),
    },
    "planner_weekly": {
        "display_name": "Weekly Plan Generator",
        "description": "Generates high-level weekly plan from tasks and objectives",
        "module": "Planner",
        "pages": ["/dashboard"],
        "file": "routers/planner.py",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": True,
        "context_sources": [
            "All open tasks with time estimates",
            "All contact reminders",
            "Active/at-risk projects",
            "FP&A actuals & QBO monthly revenue",
            "Google Calendar — full week (Mon–Sun)",
            "User's standing planner instructions",
        ],
        "tools": [],
        "default_system_prompt": (
            "You are an elite executive assistant. Create a strategic weekly plan.\n\n"
            "WEEK: {week_start} – {week_end}\n"
            "WORKING HOURS: 8:00 AM – 9:00 PM CST each day\n\n"
            "=== EXISTING CALENDAR COMMITMENTS THIS WEEK ===\n"
            "[calendar events]\n\n"
            "=== ALL OPEN TASKS ===\n"
            "[tasks with estimates and due dates]\n\n"
            "=== ACTIVE PROJECTS ===\n"
            "[projects with revenue & deadlines]\n\n"
            "=== FINANCIAL CONTEXT ===\n"
            "[cash, burn, runway]\n\n"
            "Create a week-level strategic plan. Allocate themes and key items "
            "to each day. Be realistic about capacity.\n\n"
            "Return ONLY valid JSON: { week_summary, ai_reasoning, days{} }"
        ),
    },
    "planner_chat": {
        "display_name": "Morning Brain Dump Chat",
        "description": "Conversational AI for morning brain dumps and task extraction",
        "module": "Dashboard",
        "pages": ["/dashboard"],
        "file": "routers/planner.py",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": True,
        "context_sources": [
            "Open tasks — due dates, project, contact, revenue",
            "Contact reminders — urgency, type",
            "Active projects — stage, status, revenue, deadline",
            "FP&A actuals & QBO monthly revenue",
            "Google Calendar — today's events",
            "Recent ELN notebook entries (last 10 with AI summaries)",
            "Recent meeting notes (last 5 with summaries & action items)",
            "Top client contacts (AI relationship summaries)",
            "Recent literature papers (last 5 key findings)",
            "Active strains & top compound opportunities",
            "Funding opportunities (active, by deadline)",
        ],
        "tools": [],
        "default_system_prompt": (
            "You are an executive assistant for Collective ERP, a biotech startup. "
            "You have real-time access to ALL business data across every module "
            "and help the founder prioritize and manage their day.\n\n"
            "TODAY: {today}\n\n"
            "=== LIVE BUSINESS CONTEXT ===\n"
            "OPEN TASKS | CONTACT REMINDERS | ACTIVE PROJECTS | FINANCIALS | "
            "TODAY'S CALENDAR | RECENT ELN ENTRIES | MEETING NOTES | "
            "KEY CONTACTS | LITERATURE | STRAINS & COMPOUNDS | FUNDING\n\n"
            "=== YOUR ROLE ===\n"
            "- Sharp, direct executive assistant — not overly formal\n"
            "- Use calendar to understand committed time\n"
            "- Brain dumps / 'add this' → extracted_tasks (task list, NOT calendar)\n"
            "- When asked what to do → numbered list tied to actual data\n"
            "- Overdue items and high-revenue projects first\n"
            "- Under 150 words unless detail requested\n"
            "- Never suggest adding to calendar\n\n"
            "Return ONLY valid JSON: { reply, extracted_tasks[], suggest_replan }"
        ),
    },
    "note_analysis": {
        "display_name": "Meeting Note Analyzer",
        "description": "Extracts action items, decisions, and follow-ups from meeting transcripts",
        "module": "Notes",
        "pages": ["/notebook"],
        "file": "worker.py → analyze_note_task",
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Note title",
            "Raw meeting transcript (up to 12,000 chars, from Deepgram transcription)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Analyze this meeting or session transcript and extract structured information.\n\n"
            "Meeting title: {title}\n"
            "Transcript:\n{transcript[:12000]}\n\n"
            "Return ONLY a valid JSON object with exactly these fields:\n"
            '{\n'
            '  "summary": "2-3 paragraph prose summary of what was discussed and outcomes",\n'
            '  "action_items": [{"title": "...", "description": "...", "assignee_hint": "..."}],\n'
            '  "decisions": [{"decision": "...", "context": "..."}],\n'
            '  "follow_ups": ["string"]\n'
            '}'
        ),
    },
    "entry_analysis": {
        "display_name": "ELN Entry Analyzer",
        "description": "Analyzes lab notebook entry transcripts for structured data extraction",
        "module": "Notebook",
        "pages": ["/notebook"],
        "file": "worker.py → analyze_entry_task",
        "model": "claude-sonnet-4-6",
        "max_tokens": 2048,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Entry title",
            "Raw transcript (up to 12,000 chars)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Analyze this meeting or session transcript and extract structured information.\n\n"
            "Meeting title: {title}\n"
            "Transcript:\n{transcript[:12000]}\n\n"
            "Return ONLY a valid JSON object:\n"
            '{\n'
            '  "summary": "2-3 paragraph prose summary",\n'
            '  "action_items": [{"title": "...", "description": "...", "assignee_hint": "..."}],\n'
            '  "decisions": [{"title": "...", "rationale": "..."}],\n'
            '  "follow_ups": [{"item": "...", "deadline": "..."}]\n'
            '}'
        ),
    },
    "tasks_extract": {
        "display_name": "Task Extractor (Brain Dump)",
        "description": "Extracts structured tasks from free text or brain dump",
        "module": "Tasks",
        "pages": ["/tasks", "/dashboard"],
        "file": "routers/planner.py → _build_brain_dump_prompt",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 512,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Raw brain dump text (user input only)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Extract discrete actionable items from this brain dump text. "
            "Classify each as a task or reminder.\n\n"
            "BRAIN DUMP:\n{text}\n\n"
            "Return ONLY valid JSON:\n"
            '{\n'
            '  "items": [\n'
            '    {"title": "Concise action title", "type": "task", '
            '"urgency": "high", "notes": "context or null"}\n'
            '  ]\n'
            '}\n\n'
            "Rules:\n"
            "- type: 'task' (work item) or 'reminder' (follow-up with person)\n"
            "- urgency: 'high' (do today), 'medium' (this week), 'low' (someday)"
        ),
    },
    "queue_extract": {
        "display_name": "Literature Queue Extractor",
        "description": "Extracts fermentation yield/condition data from academic papers",
        "module": "Literature",
        "pages": ["/literature"],
        "file": "routers/queue.py",
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 2000,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Paper full text (title, authors, DOI, journal, year)",
            "Extraction schema from staging_queue (organism, substrate, yield targets)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Extract structured fermentation data from the scientific paper below.\n\n"
            "Paper: {title} ({year}) — {journal}\n"
            "Full text:\n{full_text}\n\n"
            "Extract all fermentation runs: organism, substrate, yield, titer, "
            "productivity, conditions (pH, temp, DO). Return structured JSON array."
        ),
    },
    "notebook_format": {
        "display_name": "Notebook Formatter",
        "description": "Formats raw meeting notes into clean structured documents",
        "module": "Notebook",
        "pages": ["/notebook"],
        "file": "routers/notebook.py",
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Entry title",
            "Entry body (raw notes, up to 8,000 chars)",
            "Linked calendar event title (if present)",
        ],
        "tools": [],
        "default_system_prompt": (
            "You are formatting rough meeting notes into a clean, readable document.\n\n"
            "Meeting: {meeting_name}\n"
            "Raw notes:\n{body[:8000]}\n\n"
            "Format these notes into clean, well-structured markdown. Rules:\n"
            "- Preserve ALL information — do not drop any facts, numbers, or details\n"
            "- Use ## for main sections, ### for subsections\n"
            "- Use bullet lists for lists of items\n"
            "- Bold (**text**) key numbers, names, and decisions\n"
            "- Fix obvious typos or unclear abbreviations\n"
            "- Keep the tone professional but concise\n"
            "- Do NOT add new information or commentary\n"
            "- Return ONLY the formatted markdown, nothing else"
        ),
    },
    "protocols_parse": {
        "display_name": "Protocol PDF Parser",
        "description": "Parses uploaded PDF text to extract and structure SOP protocols",
        "module": "Protocols",
        "pages": ["/protocols"],
        "file": "routers/protocols.py",
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "PDF extracted text (up to ~60,000 chars via pypdf)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Extract the laboratory protocol from the PDF text below and return a single JSON object.\n\n"
            "JSON schema (output ONLY the JSON object, nothing else):\n"
            '{\n'
            '  "title": "<concise protocol title>",\n'
            '  "protocol_type": "<fermentation_method|medium_preparation|downstream_processing|'
            'genome_edit_sop|analytical_assay|strain_maintenance|substrate_preparation|other>",\n'
            '  "organism": "<organism name or null>",\n'
            '  "substrate": "<substrate/medium name or null>",\n'
            '  "vessel_type": "<e.g. shake_flask, stirred_tank, or null>",\n'
            '  "scale": "<e.g. lab, pilot, or null>",\n'
            '  "tags": ["<keyword>"],\n'
            '  "content_markdown": "<full protocol as Markdown>"\n'
            '}\n\n'
            "PDF text:\n---\n{text}\n---"
        ),
    },
    "composition_research": {
        "display_name": "Substrate Composition Researcher",
        "description": "Researches biochemical composition of substrates via web search",
        "module": "Substrates",
        "pages": ["/analyses"],
        "file": "agents/composition_agent.py",
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 2500,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Substrate name (user input)",
            "Partner organization (optional)",
            "USDA FoodData Central API results",
            "Literature search results",
        ],
        "tools": ["usda_search", "literature_search"],
        "default_system_prompt": (
            "Research the biochemical composition of the substrate '{substrate_name}'. "
            "Use available tools to search USDA and literature databases. "
            "Return structured composition data: carbohydrates, proteins, lipids, "
            "moisture, ash, and key fermentable fractions with cited sources."
        ),
    },
    "paper_summary": {
        "display_name": "Paper Summarizer",
        "description": "Summarizes academic papers for the precision fermentation R&D database",
        "module": "Literature",
        "pages": ["/literature"],
        "file": "agents/paper_summary_agent.py",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Paper full text",
            "Paper metadata (title, authors, journal, year, DOI)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Summarize this precision fermentation research paper for a biotech R&D database.\n\n"
            "Paper: {title} ({year})\n"
            "Authors: {authors}\n\n"
            "Full text:\n{full_text}\n\n"
            "Return JSON with: paper_summary (2-3 paragraphs), key_findings (bullet list), "
            "research_gaps (what is still unknown or unstudied)."
        ),
    },
    "sop_generator": {
        "display_name": "SOP Generator",
        "description": "Generates CRISPR-Cas9 Standard Operating Procedures as DOCX files",
        "module": "Protocols",
        "pages": ["/protocols"],
        "file": "agents/sop_generator.py",
        "model": "claude-opus-4-6",
        "max_tokens": 16000,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Genome edit parameters (strain, target gene, edit type, gRNA sequence)",
            "Strain metadata (organism, accession, genome stats)",
            "Protocol template structure",
        ],
        "tools": [],
        "default_system_prompt": (
            "Generate a comprehensive CRISPR-Cas9 Standard Operating Procedure (SOP) "
            "for the following genome editing experiment.\n\n"
            "Strain: {strain_name}\n"
            "Target gene: {target_gene}\n"
            "Edit type: {edit_type}\n"
            "gRNA sequence: {grna_sequence}\n\n"
            "Include: objective, materials, safety, step-by-step protocol, "
            "troubleshooting, expected results, and references. "
            "Format as a professional lab SOP document."
        ),
    },
    "paper_extraction": {
        "display_name": "Paper Data Extractor",
        "description": "Extracts structured fermentation data from scientific papers for DB ingestion",
        "module": "Literature",
        "pages": ["/literature", "/queue"],
        "file": "agents/extraction_agent.py",
        "model": "claude-sonnet-4-6",
        "max_tokens": 8192,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Paper full text",
            "Paper metadata (title, authors, DOI)",
            "Staging queue entry (extraction schema and targets)",
        ],
        "tools": [],
        "default_system_prompt": (
            "Extract all fermentation experimental data from this scientific paper.\n\n"
            "Paper: {title}\n"
            "Full text:\n{full_text}\n\n"
            "For each fermentation run, extract: organism (genus, species, strain), "
            "substrate (type and concentration), fermentation type (batch/fed-batch/continuous), "
            "yield (g/g), titer (g/L), productivity (g/L/h), key conditions "
            "(pH, temperature, dissolved oxygen), and any genetic modifications. "
            "Return a JSON array of run objects."
        ),
    },
    "regulatory_analysis": {
        "display_name": "Regulatory Analyzer",
        "description": "FDA GRAS, eCFR Title 21, EFSA regulatory assessment for compound opportunities",
        "module": "Compounds",
        "pages": ["/compounds", "/analyses"],
        "file": "agents/regulatory_agent.py",
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Compound / output name",
            "CAS number (optional)",
            "eCFR Title 21 search results",
            "FDA GRAS database results",
            "EFSA opinions search results",
        ],
        "tools": ["ecfr_search", "fda_gras_search", "efsa_search"],
        "default_system_prompt": (
            "Perform a regulatory assessment for the compound '{compound_name}' "
            "(CAS: {cas_number}).\n\n"
            "Search results from eCFR Title 21, FDA GRAS, and EFSA:\n{search_results}\n\n"
            "Return a structured regulatory status report covering: US FDA status "
            "(GRAS, food additive, prohibited), EU EFSA status, approval pathway "
            "requirements, key risks, and a summary recommendation for commercialization."
        ),
    },
    "compound_discovery": {
        "display_name": "Compound Discovery",
        "description": "Evaluates biosynthetic compound opportunities and market value from strain/substrate data",
        "module": "Compounds",
        "pages": ["/compounds", "/analyses"],
        "file": "agents/compound_discovery_agent.py",
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Strain CAZyme features (GH13, GH15, GH10, GH11, AA9, CE1, etc.)",
            "Substrate composition (starch, cellulose, lignin, etc.)",
            "Fermentation type, organism class, substrate metadata",
            "Market price data for known compounds",
        ],
        "tools": [],
        "default_system_prompt": (
            "Evaluate biosynthetic compound opportunities for strain '{strain_name}' "
            "fermenting substrate '{substrate_name}'.\n\n"
            "CAZyme profile: {cazyme_features}\n"
            "Substrate composition: {substrate_composition}\n"
            "Market prices: {market_data}\n\n"
            "For each potential compound, assess: biochemical feasibility, "
            "estimated titer range, market size (USD), regulatory pathway, "
            "and overall opportunity score (0–100). Return JSON array."
        ),
    },
    "contact_summary": {
        "display_name": "Contact Summarizer",
        "description": "Generates AI relationship summaries for contacts from email and calendar activity",
        "module": "Contacts",
        "pages": ["/contacts"],
        "file": "tasks/contacts_sync.py",
        "model": "claude-sonnet-4-6",
        "max_tokens": 1024,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": False,
        "context_sources": [
            "Contact name, email, organization, title",
            "Recent email interactions (subject, direction, date — last 30)",
            "Recent calendar events with contact (last 10)",
            "Subject areas, tags, notes",
            "Linked tasks and contact reminders",
        ],
        "tools": [],
        "default_system_prompt": (
            "Generate a concise AI relationship summary for this contact.\n\n"
            "Contact: {name} ({title} at {organization})\n"
            "Recent interactions:\n{interactions}\n\n"
            "Write 2-3 sentences covering: the nature of the relationship, "
            "recent topics discussed, and any outstanding items or next steps. "
            "Tone: professional, factual, useful for a CRM context."
        ),
    },
    "funding_enrich": {
        "display_name": "Funding Opportunity Enricher",
        "description": "Enriches funding opportunity details — fills missing fields, suggests tags, adds context",
        "module": "Funding",
        "pages": ["/funding"],
        "file": "routers/funding.py",
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "temperature": None,
        "top_p": None,
        "top_k": None,
        "wired": True,
        "context_sources": ["Opportunity title, notes, source link, current stage, tags, amount"],
        "tools": [],
        "default_system_prompt": (
            "You are a funding opportunity analyst for an early-stage biotech/foodtech startup (Symbio). "
            "Given a funding opportunity, enrich it with relevant details from your knowledge.\n\n"
            "Return ONLY valid JSON with these fields (null for unknown):\n"
            "{\n"
            "  \"funding_type\": string,\n"
            "  \"amount\": string,\n"
            "  \"tags\": [string],\n"
            "  \"notes\": string,\n"
            "  \"decision_date\": string or null,\n"
            "  \"enrichment_summary\": string\n"
            "}\n\n"
            "funding_type: e.g. 'SBIR', 'Accelerator', 'Grant', 'Angel', 'VC', 'Competition'\n"
            "amount: typical award amount as string e.g. '$50,000' or '$50K–$250K'\n"
            "tags: relevant tags for the opportunity (max 5)\n"
            "notes: 2-4 sentences with key eligibility, requirements, focus areas, and strategic fit for Symbio\n"
            "decision_date: typical announcement or decision timeline if known\n"
            "enrichment_summary: one sentence describing what was found\n\n"
            "Only include fields you're reasonably confident about. Keep notes concise and actionable."
        ),
    },
}


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _ensure_tables() -> None:
    """Create agent_config_overrides and celery_job_overrides if they don't exist,
    and add any new columns via ALTER TABLE IF NOT EXISTS."""
    try:
        conn = _get_conn()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_config_overrides (
                agent_id          VARCHAR PRIMARY KEY,
                model             VARCHAR,
                max_tokens        INTEGER,
                temperature       FLOAT,
                top_p             FLOAT,
                top_k             INTEGER,
                system_prompt_override TEXT,
                notes             TEXT,
                updated_at        TIMESTAMPTZ DEFAULT now()
            )
        """)
        # Add columns that may not exist in older installs
        for col_def in [
            "ADD COLUMN IF NOT EXISTS top_p FLOAT",
            "ADD COLUMN IF NOT EXISTS top_k INTEGER",
        ]:
            try:
                cur.execute(f"ALTER TABLE agent_config_overrides {col_def}")
            except Exception:
                conn.rollback()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS celery_job_overrides (
                job_name          VARCHAR PRIMARY KEY,
                enabled           BOOLEAN DEFAULT TRUE,
                cron_minute       VARCHAR,
                cron_hour         VARCHAR,
                cron_day_of_week  VARCHAR,
                notes             TEXT,
                updated_at        TIMESTAMPTZ DEFAULT now()
            )
        """)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("agent_config: could not ensure tables: %s", exc)


def get_agent_config(agent_id: str) -> dict[str, Any]:
    """
    Return merged config for agent_id.
    DB overrides take precedence over AGENT_REGISTRY defaults.
    Non-null DB fields override registry; null DB fields fall back to registry.
    """
    defaults = AGENT_REGISTRY.get(agent_id, {}).copy()
    try:
        conn = _get_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT model, max_tokens, temperature, top_p, top_k, "
            "system_prompt_override, notes "
            "FROM agent_config_overrides WHERE agent_id = %s",
            (agent_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            if row["model"] is not None:
                defaults["model"] = row["model"]
            if row["max_tokens"] is not None:
                defaults["max_tokens"] = row["max_tokens"]
            if row["temperature"] is not None:
                defaults["temperature"] = row["temperature"]
            if row["top_p"] is not None:
                defaults["top_p"] = row["top_p"]
            if row["top_k"] is not None:
                defaults["top_k"] = row["top_k"]
            if row["system_prompt_override"] is not None:
                defaults["system_prompt_override"] = row["system_prompt_override"]
    except Exception as exc:
        logger.warning("get_agent_config(%s): DB lookup failed, using defaults: %s", agent_id, exc)
    return defaults
