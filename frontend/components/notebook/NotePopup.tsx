"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

interface RecentEntry {
  entry_id: string;
  title: string;
  entry_type: "experiment" | "meeting" | "note";
  notebook_name?: string;
  notebook_color?: string;
  updated_at: string;
}

interface Entry {
  entry_id: string;
  title: string;
  entry_type: string;
  body: string;
  notebook_id?: string;
  updated_at: string;
}

interface Task {
  task_id: string;
  title: string;
  due_date: string | null;
  project_name: string | null;
  status: string;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(due: string | null) {
  if (!due) return false;
  return new Date(due) < new Date(new Date().toDateString());
}

const TYPE_DOT: Record<string, string> = {
  experiment: "bg-indigo-500",
  meeting: "bg-purple-500",
  note: "bg-amber-500",
};

const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 520;

export default function NotePopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<"list" | "tasks" | "editor">("list");
  const [entries, setEntries] = useState<RecentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [completingTask, setCompletingTask] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/proxy/notebook/recent?limit=12");
      if (r.ok) setEntries(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const r = await fetch("/api/proxy/tasks?status=open&limit=30");
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setTasks(data);
      }
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadRecent();
      loadTasks();
      if (view === "editor" && !entry) setView("list");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && view === "tasks") loadTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Close on Escape only
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  // Resize drag handlers
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelRef.current?.offsetWidth ?? width;

    function onMove(ev: MouseEvent) {
      if (!resizing.current) return;
      const delta = resizeStartX.current - ev.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth.current + delta));
      setWidth(next);
    }
    function onUp() {
      resizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [width]);

  const openEntry = useCallback(async (id: string) => {
    setEntryLoading(true);
    setView("editor");
    try {
      const r = await fetch(`/api/proxy/notebook/entries/${id}`);
      if (r.ok) {
        const data = await r.json();
        setEntry(data);
        setTitle(data.title || "");
        setBody(data.body || "");
      }
    } finally {
      setEntryLoading(false);
    }
  }, []);

  const createNote = useCallback(async () => {
    const r = await fetch("/api/proxy/notebook/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry_type: "note", title: "New Note" }),
    });
    if (r.ok) {
      const data = await r.json();
      setEntry(data);
      setTitle(data.title || "");
      setBody(data.body || "");
      setView("editor");
    }
  }, []);

  const completeTask = useCallback(async (taskId: string) => {
    setCompletingTask(taskId);
    try {
      await fetch(`/api/proxy/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      setTasks(prev => prev.filter(t => t.task_id !== taskId));
    } finally {
      setCompletingTask(null);
    }
  }, []);

  const scheduleSave = useCallback((fields: { title?: string; body?: string }) => {
    if (!entry) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/proxy/notebook/entries/${entry.entry_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
      } finally {
        setSaving(false);
      }
    }, 1500);
  }, [entry]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    scheduleSave({ title: val, body });
  };

  const handleBodyChange = (html: string) => {
    setBody(html);
    scheduleSave({ title, body: html });
  };

  if (!open) return null;

  const isEditing = view === "editor";

  return (
    <div>
      {/* Panel — anchored to right edge, no backdrop so platform stays usable */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700"
        style={{ width }}
      >
        {/* Resize handle on left edge */}
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-400/50 transition-colors z-10"
          title="Drag to resize"
        />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
          <div className="flex items-center gap-3">
            {isEditing && (
              <button
                onClick={() => { setView("list"); setEntry(null); loadRecent(); }}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Back to list"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            {isEditing ? (
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {entry?.entry_type === "meeting" ? "Meeting" : entry?.entry_type === "experiment" ? "Experiment" : "Note"}
              </span>
            ) : (
              /* Tab bar */
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                <button
                  onClick={() => setView("list")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    view === "list"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  Notes
                </button>
                <button
                  onClick={() => setView("tasks")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    view === "tasks"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  Tasks
                  {tasks.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-full">
                      {tasks.length}
                    </span>
                  )}
                </button>
              </div>
            )}
            {isEditing && saving && (
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />Saving
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view === "list" && (
              <button
                onClick={createNote}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                New note
              </button>
            )}
            {view === "tasks" && (
              <a
                href="/tasks"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Add task
              </a>
            )}
            {isEditing && entry && (
              <a
                href={`/notebook`}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-indigo-600 rounded hover:bg-indigo-50 transition-colors"
              >
                Open full
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Close"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Notes list view */}
          {view === "list" && (
            <div>
              {loading ? (
                <div className="p-6 text-sm text-gray-400">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No notes yet. Create one!</div>
              ) : (
                entries.map(e => (
                  <button
                    key={e.entry_id}
                    onClick={() => openEntry(e.entry_id)}
                    className="w-full text-left px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate group-hover:text-indigo-700 dark:group-hover:text-indigo-400">
                        {e.title || "Untitled"}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(e.updated_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_DOT[e.entry_type] || "bg-gray-400"}`} />
                      <span className="text-xs text-gray-500 capitalize">{e.entry_type}</span>
                      {e.notebook_name && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.notebook_color || "#6366f1" }} />
                          {e.notebook_name}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Tasks view */}
          {view === "tasks" && (
            <div>
              {tasksLoading ? (
                <div className="p-6 text-sm text-gray-400">Loading…</div>
              ) : tasks.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-gray-400 mb-3">No open tasks.</p>
                  <a
                    href="/tasks"
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    Go to Tasks →
                  </a>
                </div>
              ) : (
                <>
                  {tasks.map(t => (
                    <div
                      key={t.task_id}
                      className="flex items-start gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                    >
                      <button
                        onClick={() => completeTask(t.task_id)}
                        disabled={completingTask === t.task_id}
                        className="mt-0.5 w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-green-500 flex-shrink-0 transition-colors flex items-center justify-center"
                        title="Mark done"
                      >
                        {completingTask === t.task_id && (
                          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <a
                          href="/tasks"
                          className="text-sm font-medium text-gray-800 dark:text-gray-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 truncate block"
                        >
                          {t.title}
                        </a>
                        <div className="flex items-center gap-2 mt-0.5">
                          {t.due_date && (
                            <span className={`text-xs ${isOverdue(t.due_date) ? "text-red-500 font-medium" : "text-gray-400"}`}>
                              {isOverdue(t.due_date) ? "Overdue · " : ""}{fmtDate(t.due_date)}
                            </span>
                          )}
                          {t.project_name && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                              {t.project_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
                    <a
                      href="/tasks"
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      View all tasks →
                    </a>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Editor view */}
          {view === "editor" && (
            <div className="px-6 py-5">
              {entryLoading ? (
                <div className="text-sm text-gray-400">Loading…</div>
              ) : entry ? (
                <>
                  <input
                    value={title}
                    onChange={e => handleTitleChange(e.target.value)}
                    placeholder="Untitled"
                    className="w-full text-2xl font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-0 focus:outline-none placeholder-gray-200 dark:placeholder-gray-700 mb-4"
                  />
                  <RichTextEditor
                    content={body}
                    onChange={handleBodyChange}
                    placeholder="Start writing…"
                    minHeight="calc(100vh - 200px)"
                    autoFocus
                  />
                </>
              ) : (
                <div className="text-sm text-gray-400">Entry not found.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
