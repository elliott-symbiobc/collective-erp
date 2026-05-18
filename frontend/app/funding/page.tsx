"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Opportunity {
  opportunity_id: string;
  title: string;
  stage: string;
  deadline: string | null;
  deadline_time: string | null;
  tags: string[];
  funding_type: string | null;
  amount: string | null;
  decision_date: string | null;
  funding_dispersion: string | null;
  source_link: string | null;
  notes: string | null;
  gcal_event_id: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at?: string | null;
}

interface AppUser {
  user_id: string;
  email: string;
  display_name: string;
}

interface EnrichResult {
  funding_type?: string | null;
  amount?: string | null;
  tags?: string[];
  notes?: string | null;
  decision_date?: string | null;
  enrichment_summary?: string;
}

interface Investor {
  investor_id: string;
  status: string;
  name: string | null;
  role: string | null;
  firm: string | null;
  firm_type: string | null;
  intro_type: string | null;
  intro_notes: string | null;
  email: string | null;
  notes: string | null;
  office_phone: string | null;
  cell_phone: string | null;
  tags: string[];
  funding_type: string | null;
  avg_check_size: string | null;
  source_link: string | null;
}

type EditingCell = { id: string; field: string; value: string } | null;
type FundingViewMode = "list" | "kanban" | "gantt";

// ── Constants ──────────────────────────────────────────────────────────────────

const STAGES = ["New", "In Progress", "Applied", "Won", "Rejected", "Withdrawn"];

const STAGE_STYLES: Record<string, string> = {
  New:          "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "In Progress":"bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Applied:      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  Won:          "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  Rejected:     "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  Withdrawn:    "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const INVESTOR_STATUSES = ["Not Started", "Need to Follow Up", "In Progress", "Committed", "Passed"];

const INVESTOR_STATUS_STYLES: Record<string, string> = {
  "Not Started":       "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  "Need to Follow Up": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  "In Progress":       "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "Committed":         "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "Passed":            "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};

const TAG_COLORS: Record<string, string> = {
  "grant":             "#16a34a",
  "pitch competition": "#7c3aed",
  "accelerator":       "#0284c7",
  "partnership":       "#d97706",
  "africa funding":    "#dc2626",
  "vc":                "#6366f1",
  "cvc":               "#0891b2",
  "angel":             "#db2777",
};

function tagColor(tag: string) {
  return TAG_COLORS[tag.toLowerCase()] ?? "#6b7280";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function isOverdue(d: string | null) {
  if (!d) return false;
  return new Date(d + "T00:00:00") < new Date();
}

function isLinkUrl(s: string | null) {
  if (!s) return false;
  return s.startsWith("http://") || s.startsWith("https://");
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => {
        const c = tagColor(tag);
        return (
          <span key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded border font-medium"
            style={{ backgroundColor: c + "22", color: c, borderColor: c + "55" }}>
            {tag}
          </span>
        );
      })}
    </div>
  );
}

// ── Inline cell editor ─────────────────────────────────────────────────────────

function InlineText({
  value,
  placeholder,
  onCommit,
  onCancel,
  className = "",
  multiline = false,
}: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  className?: string;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const base = "w-full text-xs px-1.5 py-0.5 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[80px]";

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommit((e.target as HTMLInputElement).value); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }

  if (multiline) {
    return (
      <textarea ref={ref as React.RefObject<HTMLTextAreaElement>}
        defaultValue={value} placeholder={placeholder}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={handleKey}
        rows={2}
        className={`${base} ${className} resize-none`} />
    );
  }
  return (
    <input ref={ref as React.RefObject<HTMLInputElement>}
      type="text" defaultValue={value} placeholder={placeholder}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={handleKey}
      className={`${base} ${className}`} />
  );
}

function InlineSelect({
  value,
  options,
  onCommit,
  onCancel,
}: {
  value: string;
  options: string[];
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <select ref={ref}
      defaultValue={value}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      className="text-xs px-1.5 py-0.5 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500">
      {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
    </select>
  );
}

// Wrapper that turns any cell into a click-to-edit cell
function EditableCell({
  rowId, field, editing, value, onStartEdit, onCommit, onCancel,
  display, editType = "text", selectOptions = [], placeholder, multiline = false,
  className = "",
}: {
  rowId: string;
  field: string;
  editing: EditingCell;
  value: string;
  onStartEdit: (id: string, field: string, value: string) => void;
  onCommit: (id: string, field: string, value: string) => void;
  onCancel: () => void;
  display: React.ReactNode;
  editType?: "text" | "select";
  selectOptions?: string[];
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const isEditing = editing?.id === rowId && editing?.field === field;

  if (isEditing) {
    if (editType === "select") {
      return (
        <td className={`px-4 py-2 ${className}`}>
          <InlineSelect
            value={editing!.value}
            options={selectOptions}
            onCommit={(v) => onCommit(rowId, field, v)}
            onCancel={onCancel}
          />
        </td>
      );
    }
    return (
      <td className={`px-4 py-2 ${className}`}>
        <InlineText
          value={editing!.value}
          placeholder={placeholder}
          onCommit={(v) => onCommit(rowId, field, v)}
          onCancel={onCancel}
          multiline={multiline}
        />
      </td>
    );
  }

  return (
    <td
      className={`px-4 py-2 cursor-text group/cell ${className}`}
      onClick={() => onStartEdit(rowId, field, value)}
      title="Click to edit"
    >
      <div className="relative">
        {display}
        <span className="absolute -top-0.5 -right-0.5 opacity-0 group-hover/cell:opacity-40 transition-opacity">
          <svg className="w-2.5 h-2.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15H9v-2.828z" />
          </svg>
        </span>
      </div>
    </td>
  );
}

// ── Delete confirm ─────────────────────────────────────────────────────────────

function DeleteConfirm({ title, onConfirm, onCancel }: {
  title: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <p className="text-sm text-gray-800 dark:text-gray-200 mb-1 font-medium">Delete?</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">{title}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Add Opportunity Modal ──────────────────────────────────────────────────────

const EMPTY_OPP_FORM = {
  title: "", stage: "New", deadline: "", deadline_time: "", tags: "",
  funding_type: "", amount: "", decision_date: "",
  funding_dispersion: "", source_link: "", notes: "",
};

function AddOpportunityModal({ onClose, onSaved, initialStage }: { onClose: () => void; onSaved: () => void; initialStage?: string }) {
  const [form, setForm] = useState({ ...EMPTY_OPP_FORM, stage: initialStage ?? EMPTY_OPP_FORM.stage });
  const [saving, setSaving] = useState(false);
  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    await fetch("/api/proxy/funding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(), stage: form.stage,
        deadline: form.deadline || null,
        deadline_time: form.deadline_time || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        funding_type: form.funding_type || null, amount: form.amount || null,
        decision_date: form.decision_date || null,
        funding_dispersion: form.funding_dispersion || null,
        source_link: form.source_link || null, notes: form.notes || null,
      }),
    });
    setSaving(false); onSaved(); onClose();
  }

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Add Opportunity</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} placeholder="Grant / competition name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stage</label>
              <select value={form.stage} onChange={(e) => set("stage", e.target.value)} className={inputCls}>
                {STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Funding Type</label>
              <input type="text" value={form.funding_type} onChange={(e) => set("funding_type", e.target.value)} className={inputCls} placeholder="Non-Dilutive…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Deadline</label>
              <div className="flex gap-1">
                <input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} className={inputCls} />
                <input type="time" value={form.deadline_time} onChange={(e) => set("deadline_time", e.target.value)} className={inputCls + " w-28 flex-shrink-0"} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input type="text" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={inputCls} placeholder="Up to $100K…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Decision Date</label>
              <input type="text" value={form.decision_date} onChange={(e) => set("decision_date", e.target.value)} className={inputCls} placeholder="Mid-July" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Funding Dispersion</label>
              <input type="text" value={form.funding_dispersion} onChange={(e) => set("funding_dispersion", e.target.value)} className={inputCls} placeholder="End of August…" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags (comma-separated)</label>
            <input type="text" value={form.tags} onChange={(e) => set("tags", e.target.value)} className={inputCls} placeholder="Grant, Accelerator…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link</label>
            <input type="text" value={form.source_link} onChange={(e) => set("source_link", e.target.value)} className={inputCls} placeholder="https://…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputCls} placeholder="Additional context…" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving || !form.title.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Add Opportunity"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Investor Modal ─────────────────────────────────────────────────────────

const EMPTY_INV_FORM = {
  status: "Not Started", name: "", role: "", firm: "", firm_type: "",
  intro_type: "", intro_notes: "", email: "", notes: "",
  office_phone: "", cell_phone: "", tags: "", avg_check_size: "", source_link: "",
};

function AddInvestorModal({ onClose, onSaved, initialStatus }: { onClose: () => void; onSaved: () => void; initialStatus?: string }) {
  const [form, setForm] = useState({ ...EMPTY_INV_FORM, status: initialStatus ?? EMPTY_INV_FORM.status });
  const [saving, setSaving] = useState(false);
  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function save() {
    setSaving(true);
    await fetch("/api/proxy/dilutive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: form.status,
        name: form.name || null, role: form.role || null,
        firm: form.firm || null, firm_type: form.firm_type || null,
        intro_type: form.intro_type || null, intro_notes: form.intro_notes || null,
        email: form.email || null, notes: form.notes || null,
        office_phone: form.office_phone || null, cell_phone: form.cell_phone || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        avg_check_size: form.avg_check_size || null, source_link: form.source_link || null,
      }),
    });
    setSaving(false); onSaved(); onClose();
  }

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Add Investor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {INVESTOR_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Firm Type</label>
              <input type="text" value={form.firm_type} onChange={(e) => set("firm_type", e.target.value)} className={inputCls} placeholder="VC, CVC, Angel…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Contact name" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <input type="text" value={form.role} onChange={(e) => set("role", e.target.value)} className={inputCls} placeholder="Partner, Associate…" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Firm</label>
            <input type="text" value={form.firm} onChange={(e) => set("firm", e.target.value)} className={inputCls} placeholder="Firm name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Intro Type</label>
              <select value={form.intro_type} onChange={(e) => set("intro_type", e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option>Warm</option>
                <option>Cold</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Avg. Check Size</label>
              <input type="text" value={form.avg_check_size} onChange={(e) => set("avg_check_size", e.target.value)} className={inputCls} placeholder="$500K, $1–5M…" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Intro Notes</label>
            <input type="text" value={form.intro_notes} onChange={(e) => set("intro_notes", e.target.value)} className={inputCls} placeholder="How the intro was made…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} placeholder="investor@firm.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Office Phone</label>
              <input type="text" value={form.office_phone} onChange={(e) => set("office_phone", e.target.value)} className={inputCls} placeholder="(312) 555-0100" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cell Phone</label>
              <input type="text" value={form.cell_phone} onChange={(e) => set("cell_phone", e.target.value)} className={inputCls} placeholder="(312) 555-0101" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags (comma-separated)</label>
            <input type="text" value={form.tags} onChange={(e) => set("tags", e.target.value)} className={inputCls} placeholder="VC, Agri-Food…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link</label>
            <input type="text" value={form.source_link} onChange={(e) => set("source_link", e.target.value)} className={inputCls} placeholder="https://…" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputCls} placeholder="Additional context…" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Add Investor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Gantt View ─────────────────────────────────────────────────────────────────

const G_DAY_PX = 28;
const G_ROW_H  = 40;
const G_LABEL_W = 240;

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function dateToIso(d: Date) { return d.toISOString().slice(0, 10); }

function FundingGanttView({ rows, onPatch }: {
  rows: Opportunity[];
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef   = useRef<{ id: string; type: "move" | "resize"; startX: number; origStart: number; origDue: number; rangeStartMs: number } | null>(null);
  const [preview, setPreview] = useState<Record<string, { start: number; due: number }>>({});
  const previewRef = useRef<Record<string, { start: number; due: number }>>({});
  useEffect(() => { previewRef.current = preview; }, [preview]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const { rangeStart, totalDays } = useMemo(() => {
    const ms: number[] = [today.getTime()];
    for (const r of rows) {
      if (r.deadline) ms.push(new Date(r.deadline + "T00:00:00").getTime());
    }
    const minMs = Math.min(...ms) - 14 * 86400000;
    const maxMs = Math.max(...ms) + 30 * 86400000;
    const rs = new Date(minMs); rs.setHours(0,0,0,0);
    return { rangeStart: rs, totalDays: Math.max(60, Math.ceil((maxMs - rs.getTime()) / 86400000)) };
  }, [rows, today]);

  const todayDay = useMemo(() =>
    Math.floor((today.getTime() - rangeStart.getTime()) / 86400000),
    [today, rangeStart]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (todayDay - 5) * G_DAY_PX);
  }, [todayDay]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current; if (!d) return;
      const delta = Math.round((e.clientX - d.startX) / G_DAY_PX);
      let ns = d.origStart, nd = d.origDue;
      if (d.type === "move") { ns += delta; nd += delta; }
      else { nd = Math.max(d.origStart + 1, d.origDue + delta); }
      setPreview(p => ({ ...p, [d.id]: { start: ns, due: nd } }));
    }
    function onUp() {
      const d = dragRef.current; if (!d) return;
      const p = previewRef.current[d.id];
      if (p && (p.start !== d.origStart || p.due !== d.origDue)) {
        const rs = new Date(d.rangeStartMs);
        onPatch(d.id, { deadline: dateToIso(addDays(rs, p.due)) });
      }
      dragRef.current = null;
      setPreview(p => { const n = { ...p }; if (d) delete n[d.id]; return n; });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [onPatch]);

  function getDeadlineDay(opp: Opportunity): number | null {
    const p = preview[opp.opportunity_id];
    if (p) return p.due;
    if (!opp.deadline) return null;
    const dd = new Date(opp.deadline + "T00:00:00"); dd.setHours(0,0,0,0);
    return Math.floor((dd.getTime() - rangeStart.getTime()) / 86400000);
  }

  function startDrag(e: React.PointerEvent, id: string, type: "move" | "resize", sd: number, dd: number) {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { id, type, startX: e.clientX, origStart: sd, origDue: dd, rangeStartMs: rangeStart.getTime() };
  }

  const monthHeaders = useMemo(() => {
    const result: { label: string; x: number; width: number }[] = [];
    let curr = new Date(rangeStart);
    const end = addDays(rangeStart, totalDays);
    while (curr < end) {
      const mStart = Math.floor((curr.getTime() - rangeStart.getTime()) / 86400000);
      const next = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      const mEnd = next < end ? next : end;
      result.push({
        label: curr.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        x: mStart * G_DAY_PX,
        width: Math.ceil((mEnd.getTime() - curr.getTime()) / 86400000) * G_DAY_PX,
      });
      curr = next;
    }
    return result;
  }, [rangeStart, totalDays]);

  const timelineW = totalDays * G_DAY_PX;
  const datedRows  = rows.filter(r => r.deadline !== null);
  const undatedRows = rows.filter(r => !r.deadline);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-sm text-gray-400 dark:text-gray-500">No opportunities to display.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden select-none">
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>
        <div style={{ display: "inline-block", minWidth: "100%", width: G_LABEL_W + timelineW }}>
          {/* Header */}
          <div className="flex sticky top-0 z-20 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            <div className="sticky left-0 z-30 bg-gray-50 dark:bg-gray-800/60 border-r border-gray-200 dark:border-gray-700 flex items-end pb-2 px-4"
              style={{ width: G_LABEL_W, minWidth: G_LABEL_W, height: 52 }}>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Opportunity</span>
            </div>
            <div style={{ position: "relative", width: timelineW, flexShrink: 0, height: 52 }}>
              {monthHeaders.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: m.x, width: m.width, top: 0, height: 26 }}
                  className="border-r border-gray-200 dark:border-gray-700 px-2 flex items-center">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{m.label}</span>
                </div>
              ))}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 26, display: "flex" }}>
                {Array.from({ length: totalDays }, (_, i) => {
                  const d = addDays(rangeStart, i);
                  const isToday = i === todayDay;
                  const isWknd = d.getDay() === 0 || d.getDay() === 6;
                  const show = totalDays < 90 ? true : i % 7 === 0 || d.getDate() === 1;
                  return (
                    <div key={i} style={{ width: G_DAY_PX, flexShrink: 0 }}
                      className={`border-l border-gray-100 dark:border-gray-800 flex items-center justify-center ${isWknd ? "bg-gray-50/60 dark:bg-gray-800/30" : ""}`}>
                      {show && (
                        <span className={`text-[10px] ${isToday ? "text-blue-600 font-bold" : isWknd ? "text-gray-300 dark:text-gray-600" : "text-gray-400 dark:text-gray-600"}`}>
                          {d.getDate()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Dated rows grouped by stage */}
          {STAGES.map(stage => {
            const stageRows = datedRows.filter(r => r.stage === stage);
            if (stageRows.length === 0) return null;
            return (
              <div key={stage}>
                <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40" style={{ height: 28 }}>
                  <div className="sticky left-0 z-10 bg-gray-50/80 dark:bg-gray-800/40 flex items-center px-4 gap-2"
                    style={{ width: G_LABEL_W, minWidth: G_LABEL_W }}>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STAGE_STYLES[stage] ?? "bg-gray-100 text-gray-600"}`}>{stage}</span>
                    <span className="text-[10px] text-gray-400">{stageRows.length}</span>
                  </div>
                  <div style={{ width: timelineW }} />
                </div>
                {stageRows.map(opp => {
                  const dueDay = getDeadlineDay(opp);
                  if (dueDay === null) return null;
                  const overdue = isOverdue(opp.deadline);
                  const won = opp.stage === "Won";
                  const rejected = opp.stage === "Rejected" || opp.stage === "Withdrawn";
                  const markerX = dueDay * G_DAY_PX + G_DAY_PX / 2;

                  let markerColor = "#3b82f6"; // blue
                  if (won)             markerColor = "#22c55e"; // green
                  else if (rejected)   markerColor = "#9ca3af"; // gray
                  else if (overdue)    markerColor = "#ef4444"; // red
                  else if (opp.stage === "New")         markerColor = "#a78bfa"; // violet
                  else if (opp.stage === "In Progress") markerColor = "#f59e0b"; // amber

                  const timeLabel = opp.deadline_time ? ` ${opp.deadline_time}` : "";

                  return (
                    <div key={opp.opportunity_id} className="flex border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/30 dark:hover:bg-gray-800/20 group"
                      style={{ height: G_ROW_H }}>
                      <div className="sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex items-center gap-2 px-3"
                        style={{ width: G_LABEL_W, minWidth: G_LABEL_W }}>
                        <span className={`text-xs truncate flex-1 font-medium ${rejected ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-100"}`}>
                          {opp.title}
                        </span>
                        {opp.deadline && (
                          <span className={`text-[10px] flex-shrink-0 font-medium ${overdue && !rejected ? "text-red-500" : "text-gray-400"}`}>
                            {fmtDate(opp.deadline)}{timeLabel}
                          </span>
                        )}
                      </div>
                      <div style={{ position: "relative", width: timelineW, flexShrink: 0 }}>
                        {/* Today line */}
                        <div style={{ position: "absolute", left: todayDay * G_DAY_PX, top: 0, bottom: 0, width: 1, zIndex: 1, pointerEvents: "none" }}
                          className="bg-blue-400/50" />
                        {/* Weekend shading */}
                        {Array.from({ length: totalDays }, (_, i) => {
                          const d = addDays(rangeStart, i);
                          if (d.getDay() !== 0 && d.getDay() !== 6) return null;
                          return <div key={i} style={{ position: "absolute", left: i * G_DAY_PX, top: 0, bottom: 0, width: G_DAY_PX, pointerEvents: "none" }}
                            className="bg-gray-50/50 dark:bg-gray-800/20" />;
                        })}
                        {/* Deadline marker — draggable vertical pin */}
                        <div
                          style={{ position: "absolute", left: markerX - 1, top: 0, bottom: 0, width: 2, zIndex: 2, cursor: "grab", background: markerColor + "60" }}
                          onPointerDown={e => startDrag(e, opp.opportunity_id, "move", dueDay, dueDay)}
                        />
                        {/* Diamond marker at deadline */}
                        <div
                          style={{
                            position: "absolute",
                            left: markerX - 7,
                            top: G_ROW_H / 2 - 7,
                            width: 14, height: 14,
                            background: markerColor,
                            transform: "rotate(45deg)",
                            zIndex: 3,
                            cursor: "grab",
                            borderRadius: 2,
                          }}
                          title={`${opp.title} — ${opp.deadline}${timeLabel}`}
                          onPointerDown={e => startDrag(e, opp.opportunity_id, "move", dueDay, dueDay)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Undated rows */}
          {undatedRows.length > 0 && (
            <>
              <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40" style={{ height: 28 }}>
                <div className="sticky left-0 z-10 bg-gray-50/80 dark:bg-gray-800/40 flex items-center px-4"
                  style={{ width: G_LABEL_W, minWidth: G_LABEL_W }}>
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">No deadline</span>
                </div>
                <div style={{ width: timelineW }} />
              </div>
              {undatedRows.map(opp => (
                <div key={opp.opportunity_id} className="flex border-b border-gray-100 dark:border-gray-800" style={{ height: G_ROW_H }}>
                  <div className="sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex items-center gap-2 px-3"
                    style={{ width: G_LABEL_W, minWidth: G_LABEL_W }}>
                    <span className="text-xs truncate text-gray-500 dark:text-gray-400">{opp.title}</span>
                  </div>
                  <div style={{ width: timelineW }} className="flex items-center px-4">
                    <span className="text-xs text-gray-400 italic">Set a deadline to appear on chart</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Kanban column configs ──────────────────────────────────────────────────────

const NONDIL_KANBAN_COLS = [
  { id: "New",         label: "New",         dot: "bg-violet-400", headerCls: "bg-violet-50 dark:bg-violet-950/30" },
  { id: "In Progress", label: "In Progress",  dot: "bg-amber-500",  headerCls: "bg-amber-50 dark:bg-amber-950/30" },
  { id: "Applied",     label: "Applied",      dot: "bg-blue-500",   headerCls: "bg-blue-50 dark:bg-blue-950/30" },
  { id: "Won",         label: "Won",          dot: "bg-green-500",  headerCls: "bg-green-50 dark:bg-green-950/30" },
  { id: "Rejected",    label: "Rejected",     dot: "bg-red-500",    headerCls: "bg-red-50 dark:bg-red-950/30" },
  { id: "Withdrawn",   label: "Not Applied",  dot: "bg-gray-400",   headerCls: "bg-gray-50 dark:bg-gray-800/60" },
];

const DILUTIVE_KANBAN_COLS = [
  { id: "Not Started",       label: "Not Started",    dot: "bg-gray-400",   headerCls: "bg-gray-50 dark:bg-gray-800/60" },
  { id: "Need to Follow Up", label: "Follow Up",      dot: "bg-amber-500",  headerCls: "bg-amber-50 dark:bg-amber-950/30" },
  { id: "In Progress",       label: "In Progress",    dot: "bg-blue-500",   headerCls: "bg-blue-50 dark:bg-blue-950/30" },
  { id: "Committed",         label: "Committed",      dot: "bg-green-500",  headerCls: "bg-green-50 dark:bg-green-950/30" },
  { id: "Passed",            label: "Passed",         dot: "bg-red-500",    headerCls: "bg-red-50 dark:bg-red-950/30" },
];

// ── View toggle ────────────────────────────────────────────────────────────────

function ViewToggle({ mode, onChange, showGantt = true }: { mode: FundingViewMode; onChange: (m: FundingViewMode) => void; showGantt?: boolean }) {
  const views = (showGantt ? ["list", "kanban", "gantt"] : ["list", "kanban"]) as FundingViewMode[];
  const icons: Record<FundingViewMode, React.ReactNode> = {
    list: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
    kanban: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10m0-10a2 2 0 012 2h2a2 2 0 012-2V7" />
      </svg>
    ),
    gantt: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h8M3 10h14M3 14h6M3 18h10" />
      </svg>
    ),
  };
  return (
    <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {views.map((m) => (
        <button key={m} onClick={() => onChange(m)} title={`${m.charAt(0).toUpperCase() + m.slice(1)} view`}
          className={`px-2.5 py-1.5 transition-colors ${
            mode === m ? "bg-blue-600 text-white" : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          }`}>
          {icons[m]}
        </button>
      ))}
    </div>
  );
}

// ── Edit Opportunity Modal ─────────────────────────────────────────────────────

function EditOpportunityModal({ opp, onClose, onSaved, onDelete }: {
  opp: Opportunity; onClose: () => void; onSaved: () => void; onDelete: () => void;
}) {
  const [form, setForm] = useState({
    title: opp.title, stage: opp.stage,
    deadline: opp.deadline ?? "", deadline_time: opp.deadline_time ?? "",
    tags: opp.tags.join(", "),
    funding_type: opp.funding_type ?? "", amount: opp.amount ?? "",
    decision_date: opp.decision_date ?? "", funding_dispersion: opp.funding_dispersion ?? "",
    source_link: opp.source_link ?? "", notes: opp.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    await fetch(`/api/proxy/funding/${opp.opportunity_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(), stage: form.stage,
        deadline: form.deadline || null,
        deadline_time: form.deadline_time || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        funding_type: form.funding_type || null, amount: form.amount || null,
        decision_date: form.decision_date || null,
        funding_dispersion: form.funding_dispersion || null,
        source_link: form.source_link || null, notes: form.notes || null,
      }),
    });
    setSaving(false); onSaved(); onClose();
  }

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Edit Opportunity</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirmDelete(true)} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Delete">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title *</label>
            <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stage</label>
              <select value={form.stage} onChange={(e) => set("stage", e.target.value)} className={inputCls}>
                {STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Funding Type</label>
              <input type="text" value={form.funding_type} onChange={(e) => set("funding_type", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Deadline</label>
              <input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Amount</label>
              <input type="text" value={form.amount} onChange={(e) => set("amount", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Decision Date</label>
              <input type="text" value={form.decision_date} onChange={(e) => set("decision_date", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Funding Dispersion</label>
              <input type="text" value={form.funding_dispersion} onChange={(e) => set("funding_dispersion", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags (comma-separated)</label>
            <input type="text" value={form.tags} onChange={(e) => set("tags", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link</label>
            <input type="text" value={form.source_link} onChange={(e) => set("source_link", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputCls} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving || !form.title.trim()}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <DeleteConfirm title={form.title} onConfirm={onDelete} onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}

// ── Edit Investor Modal ────────────────────────────────────────────────────────

function EditInvestorModal({ inv, onClose, onSaved, onDelete }: {
  inv: Investor; onClose: () => void; onSaved: () => void; onDelete: () => void;
}) {
  const [form, setForm] = useState({
    status: inv.status, name: inv.name ?? "", role: inv.role ?? "",
    firm: inv.firm ?? "", firm_type: inv.firm_type ?? "",
    intro_type: inv.intro_type ?? "", intro_notes: inv.intro_notes ?? "",
    email: inv.email ?? "", notes: inv.notes ?? "",
    office_phone: inv.office_phone ?? "", cell_phone: inv.cell_phone ?? "",
    tags: inv.tags.join(", "), avg_check_size: inv.avg_check_size ?? "",
    source_link: inv.source_link ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function save() {
    setSaving(true);
    await fetch(`/api/proxy/dilutive/${inv.investor_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: form.status, name: form.name || null, role: form.role || null,
        firm: form.firm || null, firm_type: form.firm_type || null,
        intro_type: form.intro_type || null, intro_notes: form.intro_notes || null,
        email: form.email || null, notes: form.notes || null,
        office_phone: form.office_phone || null, cell_phone: form.cell_phone || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        avg_check_size: form.avg_check_size || null, source_link: form.source_link || null,
      }),
    });
    setSaving(false); onSaved(); onClose();
  }

  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Edit Investor</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirmDelete(true)} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Delete">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {INVESTOR_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Firm Type</label>
              <input type="text" value={form.firm_type} onChange={(e) => set("firm_type", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <input type="text" value={form.role} onChange={(e) => set("role", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Firm</label>
            <input type="text" value={form.firm} onChange={(e) => set("firm", e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Intro Type</label>
              <select value={form.intro_type} onChange={(e) => set("intro_type", e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option>Warm</option>
                <option>Cold</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Avg. Check Size</label>
              <input type="text" value={form.avg_check_size} onChange={(e) => set("avg_check_size", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Intro Notes</label>
            <input type="text" value={form.intro_notes} onChange={(e) => set("intro_notes", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Office Phone</label>
              <input type="text" value={form.office_phone} onChange={(e) => set("office_phone", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Cell Phone</label>
              <input type="text" value={form.cell_phone} onChange={(e) => set("cell_phone", e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tags (comma-separated)</label>
            <input type="text" value={form.tags} onChange={(e) => set("tags", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Link</label>
            <input type="text" value={form.source_link} onChange={(e) => set("source_link", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={inputCls} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <DeleteConfirm
          title={`${inv.name ?? "Investor"}${inv.firm ? ` @ ${inv.firm}` : ""}`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ── Funding Attachments ────────────────────────────────────────────────────────

interface FundingAttachment {
  id: string;
  type: "drive" | "email";
  external_id: string;
  title: string;
  url: string | null;
  mime_type: string | null;
  attached_at: string;
}

interface DriveResult {
  id: string; title: string; mime_type: string | null; url: string | null; label: string; modified: string | null;
}
interface EmailResult {
  id: string; title: string; from_: string; date: string; snippet: string; url: string;
}

// ── Custom Select ─────────────────────────────────────────────────────────────

interface SelectOption { value: string; label: string; dot?: string; }

function CustomSelect({ value, onChange, options, placeholder = "Select…", className = "" }: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.dot && (
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${selected.dot}`} />
          )}
          <span className={`truncate ${!selected ? "text-gray-400" : ""}`}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <svg className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {placeholder && !options.find(o => o.value === "") && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-left"
            >
              {placeholder}
            </button>
          )}
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
                opt.value === value
                  ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60"
              }`}
            >
              {opt.dot && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${opt.dot}`} />}
              {opt.label}
              {opt.value === value && (
                <svg className="ml-auto w-3.5 h-3.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentsSection({ opportunityId }: { opportunityId: string }) {
  const [attachments, setAttachments] = useState<FundingAttachment[]>([]);
  const [tab, setTab] = useState<"drive" | "email">("drive");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [driveResults, setDriveResults] = useState<DriveResult[]>([]);
  const [emailResults, setEmailResults] = useState<EmailResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/proxy/funding/${opportunityId}/attachments`)
      .then(r => r.json()).then(setAttachments).catch(() => {});
  }, [opportunityId]);

  async function search() {
    if (!query.trim()) return;
    setSearching(true); setSearchError(null);
    setDriveResults([]); setEmailResults([]);
    try {
      const url = tab === "drive"
        ? `/api/proxy/funding/drive/search?q=${encodeURIComponent(query)}`
        : `/api/proxy/funding/email/search?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        if (e.detail === "google_not_connected") setSearchError("Google not connected. Connect in Settings.");
        else setSearchError("Search failed.");
        return;
      }
      const data = await resp.json();
      if (tab === "drive") setDriveResults(data);
      else setEmailResults(data);
    } finally {
      setSearching(false);
    }
  }

  async function attach(item: { id: string; title: string; url: string | null; mime_type?: string | null }) {
    setAttaching(p => new Set(p).add(item.id));
    try {
      const resp = await fetch(`/api/proxy/funding/${opportunityId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: tab,
          external_id: item.id,
          title: item.title,
          url: item.url,
          mime_type: item.mime_type ?? null,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (!data.already_attached && data.id) {
          setAttachments(prev => [{
            id: data.id, type: tab, external_id: item.id,
            title: item.title, url: item.url ?? null, mime_type: item.mime_type ?? null,
            attached_at: new Date().toISOString(),
          }, ...prev]);
        }
      }
    } finally {
      setAttaching(p => { const n = new Set(p); n.delete(item.id); return n; });
    }
  }

  async function detach(att: FundingAttachment) {
    await fetch(`/api/proxy/funding/${opportunityId}/attachments/${att.id}`, { method: "DELETE" });
    setAttachments(prev => prev.filter(a => a.id !== att.id));
  }

  const attachedIds = new Set(attachments.map(a => a.external_id));

  const mimeIcon: Record<string, string> = {
    "application/vnd.google-apps.document":     "📄",
    "application/vnd.google-apps.spreadsheet":  "📊",
    "application/vnd.google-apps.presentation": "📑",
    "application/pdf":                          "📕",
  };

  return (
    <div className="space-y-3">
      {/* Current attachments */}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60 group">
              <span className="text-sm">{att.type === "email" ? "✉️" : mimeIcon[att.mime_type ?? ""] ?? "🗂️"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{att.title}</p>
                <p className="text-[10px] text-gray-400">{att.type === "drive" ? "Drive" : "Email"} · {new Date(att.attached_at).toLocaleDateString()}</p>
              </div>
              {att.url && (
                <a href={att.url} target="_blank" rel="noopener noreferrer"
                  className="text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0" title="Open">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
              <button onClick={() => detach(att)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                title="Remove attachment">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search section */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
          {(["drive", "email"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setDriveResults([]); setEmailResults([]); setSearchError(null); }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${tab === t ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
              {t === "drive" ? "🗂️ Drive" : "✉️ Email"}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="p-2 flex gap-1.5">
          <input
            className="flex-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            placeholder={tab === "drive" ? "Search Drive files…" : "Search emails…"}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") search(); }}
          />
          <button onClick={search} disabled={searching || !query.trim()}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
            {searching ? "…" : "Search"}
          </button>
        </div>

        {searchError && <p className="px-3 pb-2 text-xs text-red-500">{searchError}</p>}

        {/* Drive results */}
        {tab === "drive" && driveResults.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-48 overflow-y-auto">
            {driveResults.map(f => (
              <div key={f.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <span className="text-sm flex-shrink-0">{mimeIcon[f.mime_type ?? ""] ?? "🗂️"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{f.title}</p>
                  <p className="text-[10px] text-gray-400">{f.label}{f.modified ? ` · ${new Date(f.modified).toLocaleDateString()}` : ""}</p>
                </div>
                <button
                  onClick={() => attach({ id: f.id, title: f.title, url: f.url, mime_type: f.mime_type })}
                  disabled={attachedIds.has(f.id) || attaching.has(f.id)}
                  className="flex-shrink-0 text-xs px-2 py-1 rounded-md font-medium transition-colors disabled:opacity-50 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60">
                  {attachedIds.has(f.id) ? "Attached" : attaching.has(f.id) ? "…" : "Attach"}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Email results */}
        {tab === "email" && emailResults.length > 0 && (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-48 overflow-y-auto">
            {emailResults.map(e => (
              <div key={e.id} className="flex items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40">
                <span className="text-sm flex-shrink-0 mt-0.5">✉️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{e.title}</p>
                  <p className="text-[10px] text-gray-400 truncate">{e.from_}</p>
                  {e.snippet && <p className="text-[10px] text-gray-400 truncate">{e.snippet}</p>}
                </div>
                <button
                  onClick={() => attach({ id: e.id, title: e.title, url: e.url, mime_type: "email" })}
                  disabled={attachedIds.has(e.id) || attaching.has(e.id)}
                  className="flex-shrink-0 text-xs px-2 py-1 rounded-md font-medium transition-colors disabled:opacity-50 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60">
                  {attachedIds.has(e.id) ? "Attached" : attaching.has(e.id) ? "…" : "Attach"}
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "drive" && driveResults.length === 0 && !searching && !searchError && query && (
          <p className="px-3 pb-3 text-xs text-gray-400 italic">No Drive files found.</p>
        )}
        {tab === "email" && emailResults.length === 0 && !searching && !searchError && query && (
          <p className="px-3 pb-3 text-xs text-gray-400 italic">No emails found.</p>
        )}
      </div>
    </div>
  );
}

// ── Opportunity Detail Panel ───────────────────────────────────────────────────

function OpportunityDetailPanel({ opp, onClose, onSaved, onDelete }: {
  opp: Opportunity; onClose: () => void; onSaved: () => void; onDelete: () => void;
}) {
  const [form, setForm] = useState({
    title: opp.title, stage: opp.stage,
    deadline: opp.deadline ?? "", deadline_time: opp.deadline_time ?? "",
    tags: opp.tags.join(", "),
    funding_type: opp.funding_type ?? "", amount: opp.amount ?? "",
    decision_date: opp.decision_date ?? "", funding_dispersion: opp.funding_dispersion ?? "",
    source_link: opp.source_link ?? "", notes: opp.notes ?? "",
    assignee_id: opp.assignee_id ?? "",
  });
  const [gcalEventId, setGcalEventId] = useState(opp.gcal_event_id ?? null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);

  // User list for assignee picker
  const [users, setUsers] = useState<AppUser[]>([]);
  useEffect(() => {
    fetch("/api/proxy/funding/users").then(r => r.json()).then(setUsers).catch(() => {});
  }, []);

  // AI enrichment state
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); setDirty(true); }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    await fetch(`/api/proxy/funding/${opp.opportunity_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(), stage: form.stage,
        deadline: form.deadline || null,
        deadline_time: form.deadline_time || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        funding_type: form.funding_type || null, amount: form.amount || null,
        decision_date: form.decision_date || null,
        funding_dispersion: form.funding_dispersion || null,
        source_link: form.source_link || null, notes: form.notes || null,
        assignee_id: form.assignee_id || null,
      }),
    });
    setSaving(false); setDirty(false); onSaved();
  }

  async function runEnrich() {
    setEnriching(true); setEnrichResult(null); setEnrichError(null);
    try {
      const resp = await fetch(`/api/proxy/funding/${opp.opportunity_id}/enrich`, { method: "POST" });
      if (!resp.ok) { setEnrichError("Enrichment failed. Try again."); return; }
      const data: EnrichResult = await resp.json();
      setEnrichResult(data);
    } finally {
      setEnriching(false);
    }
  }

  function applyEnrichField(field: keyof typeof form, value: string) {
    set(field, value);
  }

  function applyAllEnrich() {
    if (!enrichResult) return;
    if (enrichResult.funding_type) set("funding_type", enrichResult.funding_type);
    if (enrichResult.amount) set("amount", enrichResult.amount);
    if (enrichResult.tags?.length) set("tags", enrichResult.tags.join(", "));
    if (enrichResult.notes) set("notes", enrichResult.notes);
    if (enrichResult.decision_date) set("decision_date", enrichResult.decision_date);
    setEnrichResult(null);
  }

  async function syncToCalendar() {
    if (!form.deadline) { setSyncError("Set a deadline date first."); return; }
    setSyncing(true); setSyncError(null);
    try {
      const time = form.deadline_time || "09:00";
      const [hh, mm] = time.split(":");
      const endH = String(Math.min(23, parseInt(hh) + 1)).padStart(2, "0");
      const startDt = `${form.deadline}T${hh}:${mm}:00`;
      const endDt   = `${form.deadline}T${endH}:${mm}:00`;

      const calBody = {
        title: `Funding Deadline: ${form.title}`,
        description: `Stage: ${form.stage}${form.amount ? `\nAmount: ${form.amount}` : ""}${form.notes ? `\n\n${form.notes}` : ""}`,
        start: startDt, end: endDt, timezone: "UTC",
      };

      const url = gcalEventId
        ? `/api/proxy/calendar/events/${gcalEventId}`
        : `/api/proxy/calendar/events`;
      const method = gcalEventId ? "PATCH" : "POST";

      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calBody),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (err.detail === "google_not_connected") {
          setSyncError("Google Calendar not connected. Connect in Settings.");
        } else {
          setSyncError("Calendar sync failed. Try again.");
        }
        return;
      }

      const data = await resp.json();
      const newEventId = data.id as string;
      setGcalEventId(newEventId);

      // Persist event ID to the opportunity
      await fetch(`/api/proxy/funding/${opp.opportunity_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gcal_event_id: newEventId }),
      });
    } finally {
      setSyncing(false);
    }
  }

  const stageCol = NONDIL_KANBAN_COLS.find(c => c.id === form.stage);
  const inputCls = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";
  const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" />
      {/* Panel */}
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 h-full overflow-y-auto shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div className="flex-1 min-w-0 pr-4">
            <input
              className="w-full text-xl font-bold text-gray-900 dark:text-gray-50 bg-transparent border-0 outline-none focus:bg-gray-50 dark:focus:bg-gray-800 rounded-lg px-1 -mx-1 py-0.5 transition-colors"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              placeholder="Opportunity title"
            />
            {stageCol && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className={`w-2 h-2 rounded-full ${stageCol.dot}`} />
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{form.stage}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={runEnrich} disabled={enriching}
              title="Auto-enrich with AI"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50 transition-colors">
              {enriching
                ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full" />Enriching…</>
                : <><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>Enrich</>
              }
            </button>
            {dirty && (
              <button onClick={save} disabled={saving}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                {saving ? "Saving…" : "Save"}
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30" title="Delete">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 space-y-6">

          {/* AI Enrichment result */}
          {enrichError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
              {enrichError}
              <button onClick={() => setEnrichError(null)} className="ml-2 hover:text-red-800">✕</button>
            </div>
          )}
          {enrichResult && (
            <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                  <span className="text-xs font-semibold text-violet-800 dark:text-violet-300">AI Enrichment</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={applyAllEnrich} className="text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium">Apply All</button>
                  <button onClick={() => setEnrichResult(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 rounded">Dismiss</button>
                </div>
              </div>
              {enrichResult.enrichment_summary && (
                <p className="text-xs text-violet-700 dark:text-violet-400 italic">{enrichResult.enrichment_summary}</p>
              )}
              <div className="space-y-2">
                {enrichResult.funding_type && (
                  <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-violet-100 dark:border-violet-900">
                    <div><p className="text-[10px] text-gray-400 uppercase tracking-wide">Funding Type</p><p className="text-xs font-medium text-gray-800 dark:text-gray-200">{enrichResult.funding_type}</p></div>
                    <button onClick={() => applyEnrichField("funding_type", enrichResult.funding_type!)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">Apply</button>
                  </div>
                )}
                {enrichResult.amount && (
                  <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-violet-100 dark:border-violet-900">
                    <div><p className="text-[10px] text-gray-400 uppercase tracking-wide">Amount</p><p className="text-xs font-medium text-gray-800 dark:text-gray-200">{enrichResult.amount}</p></div>
                    <button onClick={() => applyEnrichField("amount", enrichResult.amount!)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">Apply</button>
                  </div>
                )}
                {enrichResult.tags?.length ? (
                  <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-violet-100 dark:border-violet-900">
                    <div><p className="text-[10px] text-gray-400 uppercase tracking-wide">Tags</p><p className="text-xs font-medium text-gray-800 dark:text-gray-200">{enrichResult.tags.join(", ")}</p></div>
                    <button onClick={() => applyEnrichField("tags", enrichResult.tags!.join(", "))} className="text-xs text-violet-600 hover:text-violet-800 font-medium">Apply</button>
                  </div>
                ) : null}
                {enrichResult.decision_date && (
                  <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-violet-100 dark:border-violet-900">
                    <div><p className="text-[10px] text-gray-400 uppercase tracking-wide">Decision Date</p><p className="text-xs font-medium text-gray-800 dark:text-gray-200">{enrichResult.decision_date}</p></div>
                    <button onClick={() => applyEnrichField("decision_date", enrichResult.decision_date!)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">Apply</button>
                  </div>
                )}
                {enrichResult.notes && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-violet-100 dark:border-violet-900">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Notes</p>
                      <button onClick={() => applyEnrichField("notes", enrichResult.notes!)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">Apply</button>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{enrichResult.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Stage + Funding type + Assignee */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Stage</label>
              <CustomSelect
                value={form.stage}
                onChange={v => set("stage", v)}
                options={NONDIL_KANBAN_COLS.map(c => ({ value: c.id, label: c.label, dot: c.dot }))}
              />
            </div>
            <div>
              <label className={labelCls}>Funding Type</label>
              <input type="text" value={form.funding_type} onChange={e => set("funding_type", e.target.value)} className={inputCls} placeholder="e.g. SBIR, Grant, VC…" />
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className={labelCls}>Assigned To</label>
            <CustomSelect
              value={form.assignee_id}
              onChange={v => set("assignee_id", v)}
              placeholder="— Unassigned —"
              options={users.map(u => ({ value: u.user_id, label: u.display_name }))}
            />
          </div>

          {/* Amount + Dispersion */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Amount</label>
              <input type="text" value={form.amount} onChange={e => set("amount", e.target.value)} className={inputCls} placeholder="e.g. $250,000" />
            </div>
            <div>
              <label className={labelCls}>Funding Dispersion</label>
              <input type="text" value={form.funding_dispersion} onChange={e => set("funding_dispersion", e.target.value)} className={inputCls} placeholder="e.g. Lump sum, Milestone…" />
            </div>
          </div>

          {/* Deadline date + time + GCal sync */}
          <div>
            <label className={labelCls}>Deadline</label>
            <div className="flex gap-2 items-start">
              <input type="date" value={form.deadline} onChange={e => set("deadline", e.target.value)}
                className={inputCls + " flex-1"} />
              <input type="time" value={form.deadline_time} onChange={e => set("deadline_time", e.target.value)}
                className={inputCls + " w-36"} />
              <button
                onClick={syncToCalendar}
                disabled={syncing || !form.deadline}
                title={gcalEventId ? "Update Google Calendar event" : "Add to Google Calendar"}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                  gcalEventId
                    ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                } disabled:opacity-50`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.5 3h-2V1.5A1.5 1.5 0 0016 0h-1a1.5 1.5 0 00-1.5 1.5V3h-7V1.5A1.5 1.5 0 005 0H4a1.5 1.5 0 00-1.5 1.5V3h-2A.5.5 0 000 3.5v17A3.5 3.5 0 003.5 24h17a3.5 3.5 0 003.5-3.5v-17a.5.5 0 00-.5-.5zm-1 17.5a2.5 2.5 0 01-2.5 2.5h-12A2.5 2.5 0 011.5 20.5V8h18v12.5z"/>
                </svg>
                {syncing ? "Syncing…" : gcalEventId ? "Synced" : "Add to Cal"}
              </button>
            </div>
            {syncError && <p className="text-xs text-red-500 mt-1">{syncError}</p>}
          </div>

          {/* Decision date */}
          <div>
            <label className={labelCls}>Decision Date</label>
            <input type="text" value={form.decision_date} onChange={e => set("decision_date", e.target.value)} className={inputCls} placeholder="e.g. 2025-06-01" />
          </div>

          {/* Tags */}
          <div>
            <label className={labelCls}>Tags <span className="font-normal">(comma-separated)</span></label>
            <input type="text" value={form.tags} onChange={e => set("tags", e.target.value)} className={inputCls} placeholder="federal, biotech, phase-1…" />
          </div>

          {/* Source link */}
          <div>
            <label className={labelCls}>Link</label>
            <input type="url" value={form.source_link} onChange={e => set("source_link", e.target.value)} className={inputCls} placeholder="https://…" />
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={6} className={inputCls} placeholder="Any context, requirements, contacts…" />
          </div>

          {/* Attachments */}
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
            <label className={labelCls + " mb-2"}>Attachments</label>
            <AttachmentsSection opportunityId={opp.opportunity_id} />
          </div>

          {/* Meta */}
          <div className="text-[11px] text-gray-400 dark:text-gray-600 space-y-0.5 pt-2 border-t border-gray-100 dark:border-gray-800">
            <p>ID: {opp.opportunity_id}</p>
            {gcalEventId && <p className="text-green-600 dark:text-green-500">Google Calendar event linked</p>}
            {opp.created_at && <p>Created: {new Date(opp.created_at).toLocaleDateString()}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            {dirty ? "Discard" : "Close"}
          </button>
          <button onClick={save} disabled={saving || !form.title.trim() || !dirty}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <DeleteConfirm title={form.title} onConfirm={onDelete} onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}

// ── Non-Dilutive Kanban ────────────────────────────────────────────────────────

function NonDilutiveKanban({
  rows,
  selectedIds,
  onToggleSelect,
  onReload,
  onAddInCol,
}: {
  rows: Opportunity[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onReload: () => void;
  onAddInCol: (stage: string) => void;
}) {
  const dragId = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(["Withdrawn", "Rejected"]));
  const [detailOpp, setDetailOpp] = useState<Opportunity | null>(null);

  // Editable column labels persisted to localStorage
  const [colLabels, setColLabels] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem("nondil_col_labels");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColLabel, setEditingColLabel] = useState("");

  function getColLabel(col: typeof NONDIL_KANBAN_COLS[number]) {
    return colLabels[col.id] ?? col.label;
  }
  function startEditColLabel(col: typeof NONDIL_KANBAN_COLS[number]) {
    setEditingColId(col.id);
    setEditingColLabel(getColLabel(col));
  }
  function saveColLabel(colId: string) {
    const trimmed = editingColLabel.trim();
    if (trimmed) {
      const next = { ...colLabels, [colId]: trimmed };
      setColLabels(next);
      try { localStorage.setItem("nondil_col_labels", JSON.stringify(next)); } catch {}
    }
    setEditingColId(null);
  }

  // Inline card editing
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<{ title: string; deadline: string; amount: string; notes: string }>({ title: "", deadline: "", amount: "", notes: "" });

  function startInlineEdit(opp: Opportunity, e: React.MouseEvent) {
    e.stopPropagation();
    setInlineEditId(opp.opportunity_id);
    setInlineForm({ title: opp.title, deadline: opp.deadline ?? "", amount: opp.amount ?? "", notes: opp.notes ?? "" });
  }

  async function saveInlineEdit(oppId: string) {
    await fetch(`/api/proxy/funding/${oppId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: inlineForm.title.trim() || undefined,
        deadline: inlineForm.deadline || null,
        amount: inlineForm.amount.trim() || null,
        notes: inlineForm.notes.trim() || null,
      }),
    });
    setInlineEditId(null);
    onReload();
  }

  // Per-column sort: "due_date" (default) | "none" (manual/insertion order)
  const [colSort, setColSort] = useState<Record<string, "due_date" | "none">>({});
  function toggleColSort(colId: string) {
    setColSort(prev => ({ ...prev, [colId]: prev[colId] === "none" ? "due_date" : "none" }));
  }

  const byCol: Record<string, Opportunity[]> = {};
  for (const col of NONDIL_KANBAN_COLS) byCol[col.id] = [];
  for (const opp of rows) {
    if (byCol[opp.stage]) byCol[opp.stage].push(opp);
    else byCol["Applied"]?.push(opp);
  }
  // Sort each column
  for (const col of NONDIL_KANBAN_COLS) {
    const sort = colSort[col.id] ?? "due_date";
    if (sort === "due_date") {
      byCol[col.id].sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
      });
    }
  }

  function toggleCollapse(colId: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId); else next.add(colId);
      return next;
    });
  }

  async function handleColDrop(stage: string) {
    if (!dragId.current) return;
    const id = dragId.current;
    dragId.current = null;
    setDragOverCol(null);
    setDraggingId(null);
    await fetch(`/api/proxy/funding/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    onReload();
  }

  async function doDelete(opp: Opportunity) {
    await fetch(`/api/proxy/funding/${opp.opportunity_id}`, { method: "DELETE" });
    onReload();
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 360px)" }}>
        {NONDIL_KANBAN_COLS.map(col => {
          const colItems = byCol[col.id] ?? [];
          const isCollapsed = collapsed.has(col.id);
          const isColOver = dragOverCol === col.id;

          if (isCollapsed) {
            return (
              <div key={col.id}
                className="flex-shrink-0 w-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 flex flex-col items-center py-3 gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
                onClick={() => toggleCollapse(col.id)}
                title={`Expand ${getColLabel(col)}`}
              >
                <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180 tracking-wide">
                  {getColLabel(col)}
                </span>
                <span className="text-[10px] font-bold text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center">
                  {colItems.length}
                </span>
              </div>
            );
          }

          const currentSort = colSort[col.id] ?? "due_date";

          return (
            <div key={col.id}
              className={`flex-shrink-0 flex flex-col rounded-xl border transition-all duration-150 ${
                isColOver ? "border-blue-400 dark:border-blue-500 shadow-md shadow-blue-500/10" : "border-gray-200 dark:border-gray-700"
              }`}
              style={{ width: 280 }}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverCol(null); } }}
              onDrop={() => handleColDrop(col.id)}
            >
              {/* Column header */}
              <div className={`px-3 py-2.5 rounded-t-xl border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${col.headerCls}`}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${col.dot}`} />
                  {editingColId === col.id ? (
                    <input
                      autoFocus
                      className="text-xs font-semibold bg-white dark:bg-gray-700 border border-blue-400 rounded px-1 py-0.5 w-24 outline-none"
                      value={editingColLabel}
                      onChange={e => setEditingColLabel(e.target.value)}
                      onBlur={() => saveColLabel(col.id)}
                      onKeyDown={e => { if (e.key === "Enter") saveColLabel(col.id); if (e.key === "Escape") setEditingColId(null); }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className="text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-text hover:underline decoration-dashed"
                      onDoubleClick={e => { e.stopPropagation(); startEditColLabel(col); }}
                      title="Double-click to rename"
                    >
                      {getColLabel(col)}
                    </span>
                  )}
                  <span className="text-[10px] font-bold text-gray-500 bg-gray-200 dark:bg-gray-600 rounded-full px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0">
                    {colItems.length}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleColSort(col.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                    title={currentSort === "due_date" ? "Sorted by deadline (click for manual)" : "Manual order (click for deadline)"}>
                    {currentSort === "due_date"
                      ? <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
                      : <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
                    }
                  </button>
                  <button onClick={() => toggleCollapse(col.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                    title="Collapse column">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                  <button onClick={() => onAddInCol(col.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                    title="Add opportunity">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
                {colItems.map(opp => {
                  const overdue = isOverdue(opp.deadline) && opp.stage === "Applied";
                  const isBeingDragged = draggingId === opp.opportunity_id;
                  const isSelected = selectedIds.has(opp.opportunity_id);
                  const isInlineEditing = inlineEditId === opp.opportunity_id;

                  return (
                    <div key={opp.opportunity_id}
                      draggable={!isInlineEditing}
                      onDragStart={() => { if (!isInlineEditing) { dragId.current = opp.opportunity_id; setDraggingId(opp.opportunity_id); } }}
                      onDragEnd={() => { dragId.current = null; setDraggingId(null); setDragOverCol(null); }}
                      onClick={() => { if (!isInlineEditing) setDetailOpp(opp); }}
                      className={`relative bg-white dark:bg-gray-800 rounded-xl border transition-all duration-150 overflow-hidden ${
                        isInlineEditing
                          ? "border-blue-400 dark:border-blue-500 shadow-md cursor-default"
                          : isBeingDragged
                          ? "opacity-40 scale-95 shadow-none cursor-grab"
                          : isSelected
                          ? "border-blue-400 dark:border-blue-500 shadow-sm shadow-blue-500/10 cursor-pointer group"
                          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:shadow-gray-200/60 dark:hover:shadow-black/20 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer group"
                      }`}
                    >
                      {isInlineEditing ? (
                        /* ── Inline edit form ── */
                        <div className="px-3 pt-2.5 pb-3 space-y-2" onClick={e => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={inlineForm.title}
                            onChange={e => setInlineForm(f => ({ ...f, title: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") saveInlineEdit(opp.opportunity_id); if (e.key === "Escape") setInlineEditId(null); }}
                            className="w-full text-sm font-semibold bg-transparent border-0 border-b border-blue-300 dark:border-blue-600 focus:outline-none focus:border-blue-500 pb-0.5 text-gray-900 dark:text-gray-50"
                            placeholder="Title"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <p className="text-[10px] text-gray-400 mb-0.5">Deadline</p>
                              <input
                                type="date"
                                value={inlineForm.deadline}
                                onChange={e => setInlineForm(f => ({ ...f, deadline: e.target.value }))}
                                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400 mb-0.5">Amount</p>
                              <input
                                type="text"
                                value={inlineForm.amount}
                                onChange={e => setInlineForm(f => ({ ...f, amount: e.target.value }))}
                                placeholder="e.g. $250,000"
                                className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
                              />
                            </div>
                          </div>
                          <textarea
                            value={inlineForm.notes}
                            onChange={e => setInlineForm(f => ({ ...f, notes: e.target.value }))}
                            rows={2}
                            placeholder="Notes…"
                            className="w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                          />
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={() => setInlineEditId(null)}
                              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >Cancel</button>
                            <button
                              onClick={() => saveInlineEdit(opp.opportunity_id)}
                              className="px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                            >Save</button>
                          </div>
                        </div>
                      ) : (
                        /* ── Normal card view ── */
                        <div className="px-3 pt-2.5 pb-3">
                          {/* Title row */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-start gap-1.5 flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={e => e.stopPropagation()}
                                onChange={e => { e.stopPropagation(); onToggleSelect(opp.opportunity_id); }}
                                className="mt-0.5 flex-shrink-0 accent-blue-600 cursor-pointer"
                              />
                              <div className="flex items-start gap-1 min-w-0">
                                <p className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-50 min-w-0">{opp.title}</p>
                                {isLinkUrl(opp.source_link) && (
                                  <a href={opp.source_link!} target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="flex-shrink-0 mt-0.5 text-gray-300 hover:text-blue-500 transition-colors"
                                    title="Open source link">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                  </a>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={e => startInlineEdit(opp, e)}
                                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-blue-500 rounded transition-all"
                                aria-label="Quick edit">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                </svg>
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); doDelete(opp); }}
                                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-400 rounded transition-all"
                                aria-label="Delete">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Metadata */}
                          <div className="flex flex-wrap gap-1 mt-1">
                            {opp.amount && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900">
                                {opp.amount}
                              </span>
                            )}
                            {opp.deadline && (
                              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                                overdue
                                  ? "bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                              }`}>
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" />
                                </svg>
                                {fmtDate(opp.deadline)}{overdue && <span className="font-semibold"> · late</span>}
                              </span>
                            )}
                            {opp.decision_date && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                Dec: {opp.decision_date}
                              </span>
                            )}
                            {opp.tags.length > 0 && <TagList tags={opp.tags} />}
                          </div>

                          {opp.notes && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed mt-2 line-clamp-2">{opp.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {colItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <p className="text-xs text-gray-400 dark:text-gray-600">No opportunities here.</p>
                  </div>
                )}
              </div>

              {/* Add row */}
              <div className="p-2 border-t border-gray-100 dark:border-gray-800">
                <button onClick={() => onAddInCol(col.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add opportunity</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {detailOpp && (
        <OpportunityDetailPanel
          opp={detailOpp}
          onClose={() => setDetailOpp(null)}
          onSaved={() => { setDetailOpp(null); onReload(); }}
          onDelete={async () => { await doDelete(detailOpp); setDetailOpp(null); }}
        />
      )}
    </>
  );
}

// ── Dilutive Kanban ────────────────────────────────────────────────────────────

function DilutiveKanban({
  rows,
  selectedIds,
  onToggleSelect,
  onReload,
  onAddInCol,
}: {
  rows: Investor[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onReload: () => void;
  onAddInCol: (status: string) => void;
}) {
  const dragId = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editInv, setEditInv] = useState<Investor | null>(null);

  const byCol: Record<string, Investor[]> = {};
  for (const col of DILUTIVE_KANBAN_COLS) byCol[col.id] = [];
  for (const inv of rows) {
    if (byCol[inv.status]) byCol[inv.status].push(inv);
    else byCol["Not Started"]?.push(inv);
  }

  function toggleCollapse(colId: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId); else next.add(colId);
      return next;
    });
  }

  async function handleColDrop(status: string) {
    if (!dragId.current) return;
    const id = dragId.current;
    dragId.current = null;
    setDragOverCol(null);
    setDraggingId(null);
    await fetch(`/api/proxy/dilutive/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onReload();
  }

  async function doDelete(inv: Investor) {
    await fetch(`/api/proxy/dilutive/${inv.investor_id}`, { method: "DELETE" });
    onReload();
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 360px)" }}>
        {DILUTIVE_KANBAN_COLS.map(col => {
          const colItems = byCol[col.id] ?? [];
          const isCollapsed = collapsed.has(col.id);
          const isColOver = dragOverCol === col.id;

          if (isCollapsed) {
            return (
              <div key={col.id}
                className="flex-shrink-0 w-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 flex flex-col items-center py-3 gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
                onClick={() => toggleCollapse(col.id)}
                title={`Expand ${col.label}`}
              >
                <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180 tracking-wide">
                  {col.label}
                </span>
                <span className="text-[10px] font-bold text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center">
                  {colItems.length}
                </span>
              </div>
            );
          }

          return (
            <div key={col.id}
              className={`flex-shrink-0 flex flex-col rounded-xl border transition-all duration-150 ${
                isColOver ? "border-blue-400 dark:border-blue-500 shadow-md shadow-blue-500/10" : "border-gray-200 dark:border-gray-700"
              }`}
              style={{ width: 280 }}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDragOverCol(null); } }}
              onDrop={() => handleColDrop(col.id)}
            >
              {/* Column header */}
              <div className={`px-3 py-2.5 rounded-t-xl border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${col.headerCls}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{col.label}</span>
                  <span className="text-[10px] font-bold text-gray-500 bg-gray-200 dark:bg-gray-600 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                    {colItems.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleCollapse(col.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                    title="Collapse column">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                  <button onClick={() => onAddInCol(col.id)}
                    className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                    title="Add investor">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
                {colItems.map(inv => {
                  const isBeingDragged = draggingId === inv.investor_id;
                  const isSelected = selectedIds.has(inv.investor_id);

                  return (
                    <div key={inv.investor_id}
                      draggable
                      onDragStart={() => { dragId.current = inv.investor_id; setDraggingId(inv.investor_id); }}
                      onDragEnd={() => { dragId.current = null; setDraggingId(null); setDragOverCol(null); }}
                      onClick={() => setEditInv(inv)}
                      className={`relative bg-white dark:bg-gray-800 rounded-xl border cursor-pointer group transition-all duration-150 ${
                        isBeingDragged
                          ? "opacity-40 scale-95 shadow-none"
                          : isSelected
                          ? "border-blue-400 dark:border-blue-500 shadow-sm shadow-blue-500/10"
                          : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:shadow-gray-200/60 dark:hover:shadow-black/20 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      {inv.intro_type && (
                        <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl ${
                          inv.intro_type === "Warm" ? "bg-orange-400" : "bg-gray-300 dark:bg-gray-600"
                        }`} />
                      )}
                      <div className={`px-3 pt-2.5 pb-3 ${inv.intro_type ? "pl-4" : ""}`}>
                        {/* Name row */}
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-start gap-1.5 flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onClick={e => e.stopPropagation()}
                              onChange={e => { e.stopPropagation(); onToggleSelect(inv.investor_id); }}
                              className="mt-0.5 flex-shrink-0 accent-blue-600 cursor-pointer"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-50 leading-snug">
                                {inv.name ?? <span className="text-gray-400 font-normal italic">Unnamed</span>}
                              </p>
                              {inv.role && (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">{inv.role}</p>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); doDelete(inv); }}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-400 rounded transition-all"
                            aria-label="Delete">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        {/* Firm */}
                        {inv.firm && (
                          <p className="text-xs text-gray-600 dark:text-gray-300 mb-1.5">
                            {isLinkUrl(inv.source_link)
                              ? <a href={inv.source_link!} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="hover:text-blue-600 inline-flex items-center gap-1">
                                  {inv.firm}
                                  <svg className="w-3 h-3 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </a>
                              : inv.firm}
                            {inv.firm_type && <span className="text-gray-400 ml-1">· {inv.firm_type}</span>}
                          </p>
                        )}

                        {/* Metadata row */}
                        <div className="flex flex-wrap gap-1">
                          {inv.intro_type && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              inv.intro_type === "Warm"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                            }`}>{inv.intro_type}</span>
                          )}
                          {inv.avg_check_size && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900 font-semibold">
                              {inv.avg_check_size}
                            </span>
                          )}
                          {inv.email && (
                            <a href={`mailto:${inv.email}`} onClick={e => e.stopPropagation()}
                              className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:underline">
                              {inv.email}
                            </a>
                          )}
                          {inv.tags.length > 0 && <TagList tags={inv.tags} />}
                        </div>

                        {inv.notes && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed mt-2 line-clamp-2">{inv.notes}</p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {colItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <p className="text-xs text-gray-400 dark:text-gray-600">No investors here.</p>
                  </div>
                )}
              </div>

              {/* Add row */}
              <div className="p-2 border-t border-gray-100 dark:border-gray-800">
                <button onClick={() => onAddInCol(col.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add investor</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editInv && (
        <EditInvestorModal
          inv={editInv}
          onClose={() => setEditInv(null)}
          onSaved={() => { setEditInv(null); onReload(); }}
          onDelete={async () => { await doDelete(editInv); setEditInv(null); }}
        />
      )}
    </>
  );
}

// ── Non-Dilutive Tab ───────────────────────────────────────────────────────────

function NonDilutiveTab({ forceAdd, onAddConsumed }: { forceAdd: boolean; onAddConsumed: () => void }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addingForStage, setAddingForStage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Opportunity | null>(null);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [viewMode, setViewMode] = useState<FundingViewMode>("kanban");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterStage && viewMode === "list") params.set("stage", filterStage);
    const res = await fetch(`/api/proxy/funding?${params}`);
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, filterStage, viewMode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (forceAdd) { setShowAdd(true); onAddConsumed(); } }, [forceAdd, onAddConsumed]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.opportunity_id)));
  }

  async function bulkDelete() {
    await Promise.all([...selectedIds].map(id => fetch(`/api/proxy/funding/${id}`, { method: "DELETE" })));
    setSelectedIds(new Set());
    load();
  }

  async function bulkSetStage(stage: string) {
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/proxy/funding/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      })
    ));
    setSelectedIds(new Set());
    load();
  }

  function startEdit(id: string, field: string, value: string) {
    setEditing({ id, field, value });
  }

  async function commitEdit(id: string, field: string, raw: string) {
    setEditing(null);
    const value = raw.trim();
    // Optimistic update
    setRows((prev) =>
      prev.map((r) => r.opportunity_id === id ? { ...r, [field]: value || null } : r)
    );
    await fetch(`/api/proxy/funding/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
  }

  async function doDelete(opp: Opportunity) {
    await fetch(`/api/proxy/funding/${opp.opportunity_id}`, { method: "DELETE" });
    setDeleting(null);
    load();
  }

  const counts = STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((r) => r.stage === s).length;
    return acc;
  }, {});

  const Editable = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editing} onStartEdit={startEdit} onCommit={commitEdit} onCancel={() => setEditing(null)} />
  );

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;

  return (
    <>
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-sm">
          <span className="font-medium text-blue-700 dark:text-blue-300">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-blue-600 dark:text-blue-400">Move to:</span>
            {STAGES.map(s => (
              <button key={s} onClick={() => bulkSetStage(s)}
                className={`text-xs px-2 py-1 rounded-full border font-medium ${STAGE_STYLES[s]}`}>
                {s}
              </button>
            ))}
            <button onClick={bulkDelete}
              className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
              Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {(viewMode === "list") && STAGES.map((s) => counts[s] > 0 && (
          <button key={s}
            onClick={() => setFilterStage(filterStage === s ? "" : s)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
              filterStage === s ? STAGE_STYLES[s] + " ring-2 ring-offset-1 ring-current" : STAGE_STYLES[s]
            }`}>
            {s} · {counts[s]}
          </button>
        ))}
        <div className="relative ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="w-48 pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
        </div>
        {filterStage && viewMode === "list" && (
          <button onClick={() => setFilterStage("")}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Clear filter
          </button>
        )}
        <ViewToggle mode={viewMode} onChange={(m) => { setViewMode(m); setSelectedIds(new Set()); }} />
      </div>

      {/* Kanban view */}
      {viewMode === "kanban" && !loading && (
        <NonDilutiveKanban
          rows={rows}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onReload={load}
          onAddInCol={(stage) => setAddingForStage(stage)}
        />
      )}

      {/* Gantt view */}
      {viewMode === "gantt" && !loading && (
        <FundingGanttView
          rows={rows}
          onPatch={async (id, patch) => {
            setRows(prev => prev.map(r => r.opportunity_id === id ? { ...r, ...patch } : r));
            await fetch(`/api/proxy/funding/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
          }}
        />
      )}

      {/* List view */}
      {viewMode === "list" && (
        loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-gray-400 dark:text-gray-500">No opportunities found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-blue-600 cursor-pointer" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Stage</th>
                  <th className="text-left px-4 py-3 font-medium">Title</th>
                  <th className="text-left px-4 py-3 font-medium">Deadline</th>
                  <th className="text-left px-4 py-3 font-medium">Tags</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Decision</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((opp) => (
                  <tr key={opp.opportunity_id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group ${selectedIds.has(opp.opportunity_id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selectedIds.has(opp.opportunity_id)}
                        onChange={() => toggleSelect(opp.opportunity_id)} className="accent-blue-600 cursor-pointer" />
                    </td>
                    <Editable rowId={opp.opportunity_id} field="stage" value={opp.stage}
                      editType="select" selectOptions={STAGES}
                      display={
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_STYLES[opp.stage] ?? "bg-gray-100 text-gray-600"}`}>
                          {opp.stage}
                        </span>
                      } />
                    <Editable rowId={opp.opportunity_id} field="title" value={opp.title}
                      className="max-w-xs"
                      display={
                        isLinkUrl(opp.source_link)
                          ? <a href={opp.source_link!} target="_blank" rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 truncate block">
                              {opp.title}
                              <svg className="inline w-3 h-3 ml-1 opacity-50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          : <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">{opp.title}</span>
                      } />
                    <Editable rowId={opp.opportunity_id} field="deadline" value={opp.deadline ?? ""}
                      placeholder="YYYY-MM-DD"
                      display={
                        opp.deadline
                          ? <span className={`text-xs ${isOverdue(opp.deadline) && opp.stage === "Applied" ? "text-red-500 font-medium" : "text-gray-600 dark:text-gray-400"}`}>
                              {fmtDate(opp.deadline)}
                            </span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={opp.opportunity_id} field="tags" value={opp.tags.join(", ")}
                      placeholder="Grant, Accelerator…"
                      display={opp.tags.length > 0 ? <TagList tags={opp.tags} /> : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <Editable rowId={opp.opportunity_id} field="funding_type" value={opp.funding_type ?? ""}
                      placeholder="Non-Dilutive…"
                      display={<span className="text-xs text-gray-600 dark:text-gray-400">{opp.funding_type ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</span>} />
                    <Editable rowId={opp.opportunity_id} field="amount" value={opp.amount ?? ""}
                      placeholder="Up to $100K…"
                      display={<span className="text-xs font-medium text-gray-700 dark:text-gray-300">{opp.amount ?? <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}</span>} />
                    <Editable rowId={opp.opportunity_id} field="decision_date" value={opp.decision_date ?? ""}
                      placeholder="Mid-July"
                      display={
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {opp.decision_date && opp.decision_date.toLowerCase() !== "unknown"
                            ? opp.decision_date
                            : <span className="text-gray-300 dark:text-gray-600">—</span>}
                          {opp.funding_dispersion && <span className="block text-[10px] text-gray-400">Disp: {opp.funding_dispersion}</span>}
                        </span>
                      } />
                    <Editable rowId={opp.opportunity_id} field="notes" value={opp.notes ?? ""}
                      placeholder="Notes…" multiline
                      className="max-w-[200px]"
                      display={
                        opp.notes
                          ? <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2" title={opp.notes}>{opp.notes}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setDeleting(opp)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {(showAdd || addingForStage !== null) && (
        <AddOpportunityModal
          initialStage={addingForStage ?? "Applied"}
          onClose={() => { setShowAdd(false); setAddingForStage(null); }}
          onSaved={load}
        />
      )}
      {deleting && <DeleteConfirm title={deleting.title} onConfirm={() => doDelete(deleting)} onCancel={() => setDeleting(null)} />}
    </>
  );
}

// ── Dilutive Tab ───────────────────────────────────────────────────────────────

function DilutiveTab() {
  const [rows, setRows] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addingForStatus, setAddingForStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Investor | null>(null);
  const [editing, setEditing] = useState<EditingCell>(null);
  const [viewMode, setViewMode] = useState<FundingViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterStatus && viewMode === "list") params.set("status", filterStatus);
    const res = await fetch(`/api/proxy/dilutive?${params}`);
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, filterStatus, viewMode]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === rows.length ? new Set() : new Set(rows.map(r => r.investor_id)));
  }

  async function bulkDelete() {
    await Promise.all([...selectedIds].map(id => fetch(`/api/proxy/dilutive/${id}`, { method: "DELETE" })));
    setSelectedIds(new Set());
    load();
  }

  async function bulkSetStatus(status: string) {
    await Promise.all([...selectedIds].map(id =>
      fetch(`/api/proxy/dilutive/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
    ));
    setSelectedIds(new Set());
    load();
  }

  function startEdit(id: string, field: string, value: string) {
    setEditing({ id, field, value });
  }

  async function commitEdit(id: string, field: string, raw: string) {
    setEditing(null);
    const value = raw.trim();
    setRows((prev) =>
      prev.map((r) => r.investor_id === id ? { ...r, [field]: value || null } : r)
    );
    await fetch(`/api/proxy/dilutive/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
  }

  async function doDelete(inv: Investor) {
    await fetch(`/api/proxy/dilutive/${inv.investor_id}`, { method: "DELETE" });
    setDeleting(null);
    load();
  }

  const counts = INVESTOR_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = rows.filter((r) => r.status === s).length;
    return acc;
  }, {});

  const Editable = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editing} onStartEdit={startEdit} onCommit={commitEdit} onCancel={() => setEditing(null)} />
  );

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;

  return (
    <>
      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-sm">
          <span className="font-medium text-blue-700 dark:text-blue-300">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <span className="text-xs text-blue-600 dark:text-blue-400">Move to:</span>
            {INVESTOR_STATUSES.map(s => (
              <button key={s} onClick={() => bulkSetStatus(s)}
                className={`text-xs px-2 py-1 rounded-full border font-medium whitespace-nowrap ${INVESTOR_STATUS_STYLES[s] ?? "bg-gray-100 text-gray-600"}`}>
                {s}
              </button>
            ))}
            <button onClick={bulkDelete}
              className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
              Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())}
              className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {viewMode === "list" && INVESTOR_STATUSES.map((s) => counts[s] > 0 && (
          <button key={s}
            onClick={() => setFilterStatus(filterStatus === s ? "" : s)}
            className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
              filterStatus === s
                ? (INVESTOR_STATUS_STYLES[s] ?? "bg-gray-100 text-gray-600") + " ring-2 ring-offset-1 ring-current"
                : (INVESTOR_STATUS_STYLES[s] ?? "bg-gray-100 text-gray-600")
            }`}>
            {s} · {counts[s]}
          </button>
        ))}
        <div className="relative ml-auto">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search investors…"
            className="w-48 pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
        </div>
        {filterStatus && viewMode === "list" && (
          <button onClick={() => setFilterStatus("")}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Clear filter
          </button>
        )}
        <ViewToggle mode={viewMode} onChange={(m) => { setViewMode(m); setSelectedIds(new Set()); }} showGantt={false} />
      </div>

      {/* Kanban view */}
      {viewMode === "kanban" && !loading && (
        <DilutiveKanban
          rows={rows}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onReload={load}
          onAddInCol={(status) => setAddingForStatus(status)}
        />
      )}

      {/* List view */}
      {viewMode === "list" && (
        loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-gray-400 dark:text-gray-500">No investors found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="accent-blue-600 cursor-pointer" />
                  </th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <th className="text-left px-4 py-3 font-medium">Firm</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Intro</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Check Size</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((inv) => (
                  <tr key={inv.investor_id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors group ${selectedIds.has(inv.investor_id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                    <td className="px-4 py-2">
                      <input type="checkbox" checked={selectedIds.has(inv.investor_id)}
                        onChange={() => toggleSelect(inv.investor_id)} className="accent-blue-600 cursor-pointer" />
                    </td>
                    <Editable rowId={inv.investor_id} field="status" value={inv.status}
                      editType="select" selectOptions={INVESTOR_STATUSES}
                      display={
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${INVESTOR_STATUS_STYLES[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {inv.status}
                        </span>
                      } />
                    <Editable rowId={inv.investor_id} field="name" value={inv.name ?? ""}
                      placeholder="Contact name"
                      display={
                        inv.name
                          ? <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{inv.name}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={inv.investor_id} field="role" value={inv.role ?? ""}
                      placeholder="Partner…"
                      display={
                        inv.role
                          ? <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{inv.role}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={inv.investor_id} field="firm" value={inv.firm ?? ""}
                      placeholder="Firm name"
                      display={
                        inv.firm
                          ? isLinkUrl(inv.source_link)
                            ? <a href={inv.source_link!} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 whitespace-nowrap">
                                {inv.firm}
                                <svg className="inline w-3 h-3 ml-1 opacity-50" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            : <span className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{inv.firm}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={inv.investor_id} field="firm_type" value={inv.firm_type ?? ""}
                      placeholder="VC, CVC…"
                      display={
                        <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {inv.firm_type ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </span>
                      } />
                    <Editable rowId={inv.investor_id} field="intro_type" value={inv.intro_type ?? ""}
                      editType="select" selectOptions={["", "Warm", "Cold"]}
                      display={
                        inv.intro_type
                          ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                              inv.intro_type === "Warm"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            }`}>{inv.intro_type}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={inv.investor_id} field="email" value={inv.email ?? ""}
                      placeholder="email@firm.com"
                      display={
                        inv.email
                          ? <a href={`mailto:${inv.email}`} onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
                              {inv.email}
                            </a>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <Editable rowId={inv.investor_id} field="avg_check_size" value={inv.avg_check_size ?? ""}
                      placeholder="$500K…"
                      display={
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {inv.avg_check_size ?? <span className="text-gray-300 dark:text-gray-600 font-normal">—</span>}
                        </span>
                      } />
                    <Editable rowId={inv.investor_id} field="notes" value={inv.notes ?? ""}
                      placeholder="Notes…" multiline
                      className="max-w-[200px]"
                      display={
                        inv.notes
                          ? <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2" title={inv.notes}>{inv.notes}</span>
                          : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      } />
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setDeleting(inv)} className="p-1 text-gray-400 hover:text-red-500 rounded" title="Delete">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {(showAdd || addingForStatus !== null) && (
        <AddInvestorModal
          initialStatus={addingForStatus ?? "Not Started"}
          onClose={() => { setShowAdd(false); setAddingForStatus(null); }}
          onSaved={load}
        />
      )}
      {deleting && (
        <DeleteConfirm
          title={`${deleting.name ?? "Investor"}${deleting.firm ? ` @ ${deleting.firm}` : ""}`}
          onConfirm={() => doDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// ── Fundraising Plan Tab ──────────────────────────────────────────────────────

// FP&A model funding entry shape (mirrors FundingEntry in fpa/page.tsx)
interface FpaFundingEntry {
  id: string;
  name: string;
  type: "equity" | "safe" | "convertible_note" | "grant" | "sbir" | "loan";
  pre_money_valuation: number;
  dilution_pct: number;
  date: string;
  amount: number;
  disbursement: "lump_sum" | "monthly";
  start_date: string;
  end_date: string;
  monthly_amount: number;
  annual_increase_pct: number;
  notes: string;
}

// Plan-only metadata stored in funding_plan (per FP&A entry id)
interface TrancheMeta {
  milestone: string;
  color: string;
  status: "planned" | "active" | "closed";
  plan_notes: string;
}

// What we persist in funding_plan table
interface FundraisePlanStore {
  meta: Record<string, TrancheMeta>;
  strategic_notes: string;
  show_grant_overlay: boolean;
}

// Display tranche (union of FP&A financial data + plan metadata)
interface FundraiseTranche {
  id: string;
  name: string;
  type: "dilutive" | "non-dilutive";
  fpa_type: FpaFundingEntry["type"];
  amount_k: number;
  valuation_k: number;
  target_month: string;
  disbursement: "lump_sum" | "monthly";
  monthly_amount: number;
  // plan-only
  milestone: string;
  plan_notes: string;
  color: string;
  status: "planned" | "active" | "closed";
}

interface FundraisePlan {
  tranches: FundraiseTranche[];
  strategic_notes: string;
  show_grant_overlay: boolean;
}

const PLAN_COLORS = ["#6366f1","#3b82f6","#8b5cf6","#10b981","#f59e0b","#ec4899","#14b8a6","#f97316"];

const FPA_DILUTIVE = ["equity", "safe", "convertible_note"];

const FPA_TYPE_LABELS: Record<FpaFundingEntry["type"], string> = {
  equity: "Equity", safe: "SAFE", convertible_note: "Conv. Note",
  grant: "Grant", sbir: "SBIR/STTR", loan: "Loan",
};

function entryToTranche(e: FpaFundingEntry, meta: TrancheMeta | undefined, idx: number): FundraiseTranche {
  const isDilutive = FPA_DILUTIVE.includes(e.type);
  const amountK = e.disbursement === "monthly"
    ? Math.round((e.monthly_amount || 0) * 12 / 1000)
    : Math.round((e.amount || 0) / 1000);
  const targetMonth = e.disbursement === "monthly"
    ? (e.start_date || "").slice(0, 7)
    : (e.date || "").slice(0, 7);
  return {
    id: e.id,
    name: e.name || FPA_TYPE_LABELS[e.type],
    type: isDilutive ? "dilutive" : "non-dilutive",
    fpa_type: e.type,
    amount_k: amountK,
    valuation_k: isDilutive ? Math.round((e.pre_money_valuation || 0) / 1000) : 0,
    target_month: targetMonth || dateToMonth(new Date()),
    disbursement: e.disbursement || "lump_sum",
    monthly_amount: e.monthly_amount || 0,
    milestone: meta?.milestone ?? "",
    plan_notes: meta?.plan_notes ?? (e.notes || ""),
    color: meta?.color ?? PLAN_COLORS[idx % PLAN_COLORS.length],
    status: meta?.status ?? "planned",
  };
}

// Map a funding opportunity to a minimal FpaFundingEntry for import
function oppToFpaEntry(opp: Opportunity): FpaFundingEntry {
  const rawAmt = parseFloat(String(opp.amount || "0").replace(/[^0-9.]/g, "")) || 0;
  const isDilutive = (opp.funding_type || "").toLowerCase().includes("equity")
    || (opp.funding_type || "").toLowerCase().includes("vc")
    || (opp.funding_type || "").toLowerCase().includes("safe");
  return {
    id: crypto.randomUUID(),
    name: opp.title,
    type: isDilutive ? "equity" : "grant",
    pre_money_valuation: 0,
    dilution_pct: 0,
    date: opp.decision_date || opp.funding_dispersion || opp.deadline || "",
    amount: rawAmt,
    disbursement: "lump_sum",
    start_date: "",
    end_date: "",
    monthly_amount: 0,
    annual_increase_pct: 0,
    notes: opp.notes || "",
  };
}

function monthToDate(m: string): Date { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1); }
function dateToMonth(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function fmtMonth(m: string): string { const d = monthToDate(m); return d.toLocaleDateString("en-US", { month: "short", year: "numeric" }); }
function fmtK(k: number): string {
  const v = Math.round(k * 1000);
  if (Math.abs(v) >= 1_000_000) return `${v < 0 ? "-$" : "$"}${(Math.abs(v) / 1_000_000).toFixed(1)}M`;
  return `${v < 0 ? "-$" : "$"}${Math.abs(v).toLocaleString()}`;
}

function FundraisePlanTab() {
  const [fpaEntries, setFpaEntries] = useState<FpaFundingEntry[]>([]);
  const [planStore, setPlanStore] = useState<FundraisePlanStore>({ meta: {}, strategic_notes: "", show_grant_overlay: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FpaFundingEntry | null>(null);
  const [metaDraft, setMetaDraft] = useState<TrancheMeta | null>(null);
  const [grantRows, setGrantRows] = useState<Opportunity[]>([]);
  const [showOppPicker, setShowOppPicker] = useState(false);
  const [allOpps, setAllOpps] = useState<Opportunity[]>([]);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<Array<{ year: number; month: number; ebitda: number }>>([]);
  const [chartViewStart, setChartViewStart] = useState<number | null>(null);
  const [chartViewEnd, setChartViewEnd] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/proxy/fpa/model").then(r => r.ok ? r.json() : null),
      fetch("/api/proxy/funding/plan").then(r => r.ok ? r.json() : null),
      fetch("/api/proxy/funding").then(r => r.ok ? r.json() : []),
      fetch("/api/proxy/fpa/model/monthly").then(r => r.ok ? r.json() : []),
    ]).then(([fpaModel, planData, opps, monthly]) => {
      setFpaEntries((fpaModel?.funding_schedule || []) as FpaFundingEntry[]);
      if (planData && planData.meta) {
        setPlanStore(planData as FundraisePlanStore);
      } else if (planData && planData.tranches) {
        const meta: Record<string, TrancheMeta> = {};
        for (const t of planData.tranches) {
          meta[t.id] = { milestone: t.milestone || "", color: t.color || PLAN_COLORS[0], status: t.status || "planned", plan_notes: t.notes || "" };
        }
        setPlanStore({ meta, strategic_notes: planData.strategic_notes || "", show_grant_overlay: planData.show_grant_overlay ?? true });
      }
      setGrantRows((opps as Opportunity[]).filter(o => o.deadline));
      setAllOpps(opps as Opportunity[]);
      setMonthlyData((monthly as Array<{ year: number; month: number; ebitda: number }>) || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function savePlanMeta(updated: FundraisePlanStore) {
    setSaving(true);
    try {
      await fetch("/api/proxy/funding/plan", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } finally { setSaving(false); }
  }

  async function saveFpaEntries(entries: FpaFundingEntry[], msg = "Saved to FP&A model") {
    setSaving(true);
    try {
      const r = await fetch("/api/proxy/fpa/model", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funding_schedule: entries }),
      });
      if (r.ok) { setFpaEntries(entries); showSync(msg); }
    } finally { setSaving(false); }
  }

  function showSync(msg: string) {
    setSyncMsg(msg);
    setTimeout(() => setSyncMsg(null), 3000);
  }

  function updateMeta(id: string, patch: Partial<TrancheMeta>) {
    const updated = { ...planStore, meta: { ...planStore.meta, [id]: { ...(planStore.meta[id] || { milestone: "", color: PLAN_COLORS[0], status: "planned" as const, plan_notes: "" }), ...patch } } };
    setPlanStore(updated);
    savePlanMeta(updated);
  }

  function updateFpaEntry(id: string, patch: Partial<FpaFundingEntry>) {
    const updated = fpaEntries.map(e => e.id === id ? { ...e, ...patch } : e);
    saveFpaEntries(updated, "FP&A model updated");
  }

  function flushDraft() {
    if (editDraft && editId) {
      const updated = fpaEntries.map(e => e.id === editId ? editDraft : e);
      saveFpaEntries(updated, "FP&A model updated");
    }
    if (metaDraft && editId) {
      updateMeta(editId, metaDraft);
    }
  }

  function openEdit(id: string, fpaEntry: FpaFundingEntry) {
    if (editId && editId !== id) flushDraft();
    setEditId(id);
    setEditDraft({ ...fpaEntry });
    setMetaDraft({ ...(planStore.meta[id] || { milestone: "", color: PLAN_COLORS[0], status: "planned" as const, plan_notes: "" }) });
  }

  function closeEdit() {
    flushDraft();
    setEditId(null);
    setEditDraft(null);
    setMetaDraft(null);
  }

  function removeFpaEntry(id: string) {
    saveFpaEntries(fpaEntries.filter(e => e.id !== id), "Entry removed from FP&A model");
    const updatedMeta = { ...planStore.meta };
    delete updatedMeta[id];
    const updated = { ...planStore, meta: updatedMeta };
    setPlanStore(updated);
    savePlanMeta(updated);
  }

  function addNewEntry() {
    const newE: FpaFundingEntry = {
      id: crypto.randomUUID(), name: "New Round", type: "equity",
      pre_money_valuation: 0, dilution_pct: 0,
      date: dateToMonth(new Date()) + "-01", amount: 100000,
      disbursement: "lump_sum", start_date: "", end_date: "",
      monthly_amount: 0, annual_increase_pct: 0, notes: "",
    };
    const updated = [...fpaEntries, newE];
    saveFpaEntries(updated, "New entry added to FP&A model");
    setEditId(newE.id);
  }

  async function importOpportunity(opp: Opportunity) {
    const entry = oppToFpaEntry(opp);
    const updated = [...fpaEntries, entry];
    await saveFpaEntries(updated, `"${opp.title}" added to FP&A model`);
    setShowOppPicker(false);
  }

  if (loading) return <div className="flex items-center justify-center h-40"><p className="text-sm text-gray-400">Loading…</p></div>;

  const tranches = fpaEntries.map((e, i) => entryToTranche(e, planStore.meta[e.id], i));

  const sorted = [...tranches].sort((a, b) => a.target_month.localeCompare(b.target_month));
  const totalDilutive = sorted.filter(t => t.type === "dilutive").reduce((s, t) => s + t.amount_k, 0);
  const totalNonDil = sorted.filter(t => t.type === "non-dilutive").reduce((s, t) => s + t.amount_k, 0);
  const totalRaised = totalDilutive + totalNonDil;

  // Cumulative amounts for chart Y axis (raised capital step line)
  let runningTotal = 0;
  const sortedWithCumul = sorted.map(t => {
    runningTotal += t.amount_k;
    return { ...t, cumul_k: runningTotal };
  });

  // Cash balance series: ebitda (includes grants/revenue) + non-P&L inflows (equity + loans)
  const nonPnlInflows: Record<string, number> = {};
  for (const e of fpaEntries) {
    const isDilutive = ["equity", "safe", "convertible_note"].includes(e.type);
    const isLoan = e.type === "loan";
    if (!isDilutive && !isLoan) continue; // grants/SBIRs already in ebitda via grant_revenue
    if (e.disbursement === "monthly" && e.start_date && (e.monthly_amount || 0) > 0) {
      const s = new Date(e.start_date);
      const end = e.end_date ? new Date(e.end_date) : new Date(s.getFullYear() + 10, 11, 31);
      let c = new Date(s.getFullYear(), s.getMonth(), 1);
      while (c <= end) {
        const key = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}`;
        nonPnlInflows[key] = (nonPnlInflows[key] || 0) + (e.monthly_amount || 0) / 1000;
        c = new Date(c.getFullYear(), c.getMonth() + 1, 1);
      }
    } else if (e.date) {
      const key = e.date.slice(0, 7);
      nonPnlInflows[key] = (nonPnlInflows[key] || 0) + (e.amount || 0) / 1000;
    }
  }
  let cashBal = 0;
  const cashSeries = [...monthlyData]
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(md => {
      const key = `${md.year}-${String(md.month).padStart(2, "0")}`;
      cashBal += (md.ebitda || 0) / 1000 + (nonPnlInflows[key] || 0);
      return { month: key, cash_k: Math.round(cashBal * 10) / 10 };
    });

  // Chart dimensions
  const SVG_W = 900; const SVG_H = 280;
  const PAD_L = 64; const PAD_R = 32; const PAD_T = 24; const PAD_B = 48;
  const chartW = SVG_W - PAD_L - PAD_R;
  const chartH = SVG_H - PAD_T - PAD_B;

  // X axis: cover both tranches and full model range
  const trancheMonths = sorted.map(t => t.target_month);
  const mdMonths = monthlyData.map(md => `${md.year}-${String(md.month).padStart(2, "0")}`);
  const allDates = [...trancheMonths, ...mdMonths].filter(Boolean);
  const dataStartMonth = allDates.length ? allDates.reduce((a, b) => a < b ? a : b) : dateToMonth(new Date());
  const dataEndMonth   = allDates.length ? allDates.reduce((a, b) => a > b ? a : b) : dateToMonth(new Date(Date.now() + 365 * 86400000));
  const dataStartDate  = new Date(monthToDate(dataStartMonth).getTime() - 30 * 86400000);
  const dataEndDate    = new Date(monthToDate(dataEndMonth).getTime() + 60 * 86400000);

  // All years in data
  const today = new Date();
  const allDataYears = Array.from(new Set(allDates.map(m => parseInt(m.slice(0, 4))))).sort();

  // Apply chart view window (null = use data bounds)
  const startDate = chartViewStart ? new Date(chartViewStart, 0, 1) : dataStartDate;
  const endDate   = chartViewEnd   ? new Date(chartViewEnd,   11, 31) : dataEndDate;
  const totalMs   = Math.max(1, endDate.getTime() - startDate.getTime());

  const visibleYears = allDataYears.filter(y => y >= startDate.getFullYear() && y <= endDate.getFullYear());

  function xOf(month: string): number {
    const ms = monthToDate(month).getTime() - startDate.getTime();
    return PAD_L + (ms / totalMs) * chartW;
  }

  // Y axis: span raised capital AND cash balance (which can go negative)
  const cashMin = cashSeries.length ? Math.min(...cashSeries.map(c => c.cash_k)) : 0;
  const cashMax = cashSeries.length ? Math.max(...cashSeries.map(c => c.cash_k)) : 0;
  const minY = Math.min(0, cashMin) * 1.1;
  const maxY = Math.max(totalRaised, cashMax, 500) * 1.15;
  const yRange = maxY - minY;

  function yOf(val_k: number): number {
    return PAD_T + chartH - ((val_k - minY) / yRange) * chartH;
  }

  // Generate month tick marks
  const ticks: { month: string; x: number }[] = [];
  let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cur <= endDate) {
    const m = dateToMonth(cur);
    const x = xOf(m);
    if (x >= PAD_L && x <= PAD_L + chartW) ticks.push({ month: m, x });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  // Step-up cumulative raised line
  const stepPath = sortedWithCumul.length > 0 ? (() => {
    let path = `M ${PAD_L},${yOf(0)}`;
    let prevCumul = 0;
    for (const t of sortedWithCumul) {
      const x = xOf(t.target_month);
      path += ` L ${x},${yOf(prevCumul)} L ${x},${yOf(t.cumul_k)}`;
      prevCumul = t.cumul_k;
    }
    path += ` L ${PAD_L + chartW},${yOf(prevCumul)}`;
    return path;
  })() : "";

  // Y axis ticks
  const yStep = yRange <= 2000 ? 500 : yRange <= 5000 ? 1000 : yRange <= 10000 ? 2000 : 5000;
  const yTicks: number[] = [];
  for (let v = Math.ceil(minY / yStep) * yStep; v <= maxY; v += yStep) yTicks.push(v);

  const inputCls = "w-full text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500/40";

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Dilutive Target", value: fmtK(totalDilutive), sub: `${sorted.filter(t=>t.type==="dilutive").length} rounds` },
          { label: "Non-Dilutive Target", value: fmtK(totalNonDil || 0), sub: "Grants & competitions" },
          { label: "Total Capital Target", value: fmtK(totalRaised), sub: "All sources combined" },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">{s.value}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Fundraising Timeline & Cash Position</h3>
          <div className="flex items-center gap-4 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-indigo-500 opacity-60" style={{ display: "inline-block" }} /> Capital raised</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-6 h-0.5 bg-emerald-500" style={{ display: "inline-block" }} /> Cash balance</span>
          </div>
        </div>

        {/* Range controls — matches FP&A model view controls */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 mb-3">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">View period:</span>
          <div className="flex items-center gap-2">
            <select
              value={chartViewStart ?? startDate.getFullYear()}
              onChange={e => setChartViewStart(Number(e.target.value))}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              {allDataYears.filter(y => y <= (chartViewEnd ?? endDate.getFullYear())).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">→</span>
            <select
              value={chartViewEnd ?? endDate.getFullYear()}
              onChange={e => setChartViewEnd(Number(e.target.value))}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              {allDataYears.filter(y => y >= (chartViewStart ?? startDate.getFullYear())).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-400">({visibleYears.length} yr{visibleYears.length !== 1 ? "s" : ""})</span>
          <div className="flex gap-1 ml-auto">
            {[
              { label: "1Y",  s: today.getFullYear(), e: today.getFullYear() },
              { label: "2Y",  s: today.getFullYear(), e: today.getFullYear() + 1 },
              { label: "5Y",  s: today.getFullYear(), e: today.getFullYear() + 4 },
              { label: "10Y", s: today.getFullYear(), e: today.getFullYear() + 9 },
              { label: "All", s: null as number | null, e: null as number | null },
            ].map(p => {
              const active = p.s === null
                ? chartViewStart === null && chartViewEnd === null
                : chartViewStart === p.s && chartViewEnd === p.e;
              return (
                <button key={p.label} onClick={() => { setChartViewStart(p.s); setChartViewEnd(p.e); }}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${active ? "border-blue-400 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400" : "border-gray-300 dark:border-gray-600 text-gray-400 hover:text-blue-500 hover:border-blue-400"}`}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full" style={{ minWidth: 600 }}>
            {/* Y gridlines + labels */}
            {yTicks.map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={PAD_L + chartW} y1={yOf(v)} y2={yOf(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.2 : 0.06} strokeWidth={v === 0 ? 1 : 1} />
                <text x={PAD_L - 6} y={yOf(v) + 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={v === 0 ? 0.6 : 0.4}>
                  {fmtK(v)}
                </text>
              </g>
            ))}

            {/* X axis ticks */}
            {ticks.map(({ month, x }) => {
              const d = monthToDate(month);
              const isJan = d.getMonth() === 0;
              const label = d.toLocaleDateString("en-US", { month: "short" });
              return (
                <g key={month}>
                  <line x1={x} x2={x} y1={PAD_T} y2={PAD_T + chartH + 4} stroke="currentColor" strokeOpacity={isJan ? 0.15 : 0.05} strokeWidth={isJan ? 1 : 0.5} />
                  <text x={x} y={PAD_T + chartH + 16} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.5}>{label}</text>
                  {isJan && <text x={x} y={PAD_T + chartH + 28} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.7} fontWeight="600">{d.getFullYear()}</text>}
                </g>
              );
            })}

            {/* Step-up cumulative raised area fill */}
            {stepPath && (
              <path d={`${stepPath} L ${PAD_L + chartW},${yOf(0)} L ${PAD_L},${yOf(0)} Z`}
                fill="#6366f1" fillOpacity={0.07} />
            )}

            {/* Step-up cumulative raised line */}
            {stepPath && (
              <path d={stepPath} fill="none" stroke="#6366f1" strokeWidth={2} strokeOpacity={0.5} />
            )}

            {/* Cash balance area (above zero green, below zero red) */}
            {cashSeries.length > 1 && (() => {
              const pts = cashSeries.filter(c => {
                const x = xOf(c.month);
                return x >= PAD_L && x <= PAD_L + chartW;
              });
              if (pts.length < 2) return null;
              const linePts = pts.map(c => `${xOf(c.month)},${yOf(c.cash_k)}`).join(" L ");
              const zeroY = yOf(0);
              return (
                <g>
                  <path d={`M ${xOf(pts[0].month)},${zeroY} L ${linePts} L ${xOf(pts[pts.length-1].month)},${zeroY} Z`}
                    fill="#10b981" fillOpacity={0.08} />
                  <path d={`M ${linePts}`} fill="none" stroke="#10b981" strokeWidth={2} strokeOpacity={0.9} />
                </g>
              );
            })()}

            {/* Today line */}
            {(() => {
              const todayX = xOf(dateToMonth(new Date()));
              return todayX >= PAD_L && todayX <= PAD_L + chartW ? (
                <g>
                  <line x1={todayX} x2={todayX} y1={PAD_T} y2={PAD_T + chartH} stroke="#3b82f6" strokeWidth={1.5} strokeOpacity={0.5} strokeDasharray="4 2" />
                  <text x={todayX + 3} y={PAD_T + 12} fontSize={9} fill="#3b82f6" fillOpacity={0.7}>Today</text>
                </g>
              ) : null;
            })()}

            {/* Raise markers */}
            {sortedWithCumul.map(t => {
              const x = xOf(t.target_month);
              const y = yOf(t.cumul_k);
              if (x < PAD_L || x > PAD_L + chartW) return null;
              return (
                <g key={t.id} style={{ cursor: "pointer" }} onClick={() => { const e = fpaEntries.find(f => f.id === t.id); if (e) openEdit(t.id, e); }}>
                  {t.status === "active" && <circle cx={x} cy={y} r={7} fill={t.color} fillOpacity={0.2} />}
                  <circle cx={x} cy={y} r={4} fill={t.color} />
                  <text x={x} y={y + 20} textAnchor="middle" fontSize={9} fill={t.color} fontWeight="700">+{fmtK(t.amount_k)}</text>
                  <text x={x} y={y - 12} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.8} fontWeight="600">
                    {t.name.length > 16 ? t.name.slice(0, 15) + "…" : t.name}
                  </text>
                </g>
              );
            })}

            {/* Cash balance dots at key raise events */}
            {sortedWithCumul.map(t => {
              const x = xOf(t.target_month);
              if (x < PAD_L || x > PAD_L + chartW) return null;
              const cashAtMonth = cashSeries.find(c => c.month === t.target_month);
              if (!cashAtMonth) return null;
              const y = yOf(cashAtMonth.cash_k);
              return (
                <g key={`cash-${t.id}`}>
                  <circle cx={x} cy={y} r={3} fill="#10b981" />
                  <text x={x} y={y - 8} textAnchor="middle" fontSize={8} fill="#10b981" fillOpacity={0.85} fontWeight="600">
                    {fmtK(cashAtMonth.cash_k)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          Purple step = cumulative capital raised · Green line = cash balance (P&L + equity + loans) · Click a marker to edit
        </p>
      </div>

      {/* Sync status banner */}
      {syncMsg && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg text-xs text-green-700 dark:text-green-300">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {syncMsg}
        </div>
      )}

      {/* Opportunity import modal */}
      {showOppPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowOppPicker(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Import Funding Opportunity to FP&A Model</h3>
              <button onClick={() => setShowOppPicker(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-50 dark:divide-gray-800">
              {allOpps.length === 0 && <p className="text-sm text-gray-400 p-4 text-center">No opportunities found</p>}
              {allOpps.map(opp => (
                <div key={opp.opportunity_id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{opp.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STAGE_STYLES[opp.stage] || ""}`}>{opp.stage}</span>
                      {opp.amount && <span className="text-xs text-gray-500">{opp.amount}</span>}
                      {opp.funding_type && <span className="text-xs text-gray-400">{opp.funding_type}</span>}
                    </div>
                  </div>
                  <button onClick={() => importOpportunity(opp)}
                    className="flex-shrink-0 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                    Add to Model
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Funding entries (synced with FP&A) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Funding Entries</h3>
            <p className="text-xs text-gray-400 mt-0.5">Financial data synced with FP&A model · Plan metadata saved here</p>
          </div>
          <div className="flex items-center gap-2">
            {saving && <span className="text-xs text-gray-400">Saving…</span>}
            <button onClick={() => setShowOppPicker(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Opportunity
            </button>
            <button onClick={addNewEntry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              New Entry
            </button>
          </div>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-10 text-sm text-gray-400 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
            No funding entries in FP&A model. Add one above or import from Opportunities.
          </div>
        )}

        {sorted.map(t => {
          const isEditing = editId === t.id;
          const fpaEntry = fpaEntries.find(e => e.id === t.id);
          return (
            <div key={t.id} className={`rounded-xl border bg-white dark:bg-gray-900 overflow-hidden transition-all ${isEditing ? "border-blue-400 dark:border-blue-600 shadow-md" : "border-gray-200 dark:border-gray-700"}`}>
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => { if (isEditing) { closeEdit(); } else if (fpaEntry) { openEdit(t.id, fpaEntry); } }}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-mono">{FPA_TYPE_LABELS[t.fpa_type]}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      t.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                      : t.status === "closed" ? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    }`}>{t.status}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">{fmtMonth(t.target_month)}</span>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{fmtK(t.amount_k)}</span>
                    {t.type === "dilutive" && t.valuation_k > 0 && <span className="text-xs text-gray-500">@ {fmtK(t.valuation_k)} pre-money</span>}
                    {t.milestone && <span className="text-xs text-gray-400 italic truncate">{t.milestone}</span>}
                  </div>
                </div>
                <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isEditing ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </div>

              {isEditing && fpaEntry && editDraft && metaDraft && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-4 bg-gray-50/50 dark:bg-gray-800/20">
                  {/* FP&A financial fields */}
                  <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Financial Data → synced to FP&A model</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Name</label>
                      <input className={inputCls} value={editDraft.name}
                        onChange={e => setEditDraft(d => d ? { ...d, name: e.target.value } : d)}
                        onBlur={() => editDraft && saveFpaEntries(fpaEntries.map(e => e.id === t.id ? editDraft : e), "FP&A model updated")} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Type</label>
                      <select className={inputCls} value={editDraft.type} onChange={e => {
                        const updated = { ...editDraft, type: e.target.value as FpaFundingEntry["type"] };
                        setEditDraft(updated);
                        saveFpaEntries(fpaEntries.map(f => f.id === t.id ? updated : f), "FP&A model updated");
                      }}>
                        <option value="equity">Equity</option>
                        <option value="safe">SAFE</option>
                        <option value="convertible_note">Conv. Note</option>
                        <option value="grant">Grant</option>
                        <option value="sbir">SBIR/STTR</option>
                        <option value="loan">Loan</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Amount ($)</label>
                      <input type="number" className={inputCls} value={editDraft.amount}
                        onChange={e => setEditDraft(d => d ? { ...d, amount: +e.target.value } : d)}
                        onBlur={() => editDraft && saveFpaEntries(fpaEntries.map(e => e.id === t.id ? editDraft : e), "FP&A model updated")} />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Date</label>
                      <input type="date" className={inputCls} value={editDraft.date || editDraft.start_date} onChange={e => {
                        const patch = FPA_DILUTIVE.includes(editDraft.type) ? { date: e.target.value } : { start_date: e.target.value };
                        const updated = { ...editDraft, ...patch };
                        setEditDraft(updated);
                        saveFpaEntries(fpaEntries.map(f => f.id === t.id ? updated : f), "FP&A model updated");
                      }} />
                    </div>
                    {FPA_DILUTIVE.includes(editDraft.type) && (
                      <div>
                        <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Pre-Money Val ($)</label>
                        <input type="number" className={inputCls} value={editDraft.pre_money_valuation}
                          onChange={e => setEditDraft(d => d ? { ...d, pre_money_valuation: +e.target.value } : d)}
                          onBlur={() => editDraft && saveFpaEntries(fpaEntries.map(e => e.id === t.id ? editDraft : e), "FP&A model updated")} />
                      </div>
                    )}
                  </div>

                  {/* Plan-only fields */}
                  <p className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Plan Metadata → saved here only</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Status</label>
                      <select className={inputCls} value={metaDraft.status} onChange={e => {
                        const updated = { ...metaDraft, status: e.target.value as TrancheMeta["status"] };
                        setMetaDraft(updated);
                        updateMeta(t.id, updated);
                      }}>
                        <option value="planned">Planned</option>
                        <option value="active">Active</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Color</label>
                      <div className="flex gap-1.5 mt-1">
                        {PLAN_COLORS.map(c => (
                          <button key={c} onClick={() => { setMetaDraft(d => d ? { ...d, color: c } : d); updateMeta(t.id, { color: c }); }}
                            className={`w-5 h-5 rounded-full transition-transform ${metaDraft.color === c ? "ring-2 ring-offset-1 ring-gray-400 scale-110" : ""}`}
                            style={{ background: c }} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Milestone Trigger</label>
                    <input className={inputCls} value={metaDraft.milestone}
                      onChange={e => setMetaDraft(d => d ? { ...d, milestone: e.target.value } : d)}
                      onBlur={() => metaDraft && updateMeta(t.id, metaDraft)}
                      placeholder="What needs to happen before this raise…" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Plan Notes</label>
                    <textarea className={inputCls} rows={2} value={metaDraft.plan_notes}
                      onChange={e => setMetaDraft(d => d ? { ...d, plan_notes: e.target.value } : d)}
                      onBlur={() => metaDraft && updateMeta(t.id, metaDraft)} />
                  </div>
                  <button onClick={() => { removeFpaEntry(t.id); setEditId(null); setEditDraft(null); setMetaDraft(null); }}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Remove from FP&A Model
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Strategic notes */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Strategic Notes</h3>
        <textarea
          className="w-full text-sm text-gray-700 dark:text-gray-300 bg-transparent border-0 outline-none resize-none leading-relaxed"
          rows={3}
          value={planStore.strategic_notes}
          onChange={e => setPlanStore(p => ({ ...p, strategic_notes: e.target.value }))}
          onBlur={() => savePlanMeta(planStore)}
          placeholder="Strategic context, investor interest, partnership notes…"
        />
      </div>
    </div>
  );
}

// ── Management Tab (Cap Table) ────────────────────────────────────────────────

interface CapRound {
  round_id: string;
  name: string;
  round_type: string;
  status: string;
  close_date: string | null;
  pre_money_val: string | null;
  amount_raised: string | null;
  share_price: string | null;
  new_shares_issued: number | null;
  lead_investor: string | null;
  safe_cap: string | null;
  discount_pct: string | null;
  interest_rate_pct: string | null;
  maturity_date: string | null;
  mfn: boolean;
  pro_rata_rights: boolean;
  board_seat: boolean;
  notes: string | null;
  sort_order: number;
  security_count: number;
  document_count: number;
  total_invested: string;
}

interface CapHolder {
  holder_id: string;
  name: string;
  holder_type: string;
  email: string | null;
  entity_name: string | null;
  notes: string | null;
  sort_order: number;
  security_count: number;
  document_count: number;
  total_shares: string;
  total_invested: string;
}

interface CapSecurity {
  security_id: string;
  holder_id: string;
  holder_name: string;
  holder_type: string;
  round_id: string | null;
  round_name: string | null;
  round_type: string | null;
  security_type: string;
  share_class: string | null;
  shares: number | null;
  investment_amount: string | null;
  price_per_share: string | null;
  grant_date: string | null;
  vesting_schedule: string | null;
  cliff_months: number | null;
  fully_vested_date: string | null;
  safe_cap: string | null;
  discount_pct: string | null;
  notes: string | null;
}

interface CapDocument {
  document_id: string;
  holder_id: string | null;
  holder_name: string | null;
  round_id: string | null;
  round_name: string | null;
  doc_type: string;
  name: string;
  url: string | null;
  drive_file_id: string | null;
  signed_date: string | null;
  notes: string | null;
  stored_name: string | null;
  mime_type: string | null;
  file_size: number | null;
}

const ROUND_TYPES = ["safe", "convertible_note", "priced", "option_pool", "founders", "warrant"];
const ROUND_STATUSES = ["planned", "open", "closed"];
const HOLDER_TYPES = ["founder", "investor", "advisor", "employee", "option_pool"];
const SECURITY_TYPES = ["common", "preferred", "safe", "convertible_note", "option", "warrant"];
const DOC_TYPES = ["safe", "side_letter", "term_sheet", "subscription_agreement", "voting_agreement", "ipa", "board_consent", "pro_rata", "other"];

const ROUND_TYPE_LABELS: Record<string, string> = {
  safe: "SAFE", convertible_note: "Conv. Note", priced: "Priced Round",
  option_pool: "Option Pool", founders: "Founders", warrant: "Warrant",
};
const HOLDER_TYPE_LABELS: Record<string, string> = {
  founder: "Founder", investor: "Investor", advisor: "Advisor",
  employee: "Employee", option_pool: "Option Pool",
};
const DOC_TYPE_LABELS: Record<string, string> = {
  safe: "SAFE", side_letter: "Side Letter", term_sheet: "Term Sheet",
  subscription_agreement: "Subscription Agreement", voting_agreement: "Voting Agreement",
  ipa: "IPA", board_consent: "Board Consent", pro_rata: "Pro-Rata", other: "Other",
};

const HOLDER_TYPE_COLORS: Record<string, string> = {
  founder:     "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  investor:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  advisor:     "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  employee:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  option_pool: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};
const ROUND_STATUS_COLORS: Record<string, string> = {
  planned: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  open:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  closed:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

function fmtMoney(v: string | number | null): string {
  if (v === null || v === "" || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtShares(v: string | number | null): string {
  if (v === null || v === "" || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n) || n === 0) return "—";
  return n.toLocaleString();
}

function gDriveDownloadUrl(url: string): string {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}

// ── Add Round Modal ────────────────────────────────────────────────────────────

function AddRoundModal({ onClose, onSaved }: { onClose: () => void; onSaved: (r: CapRound) => void }) {
  const [form, setForm] = useState({
    name: "", round_type: "safe", status: "open", close_date: "",
    pre_money_val: "", amount_raised: "", lead_investor: "",
    safe_cap: "", discount_pct: "", interest_rate_pct: "", maturity_date: "",
    mfn: false, pro_rata_rights: false, board_seat: false, notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/proxy/cap-table/rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          pre_money_val:     form.pre_money_val     ? parseFloat(form.pre_money_val)     : null,
          amount_raised:     form.amount_raised     ? parseFloat(form.amount_raised)     : null,
          safe_cap:          form.safe_cap          ? parseFloat(form.safe_cap)          : null,
          discount_pct:      form.discount_pct      ? parseFloat(form.discount_pct)      : null,
          interest_rate_pct: form.interest_rate_pct ? parseFloat(form.interest_rate_pct) : null,
          close_date:        form.close_date    || null,
          maturity_date:     form.maturity_date || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  const isSafe = form.round_type === "safe" || form.round_type === "convertible_note";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 overflow-y-auto max-h-[90vh]">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">New Funding Round</h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Pre-Seed SAFE, Series A…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
              <select value={form.round_type} onChange={e => setForm(f => ({ ...f, round_type: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {ROUND_TYPES.map(t => <option key={t} value={t}>{ROUND_TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {ROUND_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Close Date</label>
              <input type="date" value={form.close_date} onChange={e => setForm(f => ({ ...f, close_date: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Lead Investor</label>
              <input value={form.lead_investor} onChange={e => setForm(f => ({ ...f, lead_investor: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Investor / firm name" />
            </div>
            {!isSafe && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pre-Money Valuation</label>
                <input type="number" value={form.pre_money_val} onChange={e => setForm(f => ({ ...f, pre_money_val: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="5000000" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount Raised</label>
              <input type="number" value={form.amount_raised} onChange={e => setForm(f => ({ ...f, amount_raised: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="500000" />
            </div>
            {isSafe && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Valuation Cap</label>
                  <input type="number" value={form.safe_cap} onChange={e => setForm(f => ({ ...f, safe_cap: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="5000000" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount %</label>
                  <input type="number" value={form.discount_pct} onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="20" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Maturity Date</label>
                  <input type="date" value={form.maturity_date} onChange={e => setForm(f => ({ ...f, maturity_date: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                {form.round_type === "convertible_note" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Interest Rate %</label>
                    <input type="number" value={form.interest_rate_pct} onChange={e => setForm(f => ({ ...f, interest_rate_pct: e.target.value }))}
                      className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="8" />
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex gap-4 pt-1">
            {[
              { key: "mfn", label: "MFN" },
              { key: "pro_rata_rights", label: "Pro-Rata" },
              { key: "board_seat", label: "Board Seat" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={(form as Record<string, unknown>)[key] as boolean}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                  className="rounded" />
                <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
              </label>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Create Round"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Holder Modal ────────────────────────────────────────────────────────────

function AddHolderModal({ onClose, onSaved }: { onClose: () => void; onSaved: (h: CapHolder) => void }) {
  const [form, setForm] = useState({ name: "", holder_type: "investor", email: "", entity_name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/proxy/cap-table/holders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email || null, entity_name: form.entity_name || null, notes: form.notes || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Add Equity Holder</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Smith" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
              <select value={form.holder_type} onChange={e => setForm(f => ({ ...f, holder_type: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {HOLDER_TYPES.map(t => <option key={t} value={t}>{HOLDER_TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="jane@fund.com" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Entity / Fund Name</label>
            <input value={form.entity_name} onChange={e => setForm(f => ({ ...f, entity_name: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Acme Ventures I, LLC" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Add Holder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Security Modal ──────────────────────────────────────────────────────────

function AddSecurityModal({
  holder, rounds, onClose, onSaved,
}: {
  holder: CapHolder;
  rounds: CapRound[];
  onClose: () => void;
  onSaved: (s: CapSecurity) => void;
}) {
  const [form, setForm] = useState({
    security_type: "common", share_class: "", round_id: "",
    shares: "", investment_amount: "", price_per_share: "",
    grant_date: "", vesting_schedule: "", cliff_months: "", fully_vested_date: "",
    safe_cap: "", discount_pct: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/proxy/cap-table/securities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holder_id:         holder.holder_id,
          round_id:          form.round_id          || null,
          security_type:     form.security_type,
          share_class:       form.share_class        || null,
          shares:            form.shares             ? parseInt(form.shares)              : null,
          investment_amount: form.investment_amount  ? parseFloat(form.investment_amount) : null,
          price_per_share:   form.price_per_share    ? parseFloat(form.price_per_share)   : null,
          grant_date:        form.grant_date         || null,
          vesting_schedule:  form.vesting_schedule   || null,
          cliff_months:      form.cliff_months       ? parseInt(form.cliff_months)        : null,
          fully_vested_date: form.fully_vested_date  || null,
          safe_cap:          form.safe_cap           ? parseFloat(form.safe_cap)          : null,
          discount_pct:      form.discount_pct       ? parseFloat(form.discount_pct)      : null,
          notes:             form.notes              || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  const isSafe = form.security_type === "safe" || form.security_type === "convertible_note";
  const hasShares = form.security_type === "common" || form.security_type === "preferred" || form.security_type === "option" || form.security_type === "warrant";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 overflow-y-auto max-h-[90vh]">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Add Security</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{holder.name}</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Security Type</label>
              <select value={form.security_type} onChange={e => setForm(f => ({ ...f, security_type: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {SECURITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Share Class</label>
              <input value={form.share_class} onChange={e => setForm(f => ({ ...f, share_class: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Common A, Series Seed…" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Round</label>
              <select value={form.round_id} onChange={e => setForm(f => ({ ...f, round_id: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— None —</option>
                {rounds.map(r => <option key={r.round_id} value={r.round_id}>{r.name}</option>)}
              </select>
            </div>
            {hasShares && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shares</label>
                  <input type="number" value={form.shares} onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1000000" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Price / Share</label>
                  <input type="number" step="0.000001" value={form.price_per_share} onChange={e => setForm(f => ({ ...f, price_per_share: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0.0001" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Grant Date</label>
                  <input type="date" value={form.grant_date} onChange={e => setForm(f => ({ ...f, grant_date: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Vesting Schedule</label>
                  <input value={form.vesting_schedule} onChange={e => setForm(f => ({ ...f, vesting_schedule: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="4yr / 1yr cliff" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cliff (months)</label>
                  <input type="number" value={form.cliff_months} onChange={e => setForm(f => ({ ...f, cliff_months: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="12" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fully Vested</label>
                  <input type="date" value={form.fully_vested_date} onChange={e => setForm(f => ({ ...f, fully_vested_date: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </>
            )}
            {isSafe && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Investment Amount</label>
                  <input type="number" value={form.investment_amount} onChange={e => setForm(f => ({ ...f, investment_amount: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="50000" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Valuation Cap</label>
                  <input type="number" value={form.safe_cap} onChange={e => setForm(f => ({ ...f, safe_cap: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="5000000" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount %</label>
                  <input type="number" value={form.discount_pct} onChange={e => setForm(f => ({ ...f, discount_pct: e.target.value }))}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="20" />
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Add Security"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Add Document Modal ──────────────────────────────────────────────────────────

function AddDocumentModal({
  holders, rounds, defaultHolderId, defaultRoundId, onClose, onSaved,
}: {
  holders: CapHolder[];
  rounds: CapRound[];
  defaultHolderId?: string;
  defaultRoundId?: string;
  onClose: () => void;
  onSaved: (d: CapDocument) => void;
}) {
  const [form, setForm] = useState({
    doc_type: "safe", name: "", url: "",
    holder_id: defaultHolderId ?? "",
    round_id:  defaultRoundId  ?? "",
    signed_date: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/proxy/cap-table/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type:    form.doc_type,
          name:        form.name,
          url:         form.url        || null,
          holder_id:   form.holder_id  || null,
          round_id:    form.round_id   || null,
          signed_date: form.signed_date || null,
          notes:       form.notes      || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(await res.json());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Add Document</h2>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
              <select value={form.doc_type} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Signed Date</label>
              <input type="date" value={form.signed_date} onChange={e => setForm(f => ({ ...f, signed_date: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Document Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Smith SAFE — Pre-Seed" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL / Drive Link</label>
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://drive.google.com/…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Holder</label>
              <select value={form.holder_id} onChange={e => setForm(f => ({ ...f, holder_id: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— None —</option>
                {holders.map(h => <option key={h.holder_id} value={h.holder_id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Round</label>
              <select value={form.round_id} onChange={e => setForm(f => ({ ...f, round_id: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— None —</option>
                {rounds.map(r => <option key={r.round_id} value={r.round_id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Add Document"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Holder Detail Drawer ────────────────────────────────────────────────────────

function HolderDrawer({
  holder, rounds, onClose, onUpdated,
}: {
  holder: CapHolder;
  rounds: CapRound[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [securities, setSecurities] = useState<CapSecurity[]>([]);
  const [documents, setDocuments] = useState<CapDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [editH, setEditH] = useState<CapHolder>({ ...holder });
  const [drawerTab, setDrawerTab] = useState<"overview" | "securities" | "documents">("overview");
  const [addSec, setAddSec] = useState(false);
  const [addDoc, setAddDoc] = useState(false);
  const [deletingSec, setDeletingSec] = useState<CapSecurity | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<CapDocument | null>(null);
  const [editingSec, setEditingSec] = useState<{ id: string; field: string; value: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [sRes, dRes] = await Promise.all([
        fetch(`/api/proxy/cap-table/securities?holder_id=${holder.holder_id}`),
        fetch(`/api/proxy/cap-table/documents?holder_id=${holder.holder_id}`),
      ]);
      setSecurities(sRes.ok ? await sRes.json() : []);
      setDocuments(dRes.ok ? await dRes.json() : []);
      setLoading(false);
    })();
  }, [holder.holder_id]);

  async function saveHolder(field: string, value: string) {
    const res = await fetch(`/api/proxy/cap-table/holders/${holder.holder_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    if (res.ok) { setEditH(h => ({ ...h, [field]: value })); onUpdated(); }
  }

  async function patchSecurity(secId: string, field: string, rawVal: string) {
    const numFields = new Set(["shares", "investment_amount", "price_per_share", "safe_cap", "discount_pct", "cliff_months"]);
    const val = numFields.has(field) ? (rawVal ? parseFloat(rawVal) : null) : (rawVal || null);
    await fetch(`/api/proxy/cap-table/securities/${secId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: val }),
    });
    const updated = await (await fetch(`/api/proxy/cap-table/securities?holder_id=${holder.holder_id}`)).json();
    setSecurities(updated);
    setEditingSec(null);
    onUpdated();
  }

  async function deleteSecurity(sec: CapSecurity) {
    await fetch(`/api/proxy/cap-table/securities/${sec.security_id}`, { method: "DELETE" });
    setSecurities(s => s.filter(x => x.security_id !== sec.security_id));
    setDeletingSec(null);
    onUpdated();
  }

  async function deleteDocument(doc: CapDocument) {
    await fetch(`/api/proxy/cap-table/documents/${doc.document_id}`, { method: "DELETE" });
    setDocuments(d => d.filter(x => x.document_id !== doc.document_id));
    setDeletingDoc(null);
    onUpdated();
  }

  async function uploadDocumentFile(docId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/proxy/cap-table/documents/${docId}/upload`, { method: "POST", body: fd });
    if (res.ok) {
      const updated = await res.json();
      setDocuments(d => d.map(x => x.document_id === docId ? { ...x, ...updated } : x));
    }
  }

  const CellSec = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editingSec} onStartEdit={(id, f, v) => setEditingSec({ id, field: f, value: v })}
      onCommit={patchSecurity} onCancel={() => setEditingSec(null)} />
  );

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${HOLDER_TYPE_COLORS[editH.holder_type] ?? "bg-gray-100 text-gray-600"}`}>
                {HOLDER_TYPE_LABELS[editH.holder_type] ?? editH.holder_type}
              </span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{editH.name}</h2>
            {editH.entity_name && <p className="text-xs text-gray-500 dark:text-gray-400">{editH.entity_name}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-0 px-6 border-b border-gray-100 dark:border-gray-800">
          {(["overview", "securities", "documents"] as const).map(t => (
            <button key={t} onClick={() => setDrawerTab(t)}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize ${
                drawerTab === t
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}>
              {t}{t === "securities" && securities.length > 0 && ` (${securities.length})`}
              {t === "documents"  && documents.length  > 0 && ` (${documents.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">Loading…</p>
          ) : drawerTab === "overview" ? (
            <div className="space-y-4">
              {/* Editable fields */}
              {[
                { label: "Name",        field: "name",        value: editH.name        ?? "", type: "text" as const },
                { label: "Email",       field: "email",       value: editH.email       ?? "", type: "text" as const },
                { label: "Entity",      field: "entity_name", value: editH.entity_name ?? "", type: "text" as const },
                { label: "Type",        field: "holder_type", value: editH.holder_type ?? "", type: "select" as const, options: HOLDER_TYPES },
                { label: "Notes",       field: "notes",       value: editH.notes       ?? "", type: "text" as const, multiline: true },
              ].map(({ label, field, value, type, options, multiline }) => (
                <FieldRow key={field} label={label} value={value} type={type} options={options} multiline={multiline}
                  onSave={v => saveHolder(field, v)} />
              ))}
              {/* Summary stats */}
              <div className="pt-2 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total Shares</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{fmtShares(holder.total_shares)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Total Invested</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{fmtMoney(holder.total_invested)}</p>
                </div>
              </div>
            </div>
          ) : drawerTab === "securities" ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setAddSec(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Security
                </button>
              </div>
              {securities.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">No securities yet</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800">
                        {["Type", "Class", "Round", "Shares", "Invested", "Cap", "Disc%", "Vesting", ""].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {securities.map(sec => (
                        <tr key={sec.security_id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <CellSec rowId={sec.security_id} field="security_type" value={sec.security_type}
                            editType="select" selectOptions={SECURITY_TYPES}
                            display={<span className="font-medium">{sec.security_type}</span>} />
                          <CellSec rowId={sec.security_id} field="share_class" value={sec.share_class ?? ""}
                            placeholder="Class A…"
                            display={sec.share_class
                              ? <span>{sec.share_class}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
                            {sec.round_name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                          </td>
                          <CellSec rowId={sec.security_id} field="shares" value={sec.shares?.toString() ?? ""}
                            placeholder="1000000"
                            display={sec.shares
                              ? <span className="font-medium">{sec.shares.toLocaleString()}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <CellSec rowId={sec.security_id} field="investment_amount" value={sec.investment_amount ?? ""}
                            placeholder="50000"
                            display={sec.investment_amount
                              ? <span className="font-medium">{fmtMoney(sec.investment_amount)}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <CellSec rowId={sec.security_id} field="safe_cap" value={sec.safe_cap ?? ""}
                            placeholder="5000000"
                            display={sec.safe_cap
                              ? <span>{fmtMoney(sec.safe_cap)}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <CellSec rowId={sec.security_id} field="discount_pct" value={sec.discount_pct ?? ""}
                            placeholder="20"
                            display={sec.discount_pct
                              ? <span>{sec.discount_pct}%</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <CellSec rowId={sec.security_id} field="vesting_schedule" value={sec.vesting_schedule ?? ""}
                            placeholder="4yr/1yr…"
                            display={sec.vesting_schedule
                              ? <span className="truncate max-w-[80px] block" title={sec.vesting_schedule}>{sec.vesting_schedule}</span>
                              : <span className="text-gray-300 dark:text-gray-600">—</span>} />
                          <td className="px-3 py-2">
                            <button onClick={() => setDeletingSec(sec)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setAddDoc(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Document
                </button>
              </div>
              {documents.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">No documents yet</p>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => (
                    <div key={doc.document_id} className="group flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                          </span>
                          {doc.signed_date && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">· {doc.signed_date}</span>
                          )}
                          {doc.url && (
                            <span className="text-xs text-green-600 dark:text-green-400 font-medium">· Linked</span>
                          )}
                        </div>
                        {doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block">
                            {doc.name}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{doc.name}</p>
                        )}
                        {doc.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{doc.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        {doc.url && (
                          <a href={gDriveDownloadUrl(doc.url)} target="_blank" rel="noopener noreferrer" title="Download"
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-500 rounded transition-opacity">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                          </a>
                        )}
                        <button onClick={() => setDeletingDoc(doc)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {addSec && (
        <AddSecurityModal holder={holder} rounds={rounds} onClose={() => setAddSec(false)}
          onSaved={s => { setSecurities(prev => [...prev, s]); setAddSec(false); onUpdated(); }} />
      )}
      {addDoc && (
        <AddDocumentModal holders={[holder]} rounds={rounds} defaultHolderId={holder.holder_id}
          onClose={() => setAddDoc(false)}
          onSaved={d => { setDocuments(prev => [...prev, d]); setAddDoc(false); }} />
      )}
      {deletingSec && (
        <DeleteConfirm title={`${deletingSec.security_type} security`}
          onConfirm={() => deleteSecurity(deletingSec)} onCancel={() => setDeletingSec(null)} />
      )}
      {deletingDoc && (
        <DeleteConfirm title={deletingDoc.name}
          onConfirm={() => deleteDocument(deletingDoc)} onCancel={() => setDeletingDoc(null)} />
      )}
    </div>
  );
}

// Helper: inline edit field row for the drawer overview
function FieldRow({ label, value, type, options, multiline, onSave }: {
  label: string; value: string; type: "text" | "select"; options?: string[];
  multiline?: boolean; onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0 pt-1">{label}</span>
      {editing ? (
        type === "select" ? (
          <select value={draft} autoFocus onChange={e => { setDraft(e.target.value); setEditing(false); onSave(e.target.value); }}
            onBlur={() => setEditing(false)}
            className="flex-1 text-sm px-2 py-1 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none">
            {(options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : multiline ? (
          <textarea value={draft} autoFocus rows={3}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
            className="flex-1 text-sm px-2 py-1 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none resize-none" />
        ) : (
          <input value={draft} autoFocus
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(value); } }}
            className="flex-1 text-sm px-2 py-1 rounded border border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none" />
        )
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true); }}
          className="flex-1 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group/fr">
          {value || <span className="text-gray-300 dark:text-gray-600 italic">Click to edit…</span>}
          <span className="ml-1 opacity-0 group-hover/fr:opacity-40">
            <svg className="w-2.5 h-2.5 inline text-blue-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15H9v-2.828z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}

// ── Main ManagementTab ─────────────────────────────────────────────────────────

type MgmtSubTab = "cap-table" | "rounds" | "documents";

function ManagementTab() {
  const [subTab, setSubTab] = useState<MgmtSubTab>("cap-table");
  const [holders,    setHolders]    = useState<CapHolder[]>([]);
  const [rounds,     setRounds]     = useState<CapRound[]>([]);
  const [securities, setSecurities] = useState<CapSecurity[]>([]);
  const [documents,  setDocuments]  = useState<CapDocument[]>([]);
  const [loading,    setLoading]    = useState(true);

  const [addHolder,   setAddHolder]   = useState(false);
  const [addRound,    setAddRound]    = useState(false);
  const [addDoc,      setAddDoc]      = useState(false);
  const [selectedHolder, setSelectedHolder] = useState<CapHolder | null>(null);
  const [deletingHolder, setDeletingHolder] = useState<CapHolder | null>(null);
  const [deletingRound,  setDeletingRound]  = useState<CapRound  | null>(null);
  const [deletingDoc,    setDeletingDoc]    = useState<CapDocument | null>(null);

  const [editingRound,  setEditingRound]  = useState<{ id: string; field: string; value: string } | null>(null);
  const [editingDoc,    setEditingDoc]    = useState<{ id: string; field: string; value: string } | null>(null);
  const [editingHolder, setEditingHolder] = useState<{ id: string; field: string; value: string } | null>(null);

  const load = useCallback(async () => {
    const [hRes, rRes, sRes, dRes] = await Promise.all([
      fetch("/api/proxy/cap-table/holders"),
      fetch("/api/proxy/cap-table/rounds"),
      fetch("/api/proxy/cap-table/securities"),
      fetch("/api/proxy/cap-table/documents"),
    ]);
    setHolders(hRes.ok ? await hRes.json() : []);
    setRounds(rRes.ok  ? await rRes.json() : []);
    setSecurities(sRes.ok ? await sRes.json() : []);
    setDocuments(dRes.ok  ? await dRes.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Cap table derived stats ──
  const totalShares = securities.reduce((s, x) => s + (x.shares ?? 0), 0);
  const totalInvested = securities.reduce((s, x) => s + parseFloat(x.investment_amount ?? "0"), 0);

  // % ownership per holder (shares basis — SAFEs show as "TBD" if no shares)
  function ownershipPct(h: CapHolder): string {
    const sh = parseFloat(h.total_shares ?? "0");
    if (totalShares === 0 || sh === 0) return "—";
    return (sh / totalShares * 100).toFixed(2) + "%";
  }

  // ── Patch helpers ──
  async function patchRound(roundId: string, field: string, rawVal: string) {
    const numFields = new Set(["pre_money_val", "amount_raised", "share_price", "safe_cap", "discount_pct", "interest_rate_pct", "new_shares_issued", "sort_order"]);
    const boolFields = new Set(["mfn", "pro_rata_rights", "board_seat"]);
    let val: unknown = rawVal || null;
    if (numFields.has(field)) val = rawVal ? parseFloat(rawVal) : null;
    if (boolFields.has(field)) val = rawVal === "true";
    const res = await fetch(`/api/proxy/cap-table/rounds/${roundId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: val }),
    });
    if (res.ok) {
      const updated: CapRound = await res.json();
      setRounds(rs => rs.map(r => r.round_id === roundId ? { ...r, ...updated } : r));
    }
    setEditingRound(null);
  }

  async function patchDoc(docId: string, field: string, rawVal: string) {
    const res = await fetch(`/api/proxy/cap-table/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: rawVal || null }),
    });
    if (res.ok) {
      const updated: CapDocument = await res.json();
      setDocuments(ds => ds.map(d => d.document_id === docId ? { ...d, ...updated } : d));
    }
    setEditingDoc(null);
  }

  const CellR = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editingRound} onStartEdit={(id, f, v) => setEditingRound({ id, field: f, value: v })}
      onCommit={patchRound} onCancel={() => setEditingRound(null)} />
  );

  const CellD = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editingDoc} onStartEdit={(id, f, v) => setEditingDoc({ id, field: f, value: v })}
      onCommit={patchDoc} onCancel={() => setEditingDoc(null)} />
  );

  async function patchHolder(holderId: string, field: string, rawVal: string) {
    const res = await fetch(`/api/proxy/cap-table/holders/${holderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: rawVal || null }),
    });
    if (res.ok) {
      const updated: CapHolder = await res.json();
      setHolders(hs => hs.map(h => h.holder_id === holderId ? { ...h, ...updated } : h));
    }
    setEditingHolder(null);
  }

  const CellH = (props: Omit<Parameters<typeof EditableCell>[0], "editing" | "onStartEdit" | "onCommit" | "onCancel">) => (
    <EditableCell {...props} editing={editingHolder} onStartEdit={(id, f, v) => setEditingHolder({ id, field: f, value: v })}
      onCommit={patchHolder} onCancel={() => setEditingHolder(null)} />
  );

  async function deleteHolder(h: CapHolder) {
    await fetch(`/api/proxy/cap-table/holders/${h.holder_id}`, { method: "DELETE" });
    setHolders(hs => hs.filter(x => x.holder_id !== h.holder_id));
    setDeletingHolder(null);
  }

  async function deleteRound(r: CapRound) {
    await fetch(`/api/proxy/cap-table/rounds/${r.round_id}`, { method: "DELETE" });
    setRounds(rs => rs.filter(x => x.round_id !== r.round_id));
    setDeletingRound(null);
  }

  async function deleteDoc(d: CapDocument) {
    await fetch(`/api/proxy/cap-table/documents/${d.document_id}`, { method: "DELETE" });
    setDocuments(ds => ds.filter(x => x.document_id !== d.document_id));
    setDeletingDoc(null);
  }

  async function uploadDocFile(docId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/proxy/cap-table/documents/${docId}/upload`, { method: "POST", body: fd });
    if (res.ok) {
      const updated = await res.json();
      setDocuments(ds => ds.map(d => d.document_id === docId ? { ...d, ...updated } : d));
    }
  }

  // Group holders by type for the cap table view
  const groupOrder: CapHolder["holder_type"][] = ["founder", "employee", "advisor", "investor", "option_pool"];
  const grouped = groupOrder
    .map(type => ({ type, items: holders.filter(h => h.holder_type === type) }))
    .filter(g => g.items.length > 0);

  const subTabs: { id: MgmtSubTab; label: string }[] = [
    { id: "cap-table",  label: "Cap Table" },
    { id: "rounds",     label: "Rounds" },
    { id: "documents",  label: "Documents" },
  ];

  return (
    <>
      {/* Sub-tab bar + actions */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
          {subTabs.map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                subTab === t.id
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {subTab === "cap-table"  && (
            <button onClick={() => setAddHolder(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Holder
            </button>
          )}
          {subTab === "rounds" && (
            <button onClick={() => setAddRound(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Round
            </button>
          )}
          {subTab === "documents" && (
            <button onClick={() => setAddDoc(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Document
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        </div>
      ) : subTab === "cap-table" ? (
        <>
          {/* Summary strip */}
          {holders.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Total Shareholders", value: holders.length.toString() },
                { label: "Total Shares Issued", value: totalShares > 0 ? totalShares.toLocaleString() : "—" },
                { label: "Total Capital Raised", value: fmtMoney(totalInvested) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          )}

          {holders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-52 gap-3">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
              <p className="text-sm text-gray-500 dark:text-gray-400">No equity holders yet</p>
              <button onClick={() => setAddHolder(true)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Add First Holder
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Shares</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">Invested</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">% Ownership</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">Securities</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">Docs</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {grouped.map(({ type, items }) => (
                    <React.Fragment key={type}>
                      {/* Group header row */}
                      <tr className="border-t border-gray-200 dark:border-gray-700">
                        <td colSpan={9} className="px-4 pt-3 pb-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                            {HOLDER_TYPE_LABELS[type] ?? type}s
                          </span>
                        </td>
                      </tr>
                      {items.map(h => (
                        <tr key={h.holder_id} className="group hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors cursor-pointer"
                          onClick={() => { if (!editingHolder) setSelectedHolder(h); }}>
                          <CellH rowId={h.holder_id} field="name" value={h.name}
                            display={
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                                {h.name}
                              </span>
                            } />
                          <CellH rowId={h.holder_id} field="holder_type" value={h.holder_type}
                            editType="select" selectOptions={HOLDER_TYPES}
                            display={
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${HOLDER_TYPE_COLORS[h.holder_type] ?? "bg-gray-100 text-gray-600"}`}>
                                {HOLDER_TYPE_LABELS[h.holder_type] ?? h.holder_type}
                              </span>
                            } />
                          <CellH rowId={h.holder_id} field="entity_name" value={h.entity_name ?? ""} placeholder="Entity name…"
                            display={
                              h.entity_name
                                ? <span className="text-xs text-gray-500 dark:text-gray-400">{h.entity_name}</span>
                                : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            } />
                          <td className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                            {fmtShares(h.total_shares)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums">
                            {fmtMoney(h.total_invested)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 tabular-nums">
                              {ownershipPct(h)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {h.security_count > 0 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                                {h.security_count}
                              </span>
                            ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {h.document_count > 0 ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                                {h.document_count}
                              </span>
                            ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <button onClick={() => setDeletingHolder(h)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {/* Totals row */}
                  {holders.length > 0 && (
                    <tr className="bg-gray-50 dark:bg-gray-800 border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                      <td className="px-4 py-3 text-xs font-semibold text-gray-700 dark:text-gray-300" colSpan={3}>Total</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtShares(totalShares)}</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtMoney(totalInvested)}</td>
                      <td className="px-4 py-3 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">100%</td>
                      <td colSpan={3}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : subTab === "rounds" ? (
        rounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 gap-3">
            <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">No funding rounds yet</p>
            <button onClick={() => setAddRound(true)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Add First Round
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  {["Name", "Type", "Status", "Date", "Pre-Money", "Raised", "Lead", "Cap", "Disc%", "MFN", "Pro-Rata", "Board", ""].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rounds.map(r => (
                  <tr key={r.round_id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <CellR rowId={r.round_id} field="name" value={r.name}
                      display={<span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span>} />
                    <CellR rowId={r.round_id} field="round_type" value={r.round_type}
                      editType="select" selectOptions={ROUND_TYPES}
                      display={<span className="text-xs font-medium text-gray-600 dark:text-gray-400">{ROUND_TYPE_LABELS[r.round_type] ?? r.round_type}</span>} />
                    <CellR rowId={r.round_id} field="status" value={r.status}
                      editType="select" selectOptions={ROUND_STATUSES}
                      display={
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROUND_STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </span>
                      } />
                    <CellR rowId={r.round_id} field="close_date" value={r.close_date ?? ""} placeholder="YYYY-MM-DD"
                      display={r.close_date
                        ? <span className="text-xs text-gray-600 dark:text-gray-400">{r.close_date}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellR rowId={r.round_id} field="pre_money_val" value={r.pre_money_val ?? ""} placeholder="5000000"
                      display={r.pre_money_val
                        ? <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(r.pre_money_val)}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellR rowId={r.round_id} field="amount_raised" value={r.amount_raised ?? ""} placeholder="500000"
                      display={r.amount_raised
                        ? <span className="text-xs font-medium text-green-700 dark:text-green-400 tabular-nums">{fmtMoney(r.amount_raised)}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellR rowId={r.round_id} field="lead_investor" value={r.lead_investor ?? ""} placeholder="Firm name…"
                      display={r.lead_investor
                        ? <span className="text-xs text-gray-700 dark:text-gray-300">{r.lead_investor}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellR rowId={r.round_id} field="safe_cap" value={r.safe_cap ?? ""} placeholder="5000000"
                      display={r.safe_cap
                        ? <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums">{fmtMoney(r.safe_cap)}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellR rowId={r.round_id} field="discount_pct" value={r.discount_pct ?? ""} placeholder="20"
                      display={r.discount_pct
                        ? <span className="text-xs text-gray-700 dark:text-gray-300 tabular-nums">{r.discount_pct}%</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={r.mfn} readOnly
                        className="rounded pointer-events-none" />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={r.pro_rata_rights} readOnly
                        className="rounded pointer-events-none" />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={r.board_seat} readOnly
                        className="rounded pointer-events-none" />
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => setDeletingRound(r)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        /* Documents tab */
        documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 gap-3">
            <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">No documents yet</p>
            <button onClick={() => setAddDoc(true)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Add First Document
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  {["Type", "Name", "Holder", "Round", "Signed", "Notes", "Link", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {documents.map(doc => (
                  <tr key={doc.document_id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <CellD rowId={doc.document_id} field="doc_type" value={doc.doc_type}
                      editType="select" selectOptions={DOC_TYPES}
                      display={
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 whitespace-nowrap">
                          {DOC_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                        </span>
                      } />
                    <CellD rowId={doc.document_id} field="name" value={doc.name}
                      display={
                        doc.url ? (
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                            {doc.name}
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                          </a>
                        ) : (
                          <span className="font-medium text-gray-900 dark:text-gray-100">{doc.name}</span>
                        )
                      } />
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {doc.holder_name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {doc.round_name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <CellD rowId={doc.document_id} field="signed_date" value={doc.signed_date ?? ""} placeholder="YYYY-MM-DD"
                      display={doc.signed_date
                        ? <span className="text-xs text-gray-600 dark:text-gray-400">{doc.signed_date}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellD rowId={doc.document_id} field="notes" value={doc.notes ?? ""} placeholder="Notes…" multiline
                      className="max-w-[180px]"
                      display={doc.notes
                        ? <span className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{doc.notes}</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>} />
                    <CellD rowId={doc.document_id} field="url" value={doc.url ?? ""} placeholder="Paste Drive URL…"
                      display={
                        doc.url ? (
                          <div className="flex items-center gap-2">
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" title="View"
                              className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" /><circle cx="12" cy="12" r="3" />
                              </svg>
                            </a>
                            <a href={gDriveDownloadUrl(doc.url)} target="_blank" rel="noopener noreferrer" title="Download"
                              className="text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                            </a>
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                        )
                      } />
                    <td className="px-4 py-3">
                      <button onClick={() => setDeletingDoc(doc)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-opacity">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Modals */}
      {addHolder && (
        <AddHolderModal onClose={() => setAddHolder(false)}
          onSaved={h => { setHolders(hs => [...hs, h]); setAddHolder(false); }} />
      )}
      {addRound && (
        <AddRoundModal onClose={() => setAddRound(false)}
          onSaved={r => { setRounds(rs => [...rs, r]); setAddRound(false); }} />
      )}
      {addDoc && (
        <AddDocumentModal holders={holders} rounds={rounds}
          onClose={() => setAddDoc(false)}
          onSaved={d => { setDocuments(ds => [...ds, d]); setAddDoc(false); }} />
      )}
      {selectedHolder && (
        <HolderDrawer holder={selectedHolder} rounds={rounds}
          onClose={() => setSelectedHolder(null)}
          onUpdated={load} />
      )}
      {deletingHolder && (
        <DeleteConfirm title={deletingHolder.name}
          onConfirm={() => deleteHolder(deletingHolder)} onCancel={() => setDeletingHolder(null)} />
      )}
      {deletingRound && (
        <DeleteConfirm title={deletingRound.name}
          onConfirm={() => deleteRound(deletingRound)} onCancel={() => setDeletingRound(null)} />
      )}
      {deletingDoc && (
        <DeleteConfirm title={deletingDoc.name}
          onConfirm={() => deleteDoc(deletingDoc)} onCancel={() => setDeletingDoc(null)} />
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type FundingTab = "non-dilutive" | "dilutive" | "plan" | "management" | "reports";

export default function FundingPage() {
  const [activeTab, setActiveTab] = useState<FundingTab>("non-dilutive");
  const [addNonDilutive, setAddNonDilutive] = useState(false);

  const tabs: { id: FundingTab; label: string }[] = [
    { id: "non-dilutive", label: "Applications" },
    { id: "dilutive",     label: "Investors" },
    { id: "plan",         label: "Plan" },
    { id: "management",   label: "Management" },
    { id: "reports",      label: "Reports" },
  ];

  const subtitles: Record<FundingTab, string> = {
    "non-dilutive": "Grants, accelerators & pitch competitions",
    "dilutive":     "Investors, VCs & equity financing",
    "plan":         "Funding strategy & roadmap",
    "management":   "Portfolio & relationship management",
    "reports":      "Funding reports & analytics",
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Funding</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitles[activeTab]}</p>
        </div>
        {activeTab === "non-dilutive" && (
          <button onClick={() => setAddNonDilutive(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        )}
      </div>

      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "non-dilutive" && (
        <NonDilutiveTab forceAdd={addNonDilutive} onAddConsumed={() => setAddNonDilutive(false)} />
      )}
      {activeTab === "dilutive" && <DilutiveTab />}
      {activeTab === "plan" && <FundraisePlanTab />}
      {activeTab === "management" && <ManagementTab />}
      {activeTab === "reports" && (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-gray-400 dark:text-gray-500">Reports — coming soon.</p>
        </div>
      )}
    </div>
  );
}
