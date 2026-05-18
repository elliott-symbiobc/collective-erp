"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

interface Protocol {
  protocol_id: string;
  protocol_type: string;
  title: string;
  version: string;
  status: string;
  source_type: string;
  source_queue_id: string | null;
  source_paper_doi: string | null;
  organism: string | null;
  substrate: string | null;
  vessel_type: string | null;
  scale: string | null;
  author: string | null;
  is_internal: boolean;
  created_at: string;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  tags: string[] | null;
}

interface ProtocolDetail extends Protocol {
  content_markdown: string | null;
  content_json: object | null;
}

interface ProtocolRevision {
  revision_id: string;
  protocol_id: string;
  revised_at: string;
  version_label: string | null;
  is_major: boolean | null;
  change_summary: string | null;
  changed_by_name: string | null;
  title: string | null;
  protocol_type: string | null;
  author: string | null;
  organism: string | null;
  substrate: string | null;
  vessel_type: string | null;
  scale: string | null;
  notes: string | null;
  tags: string[] | null;
  content_markdown: string | null;
  is_internal: boolean | null;
}

type Snapshotable = Pick<ProtocolRevision,
  "title" | "protocol_type" | "author" | "organism" | "substrate" |
  "vessel_type" | "scale" | "notes" | "tags" | "is_internal" | "content_markdown"
>;

const REVISION_FIELD_LABELS: Record<string, string> = {
  title: "Title", protocol_type: "Type", author: "Author",
  organism: "Organism", substrate: "Substrate", vessel_type: "Vessel",
  scale: "Scale", notes: "Notes", tags: "Tags",
  is_internal: "Internal flag", content_markdown: "Content",
};

function changedFields(before: Snapshotable, after: Snapshotable): string[] {
  return (Object.keys(REVISION_FIELD_LABELS) as (keyof Snapshotable)[]).filter(f => {
    const a = f === "tags" ? (before[f] ?? []) as string[] : null;
    const b = f === "tags" ? (after[f]  ?? []) as string[] : null;
    if (a !== null && b !== null) return a.join(",") !== b.join(",");
    return String(before[f] ?? "") !== String(after[f] ?? "");
  }).map(f => REVISION_FIELD_LABELS[f]);
}

// ── Constants ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  fermentation_method: "Fermentation",
  medium_preparation: "Medium Prep",
  downstream_processing: "Downstream",
  genome_edit_sop: "Genome Edit SOP",
  analytical_assay: "Analytical Assay",
  strain_maintenance: "Strain Maintenance",
  substrate_preparation: "Substrate Prep",
  other: "Other",
};

const TYPE_COLORS: Record<string, string> = {
  fermentation_method: "bg-blue-100 text-blue-700",
  medium_preparation: "bg-green-100 text-green-700",
  downstream_processing: "bg-purple-100 text-purple-700",
  genome_edit_sop: "bg-red-100 text-red-700",
  analytical_assay: "bg-amber-100 text-amber-700",
  strain_maintenance: "bg-teal-100 text-teal-700",
  substrate_preparation: "bg-orange-100 text-orange-700",
  other: "bg-gray-100 text-gray-700",
};

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-100 text-green-700",
  draft: "bg-amber-100 text-amber-700",
  archived: "bg-gray-100 text-gray-500",
};

const SOURCE_LABELS: Record<string, string> = {
  generated: "Generated",
  extracted: "Extracted",
  manual: "Manual",
  imported: "Imported",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function TypeBadge({ type }: { type: string }) {
  const label = TYPE_LABELS[type] ?? type;
  const color = TYPE_COLORS[type] ?? "bg-gray-100 text-gray-600";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

function InternalBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 1a5 5 0 015 5v2h1a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V10a2 2 0 012-2h1V6a5 5 0 015-5zm0 2a3 3 0 00-3 3v2h6V6a3 3 0 00-3-3zm0 9a2 2 0 110 4 2 2 0 010-4z"/>
      </svg>
      Internal
    </span>
  );
}

// ── Protocol Detail Drawer ─────────────────────────────────────────────────

const FIELD_CLS = "w-full text-sm text-gray-900 bg-white border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-400 placeholder-gray-400";

function renderMarkdown(md: string) {
  return md.split("\n").map((line, i) => {
    if (line.startsWith("# "))  return <h1  key={i} className="text-lg font-bold mt-0 mb-3">{line.slice(2)}</h1>;
    if (line.startsWith("## ")) return <h2  key={i} className="text-sm font-semibold text-gray-700 mt-4 mb-2 uppercase tracking-wide">{line.slice(3)}</h2>;
    if (line.startsWith("| ") && line.includes("|")) {
      const cells = line.split("|").filter(c => c.trim()).map(c => c.trim());
      return (
        <div key={i} className="grid text-xs py-1 border-b border-gray-100 gap-2"
          style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
          {cells.map((c, j) => <span key={j}>{c}</span>)}
        </div>
      );
    }
    if (/^\d+\./.test(line))    return <p key={i} className="text-sm text-gray-700 mb-1">{line}</p>;
    if (line.startsWith("---")) return <hr key={i} className="my-3 border-gray-200" />;
    if (line.startsWith("*") && line.endsWith("*")) return <p key={i} className="text-xs text-gray-500 italic">{line.slice(1, -1)}</p>;
    if (line.trim())             return <p key={i} className="text-sm text-gray-700 mb-1">{line}</p>;
    return <div key={i} className="h-2" />;
  });
}

function ProtocolDetail({
  protocol,
  onClose,
  onStatusChange,
  onSaved,
}: {
  protocol: ProtocolDetail;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onSaved: (updated: ProtocolDetail) => void;
}) {
  const [editMode, setEditMode]   = useState(false);
  const [updating, setUpdating]   = useState(false);
  const [saving,   setSaving]     = useState(false);
  const [statusError, setStatusError] = useState("");
  const [saveError,   setSaveError]   = useState("");
  const [revisions,   setRevisions]   = useState<ProtocolRevision[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [diffRevision, setDiffRevision] = useState<ProtocolRevision | null>(null);
  // versioning fields for save
  const [isMajor,       setIsMajor]       = useState(false);
  const [changeSummary, setChangeSummary] = useState("");

  // Edit fields
  const [title,      setTitle]      = useState(protocol.title);
  const [type,       setType]       = useState(protocol.protocol_type);
  const [author,     setAuthor]     = useState(protocol.author ?? "");
  const [isInternal, setIsInternal] = useState(protocol.is_internal);
  const [organism,   setOrganism]   = useState(protocol.organism ?? "");
  const [substrate,  setSubstrate]  = useState(protocol.substrate ?? "");
  const [vessel,     setVessel]     = useState(protocol.vessel_type ?? "");
  const [scale,      setScale]      = useState(protocol.scale ?? "");
  const [notes,      setNotes]      = useState(protocol.notes ?? "");
  const [tags,       setTags]       = useState((protocol.tags ?? []).join(", "));
  const [content,    setContent]    = useState(protocol.content_markdown ?? "");
  const [createdAt,  setCreatedAt]  = useState(protocol.created_at ? protocol.created_at.slice(0, 10) : "");
  const [approvedAt, setApprovedAt] = useState(protocol.approved_at ? protocol.approved_at.slice(0, 10) : "");

  useEffect(() => {
    fetch(`/api/proxy/protocols/${protocol.protocol_id}/revisions`)
      .then(r => r.ok ? r.json() : [])
      .then(setRevisions)
      .catch(() => {});
  }, [protocol.protocol_id]);

  function enterEdit() {
    setTitle(protocol.title);
    setType(protocol.protocol_type);
    setAuthor(protocol.author ?? "");
    setIsInternal(protocol.is_internal);
    setOrganism(protocol.organism ?? "");
    setSubstrate(protocol.substrate ?? "");
    setVessel(protocol.vessel_type ?? "");
    setScale(protocol.scale ?? "");
    setNotes(protocol.notes ?? "");
    setTags((protocol.tags ?? []).join(", "));
    setContent(protocol.content_markdown ?? "");
    setCreatedAt(protocol.created_at ? protocol.created_at.slice(0, 10) : "");
    setApprovedAt(protocol.approved_at ? protocol.approved_at.slice(0, 10) : "");
    setSaveError("");
    setEditMode(true);
  }

  async function saveEdit() {
    if (!title.trim()) { setSaveError("Title is required"); return; }
    setSaving(true);
    setSaveError("");
    try {
      const body: Record<string, unknown> = {
        title:            title.trim(),
        protocol_type:    type,
        author:           author.trim() || null,
        is_internal:      isInternal,
        organism:         organism.trim() || null,
        substrate:        substrate.trim() || null,
        vessel_type:      vessel.trim() || null,
        scale:            scale.trim() || null,
        notes:            notes.trim() || null,
        tags:             tags.split(",").map(t => t.trim()).filter(Boolean),
        content_markdown: content,
        created_at:       createdAt  || null,
        approved_at:      approvedAt || null,
        is_major:         isMajor,
        change_summary:   changeSummary.trim() || null,
      };
      const res = await fetch(`/api/proxy/protocols/${protocol.protocol_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setSaveError(d.detail ?? "Save failed"); return; }
      const updated = await res.json();
      onSaved(updated);
      setEditMode(false);
      setIsMajor(false);
      setChangeSummary("");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(newStatus: string) {
    setUpdating(true);
    setStatusError("");
    try {
      const res = await fetch(`/api/proxy/protocols/${protocol.protocol_id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        onStatusChange(protocol.protocol_id, newStatus);
      } else {
        const d = await res.json().catch(() => ({}));
        setStatusError(d.detail ?? "Update failed");
      }
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            {editMode ? (
              <input value={title} onChange={e => setTitle(e.target.value)}
                className={`${FIELD_CLS} text-base font-semibold`} placeholder="Protocol title" />
            ) : (
              <h2 className="text-base font-semibold text-gray-900 leading-snug">{protocol.title}</h2>
            )}
            {!editMode && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <TypeBadge type={protocol.protocol_type} />
                <StatusBadge status={protocol.status} />
                {protocol.is_internal && <InternalBadge />}
                <span className="text-xs text-gray-500">v{protocol.version}</span>
                {protocol.organism && <span className="text-xs text-gray-500 italic">{protocol.organism}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!editMode && (
              <button onClick={enterEdit}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Meta / Edit fields */}
        {editMode ? (
          <div className="px-6 py-4 border-b border-gray-100 space-y-3 shrink-0">
            {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{saveError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Type</label>
                <select value={type} onChange={e => setType(e.target.value)} className={FIELD_CLS}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Author</label>
                <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="e.g. J. Smith" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Organism</label>
                <input value={organism} onChange={e => setOrganism(e.target.value)} placeholder="e.g. A. oryzae RIB40" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Substrate</label>
                <input value={substrate} onChange={e => setSubstrate(e.target.value)} placeholder="e.g. Wheat Bran" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Vessel type</label>
                <input value={vessel} onChange={e => setVessel(e.target.value)} placeholder="e.g. shake_flask" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Scale</label>
                <input value={scale} onChange={e => setScale(e.target.value)} placeholder="e.g. lab, pilot" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Tags <span className="text-gray-400">(comma-separated)</span></label>
                <input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. SSF, cellulase" className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Created date</label>
                <input type="date" value={createdAt} onChange={e => setCreatedAt(e.target.value)} className={FIELD_CLS} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-0.5">Approved date</label>
                <input type="date" value={approvedAt} onChange={e => setApprovedAt(e.target.value)} className={FIELD_CLS} />
              </div>
              <div className="flex items-center gap-3 pt-4">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
                <span className="text-sm text-gray-700 font-medium">Internal protocol</span>
                <span className="text-xs text-gray-400">Not visible in public-facing outputs</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes" className={FIELD_CLS} />
            </div>
            {/* Version bump */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Version</p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isMajor} onChange={e => setIsMajor(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700 font-medium">Major version</span>
                  <span className="text-xs text-gray-400">(bumps vX.0)</span>
                </label>
              </div>
              <input value={changeSummary} onChange={e => setChangeSummary(e.target.value)}
                placeholder="Change summary (optional)"
                className={FIELD_CLS} />
            </div>
          </div>
        ) : (
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 shrink-0">
            <span>Source: <span className="font-medium text-gray-700">{SOURCE_LABELS[protocol.source_type] ?? protocol.source_type}</span></span>
            {protocol.author && <span>Author: <span className="font-medium text-gray-700">{protocol.author}</span></span>}
            {protocol.substrate && <span>Substrate: <span className="font-medium text-gray-700">{protocol.substrate}</span></span>}
            {protocol.source_paper_doi && (
              <a href={`https://doi.org/${protocol.source_paper_doi}`} target="_blank" rel="noopener noreferrer"
                className="text-blue-600 hover:underline">
                DOI: {protocol.source_paper_doi}
              </a>
            )}
            <span>Created: {formatDate(protocol.created_at)}</span>
            {protocol.approved_at && <span>Approved: {formatDate(protocol.approved_at)} by {protocol.approved_by}</span>}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {editMode ? (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Content <span className="text-gray-400">(Markdown)</span></label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                rows={24}
                className="w-full text-sm text-gray-900 bg-white border border-gray-300 rounded px-3 py-2 font-mono focus:outline-none focus:border-blue-400 resize-y"
                placeholder="# Protocol Title&#10;&#10;## Materials&#10;..."/>
            </div>
          ) : (
            <>
              {protocol.content_markdown ? (
                <div className="prose prose-sm max-w-none text-gray-800">
                  {renderMarkdown(protocol.content_markdown)}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No content available for this protocol.</p>
              )}
              {protocol.notes && (
                <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span className="font-medium">Notes: </span>{protocol.notes}
                </div>
              )}
              {revisions.length > 0 && (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <button
                    onClick={() => setShowHistory(h => !h)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Revision history ({revisions.length})
                  </button>
                  {showHistory && (
                    <ol className="mt-3 space-y-2">
                      {(() => {
                        const states: Snapshotable[] = [...revisions, protocol];
                        return revisions.map((rev, i) => {
                          const changed = changedFields(states[i], states[i + 1]);
                          return (
                            <li key={rev.revision_id} className="flex items-start gap-3 text-xs py-2 border-b border-gray-50 last:border-0">
                              <div className="shrink-0 min-w-0">
                                {rev.version_label && (
                                  <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-bold mb-0.5 ${rev.is_major ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                                    {rev.version_label}
                                  </span>
                                )}
                                <p className="text-gray-400 tabular-nums whitespace-nowrap">
                                  {new Date(rev.revised_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                                </p>
                                {rev.changed_by_name && <p className="text-gray-400">{rev.changed_by_name}</p>}
                              </div>
                              <div className="flex-1 min-w-0">
                                {rev.change_summary && (
                                  <p className="text-gray-700 font-medium mb-0.5">{rev.change_summary}</p>
                                )}
                                <p className="text-gray-500">
                                  {changed.length > 0 ? changed.join(", ") : "No tracked field changes"}
                                </p>
                              </div>
                              {rev.content_markdown && (
                                <button
                                  onClick={() => setDiffRevision(diffRevision?.revision_id === rev.revision_id ? null : rev)}
                                  className={`shrink-0 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                                    diffRevision?.revision_id === rev.revision_id
                                      ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                                      : "border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600"
                                  }`}
                                >
                                  Diff
                                </button>
                              )}
                            </li>
                          );
                        }).reverse();
                      })()}
                    </ol>
                  )}
                  {/* Diff panel */}
                  {diffRevision && (
                    <div className="mt-4 border border-indigo-200 rounded-lg overflow-hidden">
                      <div className="bg-indigo-50 px-3 py-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-indigo-700">
                          Diff — {diffRevision.version_label ?? new Date(diffRevision.revised_at).toLocaleDateString()} vs current
                        </span>
                        <button onClick={() => setDiffRevision(null)} className="text-indigo-400 hover:text-indigo-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-indigo-100 text-xs">
                        <div className="p-3">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">
                            {diffRevision.version_label ?? "Previous"}
                          </p>
                          <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 leading-relaxed">
                            {diffRevision.content_markdown ?? "(no content)"}
                          </pre>
                        </div>
                        <div className="p-3">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Current (v{protocol.version})</p>
                          <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 leading-relaxed">
                            {protocol.content_markdown ?? "(no content)"}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-2 flex-wrap shrink-0">
          {editMode ? (
            <>
              <button onClick={saveEdit} disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button onClick={() => setEditMode(false)} disabled={saving}
                className="rounded-md border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              {protocol.status === "draft" && (
                <button onClick={() => changeStatus("approved")} disabled={updating}
                  className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors">
                  {updating ? "Updating…" : "Mark Approved"}
                </button>
              )}
              {protocol.status === "approved" && (
                <button onClick={() => changeStatus("archived")} disabled={updating}
                  className="rounded-md border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors">
                  Archive
                </button>
              )}
              {protocol.status === "archived" && (
                <button onClick={() => changeStatus("draft")} disabled={updating}
                  className="rounded-md border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors">
                  Restore to Draft
                </button>
              )}
              {protocol.source_queue_id && (
                <Link href="/queue" className="text-xs text-blue-600 hover:underline">
                  View source in Queue →
                </Link>
              )}
              {statusError && <span className="text-xs text-red-600">{statusError}</span>}
            </>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState<"all"|"sbc"|"external">("all");
  const [selected, setSelected] = useState<ProtocolDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterType) params.set("protocol_type", filterType);
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "100");
      const res = await fetch(`/api/proxy/protocols?${params}`);
      if (!res.ok) throw new Error("Failed to load protocols");
      const data = await res.json();
      setProtocols(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [search, filterType, filterStatus]);

  async function openDetail(id: string) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/proxy/protocols/${id}`);
      if (res.ok) setSelected(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleStatusChange(id: string, status: string) {
    setProtocols(ps => ps.map(p => p.protocol_id === id ? { ...p, status } : p));
    if (selected?.protocol_id === id) setSelected(s => s ? { ...s, status } : s);
  }

  function handleSaved(updated: ProtocolDetail) {
    setProtocols(ps => ps.map(p => p.protocol_id === updated.protocol_id ? { ...p, ...updated } : p));
    setSelected(updated);
  }

  async function handleDelete(id: string) {
    if (deletingId !== id) { setDeletingId(id); return; }
    try {
      await fetch(`/api/proxy/protocols/${id}`, { method: "DELETE" });
      setProtocols(ps => ps.filter(p => p.protocol_id !== id));
      setTotal(t => t - 1);
      if (selected?.protocol_id === id) setSelected(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-uploaded
    e.target.value = "";
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/proxy/protocols/upload", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUploadError(d.detail ?? "Upload failed");
        return;
      }
      const created: ProtocolDetail = await res.json();
      setProtocols(ps => [created, ...ps]);
      setTotal(t => t + 1);
      // Open the new protocol immediately
      setSelected(created);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {selected && (
        <ProtocolDetail
          protocol={selected}
          onClose={() => setSelected(null)}
          onStatusChange={handleStatusChange}
          onSaved={handleSaved}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Protocol Bank</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Fermentation protocols, medium preparations, SOPs, and analytical assays.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{total} protocol{total !== 1 ? "s" : ""}</span>
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Parsing PDF…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload PDF
              </>
            )}
          </button>
        </div>
      </div>
      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 flex items-center justify-between">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError("")} className="text-red-400 hover:text-red-600 ml-4 text-lg leading-none">×</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="search"
          placeholder="Search protocols..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400 w-64"
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-blue-400">
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        {(search || filterType || filterStatus) && (
          <button onClick={() => { setSearch(""); setFilterType(""); setFilterStatus(""); setFilterSource("all"); }}
            className="text-xs text-gray-500 hover:text-gray-700">
            Clear filters
          </button>
        )}
      </div>

      {/* Source tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {(["all","sbc","external"] as const).map((tab) => {
          const counts = {
            all: protocols.length,
            sbc: protocols.filter(p => ["manual","generated"].includes(p.source_type) || p.is_internal).length,
            external: protocols.filter(p => ["extracted","imported"].includes(p.source_type)).length,
          };
          const labels = { all: "All", sbc: "SBC", external: "External" };
          return (
            <button key={tab} onClick={() => setFilterSource(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                filterSource === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {labels[tab]}
              <span className="ml-1.5 text-xs text-gray-400">{counts[tab]}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : protocols.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm">No protocols yet.</p>
          <p className="text-xs mt-1">Protocols are auto-generated when queue items with defined media are approved.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Organism</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Author</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {protocols.filter(p =>
                filterSource === "sbc" ? (["manual","generated"].includes(p.source_type) || p.is_internal) :
                filterSource === "external" ? ["extracted","imported"].includes(p.source_type) :
                true
              ).map(p => (
                <tr key={p.protocol_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => openDetail(p.protocol_id)} disabled={loadingDetail}
                        className="text-sm font-medium text-gray-900 hover:text-blue-600 text-left leading-snug transition-colors">
                        {p.title}
                      </button>
                      {p.is_internal && <InternalBadge />}
                    </div>
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.tags.map(t => (
                          <span key={t} className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{t}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><TypeBadge type={p.protocol_type} /></td>
                  <td className="px-4 py-3 text-xs text-gray-600 italic">{p.organism ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{p.author ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openDetail(p.protocol_id)} disabled={loadingDetail}
                        className="text-xs text-blue-600 hover:underline">
                        View
                      </button>
                      {deletingId === p.protocol_id ? (
                        <>
                          <button onClick={() => handleDelete(p.protocol_id)}
                            className="text-xs text-red-600 font-medium hover:underline">
                            Confirm?
                          </button>
                          <button onClick={() => setDeletingId(null)}
                            className="text-xs text-gray-400 hover:text-gray-600">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleDelete(p.protocol_id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
