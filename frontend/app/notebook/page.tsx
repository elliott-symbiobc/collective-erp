"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("@/components/notebook/RichTextEditor"), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notebook {
  notebook_id: string;
  name: string;
  color: string;
  entry_count: number;
  is_shared: boolean;
  owner_name: string | null;
}

type EntryType = "experiment" | "meeting" | "note";
type AiStatus = "none" | "processing" | "done" | "error";
type SortKey = "updated" | "created" | "title";

interface EntryStub {
  entry_id: string;
  title: string;
  entry_type: EntryType;
  notebook_id: string | null;
  notebook_name: string | null;
  notebook_color: string | null;
  is_shared: boolean;
  ai_status: AiStatus;
  updated_at: string;
  created_at: string;
  author_name: string | null;
}

interface Entry extends EntryStub {
  objective: string;
  protocol: string;
  observations: string;
  results: string;
  conclusions: string;
  body: string;
  raw_transcript: string;
  ai_summary: string;
  action_items: ActionItem[];
  decisions: Decision[];
  follow_ups: FollowUp[];
  calendar_event_title: string;
  experiment_types: string[];
  tags: string[];
  linked_protocols?: LinkedProtocol[];
  edit_history?: EditRecord[];
  collaborators?: Collaborator[];
  gdoc_url?: string;
}

interface Collaborator { user_id: string; full_name: string; email: string }
interface EditRecord { edit_id: string; fields: string[]; edited_at: string; editor_name?: string }
interface LinkedProtocol { protocol_id: string; title: string; version_label: string; linked_at: string }
interface ActionItem { title: string; description: string; assignee_hint?: string }
interface Decision { title: string; rationale?: string }
interface FollowUp { item: string; deadline?: string }
interface Attachment { attachment_id: string; original_name: string; file_size: number | null; uploaded_at: string }
interface PlatformUser { user_id: string; full_name: string; email: string }
interface NoteComment { comment_id: string; user_id: string; author_name: string; body: string; created_at: string; updated_at: string }

const EXPERIMENT_TYPES = ["Fermentation","Assay","Analysis","Protocol Development","Literature Review","Meeting Notes","Planning","Other"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s?: string) {
  if (!s) return "";
  const d = new Date(s);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = diff / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 10080) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtBytes(n: number | null) {
  if (!n) return "";
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const TYPE_COLOR: Record<string, string> = {
  note: "bg-amber-100 text-amber-700",
  meeting: "bg-purple-100 text-purple-700",
  experiment: "bg-indigo-100 text-indigo-700",
};

const TYPE_DOT: Record<string, string> = {
  note: "#f59e0b",
  meeting: "#a855f7",
  experiment: "#6366f1",
};

function TypePill({ type }: { type: EntryType }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${TYPE_COLOR[type] ?? "bg-gray-100 text-gray-500"}`}>
      {type}
    </span>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
  notebooks,
  entries,
  search,
  setSearch,
  typeFilter,
  setTypeFilter,
  sort,
  setSort,
  onSelect,
  onCreate,
  onCreateNotebook,
  onImport,
}: {
  notebooks: Notebook[];
  entries: EntryStub[];
  search: string;
  setSearch: (s: string) => void;
  typeFilter: string;
  setTypeFilter: (t: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  onSelect: (id: string) => void;
  onCreate: (type: EntryType, notebookId?: string) => void;
  onCreateNotebook: (name: string) => void;
  onImport: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newNbName, setNewNbName] = useState("");
  const [showNewNb, setShowNewNb] = useState(false);
  const [newEntryFor, setNewEntryFor] = useState<string | null>(null);
  const newEntryRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (newEntryRef.current && !newEntryRef.current.contains(e.target as Node)) setNewEntryFor(null);
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggle = (id: string) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

  const sortFn = (a: EntryStub, b: EntryStub) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "created") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  };

  const filtered = entries
    .filter(e => {
      if (typeFilter !== "all" && e.entry_type !== typeFilter) return false;
      if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort(sortFn);

  const byNotebook: Record<string, EntryStub[]> = {};
  const loose: EntryStub[] = [];
  for (const e of filtered) {
    if (e.notebook_id) {
      byNotebook[e.notebook_id] = byNotebook[e.notebook_id] || [];
      byNotebook[e.notebook_id].push(e);
    } else {
      loose.push(e);
    }
  }

  const isSearching = search.trim() || typeFilter !== "all";

  const sortLabels: Record<SortKey, string> = { updated: "Last edited", created: "Date created", title: "Title A–Z" };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b border-gray-100 bg-white space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 placeholder-gray-300 transition-all"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Sort */}
          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors bg-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
              <span className="text-xs">{sortLabels[sort]}</span>
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-40 overflow-hidden">
                {(Object.entries(sortLabels) as [SortKey, string][]).map(([k, v]) => (
                  <button key={k} onClick={() => { setSort(k); setSortOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${sort === k ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Import from Google Docs */}
          <button
            onClick={onImport}
            title="Import from Google Docs"
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors bg-white"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" opacity=".5"/><path d="M9 13h6v1H9zm0 2h6v1H9zm0-4h6v1H9z"/></svg>
            Import
          </button>

          {/* New entry */}
          <div ref={newEntryRef} className="relative">
            <button
              onClick={() => setNewEntryFor("__top__")}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
              New
            </button>
            {newEntryFor === "__top__" && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 w-44 overflow-hidden">
                {(["note","meeting","experiment"] as EntryType[]).map(t => (
                  <button key={t} onClick={() => { onCreate(t); setNewEntryFor(null); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 capitalize transition-colors">
                    <span className="w-2 h-2 rounded-full" style={{ background: TYPE_DOT[t] }} />
                    {t === "note" ? "Plain note" : t === "meeting" ? "Meeting note" : "Experiment"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Type filters */}
        <div className="flex gap-1.5">
          {["all","note","meeting","experiment"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${typeFilter === t ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"}`}>
              {t === "all" ? "All types" : t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">

        {isSearching && filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-gray-400">No notes match your search.</div>
        )}

        {/* Notebooks */}
        {notebooks.map(nb => {
          const nbEntries = byNotebook[nb.notebook_id] ?? [];
          if (isSearching && nbEntries.length === 0) return null;
          const open = !collapsed[nb.notebook_id];
          return (
            <div key={nb.notebook_id} className="mb-1">
              {/* Notebook header */}
              <div className="flex items-center gap-2 group">
                <button
                  onClick={() => toggle(nb.notebook_id)}
                  className="flex items-center gap-2 flex-1 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                >
                  <svg className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: nb.color || "#6366f1" }} />
                  <span className="text-sm font-semibold text-gray-700">{nb.name}</span>
                  <span className="text-xs text-gray-400 font-normal">
                    {isSearching ? nbEntries.length : nb.entry_count}
                  </span>
                </button>
                {/* Add to this notebook */}
                <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setNewEntryFor(newEntryFor === nb.notebook_id ? null : nb.notebook_id)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Add entry to this notebook"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  </button>
                  {newEntryFor === nb.notebook_id && (
                    <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 w-44 overflow-hidden">
                      {(["note","meeting","experiment"] as EntryType[]).map(t => (
                        <button key={t} onClick={() => { onCreate(t, nb.notebook_id); setNewEntryFor(null); }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 capitalize transition-colors">
                          <span className="w-2 h-2 rounded-full" style={{ background: TYPE_DOT[t] }} />
                          {t === "note" ? "Plain note" : t === "meeting" ? "Meeting note" : "Experiment"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Entries */}
              {open && (
                <div className="ml-5 mt-0.5 space-y-px">
                  {nbEntries.length === 0 && !isSearching && (
                    <p className="px-3 py-2 text-xs text-gray-400">Empty — add a note above.</p>
                  )}
                  {nbEntries.map(e => (
                    <EntryRow key={e.entry_id} entry={e} onSelect={onSelect} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Loose notes */}
        {(loose.length > 0 || (!isSearching)) && (
          <div className="mb-1">
            <button
              onClick={() => toggle("__loose__")}
              className="flex items-center gap-2 flex-1 w-full py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <svg className={`w-3 h-3 text-gray-400 transition-transform flex-shrink-0 ${!collapsed["__loose__"] ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-gray-300" />
              <span className="text-sm font-semibold text-gray-500">Loose notes</span>
              <span className="text-xs text-gray-400">{loose.length}</span>
            </button>
            {!collapsed["__loose__"] && (
              <div className="ml-5 mt-0.5 space-y-px">
                {loose.length === 0 && !isSearching && (
                  <p className="px-3 py-2 text-xs text-gray-400">Notes not in any notebook appear here.</p>
                )}
                {loose.map(e => (
                  <EntryRow key={e.entry_id} entry={e} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* New notebook */}
        <div className="pt-4 pb-2">
          {showNewNb ? (
            <div className="flex items-center gap-1.5 px-2">
              <input
                value={newNbName}
                onChange={e => setNewNbName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newNbName.trim()) { onCreateNotebook(newNbName.trim()); setNewNbName(""); setShowNewNb(false); }
                  if (e.key === "Escape") { setShowNewNb(false); setNewNbName(""); }
                }}
                autoFocus
                placeholder="Notebook name…"
                className="flex-1 text-sm border-b border-gray-300 focus:border-indigo-500 focus:outline-none py-1 bg-transparent text-gray-800 placeholder-gray-300"
              />
              <button onClick={() => { if (newNbName.trim()) { onCreateNotebook(newNbName.trim()); setNewNbName(""); } setShowNewNb(false); }}
                className="text-xs text-indigo-600 font-medium hover:text-indigo-800 px-1">
                Add
              </button>
              <button onClick={() => { setShowNewNb(false); setNewNbName(""); }} className="text-xs text-gray-400 hover:text-gray-600 px-1">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setShowNewNb(true)}
              className="flex items-center gap-2 px-2 py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors rounded">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              New notebook
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryRow({ entry: e, onSelect }: { entry: EntryStub; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(e.entry_id)}
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-3 group transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: TYPE_DOT[e.entry_type] ?? "#9ca3af" }} />
      <span className="flex-1 text-sm text-gray-700 truncate group-hover:text-gray-900">{e.title || "Untitled"}</span>
      <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(e.updated_at)}</span>
      {e.is_shared && (
        <svg className="w-3 h-3 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      )}
      {e.ai_status === "processing" && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />}
      {e.ai_status === "done" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
    </button>
  );
}

// ── Editor view ────────────────────────────────────────────────────────────────

function EditorView({
  entry,
  notebooks,
  platformUsers,
  onBack,
  onDelete,
  onUpdate,
}: {
  entry: Entry;
  notebooks: Notebook[];
  platformUsers: PlatformUser[];
  onBack: () => void;
  onDelete: () => void;
  onUpdate: (fields: Partial<Entry>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState<Partial<Entry>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collaboration
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabSearch, setCollabSearch] = useState("");
  const collabRef = useRef<HTMLDivElement>(null);
  const [pendingCollab, setPendingCollab] = useState<PlatformUser | null>(null);
  const [handoffMsg, setHandoffMsg] = useState("");
  const [sharingCollab, setSharingCollab] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Transcription
  const [recording, setRecording] = useState(false);
  const [transcriptLive, setTranscriptLive] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  // Misc
  const [formattingNotes, setFormattingNotes] = useState(false);
  const [exportingGdoc, setExportingGdoc] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  // Comments
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  // Notebook assign dropdown
  const [nbOpen, setNbOpen] = useState(false);
  const nbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (collabRef.current && !collabRef.current.contains(e.target as Node)) setCollabOpen(false);
      if (nbRef.current && !nbRef.current.contains(e.target as Node)) setNbOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    fetch(`/api/proxy/notebook/entries/${entry.entry_id}/attachments`)
      .then(r => r.ok ? r.json() : [])
      .then(setAttachments)
      .catch(() => {});
    fetch(`/api/proxy/notebook/entries/${entry.entry_id}/comments`)
      .then(r => r.ok ? r.json() : { comments: [] })
      .then(d => setComments(d.comments ?? []))
      .catch(() => {});
  }, [entry.entry_id]);

  const schedSave = useCallback((fields: Partial<Entry>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        if (r.ok) onUpdate(await r.json());
      } finally { setSaving(false); }
    }, 1200);
  }, [entry.entry_id, onUpdate]);

  const setField = useCallback(<K extends keyof Entry>(key: K, val: Entry[K]) => {
    setEditFields(prev => {
      const next = { ...prev, [key]: val };
      schedSave(next);
      return next;
    });
    onUpdate({ [key]: val } as Partial<Entry>);
  }, [schedSave, onUpdate]);

  const current = { ...entry, ...editFields };

  // Transcription
  const startRecording = async () => {
    try {
      const tr = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/ws-ticket`, { method: "POST" });
      if (!tr.ok) { alert("Auth failed"); return; }
      const { ticket } = await tr.json();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/notebook/entries/${entry.entry_id}/transcribe?ticket=${ticket}`);
      wsRef.current = ws;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ws.onopen = () => {
        setRecording(true); setTranscriptLive("");
        const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        mediaRef.current = mr;
        mr.ondataavailable = e => { if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
        mr.start(250);
      };
      ws.onmessage = e => {
        const d = JSON.parse(e.data);
        if (d.type === "transcript" && d.is_final) setTranscriptLive(p => p + (p ? " " : "") + d.transcript);
        if (d.type === "done") { setRecording(false); setTimeout(() => window.location.reload(), 1200); }
        if (d.type === "error") setRecording(false);
      };
      ws.onerror = ws.onclose = () => setRecording(false);
    } catch { alert("Could not access microphone."); }
  };
  const stopRecording = () => {
    if (mediaRef.current?.state !== "inactive") mediaRef.current?.stop();
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "stop" }));
    mediaRef.current?.stream?.getTracks().forEach(t => t.stop());
  };

  const addCollab = async (uid: string, message?: string) => {
    setSharingCollab(true);
    try {
      const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/collaborators`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, message: message || null }),
      });
      if (r.ok) { const d = await r.json(); onUpdate({ collaborators: d.collaborators }); }
    } finally {
      setSharingCollab(false);
      setPendingCollab(null);
      setHandoffMsg("");
      setCollabOpen(false);
      setCollabSearch("");
    }
  };
  const removeCollab = async (uid: string) => {
    const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/collaborators/${uid}`, { method: "DELETE" });
    if (r.ok) { const d = await r.json(); onUpdate({ collaborators: d.collaborators }); }
  };

  const submitComment = async () => {
    if (!commentDraft.trim()) return;
    setSubmittingComment(true);
    try {
      const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentDraft.trim() }),
      });
      if (r.ok) { const created = await r.json(); setComments(prev => [...prev, created]); setCommentDraft(""); }
    } finally { setSubmittingComment(false); }
  };

  const saveEditComment = async (commentId: string) => {
    if (!editBody.trim()) return;
    const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/comments/${commentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody.trim() }),
    });
    if (r.ok) {
      const updated = await r.json();
      setComments(prev => prev.map(c => c.comment_id === commentId ? { ...c, body: updated.body, updated_at: updated.updated_at } : c));
    }
    setEditingComment(null);
  };

  const deleteComment = async (commentId: string) => {
    if (!confirm("Delete this comment?")) return;
    const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/comments/${commentId}`, { method: "DELETE" });
    if (r.ok || r.status === 204) setComments(prev => prev.filter(c => c.comment_id !== commentId));
  };

  const exportGdoc = async () => {
    setExportingGdoc(true);
    try {
      const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/gdoc-export`, { method: "POST" });
      if (r.ok) { const d = await r.json(); onUpdate({ gdoc_url: d.gdoc_url }); window.open(d.gdoc_url, "_blank"); }
      else { const e = await r.json().catch(() => ({})); alert(e.detail || "Export failed — connect your Google account in Settings."); }
    } finally { setExportingGdoc(false); }
  };

  const formatNotes = async () => {
    setFormattingNotes(true);
    try {
      const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/format-notes`, { method: "POST" });
      if (r.ok) { const d = await r.json(); setField("body", d.formatted_body); }
    } finally { setFormattingNotes(false); }
  };

  const uploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const f = e.target.files[0];
    if (!f.name.toLowerCase().endsWith(".pdf")) { alert("PDF only"); return; }
    setUploadingPdf(true);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/attachments`, { method: "POST", body: fd });
    if (r.ok) { const a = await r.json(); setAttachments(prev => [...prev, a]); }
    setUploadingPdf(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const deleteAttachment = async (aid: string) => {
    await fetch(`/api/proxy/notebook/entries/${entry.entry_id}/attachments/${aid}`, { method: "DELETE" });
    setAttachments(prev => prev.filter(a => a.attachment_id !== aid));
  };

  const collabIds = new Set((current.collaborators ?? []).map(c => c.user_id));
  const filteredUsers = platformUsers.filter(u =>
    !collabIds.has(u.user_id) &&
    (collabSearch === "" || u.full_name.toLowerCase().includes(collabSearch.toLowerCase()) || u.email.toLowerCase().includes(collabSearch.toLowerCase()))
  );

  const isNote = current.entry_type === "note";
  const isMeeting = current.entry_type === "meeting";
  const isExperiment = current.entry_type === "experiment";

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Editor top bar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white">
        {/* Back */}
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Notes
        </button>

        <span className="text-gray-200 flex-shrink-0">|</span>

        {/* Notebook picker */}
        <div ref={nbRef} className="relative flex-shrink-0">
          <button onClick={() => setNbOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors py-1 px-2 rounded hover:bg-gray-50">
            {current.notebook_id ? (
              <>
                <span className="w-2 h-2 rounded-sm" style={{ background: notebooks.find(n => n.notebook_id === current.notebook_id)?.color || "#6366f1" }} />
                {notebooks.find(n => n.notebook_id === current.notebook_id)?.name ?? "Notebook"}
              </>
            ) : (
              <span className="text-gray-400">No notebook</span>
            )}
            <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {nbOpen && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 w-48 overflow-hidden">
              <button onClick={() => { setField("notebook_id", null as any); setNbOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${!current.notebook_id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>
                No notebook
              </button>
              {notebooks.map(nb => (
                <button key={nb.notebook_id} onClick={() => { setField("notebook_id", nb.notebook_id as any); setNbOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${current.notebook_id === nb.notebook_id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: nb.color || "#6366f1" }} />
                  {nb.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Saving indicator */}
        {saving && <span className="text-xs text-gray-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />Saving</span>}

        {/* Collaborators */}
        <div className="flex items-center gap-1">
          {(current.collaborators ?? []).map(c => (
            <div key={c.user_id} className="relative group">
              <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700 cursor-default"
                title={c.full_name}>
                {c.full_name?.charAt(0).toUpperCase()}
              </div>
              <button onClick={() => removeCollab(c.user_id)}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-100 text-red-400 hidden group-hover:flex items-center justify-center">
                <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          <div ref={collabRef} className="relative">
            <button onClick={() => { setCollabOpen(o => !o); setCollabSearch(""); }}
              className="w-6 h-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
              title="Share with someone">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            </button>
            {collabOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg w-60 overflow-hidden">
                <div className="p-2 border-b border-gray-100">
                  <input value={collabSearch} onChange={e => setCollabSearch(e.target.value)} placeholder="Search users…" autoFocus
                    className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-400 placeholder-gray-300" />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredUsers.length === 0
                    ? <p className="text-xs text-gray-400 px-3 py-2">No users found</p>
                    : filteredUsers.map(u => (
                      <button key={u.user_id} onClick={() => { setPendingCollab(u); setHandoffMsg(""); setCollabOpen(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center gap-2 transition-colors">
                        <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-semibold text-indigo-700">
                          {u.full_name?.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-800 truncate">{u.full_name}</div>
                          <div className="text-[10px] text-gray-400 truncate">{u.email}</div>
                        </div>
                      </button>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 border-l border-gray-100 pl-3 ml-1">
          {/* Google Doc */}
          <button onClick={exportGdoc} disabled={exportingGdoc} title="Export to Google Docs"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40">
            {exportingGdoc
              ? <span className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin block" />
              : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" opacity=".5"/><path d="M9 13h6v1H9zm0 2h6v1H9zm0-4h6v1H9z"/></svg>
            }
          </button>
          {current.gdoc_url && (
            <>
              <a href={current.gdoc_url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-indigo-500 hover:underline px-1">Open ↗</a>
              <span className="text-[10px] text-emerald-500 px-1" title="Changes are automatically synced to Google Docs">auto-sync on</span>
            </>
          )}

          {/* Meta toggle */}
          <button onClick={() => setShowMeta(m => !m)} title="Details"
            className={`p-1.5 rounded-lg transition-colors ${showMeta ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Delete */}
          <button onClick={onDelete} title="Delete entry"
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Editor body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 pt-8 pb-24">

          {/* Title */}
          <input
            value={current.title}
            onChange={e => setField("title", e.target.value)}
            placeholder="Untitled"
            className="w-full text-3xl font-bold text-gray-900 bg-transparent border-0 focus:outline-none placeholder-gray-200 mb-2 tracking-tight"
          />

          {/* Type + date + share pill row */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <TypePill type={current.entry_type as EntryType} />
            {current.ai_status === "processing" && <span className="text-xs text-amber-600 animate-pulse">Analyzing…</span>}
            {current.ai_status === "done" && <span className="text-xs text-emerald-600">AI done</span>}
            <span className="text-xs text-gray-400">{fmtDate(current.updated_at)}</span>
            {current.is_shared && <span className="text-xs text-indigo-500 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              Shared with team
            </span>}
          </div>

          {/* ── NOTE body ── */}
          {(isNote || isMeeting) && (
            <div className="space-y-6">
              {isMeeting && (
                <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 rounded-xl border border-violet-100">
                  <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <input value={current.calendar_event_title ?? ""} onChange={e => setField("calendar_event_title", e.target.value)}
                    placeholder="Meeting name…"
                    className="flex-1 bg-transparent border-0 focus:outline-none text-violet-900 placeholder-violet-300 text-sm font-medium" />
                </div>
              )}

              <RichTextEditor
                content={current.body ?? ""}
                onChange={html => setField("body", html)}
                placeholder="Start writing…"
                minHeight="calc(100vh - 280px)"
              />

              {isMeeting && (
                <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                  <button onClick={!recording ? startRecording : stopRecording}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${recording ? "bg-gray-800 text-white" : "bg-rose-600 text-white hover:bg-rose-700"}`}>
                    <span className={`w-2 h-2 rounded-full ${recording ? "bg-rose-400 animate-pulse" : "bg-white animate-pulse"}`} />
                    {recording ? "Stop recording" : "Record"}
                  </button>
                  <button onClick={formatNotes} disabled={formattingNotes || !current.body?.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-40 transition-colors">
                    {formattingNotes ? <><span className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />Formatting…</> : "✦ AI format"}
                  </button>
                </div>
              )}

              {isMeeting && (transcriptLive || current.raw_transcript) && (
                <div className="border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-500 bg-gray-50 max-h-40 overflow-y-auto leading-relaxed">
                  <p className="text-xs font-medium text-gray-400 mb-1.5">Transcript</p>
                  {recording ? transcriptLive || <span className="italic">Listening…</span> : current.raw_transcript}
                </div>
              )}

              {current.ai_status === "done" && current.ai_summary && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">AI Summary</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{current.ai_summary}</p>
                  {current.action_items?.length > 0 && (
                    <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Action Items</p>
                      {current.action_items.map((a, i) => (
                        <div key={i} className="flex items-start gap-2 mb-1.5">
                          <span className="mt-1 w-3.5 h-3.5 rounded border border-gray-300 flex-shrink-0" />
                          <span className="text-sm text-gray-700">{a.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── EXPERIMENT ── */}
          {isExperiment && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Experiment type</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXPERIMENT_TYPES.map(t => (
                    <button key={t} onClick={() => {
                      const cur = current.experiment_types ?? [];
                      setField("experiment_types", cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]);
                    }}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${(current.experiment_types ?? []).includes(t) ? "bg-indigo-600 text-white border-indigo-600" : "text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {([
                { key: "objective", label: "Objective", ph: "What are you testing?", rows: "120px" },
                { key: "protocol", label: "Protocol", ph: "Step-by-step method…", rows: "160px" },
                { key: "observations", label: "Observations", ph: "What did you see?", rows: "160px" },
                { key: "results", label: "Results", ph: "Quantitative outcomes…", rows: "140px" },
                { key: "conclusions", label: "Conclusions", ph: "What does it mean?", rows: "120px" },
              ] as const).map(({ key, label, ph, rows }) => (
                <div key={key}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
                  <RichTextEditor
                    content={(current[key as keyof Entry] as string) ?? ""}
                    onChange={html => setField(key as keyof Entry, html as any)}
                    placeholder={ph}
                    minHeight={rows}
                  />
                </div>
              ))}
            </div>
          )}

          {/* ── META panel ── */}
          {showMeta && (
            <div className="mt-8 pt-6 border-t border-gray-100 space-y-5">
              {/* Tags */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Tags</p>
                <input value={(current.tags ?? []).join(", ")}
                  onChange={e => setField("tags", e.target.value.split(",").map(t => t.trim()).filter(Boolean))}
                  placeholder="tag1, tag2…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-colors" />
              </div>

              {/* Share toggle */}
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={current.is_shared} onChange={e => setField("is_shared", e.target.checked)}
                  className="accent-indigo-600 w-4 h-4 cursor-pointer" />
                Shared with entire team
              </label>

              {/* Attachments */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Attachments</p>
                <input ref={fileInputRef} type="file" accept=".pdf" onChange={uploadPdf} className="hidden" />
                <div className="space-y-1.5 mb-2">
                  {attachments.map(a => (
                    <div key={a.attachment_id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                      <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z"/></svg>
                      <a href={`/api/proxy/notebook/entries/${entry.entry_id}/attachments/${a.attachment_id}`} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-sm text-indigo-700 hover:underline truncate">{a.original_name}</a>
                      {a.file_size && <span className="text-xs text-gray-400">{fmtBytes(a.file_size)}</span>}
                      <button onClick={() => deleteAttachment(a.attachment_id)} className="text-gray-300 hover:text-red-400 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploadingPdf}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1.5 transition-colors disabled:opacity-40">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  {uploadingPdf ? "Uploading…" : "Attach PDF"}
                </button>
              </div>

              {/* Edit history */}
              {(current.edit_history?.length ?? 0) > 0 && (
                <details className="group">
                  <summary className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer list-none flex items-center gap-1 select-none">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Edit history ({current.edit_history!.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4 border-l-2 border-gray-100">
                    {current.edit_history!.map(e => (
                      <li key={e.edit_id} className="text-xs text-gray-400">
                        {fmtDate(e.edited_at)}{e.editor_name ? ` · ${e.editor_name}` : ""} <span className="text-gray-300">— {e.fields.join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* ── Comments ── */}
          <div className="mt-10 pt-6 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
              Comments {comments.length > 0 && <span className="normal-case font-normal text-gray-300 ml-1">· {comments.length}</span>}
            </p>

            <div className="space-y-4 mb-5">
              {comments.map(c => (
                <div key={c.comment_id} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-semibold text-indigo-700 flex-shrink-0 mt-0.5">
                    {c.author_name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-800">{c.author_name}</span>
                      <span className="text-[10px] text-gray-400">{fmtDate(c.created_at)}</span>
                    </div>
                    {editingComment === c.comment_id ? (
                      <div className="space-y-2">
                        <textarea
                          autoFocus
                          value={editBody}
                          onChange={e => setEditBody(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => saveEditComment(c.comment_id)}
                            className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">Save</button>
                          <button onClick={() => setEditingComment(null)}
                            className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/comment">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{c.body}</p>
                        <div className="flex gap-3 mt-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingComment(c.comment_id); setEditBody(c.body); }}
                            className="text-[10px] text-gray-400 hover:text-indigo-600 transition-colors">Edit</button>
                          <button onClick={() => deleteComment(c.comment_id)}
                            className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-xs text-gray-300">No comments yet.</p>
              )}
            </div>

            {/* New comment input */}
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[11px] text-gray-400 flex-shrink-0 mt-0.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
              </div>
              <div className="flex-1 space-y-2">
                <textarea
                  value={commentDraft}
                  onChange={e => setCommentDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitComment(); }}
                  placeholder="Add a comment… (⌘↵ to submit)"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 placeholder-gray-300 resize-none transition-all"
                />
                {commentDraft.trim() && (
                  <button onClick={submitComment} disabled={submittingComment}
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                    {submittingComment ? "Posting…" : "Comment"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Handoff message modal */}
      {pendingCollab && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-semibold text-indigo-700 flex-shrink-0">
                {pendingCollab.full_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Share with {pendingCollab.full_name}</p>
                <p className="text-xs text-gray-400">{pendingCollab.email}</p>
              </div>
            </div>
            <textarea
              autoFocus
              value={handoffMsg}
              onChange={e => setHandoffMsg(e.target.value)}
              placeholder="Add a message (optional) — they'll see this in their notification…"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 placeholder-gray-300 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPendingCollab(null)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => addCollab(pendingCollab.user_id, handoffMsg)}
                disabled={sharingCollab}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {sharingCollab && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {sharingCollab ? "Sharing…" : "Share"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function NotebookPageInner() {
  useSession();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [entries, setEntries] = useState<EntryStub[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [activeEntry, setActiveEntry] = useState<Entry | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);

  // Google Docs import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importingGdoc, setImportingGdoc] = useState(false);
  const [importError, setImportError] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [nbRes, entRes] = await Promise.all([
      fetch("/api/proxy/notebook/notebooks"),
      fetch("/api/proxy/notebook/entries?limit=200&scope=all"),
    ]);
    if (nbRes.ok) setNotebooks(await nbRes.json());
    if (entRes.ok) {
      const d = await entRes.json();
      setEntries(d.entries ?? d);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    fetch("/api/proxy/notebook/platform-users").then(r => r.ok ? r.json() : []).then(setPlatformUsers).catch(() => {});
  }, []);

  // Handle ?new= param
  useEffect(() => {
    const t = searchParams.get("new") as EntryType | null;
    if (t && ["experiment","meeting","note"].includes(t)) {
      handleCreate(t);
      router.replace("/notebook");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEntry = useCallback(async (id: string) => {
    setEntryLoading(true);
    const r = await fetch(`/api/proxy/notebook/entries/${id}`);
    if (r.ok) setActiveEntry(await r.json());
    setEntryLoading(false);
  }, []);

  const handleCreate = useCallback(async (type: EntryType, notebookId?: string) => {
    const r = await fetch("/api/proxy/notebook/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry_type: type,
        title: type === "experiment" ? "New Experiment" : type === "meeting" ? "New Meeting Note" : "New Note",
        notebook_id: notebookId ?? null,
      }),
    });
    if (r.ok) {
      const created = await r.json();
      loadAll();
      openEntry(created.entry_id);
    }
  }, [loadAll, openEntry]);

  const handleCreateNotebook = useCallback(async (name: string) => {
    const r = await fetch("/api/proxy/notebook/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) loadAll();
  }, [loadAll]);

  const handleImportGdoc = useCallback(async () => {
    if (!importUrl.trim()) return;
    setImportingGdoc(true);
    setImportError("");
    try {
      const r = await fetch("/api/proxy/notebook/entries/import-gdoc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gdoc_url: importUrl.trim() }),
      });
      if (r.ok) {
        const created = await r.json();
        setShowImportModal(false);
        setImportUrl("");
        loadAll();
        openEntry(created.entry_id);
      } else {
        const e = await r.json().catch(() => ({}));
        setImportError(e.detail || "Import failed — check the URL and that Google is connected in Settings.");
      }
    } finally {
      setImportingGdoc(false);
    }
  }, [importUrl, loadAll, openEntry]);

  const handleDelete = useCallback(async () => {
    if (!activeEntry || !confirm("Delete this entry?")) return;
    await fetch(`/api/proxy/notebook/entries/${activeEntry.entry_id}`, { method: "DELETE" });
    setActiveEntry(null);
    loadAll();
  }, [activeEntry, loadAll]);

  const handleUpdate = useCallback((fields: Partial<Entry>) => {
    setActiveEntry(prev => prev ? { ...prev, ...fields } : prev);
    // Refresh stub list title/type if changed
    if (fields.title || fields.entry_type || fields.updated_at) {
      setEntries(prev => prev.map(e => e.entry_id === activeEntry?.entry_id ? { ...e, ...fields as Partial<EntryStub> } : e));
    }
  }, [activeEntry?.entry_id]);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-gray-400">Loading…</div>;
  }

  if (entryLoading) {
    return <div className="flex items-center justify-center h-full text-sm text-gray-400">Opening…</div>;
  }

  if (activeEntry) {
    return (
      <EditorView
        entry={activeEntry}
        notebooks={notebooks}
        platformUsers={platformUsers}
        onBack={() => { setActiveEntry(null); loadAll(); }}
        onDelete={handleDelete}
        onUpdate={handleUpdate}
      />
    );
  }

  return (
    <>
      <ListView
        notebooks={notebooks}
        entries={entries}
        search={search}
        setSearch={setSearch}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        sort={sort}
        setSort={setSort}
        onSelect={openEntry}
        onCreate={handleCreate}
        onCreateNotebook={handleCreateNotebook}
        onImport={() => { setImportError(""); setShowImportModal(true); }}
      />

      {/* Google Docs import modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowImportModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Import from Google Docs</h2>
              <button onClick={() => setShowImportModal(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-xs text-gray-500">Paste the URL of a Google Doc. It will be imported as a new note and linked for auto-sync.</p>
            <input
              autoFocus
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleImportGdoc()}
              placeholder="https://docs.google.com/document/d/..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 placeholder-gray-300"
            />
            {importError && <p className="text-xs text-red-500">{importError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowImportModal(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                onClick={handleImportGdoc}
                disabled={!importUrl.trim() || importingGdoc}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {importingGdoc && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {importingGdoc ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function NotebookPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-gray-400">Loading…</div>}>
      <NotebookPageInner />
    </Suspense>
  );
}
