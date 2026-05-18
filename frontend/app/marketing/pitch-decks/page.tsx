"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface PitchDeck {
  id: string;
  title: string;
  description: string;
  pdf_url: string | null;
  pdf_name: string | null;
  pptx_url: string | null;
  pptx_name: string | null;
}

// ── API ────────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`/api/proxy${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
  }
  return r.json();
}

// ── Attach File Modal ──────────────────────────────────────────────────────

function AttachModal({
  deckId,
  slot,
  slotLabel,
  onClose,
  onAttached,
}: {
  deckId: string;
  slot: "pdf" | "pptx";
  slotLabel: string;
  onClose: () => void;
  onAttached: (deck: PitchDeck) => void;
}) {
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{ name: string; web_view_link: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleResolve() {
    if (!url.trim()) return;
    setResolving(true); setError(null); setResolved(null);
    try {
      const data = await apiFetch("/marketing/pitch-decks/file/resolve", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setResolved(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not access file");
    } finally { setResolving(false); }
  }

  async function handleAttach() {
    if (!resolved) return;
    setSaving(true); setError(null);
    try {
      const deck = await apiFetch(`/marketing/pitch-decks/${deckId}/file`, {
        method: "PATCH",
        body: JSON.stringify({ slot, url: resolved.web_view_link, name: resolved.name }),
      });
      onAttached(deck);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to attach");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Attach {slotLabel}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Paste a Google Drive link to your {slotLabel} file.
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={e => { setUrl(e.target.value); setResolved(null); setError(null); }}
              onKeyDown={e => { if (e.key === "Enter") handleResolve(); }}
              placeholder="https://drive.google.com/…"
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <button
              onClick={handleResolve}
              disabled={resolving || !url.trim()}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 shrink-0"
            >
              {resolving ? "…" : "Verify"}
            </button>
          </div>

          {resolved && (
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
              <svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-green-800 dark:text-green-300 font-medium truncate flex-1">{resolved.name}</p>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              Cancel
            </button>
            <button
              onClick={handleAttach}
              disabled={!resolved || saving}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-60"
            >
              {saving ? "Attaching…" : "Attach"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File slot ──────────────────────────────────────────────────────────────

function FileSlot({
  label,
  icon,
  url,
  name,
  onAttach,
  onDetach,
}: {
  label: string;
  icon: React.ReactNode;
  url: string | null;
  name: string | null;
  onAttach: () => void;
  onDetach: () => void;
}) {
  const [confirmDetach, setConfirmDetach] = useState(false);

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="shrink-0 text-gray-400 dark:text-gray-500">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
        {url && name ? (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate block max-w-xs">
            {name}
          </a>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">Not attached</p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {url ? (
          <>
            <button onClick={onAttach}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Replace
            </button>
            {confirmDetach ? (
              <div className="flex items-center gap-1">
                <button onClick={onDetach}
                  className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Remove</button>
                <button onClick={() => setConfirmDetach(false)}
                  className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDetach(true)}
                className="p-1.5 rounded-md text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </>
        ) : (
          <button onClick={onAttach}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            Attach
          </button>
        )}
      </div>
    </div>
  );
}

// ── PDF icon ───────────────────────────────────────────────────────────────

const PdfIcon = (
  <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 2a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V8l-6-6H5zm7 1.5L18.5 9H12V3.5zM8.5 14c0-.83.67-1.5 1.5-1.5h.5v-1H10A2.5 2.5 0 007.5 14v.5A2.5 2.5 0 0010 17h.5v1H10a.5.5 0 010-1v-1H9a1.5 1.5 0 01-1.5-1.5V14zm5.5 3h-1v-4h1v4zm2-4h-1v4h1v-4z" />
  </svg>
);

const PptxIcon = (
  <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 2a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V8l-6-6H5zm7 1.5L18.5 9H12V3.5zM9 13h2.5a1.5 1.5 0 010 3H10v2H9v-5zm1 1v1h1.5a.5.5 0 000-1H10z" />
  </svg>
);

// ── Deck card ──────────────────────────────────────────────────────────────

function DeckCard({
  deckType,
  deck,
  onUpdate,
}: {
  deckType: string;
  deck: PitchDeck | undefined;
  onUpdate: (updated: PitchDeck) => void;
}) {
  const [attachSlot, setAttachSlot] = useState<"pdf" | "pptx" | null>(null);
  const [creating, setCreating] = useState(false);

  async function ensureDeck(): Promise<PitchDeck> {
    if (deck) return deck;
    setCreating(true);
    try {
      const created = await apiFetch("/marketing/pitch-decks", {
        method: "POST",
        body: JSON.stringify({ title: deckType }),
      });
      onUpdate(created);
      return created;
    } finally { setCreating(false); }
  }

  async function openAttach(slot: "pdf" | "pptx") {
    await ensureDeck();
    setAttachSlot(slot);
  }

  async function handleDetach(slot: "pdf" | "pptx") {
    if (!deck) return;
    const updated = await apiFetch(`/marketing/pitch-decks/${deck.id}/file/${slot}`, { method: "DELETE" });
    onUpdate(updated);
  }

  const hasPdf  = !!(deck?.pdf_url);
  const hasPptx = !!(deck?.pptx_url);
  const hasAny  = hasPdf || hasPptx;

  return (
    <div className={`bg-white dark:bg-gray-900 border rounded-xl overflow-hidden transition-all ${
      hasAny ? "border-gray-200 dark:border-gray-700" : "border-gray-200 dark:border-gray-700 border-dashed"
    }`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{deckType}</h2>
          {!hasAny && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">No files attached yet</p>
          )}
        </div>
        {hasAny && (
          <div className="flex items-center gap-1.5">
            {hasPdf  && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900">PDF</span>}
            {hasPptx && <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border border-orange-100 dark:border-orange-900">PPTX</span>}
          </div>
        )}
      </div>

      {/* File slots */}
      <div className="px-5 divide-y divide-gray-50 dark:divide-gray-800/60">
        <FileSlot
          label="PDF"
          icon={PdfIcon}
          url={deck?.pdf_url ?? null}
          name={deck?.pdf_name ?? null}
          onAttach={() => openAttach("pdf")}
          onDetach={() => handleDetach("pdf")}
        />
        <FileSlot
          label="PowerPoint (PPTX)"
          icon={PptxIcon}
          url={deck?.pptx_url ?? null}
          name={deck?.pptx_name ?? null}
          onAttach={() => openAttach("pptx")}
          onDetach={() => handleDetach("pptx")}
        />
      </div>

      {/* Attach modal */}
      {attachSlot && deck && (
        <AttachModal
          deckId={deck.id}
          slot={attachSlot}
          slotLabel={attachSlot === "pdf" ? "PDF" : "PowerPoint"}
          onClose={() => setAttachSlot(null)}
          onAttached={updated => { onUpdate(updated); setAttachSlot(null); }}
        />
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PitchDecksPage() {
  const [decks, setDecks] = useState<PitchDeck[]>([]);
  const [deckTypes, setDeckTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await apiFetch("/marketing/pitch-decks");
    setDecks(data.decks ?? []);
    setDeckTypes(data.deck_types ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateDeck(updated: PitchDeck) {
    setDecks(prev => {
      const exists = prev.find(d => d.id === updated.id);
      return exists ? prev.map(d => d.id === updated.id ? updated : d) : [...prev, updated];
    });
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4 pb-16">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Pitch Decks</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Attach PDF and PowerPoint versions of each deck from Google Drive.
        </p>
      </div>

      {deckTypes.map(deckType => (
        <DeckCard
          key={deckType}
          deckType={deckType}
          deck={decks.find(d => d.title === deckType)}
          onUpdate={updateDeck}
        />
      ))}
    </div>
  );
}
