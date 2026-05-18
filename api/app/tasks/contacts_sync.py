"""
contacts_sync.py — Background tasks for the contacts module.

Tasks:
  - sync_gmail_contacts(user_id)          Pull Gmail threads for known contact emails
  - sync_calendar_contacts(user_id)       Pull Calendar events involving known contacts
  - enrich_contact(contact_id)            Claude + Semantic Scholar profile enrichment
  - summarize_contact(contact_id)         Claude AI summary of interactions
"""

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


def _conn():
    return psycopg2.connect(DATABASE_URL)


# ---------------------------------------------------------------------------
# Google token helpers
# ---------------------------------------------------------------------------

def _get_valid_token(user_id: str, conn) -> Optional[str]:
    """Return a valid access token for the user, refreshing if needed."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT access_token, refresh_token, token_expiry FROM google_oauth_tokens WHERE user_id = %s",
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return None

    # If token expires in < 5 minutes, refresh it
    expiry = row["token_expiry"]
    if expiry and expiry < datetime.now(timezone.utc) + timedelta(minutes=5):
        new_token = _refresh_google_token(row["refresh_token"], user_id, conn)
        return new_token

    return row["access_token"]


def _refresh_google_token(refresh_token: str, user_id: str, conn) -> Optional[str]:
    """Use refresh_token to get a new access_token and store it."""
    import httpx
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not client_id or not client_secret or not refresh_token:
        return None

    try:
        r = httpx.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
        if r.status_code != 200:
            logger.error("Token refresh failed: %s", r.text)
            return None

        tokens = r.json()
        access_token = tokens["access_token"]
        expires_in = tokens.get("expires_in", 3600)
        expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        cur = conn.cursor()
        cur.execute(
            "UPDATE google_oauth_tokens SET access_token=%s, token_expiry=%s, updated_at=NOW() WHERE user_id=%s",
            (access_token, expiry, user_id),
        )
        conn.commit()
        return access_token
    except Exception as exc:
        logger.exception("Token refresh error for user %s", user_id)
        return None


# ---------------------------------------------------------------------------
# Gmail sync
# ---------------------------------------------------------------------------

def _parse_email_addresses(header_value: str) -> list[str]:
    """Extract all email addresses from a header like 'Name <a@b.com>, c@d.com'."""
    import re
    if not header_value:
        return []
    # Find all email addresses in angle brackets or bare
    addrs = re.findall(r'<([^>]+)>|(?:^|,)\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})', header_value)
    result = []
    for a, b in addrs:
        addr = (a or b).strip().lower()
        if addr:
            result.append(addr)
    return result


def sync_gmail_contacts(user_id: str) -> dict:
    """
    Pull Gmail messages where senders/recipients match known contact emails.

    Group email logic:
    - If contact is the SENDER: always record as a direct interaction.
    - If contact is a RECIPIENT among >3 total recipients: record as a group
      email (stored with is_group_email=True in metadata). Group emails do NOT
      update last_interaction_at and are shown differently in the UI.
    - If contact is a recipient in a small thread (≤3 recipients total): record
      as a direct interaction.
    """
    import httpx

    conn = _conn()
    try:
        access_token = _get_valid_token(user_id, conn)
        if not access_token:
            logger.info("No Google token for user %s — skipping Gmail sync", user_id)
            return {"status": "skipped", "reason": "no_token"}

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT contact_id, email FROM contacts WHERE email IS NOT NULL AND archived = false")
        contacts_by_email = {row["email"].lower(): row["contact_id"] for row in cur.fetchall()}

        if not contacts_by_email:
            return {"status": "skipped", "reason": "no_contacts_with_email"}

        auth_headers = {"Authorization": f"Bearer {access_token}"}
        synced = 0
        contacts_updated = set()

        for email, contact_id in contacts_by_email.items():
            try:
                query = f"from:{email} OR to:{email}"
                resp = httpx.get(
                    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                    headers=auth_headers,
                    params={"q": query, "maxResults": 20},
                    timeout=15,
                )
                if resp.status_code != 200:
                    continue

                messages = resp.json().get("messages", [])
                for msg_ref in messages[:10]:
                    msg_id = msg_ref["id"]
                    cur.execute(
                        "SELECT 1 FROM contact_interactions WHERE contact_id=%s AND external_id=%s",
                        (contact_id, msg_id),
                    )
                    if cur.fetchone():
                        continue

                    # Fetch headers (To, CC needed for group detection)
                    msg_resp = httpx.get(
                        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                        headers=auth_headers,
                        params={
                            "format": "metadata",
                            "metadataHeaders": ["Subject", "From", "To", "Cc", "Date"],
                        },
                        timeout=15,
                    )
                    if msg_resp.status_code != 200:
                        continue

                    msg = msg_resp.json()
                    hdr_list = msg.get("payload", {}).get("headers", [])
                    hdr = {h["name"].lower(): h["value"] for h in hdr_list}

                    subject = hdr.get("subject", "(no subject)")
                    from_addr = hdr.get("from", "")
                    to_addr = hdr.get("to", "")
                    cc_addr = hdr.get("cc", "")
                    date_str = hdr.get("date", "")
                    snippet = msg.get("snippet", "")[:500]

                    contact_is_sender = email.lower() in from_addr.lower()

                    # Count unique recipients (To + CC)
                    to_list = _parse_email_addresses(to_addr)
                    cc_list = _parse_email_addresses(cc_addr)
                    all_recipients = list(set(to_list + cc_list))
                    recipient_count = len(all_recipients)

                    # Group email: contact is NOT sender and there are >3 total recipients
                    is_group_email = (not contact_is_sender) and (recipient_count > 3)

                    direction = "inbound" if contact_is_sender else "outbound"
                    # Flip: if the contact sent it to us, it's inbound from our perspective
                    direction = "inbound" if contact_is_sender else "outbound"
                    interaction_type = "email_received" if contact_is_sender else "email_sent"

                    try:
                        from email.utils import parsedate_to_datetime
                        occurred_at = parsedate_to_datetime(date_str)
                    except Exception:
                        occurred_at = datetime.now(timezone.utc)

                    metadata = {
                        "is_group_email": is_group_email,
                        "recipient_count": recipient_count,
                        "from": from_addr,
                        "to": to_addr,
                        "cc": cc_addr,
                        "gmail_id": msg_id,
                    }

                    cur.execute(
                        """
                        INSERT INTO contact_interactions
                            (contact_id, interaction_type, subject, content_preview,
                             external_id, occurred_at, direction, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (contact_id, external_id) DO NOTHING
                        """,
                        (
                            contact_id, interaction_type, subject, snippet,
                            msg_id, occurred_at, direction,
                            psycopg2.extras.Json(metadata),
                        ),
                    )
                    synced += 1
                    # Only mark as a real interaction if NOT a group email
                    if not is_group_email:
                        contacts_updated.add((contact_id, occurred_at))

            except Exception as exc:
                logger.warning("Gmail sync failed for contact %s: %s", contact_id, exc)
                continue

        # Update last_interaction_at only for direct (non-group) interactions
        if contacts_updated:
            cur.execute(
                """
                UPDATE contacts c
                SET last_interaction_at = (
                    SELECT MAX(ci.occurred_at)
                    FROM contact_interactions ci
                    WHERE ci.contact_id = c.contact_id
                      AND (ci.metadata->>'is_group_email' IS NULL
                           OR ci.metadata->>'is_group_email' = 'false')
                )
                WHERE c.contact_id IN (
                    SELECT DISTINCT contact_id FROM contact_interactions
                    WHERE metadata->>'is_group_email' = 'false'
                       OR metadata->>'is_group_email' IS NULL
                )
                """
            )
        # Fetch current historyId from Gmail profile and store it for incremental syncs
        try:
            profile_resp = httpx.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/profile",
                headers=auth_headers, timeout=10,
            )
            if profile_resp.status_code == 200:
                history_id = profile_resp.json().get("historyId")
                if history_id:
                    cur.execute(
                        "UPDATE google_oauth_tokens SET gmail_history_id = %s, updated_at = NOW() WHERE user_id = %s",
                        (str(history_id), user_id),
                    )
        except Exception:
            cur.execute(
                "UPDATE google_oauth_tokens SET updated_at = NOW() WHERE user_id = %s",
                (user_id,),
            )
        conn.commit()

        logger.info("Gmail sync for user %s: %d new interactions", user_id, synced)
        return {"status": "success", "synced": synced}

    except Exception as exc:
        logger.exception("sync_gmail_contacts failed for user %s", user_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


def sync_gmail_incremental(user_id: str) -> dict:
    """
    Incremental Gmail sync using the History API.
    Only fetches messages added since the last full or incremental sync.
    Falls back to a full sync if no historyId is stored yet.
    """
    import httpx

    conn = _conn()
    try:
        access_token = _get_valid_token(user_id, conn)
        if not access_token:
            return {"status": "skipped", "reason": "no_token"}

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT gmail_history_id FROM google_oauth_tokens WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        history_id = row["gmail_history_id"] if row else None

        if not history_id:
            logger.info("No historyId stored for user %s — running full sync", user_id)
            return sync_gmail_contacts(user_id)

        # Load contact email → id map
        cur.execute("SELECT contact_id, email FROM contacts WHERE email IS NOT NULL AND archived = false")
        contacts_by_email = {r["email"].lower(): r["contact_id"] for r in cur.fetchall()}
        if not contacts_by_email:
            return {"status": "skipped", "reason": "no_contacts_with_email"}

        auth_headers = {"Authorization": f"Bearer {access_token}"}

        # Fetch history since last sync
        new_message_ids: set[str] = set()
        page_token = None
        while True:
            params: dict = {
                "startHistoryId": history_id,
                "historyTypes": "messageAdded",
            }
            if page_token:
                params["pageToken"] = page_token
            resp = httpx.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/history",
                headers=auth_headers, params=params, timeout=15,
            )
            if resp.status_code == 404:
                # historyId expired (>30 days) — fall back to full sync
                logger.info("historyId expired for user %s — running full sync", user_id)
                return sync_gmail_contacts(user_id)
            if resp.status_code != 200:
                return {"status": "error", "error": f"history API {resp.status_code}"}
            data = resp.json()
            for record in data.get("history", []):
                for added in record.get("messagesAdded", []):
                    new_message_ids.add(added["message"]["id"])
            page_token = data.get("nextPageToken")
            if not page_token:
                new_history_id = data.get("historyId", history_id)
                break

        if not new_message_ids:
            # No new messages — just update historyId
            cur.execute(
                "UPDATE google_oauth_tokens SET gmail_history_id = %s, updated_at = NOW() WHERE user_id = %s",
                (str(new_history_id), user_id),
            )
            conn.commit()
            return {"status": "success", "synced": 0}

        # Fetch metadata for each new message and process if it matches a contact
        synced = 0
        contacts_updated: set = set()

        for msg_id in new_message_ids:
            # Skip if already stored
            cur.execute(
                "SELECT 1 FROM contact_interactions WHERE external_id = %s LIMIT 1",
                (msg_id,),
            )
            if cur.fetchone():
                continue

            try:
                msg_resp = httpx.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}",
                    headers=auth_headers,
                    params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To", "Cc", "Date"]},
                    timeout=15,
                )
                if msg_resp.status_code != 200:
                    continue
                msg = msg_resp.json()
                hdr_list = msg.get("payload", {}).get("headers", [])
                hdr = {h["name"].lower(): h["value"] for h in hdr_list}

                from_addr = hdr.get("from", "")
                to_addr   = hdr.get("to", "")
                cc_addr   = hdr.get("cc", "")
                subject   = hdr.get("subject", "(no subject)")
                date_str  = hdr.get("date", "")
                snippet   = msg.get("snippet", "")[:500]

                # Find which contact(s) this message involves
                to_list = _parse_email_addresses(to_addr)
                cc_list = _parse_email_addresses(cc_addr)
                from_list = _parse_email_addresses(from_addr)
                all_recipients = list(set(to_list + cc_list))
                recipient_count = len(all_recipients)

                matched_contacts: list[tuple[str, bool]] = []  # (contact_id, is_sender)
                for email_addr, contact_id in contacts_by_email.items():
                    if any(email_addr in e for e in from_list):
                        matched_contacts.append((str(contact_id), True))
                    elif any(email_addr in e for e in all_recipients):
                        matched_contacts.append((str(contact_id), False))

                try:
                    from email.utils import parsedate_to_datetime
                    occurred_at = parsedate_to_datetime(date_str)
                except Exception:
                    occurred_at = datetime.now(timezone.utc)

                for contact_id, is_sender in matched_contacts:
                    is_group = (not is_sender) and (recipient_count > 3)
                    interaction_type = "email_received" if is_sender else "email_sent"
                    direction = "inbound" if is_sender else "outbound"
                    metadata = {
                        "is_group_email": is_group,
                        "recipient_count": recipient_count,
                        "from": from_addr, "to": to_addr, "cc": cc_addr,
                        "gmail_id": msg_id,
                    }
                    cur.execute(
                        """
                        INSERT INTO contact_interactions
                            (contact_id, interaction_type, subject, content_preview,
                             external_id, occurred_at, direction, metadata)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (contact_id, external_id) DO NOTHING
                        """,
                        (contact_id, interaction_type, subject, snippet,
                         msg_id, occurred_at, direction, psycopg2.extras.Json(metadata)),
                    )
                    synced += 1
                    if not is_group:
                        contacts_updated.add((contact_id, occurred_at))

            except Exception as exc:
                logger.warning("incremental sync failed for message %s: %s", msg_id, exc)
                continue

        if contacts_updated:
            cur.execute(
                """
                UPDATE contacts c
                SET last_interaction_at = (
                    SELECT MAX(ci.occurred_at) FROM contact_interactions ci
                    WHERE ci.contact_id = c.contact_id
                      AND (ci.metadata->>'is_group_email' IS NULL
                           OR ci.metadata->>'is_group_email' = 'false')
                )
                WHERE c.contact_id = ANY(%s::uuid[])
                """,
                ([cid for cid, _ in contacts_updated],),
            )

        cur.execute(
            "UPDATE google_oauth_tokens SET gmail_history_id = %s, updated_at = NOW() WHERE user_id = %s",
            (str(new_history_id), user_id),
        )
        conn.commit()
        logger.info("Gmail incremental sync for user %s: %d new interactions", user_id, synced)
        return {"status": "success", "synced": synced}

    except Exception as exc:
        logger.exception("sync_gmail_incremental failed for user %s", user_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Calendar sync
# ---------------------------------------------------------------------------

def sync_calendar_contacts(user_id: str) -> dict:
    """Pull Google Calendar events that involve known contacts."""
    import httpx

    conn = _conn()
    try:
        access_token = _get_valid_token(user_id, conn)
        if not access_token:
            return {"status": "skipped", "reason": "no_token"}

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT contact_id, email FROM contacts WHERE email IS NOT NULL AND archived = false")
        contacts_by_email = {row["email"].lower(): row["contact_id"] for row in cur.fetchall()}

        if not contacts_by_email:
            return {"status": "skipped", "reason": "no_contacts_with_email"}

        headers = {"Authorization": f"Bearer {access_token}"}

        # Fetch upcoming and recent events (30 days back, 14 forward)
        now = datetime.now(timezone.utc)
        time_min = (now - timedelta(days=30)).isoformat()
        time_max = (now + timedelta(days=14)).isoformat()

        resp = httpx.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers=headers,
            params={
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": 100,
                "singleEvents": True,
                "orderBy": "startTime",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            return {"status": "error", "reason": resp.text[:200]}

        events = resp.json().get("items", [])
        synced = 0

        for event in events:
            event_id = event.get("id", "")
            attendees = event.get("attendees", [])
            attendee_emails = {a.get("email", "").lower() for a in attendees}

            for email, contact_id in contacts_by_email.items():
                if email not in attendee_emails:
                    continue

                cur.execute(
                    "SELECT 1 FROM contact_interactions WHERE contact_id=%s AND external_id=%s",
                    (contact_id, event_id),
                )
                if cur.fetchone():
                    continue

                start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
                try:
                    occurred_at = datetime.fromisoformat(start.replace("Z", "+00:00"))
                except Exception:
                    occurred_at = datetime.now(timezone.utc)

                summary = event.get("summary", "Meeting")[:255]
                description = event.get("description", "")[:500]

                cur.execute(
                    """
                    INSERT INTO contact_interactions
                        (contact_id, interaction_type, subject, content_preview,
                         external_id, occurred_at)
                    VALUES (%s, 'meeting', %s, %s, %s, %s)
                    ON CONFLICT (contact_id, external_id) DO NOTHING
                    """,
                    (contact_id, summary, description, event_id, occurred_at),
                )
                synced += 1

        conn.commit()
        logger.info("Calendar sync for user %s: %d new interactions", user_id, synced)
        return {"status": "success", "synced": synced}

    except Exception as exc:
        logger.exception("sync_calendar_contacts failed for user %s", user_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# AI Summary
# ---------------------------------------------------------------------------

def summarize_contact(contact_id: str) -> dict:
    """Generate AI summary of a contact's profile and interactions using Claude."""
    import anthropic

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM contacts WHERE contact_id = %s", (contact_id,))
        contact = cur.fetchone()
        if not contact:
            return {"status": "error", "error": "contact not found"}

        # Fetch recent interactions
        cur.execute(
            """
            SELECT interaction_type, subject, content_preview, occurred_at, direction
            FROM contact_interactions
            WHERE contact_id = %s
            ORDER BY occurred_at DESC
            LIMIT 30
            """,
            (contact_id,),
        )
        interactions = [dict(r) for r in cur.fetchall()]

        # Fetch open reminders (action items)
        cur.execute(
            """
            SELECT title, reminder_type, due_date, description
            FROM contact_reminders
            WHERE contact_id = %s AND resolved = false
            ORDER BY due_date ASC NULLS LAST
            """,
            (contact_id,),
        )
        open_reminders = [dict(r) for r in cur.fetchall()]

        # Fetch substrate links
        cur.execute(
            """
            SELECT s.name, csl.role
            FROM contact_substrate_links csl
            JOIN substrates s ON s.substrate_id = csl.substrate_id
            WHERE csl.contact_id = %s
            """,
            (contact_id,),
        )
        substrate_links = [dict(r) for r in cur.fetchall()]

        # Build context
        parts = []

        # Open action items go FIRST
        if open_reminders:
            items_text = "Open action items:\n"
            for r in open_reminders:
                due = f" (due {r['due_date']})" if r.get("due_date") else ""
                items_text += f"- {r['title']}{due}\n"
                if r.get("description"):
                    items_text += f"  {r['description']}\n"
            parts.append(items_text)

        # Contact profile
        profile = (
            f"Contact: {contact['name']}"
            + (f", {contact.get('title')}" if contact.get('title') else "")
            + (f" at {contact.get('organization')}" if contact.get('organization') else "")
            + f"\nEmail: {contact.get('email', 'unknown')}"
            + (f"\nSubject areas: {', '.join(contact.get('subject_areas') or [])}" if contact.get('subject_areas') else "")
            + (f"\nNotes: {contact['notes']}" if contact.get('notes') else "")
        )
        if substrate_links:
            profile += "\nLinked substrates: " + ", ".join(f"{sl['name']} ({sl['role']})" for sl in substrate_links)
        parts.append(profile)

        # Interactions
        if interactions:
            ix_lines = []
            for ix in interactions[:15]:
                d = ix["occurred_at"].strftime("%Y-%m-%d") if ix["occurred_at"] else "?"
                subj = (ix.get("subject") or "").strip()[:80]
                preview = (ix.get("content_preview") or "").strip()[:100]
                line = f"[{d}] {ix['interaction_type'].replace('_',' ')}"
                if subj:
                    line += f": {subj}"
                if preview and preview != subj:
                    line += f" — {preview}"
                ix_lines.append(line)
            parts.append("Recent interactions:\n" + "\n".join(ix_lines))

        context = "\n\n".join(parts)

        prompt = (
            f"Write a plain-text CRM summary for this contact. No headers, no markdown, no bullet points — "
            f"just 2-3 short paragraphs separated by blank lines.\n\n"
            f"Structure: If there are open action items, start with a sentence listing them specifically. "
            f"Then describe who this person is and what their relevance is to us. "
            f"Then describe the relationship history and current status.\n\n"
            f"Be direct and specific. Only mention things actually present in the data below. "
            f"Do not pad with generic phrases like 'it is recommended' or 'this contact represents'.\n\n"
            f"{context}"
        )

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        summary = message.content[0].text

        # Generate a short tagline (≤12 words) capturing who they are + key context
        tagline_msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=60,
            messages=[{"role": "user", "content": (
                f"Based on this CRM summary, write a single tagline of at most 12 words that captures "
                f"who this person is and the most important thing about our relationship. "
                f"No punctuation at the end. No quotes. Just the tagline.\n\n{summary}"
            )}],
        )
        tagline = tagline_msg.content[0].text.strip().strip('"').strip("'")

        cur.execute(
            "UPDATE contacts SET ai_summary = %s, tagline = %s, ai_summary_updated_at = NOW() WHERE contact_id = %s",
            (summary, tagline, contact_id),
        )
        conn.commit()
        logger.info("AI summary generated for contact %s", contact_id)
        return {"status": "success", "contact_id": contact_id}

    except Exception as exc:
        logger.exception("summarize_contact failed for %s", contact_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Web enrichment (Semantic Scholar + Claude knowledge)
# ---------------------------------------------------------------------------

def enrich_contact(contact_id: str) -> dict:
    """
    Enrich a contact's profile using:
    1. Semantic Scholar API — find publications by this person
    2. Claude — synthesize professional context
    """
    import anthropic

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM contacts WHERE contact_id = %s", (contact_id,))
        contact = cur.fetchone()
        if not contact:
            return {"status": "error", "error": "contact not found"}

        name = contact["name"]
        org = contact.get("organization", "")
        enrichment = dict(contact.get("enrichment_data") or {})

        # 1. Semantic Scholar paper search
        papers = []
        try:
            import requests
            s2_key = os.environ.get("S2_API_KEY", "")
            hdrs = {"x-api-key": s2_key} if s2_key else {}
            query = f"{name} {org}".strip()
            r = requests.get(
                "https://api.semanticscholar.org/graph/v1/author/search",
                params={"query": query, "fields": "name,affiliations,paperCount,citationCount,papers.title,papers.year"},
                headers=hdrs,
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                authors = data.get("data", [])
                if authors:
                    best = authors[0]
                    enrichment["s2_author_id"] = best.get("authorId")
                    enrichment["s2_paper_count"] = best.get("paperCount", 0)
                    enrichment["s2_citation_count"] = best.get("citationCount", 0)
                    recent_papers = sorted(
                        best.get("papers", []),
                        key=lambda p: p.get("year", 0),
                        reverse=True,
                    )[:5]
                    papers = [{"title": p.get("title"), "year": p.get("year")} for p in recent_papers]
                    enrichment["recent_papers"] = papers
        except Exception as exc:
            logger.warning("S2 search failed for %s: %s", name, exc)

        # 2. Claude enrichment prompt
        papers_text = ""
        if papers:
            papers_text = "\nPublications found:\n" + "\n".join(
                f"  - {p['title']} ({p['year']})" for p in papers
            )

        prompt = (
            f"You are enriching a contact record for a biotech CRM. Based on the information below, "
            f"provide a structured professional profile.\n\n"
            f"Name: {name}\n"
            f"Organization: {org or 'Unknown'}\n"
            f"Title: {contact.get('title', 'Unknown')}\n"
            f"Subject Areas: {', '.join(contact.get('subject_areas') or []) or 'Not specified'}\n"
            f"{papers_text}\n\n"
            f"Provide a JSON object with these fields (use null for unknown):\n"
            f'{{"professional_background": "2-3 sentences about expertise and role",\n'
            f' "key_expertise": ["list", "of", "expertise areas"],\n'
            f' "industry_focus": "primary industry/sector",\n'
            f' "relevance_to_biotech": "why this contact matters to a biotech focused on fungal fermentation and industrial waste streams",\n'
            f' "suggested_tags": ["up to 5 relevant tags"]}}\n\n'
            f"Return only valid JSON, no markdown code blocks."
        )

        try:
            client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )
            import json, re as _re
            _raw = message.content[0].text.strip() if message.content else ""
            _fence = _re.search(r"```(?:json)?\s*([\s\S]*?)```", _raw)
            if _fence: _raw = _fence.group(1).strip()
            if not _raw: raise ValueError("Claude returned empty response")
            claude_data = json.loads(_raw)
            enrichment.update(claude_data)

            # Auto-suggest tags if contact has none
            cur.execute("SELECT tags FROM contacts WHERE contact_id = %s", (contact_id,))
            existing = cur.fetchone()
            if existing and not (existing["tags"] or []):
                suggested = claude_data.get("suggested_tags", [])[:5]
                if suggested:
                    cur.execute(
                        "UPDATE contacts SET tags = %s WHERE contact_id = %s",
                        (suggested, contact_id),
                    )
        except Exception as exc:
            logger.warning("Claude enrichment failed for %s: %s", name, exc)

        # 3. Company profile + regulatory + incentives (second Claude call)
        try:
            company_prompt = (
                f"You are a business intelligence analyst for a biotech startup (Collective ERP) "
                f"focused on food ingredients, fermentation, and upcycling agricultural waste streams.\n\n"
                f"Research this company and contact:\n"
                f"Name: {name}\n"
                f"Organization: {org or 'Unknown'}\n"
                f"Title: {contact.get('title', 'Unknown')}\n\n"
                f"Return a JSON object with these exact fields (null if unknown, [] if none apply):\n"
                f'{{\n'
                f'  "company_location": "City, State or Country",\n'
                f'  "company_size": "estimated headcount range e.g. 50-200 employees",\n'
                f'  "company_focus": "1-2 sentence description of what the company does",\n'
                f'  "company_type": "e.g. food manufacturer, ingredient supplier, research institution, retailer, distributor",\n'
                f'  "regulatory_pressures": [\n'
                f'    "Name each specific regulation/standard that affects this company — \n'
                f'     e.g. FDA FSMA Preventive Controls, California Prop 65, USDA NOP organic, \n'
                f'     EU Novel Foods Regulation. Be specific, not generic."\n'
                f'  ],\n'
                f'  "government_incentives": [\n'
                f'    "Name each specific grant or program available to this company/sector — \n'
                f'     e.g. USDA SBIR Phase I, NSF SBIR, California Competes Tax Credit, \n'
                f'     NIFA Sustainable Ag Research. Be specific."\n'
                f'  ],\n'
                f'  "partnership_potential": "1-2 sentences on how Symbio could partner with this company"\n'
                f'}}\n\n'
                f"Base regulatory and incentive answers on the company location and industry. "
                f"Return only valid JSON, no markdown code blocks."
            )
            company_msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=700,
                messages=[{"role": "user", "content": company_prompt}],
            )
            import json as _json2
            raw2 = company_msg.content[0].text.strip()
            # Strip markdown fences if present
            import re as _re2
            fence2 = _re2.search(r"```(?:json)?\s*([\s\S]*?)```", raw2)
            if fence2:
                raw2 = fence2.group(1).strip()
            company_data = _json2.loads(raw2)
            enrichment.update(company_data)
            logger.info("Company enrichment complete for %s", name)
        except Exception as exc:
            logger.warning("Company enrichment failed for %s: %s", name, exc)

        cur.execute(
            "UPDATE contacts SET enrichment_data = %s, last_enriched_at = NOW() WHERE contact_id = %s",
            (psycopg2.extras.Json(enrichment), contact_id),
        )
        conn.commit()
        logger.info("Enrichment complete for contact %s", contact_id)
        return {"status": "success", "contact_id": contact_id, "enrichment": enrichment}

    except Exception as exc:
        logger.exception("enrich_contact failed for %s", contact_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Relationship inference from email co-occurrence
# ---------------------------------------------------------------------------

def infer_relationships_from_emails() -> dict:
    """
    Analyse email interaction metadata to infer relationships between contacts.

    Scoring per shared email:
      - Sender → direct recipient (small thread ≤3 recipients): +4
      - Sender → recipient on group email (>3 recipients):       +1
      - Co-recipients on small thread:                           +2
      - Co-recipients on group email:                            +0.5

    A pair needs a raw score ≥ 3 to create/update a relationship.
    Strength 1-5 is derived from score (capped at 5).

    relationship_type is set to 'inferred_email' so the graph can
    distinguish inferred edges from manually curated ones.
    """
    import re

    def _emails_from(val: str) -> list[str]:
        if not val:
            return []
        found = re.findall(r'<([^>]+)>|(?:^|,)\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})', val)
        return list({(a or b).strip().lower() for a, b in found if (a or b).strip()})

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Build email → contact_id lookup
        cur.execute("SELECT contact_id, email FROM contacts WHERE email IS NOT NULL AND archived = false")
        email_to_id = {row["email"].lower(): str(row["contact_id"]) for row in cur.fetchall()}

        if len(email_to_id) < 2:
            return {"status": "skipped", "reason": "fewer than 2 contacts with email"}

        # Fetch all email interactions that have metadata
        cur.execute(
            """
            SELECT contact_id, interaction_type, occurred_at, metadata
            FROM contact_interactions
            WHERE interaction_type IN ('email_sent', 'email_received')
              AND metadata IS NOT NULL
              AND metadata != '{}'::jsonb
            """
        )
        interactions = cur.fetchall()

        # co_scores[frozenset({id_a, id_b})] = float score
        from collections import defaultdict
        co_scores: dict[frozenset, float] = defaultdict(float)

        for ix in interactions:
            meta = ix["metadata"] or {}
            from_val = meta.get("from", "")
            to_val   = meta.get("to", "")
            cc_val   = meta.get("cc", "")
            is_group = meta.get("is_group_email", False)
            recip_count = meta.get("recipient_count", 1)

            # Resolve all participants in this email to contact IDs
            sender_emails = _emails_from(from_val)
            recip_emails  = _emails_from(to_val) + _emails_from(cc_val)

            sender_ids  = {email_to_id[e] for e in sender_emails if e in email_to_id}
            recip_ids   = {email_to_id[e] for e in recip_emails  if e in email_to_id}
            all_ids = sender_ids | recip_ids

            if len(all_ids) < 2:
                continue

            # Score sender→recipient pairs
            for sid in sender_ids:
                for rid in recip_ids:
                    if sid == rid:
                        continue
                    pair = frozenset({sid, rid})
                    co_scores[pair] += 1.0 if is_group else 4.0

            # Score co-recipient pairs (recipient↔recipient)
            recip_list = list(recip_ids)
            for i in range(len(recip_list)):
                for j in range(i + 1, len(recip_list)):
                    pair = frozenset({recip_list[i], recip_list[j]})
                    co_scores[pair] += 0.5 if is_group else 2.0

        # Upsert relationships for pairs above threshold
        THRESHOLD = 3.0
        created = updated = skipped = 0

        for pair, score in co_scores.items():
            if score < THRESHOLD:
                skipped += 1
                continue

            ids = list(pair)
            id_a, id_b = sorted(ids)  # canonical order
            strength = min(5, max(1, round(score / 4)))

            cur.execute(
                """
                INSERT INTO contact_relationships
                    (contact_a_id, contact_b_id, relationship_type, description, strength)
                VALUES (%s, %s, 'inferred_email', %s, %s)
                ON CONFLICT (contact_a_id, contact_b_id, relationship_type) DO UPDATE
                    SET strength    = EXCLUDED.strength,
                        description = EXCLUDED.description
                RETURNING (xmax = 0) AS inserted
                """,
                (
                    id_a, id_b,
                    f"Inferred from {round(score)} email co-occurrence points",
                    strength,
                ),
            )
            row = cur.fetchone()
            if row and row["inserted"]:
                created += 1
            else:
                updated += 1

        conn.commit()
        logger.info(
            "infer_relationships_from_emails: %d created, %d updated, %d below threshold",
            created, updated, skipped,
        )
        return {"status": "success", "created": created, "updated": updated, "skipped": skipped}

    except Exception as exc:
        logger.exception("infer_relationships_from_emails failed")
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Refresh stale AI summaries (daily)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Google Contacts bidirectional sync
# ---------------------------------------------------------------------------

def _google_person_to_dict(person: dict) -> dict:
    """Extract relevant fields from a Google People API person resource."""
    names = person.get("names", [])
    emails = person.get("emailAddresses", [])
    phones = person.get("phoneNumbers", [])
    orgs = person.get("organizations", [])

    update_time = None
    for src in person.get("metadata", {}).get("sources", []):
        ut = src.get("updateTime")
        if ut:
            update_time = ut
            break

    return {
        "name": (names[0].get("displayName") or names[0].get("unstructuredName")) if names else None,
        "email": emails[0]["value"].strip().lower() if emails else None,
        "phone": phones[0]["value"] if phones else None,
        "organization": orgs[0].get("name") if orgs else None,
        "title": orgs[0].get("title") if orgs else None,
        "resource_name": person.get("resourceName"),
        "etag": person.get("etag"),
        "google_update_time": update_time,
    }


def _contact_to_google_person(contact: dict) -> dict:
    """Convert a platform contact record to a Google People API person body."""
    person: dict = {}
    if contact.get("name"):
        person["names"] = [{"unstructuredName": contact["name"]}]
    if contact.get("email"):
        person["emailAddresses"] = [{"value": contact["email"]}]
    if contact.get("phone"):
        person["phoneNumbers"] = [{"value": contact["phone"]}]
    org: dict = {}
    if contact.get("organization"):
        org["name"] = contact["organization"]
    if contact.get("title"):
        org["title"] = contact["title"]
    if org:
        person["organizations"] = [org]
    return person


def sync_google_contacts_inbound(user_id: str) -> dict:
    """
    Pull all contacts from Google People API and sync into the platform.

    For each Google contact:
      - If a matching platform contact exists (by resource name mapping or email):
          compare updated_at timestamps; if Google is newer, update the platform record.
      - If no match exists:
          create a pending_contact record for human review.

    Uses a syncToken for incremental syncs after the first full pass.
    """
    import httpx

    conn = _conn()
    try:
        access_token = _get_valid_token(user_id, conn)
        if not access_token:
            return {"status": "skipped", "reason": "no_token"}

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT google_contacts_sync_token FROM google_oauth_tokens WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        sync_token = row["google_contacts_sync_token"] if row else None

        headers = {"Authorization": f"Bearer {access_token}"}
        person_fields = "names,emailAddresses,phoneNumbers,organizations,metadata"

        all_persons: list[dict] = []
        new_sync_token = None
        page_token = None
        full_retry = False

        while True:
            params: dict = {"personFields": person_fields, "pageSize": 200}
            if sync_token and not full_retry:
                params["syncToken"] = sync_token
            if page_token:
                params["pageToken"] = page_token

            resp = httpx.get(
                "https://people.googleapis.com/v1/people/me/connections",
                headers=headers, params=params, timeout=20,
            )

            if resp.status_code == 410:
                # syncToken expired — fall back to full sync
                sync_token = None
                full_retry = True
                page_token = None
                all_persons = []
                continue
            if resp.status_code != 200:
                return {"status": "error", "error": f"People API {resp.status_code}: {resp.text[:200]}"}

            data = resp.json()
            all_persons.extend(data.get("connections", []))
            new_sync_token = data.get("nextSyncToken", new_sync_token)
            page_token = data.get("nextPageToken")
            if not page_token:
                break

        # Load platform contacts for matching
        cur.execute(
            "SELECT contact_id, email, updated_at FROM contacts WHERE archived = false"
        )
        contacts_by_email: dict[str, dict] = {
            r["email"].lower(): {"id": r["contact_id"], "updated_at": r["updated_at"]}
            for r in cur.fetchall() if r["email"]
        }

        cur.execute(
            "SELECT contact_id, google_resource_name FROM contact_google_mappings WHERE user_id = %s",
            (user_id,),
        )
        contacts_by_resource: dict[str, str] = {
            r["google_resource_name"]: str(r["contact_id"]) for r in cur.fetchall()
        }

        updated = 0
        queued_pending = 0

        for person in all_persons:
            if person.get("metadata", {}).get("deleted"):
                continue

            gd = _google_person_to_dict(person)
            if not gd["name"] and not gd["email"]:
                continue

            # Resolve matching platform contact
            contact_id = None
            if gd["resource_name"]:
                contact_id = contacts_by_resource.get(gd["resource_name"])
            if not contact_id and gd["email"]:
                match = contacts_by_email.get(gd["email"])
                if match:
                    contact_id = str(match["id"])

            if contact_id:
                # Conflict resolution: most recently modified wins
                cur.execute(
                    "SELECT updated_at FROM contacts WHERE contact_id = %s",
                    (contact_id,),
                )
                c = cur.fetchone()
                platform_updated_at = c["updated_at"] if c else None

                google_is_newer = False
                if gd["google_update_time"] and platform_updated_at:
                    try:
                        g_dt = datetime.fromisoformat(gd["google_update_time"].replace("Z", "+00:00"))
                        p_dt = platform_updated_at if platform_updated_at.tzinfo else platform_updated_at.replace(tzinfo=timezone.utc)
                        google_is_newer = g_dt > p_dt
                    except Exception:
                        pass
                elif gd["google_update_time"] and not platform_updated_at:
                    google_is_newer = True

                if google_is_newer:
                    cols = {k: gd[k] for k in ("name", "email", "phone", "organization", "title") if gd.get(k)}
                    if cols:
                        set_clause = ", ".join(f"{k} = %s" for k in cols)
                        cur.execute(
                            f"UPDATE contacts SET {set_clause}, updated_at = NOW() WHERE contact_id = %s",
                            list(cols.values()) + [contact_id],
                        )
                        updated += 1

                # Upsert the resource name mapping
                if gd["resource_name"]:
                    cur.execute(
                        """
                        INSERT INTO contact_google_mappings
                            (contact_id, user_id, google_resource_name, google_etag, synced_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (contact_id, user_id) DO UPDATE
                            SET google_resource_name = EXCLUDED.google_resource_name,
                                google_etag           = EXCLUDED.google_etag,
                                synced_at             = NOW()
                        """,
                        (contact_id, user_id, gd["resource_name"], gd["etag"]),
                    )

            else:
                # Unknown — queue as pending (deduplicated by partial unique indexes)
                try:
                    cur.execute(
                        """
                        INSERT INTO pending_contacts
                            (source, name, email, phone, organization, title,
                             google_resource_name, google_etag, raw_data)
                        VALUES ('google_contacts', %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (
                            gd["name"], gd["email"], gd["phone"],
                            gd["organization"], gd["title"],
                            gd["resource_name"], gd["etag"],
                            psycopg2.extras.Json(person),
                        ),
                    )
                    if cur.rowcount:
                        queued_pending += 1
                except Exception:
                    pass

        if new_sync_token:
            cur.execute(
                "UPDATE google_oauth_tokens SET google_contacts_sync_token = %s, updated_at = NOW() WHERE user_id = %s",
                (new_sync_token, user_id),
            )

        conn.commit()
        logger.info(
            "Google Contacts inbound sync for user %s: %d updated, %d queued pending",
            user_id, updated, queued_pending,
        )
        return {"status": "success", "updated": updated, "queued_pending": queued_pending}

    except Exception as exc:
        logger.exception("sync_google_contacts_inbound failed for user %s", user_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


def push_contact_to_google(contact_id: str) -> dict:
    """
    Push a platform contact to Google Contacts for all users with connected accounts.
    Creates the contact if no mapping exists for a user; updates if one does.
    """
    import httpx

    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM contacts WHERE contact_id = %s AND archived = false",
            (contact_id,),
        )
        contact = cur.fetchone()
        if not contact:
            return {"status": "skipped", "reason": "not found or archived"}

        person_body = _contact_to_google_person(dict(contact))
        if not person_body:
            return {"status": "skipped", "reason": "no pushable fields"}

        cur.execute("SELECT user_id FROM google_oauth_tokens")
        users = [str(r["user_id"]) for r in cur.fetchall()]

        pushed = 0
        errors = 0

        for uid in users:
            access_token = _get_valid_token(uid, conn)
            if not access_token:
                continue

            headers = {"Authorization": f"Bearer {access_token}"}

            cur.execute(
                "SELECT google_resource_name, google_etag FROM contact_google_mappings WHERE contact_id = %s AND user_id = %s",
                (contact_id, uid),
            )
            mapping = cur.fetchone()

            try:
                if mapping:
                    body = dict(person_body)
                    body["etag"] = mapping["google_etag"]
                    resp = httpx.patch(
                        f"https://people.googleapis.com/v1/{mapping['google_resource_name']}:updateContact",
                        headers=headers,
                        params={"updatePersonFields": "names,emailAddresses,phoneNumbers,organizations"},
                        json=body,
                        timeout=15,
                    )
                    if resp.status_code == 200:
                        result = resp.json()
                        cur.execute(
                            "UPDATE contact_google_mappings SET google_etag = %s, synced_at = NOW() WHERE contact_id = %s AND user_id = %s",
                            (result.get("etag"), contact_id, uid),
                        )
                        pushed += 1
                    elif resp.status_code == 404:
                        # Stale mapping — delete and fall through to create
                        cur.execute(
                            "DELETE FROM contact_google_mappings WHERE contact_id = %s AND user_id = %s",
                            (contact_id, uid),
                        )
                        mapping = None
                    else:
                        logger.warning("Google PATCH failed for contact %s user %s: %s", contact_id, uid, resp.text[:200])
                        errors += 1

                if not mapping:
                    resp = httpx.post(
                        "https://people.googleapis.com/v1/people:createContact",
                        headers=headers,
                        json=person_body,
                        timeout=15,
                    )
                    if resp.status_code == 200:
                        result = resp.json()
                        cur.execute(
                            """
                            INSERT INTO contact_google_mappings
                                (contact_id, user_id, google_resource_name, google_etag, synced_at)
                            VALUES (%s, %s, %s, %s, NOW())
                            ON CONFLICT (contact_id, user_id) DO UPDATE
                                SET google_resource_name = EXCLUDED.google_resource_name,
                                    google_etag           = EXCLUDED.google_etag,
                                    synced_at             = NOW()
                            """,
                            (contact_id, uid, result.get("resourceName"), result.get("etag")),
                        )
                        pushed += 1
                    else:
                        logger.warning("Google POST failed for contact %s user %s: %s", contact_id, uid, resp.text[:200])
                        errors += 1

            except Exception as exc:
                logger.warning("push_contact_to_google error for user %s: %s", uid, exc)
                errors += 1

        conn.commit()
        logger.info("push_contact_to_google for %s: %d pushed, %d errors", contact_id, pushed, errors)
        return {"status": "success", "pushed": pushed, "errors": errors}

    except Exception as exc:
        logger.exception("push_contact_to_google failed for %s", contact_id)
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()


def refresh_stale_summaries() -> dict:
    """Refresh AI summaries for contacts where summary is > 7 days old."""
    conn = _conn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT contact_id FROM contacts
            WHERE archived = false
              AND (ai_summary_updated_at IS NULL OR ai_summary_updated_at < NOW() - INTERVAL '7 days')
              AND (
                  EXISTS (SELECT 1 FROM contact_interactions ci WHERE ci.contact_id = contacts.contact_id)
              )
            LIMIT 20
            """
        )
        stale = [r["contact_id"] for r in cur.fetchall()]
        refreshed = 0
        for contact_id in stale:
            result = summarize_contact(contact_id)
            if result.get("status") == "success":
                refreshed += 1
        logger.info("refresh_stale_summaries: %d summaries refreshed", refreshed)
        return {"status": "success", "refreshed": refreshed}
    except Exception as exc:
        logger.exception("refresh_stale_summaries failed")
        return {"status": "error", "error": str(exc)}
    finally:
        conn.close()
