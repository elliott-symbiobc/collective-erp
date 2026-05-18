"use client";

import { useEffect, useState } from "react";

interface TaskSuggestion {
  suggestion_id?: string;
  message_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  date: string;
  reason: string;
  title?: string;
  suggested_action: string;
  suggested_due_date: string;
  task_type?: string;
  priority?: string;
  status?: string;
}

const TASK_TYPE_META: Record<string, { label: string; color: string }> = {
  email:    { label: "Email",    color: "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900" },
  call:     { label: "Call",     color: "bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900" },
  meeting:  { label: "Meeting",  color: "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-900" },
  document: { label: "Document", color: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900" },
  todo:     { label: "To-do",    color: "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700" },
};

function TaskTypeBadge({ type }: { type?: string }) {
  const meta = TASK_TYPE_META[type ?? "todo"] ?? TASK_TYPE_META.todo;
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${meta.color} flex-shrink-0 uppercase tracking-wide`}>
      {meta.label}
    </span>
  );
}

export default function SuggestionsSection({ onTaskCreated }: { onTaskCreated: () => void }) {
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [accepting, setAccepting] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/proxy/email/followup-suggestions")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.suggestions?.length) setSuggestions(d.suggestions); })
      .catch(() => {});
  }, []);

  async function scan() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/proxy/email/suggest-followups?max_results=20");
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.detail || "Scan failed"); return; }
      const d = await res.json();
      setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
    } catch { setError("Failed to reach email service"); }
    finally { setLoading(false); }
  }

  async function accept(s: TaskSuggestion) {
    setAccepting(prev => new Set([...prev, s.message_id]));
    try {
      const res = await fetch("/api/proxy/email/accept-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: s.from_email, from_name: s.from_name,
          subject: s.subject,
          suggested_action: s.suggested_action,
          suggested_due_date: s.suggested_due_date,
          message_id: s.message_id,
          task_type: s.task_type || "email",
          priority: s.priority || "medium",
          title: s.title || s.suggested_action,
          suggestion_id: s.suggestion_id,
        }),
      });
      if (res.ok) {
        setSuggestions(prev => prev.map(x => x.message_id === s.message_id ? { ...x, status: "accepted" } : x));
        onTaskCreated();
      }
    } finally {
      setAccepting(prev => { const n = new Set(prev); n.delete(s.message_id); return n; });
    }
  }

  async function dismiss(s: TaskSuggestion) {
    setSuggestions(prev => prev.filter(x => x.message_id !== s.message_id));
    if (s.suggestion_id) {
      await fetch(`/api/proxy/email/followup-suggestions/${s.suggestion_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      }).catch(() => {});
    }
  }

  const visible = suggestions.filter(s => s.status !== "dismissed");
  const pending = visible.filter(s => s.status !== "accepted");

  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between px-4 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 group">
          <svg className={`w-3 h-3 text-gray-300 dark:text-gray-600 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors tracking-wide">
            SUGGESTED
          </span>
          {pending.length > 0 && (
            <span className="text-[10px] font-semibold tabular-nums text-indigo-500 dark:text-indigo-400">
              {pending.length}
            </span>
          )}
        </button>
        <button onClick={scan} disabled={loading}
          className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 transition-colors">
          {loading
            ? <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Scanning</>
            : <><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>Scan emails</>
          }
        </button>
      </div>

      {open && (
        <div>
          {error && <p className="text-[11px] text-red-400 px-4 pb-2">{error}</p>}

          {loading && visible.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-gray-400">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              <span className="text-[11px]">Scanning your inbox…</span>
            </div>
          )}

          {!loading && visible.length === 0 && (
            <div className="px-4 py-3">
              <button onClick={scan} className="text-[11px] text-gray-400 hover:text-indigo-500 transition-colors">
                No suggestions · scan inbox now →
              </button>
            </div>
          )}

          {visible.map(s => {
            const accepted = s.status === "accepted";
            const isAccepting = accepting.has(s.message_id);
            const dueStr = s.suggested_due_date
              ? new Date(s.suggested_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : null;
            return (
              <div key={s.message_id}
                className={`flex items-start gap-3 px-4 py-2.5 group border-b border-gray-50 dark:border-gray-800/60 last:border-0 transition-colors ${accepted ? "opacity-50" : "hover:bg-gray-50/60 dark:hover:bg-gray-800/30"}`}>
                <div className="flex-shrink-0 mt-0.5">
                  <TaskTypeBadge type={s.task_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium leading-snug ${accepted ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>
                    {s.title || s.suggested_action}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">
                    {s.from_name} · <span className="text-gray-300 dark:text-gray-600">{s.reason}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {dueStr && <span className="text-[11px] text-gray-300 dark:text-gray-600">{dueStr}</span>}
                  {accepted ? (
                    <span className="text-[11px] text-green-500 font-medium">✓ Added</span>
                  ) : (
                    <>
                      <button onClick={() => accept(s)} disabled={isAccepting}
                        className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-40 transition-colors">
                        {isAccepting ? "Adding…" : "Add"}
                      </button>
                      <button onClick={() => dismiss(s)}
                        className="text-[11px] text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-all">
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
