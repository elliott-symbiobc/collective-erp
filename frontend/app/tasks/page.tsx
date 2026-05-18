"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import ReportsPanel from "@/components/ReportsPanel";
import MessagingDrawer from "@/components/MessagingDrawer";
import SuggestionsSection from "@/components/SuggestionsSection";

const CHEVRON = "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22M19%209l-7%207-7-7%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.4rem_center] bg-[length:1rem]";
const SEL = `text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30 pr-8 ${CHEVRON}`;
const SEL_XS = `text-xs border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/30 pr-6 ${CHEVRON}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  task_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  start_date: string | null;
  estimated_minutes: number | null;
  status: "open" | "done";
  kanban_status: "todo" | "in_progress" | "review" | "done";
  sort_order: number | null;
  project_id: string | null;
  project_name: string | null;
  source_note_id: string | null;
  note_title: string | null;
  contact_id: string | null;
  contact_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  owner_name: string | null;
  source: string | null;
  created_at: string;
  priority: Priority | null;
  activity_type?: string | null;
  milestone_id?: string | null;
  milestone_title?: string | null;
  extra_assignees?: { user_id: string; name: string }[] | null;
  blocked_by_count?: number | null;
}

interface User {
  user_id: string;
  name: string;
  email: string;
}

type Priority = "high" | "medium" | "low";
type ViewMode = "list" | "kanban" | "gantt" | "reports";
type FilterMode = "open" | "done" | "all";
type KanbanColId = "todo" | "in_progress" | "review" | "done";

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtMinutes(m: number | null): string | null {
  if (!m) return null;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function isOverdue(due: string | null, status: string): boolean {
  if (!due || status === "done") return false;
  return new Date(due) < new Date(new Date().toDateString());
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function inferPriority(task: Task): Priority {
  if (task.priority) return task.priority;
  if (isOverdue(task.due_date, task.status)) return "high";
  if (task.due_date && task.status !== "done") {
    const days = Math.ceil((new Date(task.due_date).getTime() - Date.now()) / 86400000);
    if (days <= 3) return "high";
    if (days <= 7) return "medium";
  }
  return "low";
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Task Type Badge ──────────────────────────────────────────────────────────

const TASK_TYPES = ["email", "call", "meeting", "document", "todo", "in_silico", "wet_lab"] as const;
const TASK_TYPE_META: Record<string, { label: string; color: string }> = {
  email:     { label: "Email",             color: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800" },
  call:      { label: "Call",              color: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800" },
  meeting:   { label: "Meeting",           color: "bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800" },
  document:  { label: "Document",          color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800" },
  todo:      { label: "To-do",             color: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700" },
  in_silico: { label: "In-Silico Analysis",color: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-800" },
  wet_lab:   { label: "Wet Lab Work",      color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-800" },
};

function TaskTypeBadge({ type, onClick }: { type?: string | null; onClick?: (e: React.MouseEvent) => void }) {
  const t = type && TASK_TYPE_META[type] ? type : null;
  if (!t) return null;
  const meta = TASK_TYPE_META[t];
  if (onClick) {
    return (
      <button onClick={onClick} title="Click to change type"
        className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border cursor-pointer hover:opacity-80 transition-opacity ${meta.color}`}>
        {meta.label}
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ─── Priority Badge ───────────────────────────────────────────────────────────

const PRIORITY_CYCLE: Priority[] = ["low", "medium", "high"];

function PriorityBadge({ priority, onClick }: { priority: Priority; onClick?: (e: React.MouseEvent) => void }) {
  const map = {
    high: { label: "High", cls: "bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800" },
    medium: { label: "Med", cls: "bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800" },
    low: { label: "Low", cls: "bg-green-50 text-green-600 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800" },
  };
  const { label, cls } = map[priority];
  if (onClick) {
    return (
      <button
        onClick={onClick}
        title="Click to change priority"
        className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md cursor-pointer hover:opacity-80 transition-opacity ${cls}`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${cls}`}>
      {label}
    </span>
  );
}

// ─── New Task Modal ───────────────────────────────────────────────────────────

interface MilestoneSummary { milestone_id: string; title: string; }

function NewTaskModal({
  users,
  projects,
  defaultKanbanStatus,
  onSubmit,
  onClose,
}: {
  users: User[];
  projects: { project_id: string; name: string }[];
  defaultKanbanStatus?: KanbanColId;
  onSubmit: (data: Partial<Task>) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [start, setStart] = useState("");
  const [est, setEst] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [assigneeNote, setAssigneeNote] = useState("");
  const [projectId, setProjectId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [milestones, setMilestones] = useState<MilestoneSummary[]>([]);
  const [kanbanStatus, setKanbanStatus] = useState<KanbanColId>(defaultKanbanStatus ?? "todo");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMilestoneId("");
    if (!projectId) { setMilestones([]); return; }
    fetch(`/api/proxy/projects/${projectId}/milestones`)
      .then(r => r.ok ? r.json() : [])
      .then((data: MilestoneSummary[]) => setMilestones(Array.isArray(data) ? data : []))
      .catch(() => setMilestones([]));
  }, [projectId]);

  async function submit() {
    if (!title.trim()) return;
    if (assignedTo && !assigneeNote.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        due_date: due || null,
        start_date: start || null,
        estimated_minutes: est ? parseInt(est, 10) : null,
        assigned_to: assignedTo || null,
        assignment_note: assignedTo ? assigneeNote.trim() : null,
        project_id: projectId || null,
        milestone_id: milestoneId || null,
        kanban_status: kanbanStatus,
      } as Partial<Task> & { assignment_note?: string | null });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">New Task</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) submit(); if (e.key === "Escape") onClose(); }}
              placeholder="What needs to be done?"
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add details, context, or notes…"
              rows={3}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none transition-all"
            />
          </div>

          {/* Dates row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Start Date</label>
              <input
                type="date"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Due Date</label>
              <input
                type="date"
                value={due}
                onChange={e => setDue(e.target.value)}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 transition-all"
              />
            </div>
          </div>

          {/* Status + Estimate row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Status</label>
              <select
                value={kanbanStatus}
                onChange={e => setKanbanStatus(e.target.value as KanbanColId)}
                className={`w-full ${SEL}`}
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Estimate (min)</label>
              <input
                type="number"
                value={est}
                onChange={e => setEst(e.target.value)}
                placeholder="e.g. 30"
                min={1}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 transition-all"
              />
            </div>
          </div>

          {/* Assignee */}
          {users.length > 0 && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Assignee</label>
                <select
                  value={assignedTo}
                  onChange={e => { setAssignedTo(e.target.value); setAssigneeNote(""); }}
                  className={`w-full ${SEL}`}
                >
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>)}
                </select>
              </div>
              {assignedTo && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    Note to assignee <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={assigneeNote}
                    onChange={e => setAssigneeNote(e.target.value)}
                    placeholder="Add context for the assignee…"
                    rows={2}
                    className={`w-full text-sm bg-gray-50 dark:bg-gray-800 border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none transition-all ${
                      assignedTo && !assigneeNote.trim() ? "border-red-300 dark:border-red-700" : "border-gray-200 dark:border-gray-700"
                    }`}
                  />
                  {assignedTo && !assigneeNote.trim() && (
                    <p className="text-[10px] text-red-500 mt-1">Required when assigning to someone</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Project */}
          {projects.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Project</label>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className={`w-full ${SEL}`}
              >
                <option value="">No project</option>
                {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Milestone — only shown when a project is selected and has milestones */}
          {milestones.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Milestone</label>
              <select
                value={milestoneId}
                onChange={e => setMilestoneId(e.target.value)}
                className={`w-full ${SEL}`}
              >
                <option value="">No milestone</option>
                {milestones.map(m => <option key={m.milestone_id} value={m.milestone_id}>{m.title}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || busy || (!!assignedTo && !assigneeNote.trim())}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {busy && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Task Modal ──────────────────────────────────────────────────────────

function EditTaskModal({
  task,
  users,
  projects,
  onSave,
  onDelete,
  onClose,
}: {
  task: Task;
  users: User[];
  projects: { project_id: string; name: string }[];
  onSave: (id: string, patch: Partial<Task> & { assignment_note?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [start, setStart] = useState(task.start_date ?? "");
  const [est, setEst] = useState(task.estimated_minutes ? String(task.estimated_minutes) : "");
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? "");
  const [assigneeNote, setAssigneeNote] = useState("");
  const [projectId, setProjectId] = useState(task.project_id ?? "");
  const [milestoneId, setMilestoneId] = useState(task.milestone_id ?? "");
  const [milestones, setMilestones] = useState<MilestoneSummary[]>([]);
  const [kanbanStatus, setKanbanStatus] = useState<KanbanColId>(task.kanban_status ?? "todo");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!projectId) { setMilestones([]); return; }
    fetch(`/api/proxy/projects/${projectId}/milestones`)
      .then(r => r.ok ? r.json() : [])
      .then((data: MilestoneSummary[]) => setMilestones(Array.isArray(data) ? data : []))
      .catch(() => setMilestones([]));
  }, [projectId]);

  const isNewAssignee = !!(assignedTo && assignedTo !== (task.assigned_to ?? ""));

  async function save() {
    if (!title.trim()) return;
    if (isNewAssignee && !assigneeNote.trim()) return;
    setBusy(true);
    try {
      await onSave(task.task_id, {
        title: title.trim(),
        description: description.trim() || null,
        due_date: due || null,
        start_date: start || null,
        estimated_minutes: est ? parseInt(est, 10) : null,
        assigned_to: assignedTo || null,
        project_id: projectId || null,
        milestone_id: milestoneId || null,
        kanban_status: kanbanStatus,
        assignment_note: isNewAssignee ? assigneeNote.trim() : null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await onDelete(task.task_id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Edit Task</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) save(); if (e.key === "Escape") onClose(); }}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Add details, context, or notes…"
              rows={3}
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none transition-all"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Start Date</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 transition-all" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Due Date</label>
              <input type="date" value={due} onChange={e => setDue(e.target.value)}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 transition-all" />
            </div>
          </div>

          {/* Status + Estimate */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Status</label>
              <select value={kanbanStatus} onChange={e => setKanbanStatus(e.target.value as KanbanColId)}
                className={`w-full ${SEL}`}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Estimate (min)</label>
              <input type="number" value={est} onChange={e => setEst(e.target.value)} placeholder="e.g. 30" min={1}
                className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 transition-all" />
            </div>
          </div>

          {/* Assignee */}
          {users.length > 0 && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Assignee</label>
                <select value={assignedTo} onChange={e => { setAssignedTo(e.target.value); setAssigneeNote(""); }}
                  className={`w-full ${SEL}`}>
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>)}
                </select>
              </div>
              {isNewAssignee && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    Note to assignee <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={assigneeNote}
                    onChange={e => setAssigneeNote(e.target.value)}
                    placeholder="Add a note for the assignee…"
                    rows={2}
                    className={`w-full text-sm bg-gray-50 dark:bg-gray-800 border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-none transition-all ${
                      !assigneeNote.trim() ? "border-red-400 dark:border-red-500" : "border-gray-200 dark:border-gray-700"
                    }`}
                  />
                  {!assigneeNote.trim() && (
                    <p className="mt-1 text-xs text-red-500">A note is required when assigning a task.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Project */}
          {projects.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Project</label>
              <select value={projectId} onChange={e => { setProjectId(e.target.value); setMilestoneId(""); }}
                className={`w-full ${SEL}`}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Milestone */}
          {milestones.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Milestone</label>
              <select value={milestoneId} onChange={e => setMilestoneId(e.target.value)}
                className={`w-full ${SEL}`}>
                <option value="">No milestone</option>
                {milestones.map(m => <option key={m.milestone_id} value={m.milestone_id}>{m.title}</option>)}
              </select>
            </div>
          )}

          {/* Meta info */}
          <div className="text-[11px] text-gray-400 dark:text-gray-600 border-t border-gray-100 dark:border-gray-800 pt-3">
            Created {new Date(task.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            {task.project_name && ` · ${task.project_name}`}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 dark:text-red-400">Delete this task?</span>
              <button onClick={handleDelete} disabled={busy}
                className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
                Yes, delete
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete
            </button>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={!title.trim() || busy || (isNewAssignee && !assigneeNote.trim())}
              className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2">
              {busy && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Gantt View ───────────────────────────────────────────────────────────────

const DAY_PX = 26;
const ROW_H = 38;
const LABEL_W = 220;

interface GanttDrag {
  taskId: string;
  type: "move" | "resize";
  startX: number;
  origStart: number;
  origDue: number;
  rangeStartMs: number;
}

function GanttView({
  tasks,
  onUpdate,
  onToggle,
  onDelete,
  showOwner,
}: {
  tasks: Task[];
  onUpdate: (id: string, patch: Partial<Task> & { assignment_note?: string | null }) => Promise<void>;
  onToggle: (task: Task) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  showOwner?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GanttDrag | null>(null);
  const [preview, setPreview] = useState<Record<string, { start: number; due: number }>>({});
  const previewRef = useRef<Record<string, { start: number; due: number }>>({});
  useEffect(() => { previewRef.current = preview; }, [preview]);

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  const { rangeStart, totalDays } = useMemo(() => {
    const ms: number[] = [today.getTime()];
    for (const t of tasks) {
      if (t.start_date) ms.push(new Date(t.start_date).getTime());
      if (t.due_date) ms.push(new Date(t.due_date).getTime());
    }
    const minMs = Math.min(...ms) - 7 * 86400000;
    const maxMs = Math.max(...ms) + 21 * 86400000;
    const rs = new Date(minMs); rs.setHours(0, 0, 0, 0);
    return { rangeStart: rs, totalDays: Math.max(60, Math.ceil((maxMs - rs.getTime()) / 86400000)) };
  }, [tasks, today]);

  const todayDay = useMemo(() =>
    Math.floor((today.getTime() - rangeStart.getTime()) / 86400000),
    [today, rangeStart]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (todayDay - 4) * DAY_PX);
  }, [todayDay]);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const delta = Math.round((e.clientX - d.startX) / DAY_PX);
      let ns = d.origStart, nd = d.origDue;
      if (d.type === "move") { ns += delta; nd += delta; }
      else { nd = Math.max(d.origStart + 1, d.origDue + delta); }
      setPreview(p => ({ ...p, [d.taskId]: { start: ns, due: nd } }));
    }
    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      const p = previewRef.current[d.taskId];
      if (p && (p.start !== d.origStart || p.due !== d.origDue)) {
        const rs = new Date(d.rangeStartMs);
        onUpdateRef.current(d.taskId, {
          start_date: dateToIso(addDays(rs, p.start)),
          due_date: dateToIso(addDays(rs, p.due)),
        });
      }
      dragRef.current = null;
      setPreview(p => { const n = { ...p }; if (d) delete n[d.taskId]; return n; });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  function getBarDays(task: Task): { start: number; due: number } | null {
    const p = preview[task.task_id];
    if (p) return p;
    let sd: number | null = null, dd: number | null = null;
    if (task.start_date) {
      const d = new Date(task.start_date); d.setHours(0, 0, 0, 0);
      sd = Math.floor((d.getTime() - rangeStart.getTime()) / 86400000);
    }
    if (task.due_date) {
      const d = new Date(task.due_date); d.setHours(0, 0, 0, 0);
      dd = Math.floor((d.getTime() - rangeStart.getTime()) / 86400000);
    }
    if (sd === null && dd === null) return null;
    if (sd === null) sd = dd!;
    if (dd === null) dd = sd + 1;
    if (dd <= sd) dd = sd + 1;
    return { start: sd, due: dd };
  }

  function startDrag(e: React.PointerEvent, taskId: string, type: "move" | "resize", sd: number, dd: number) {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { taskId, type, startX: e.clientX, origStart: sd, origDue: dd, rangeStartMs: rangeStart.getTime() };
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
        x: mStart * DAY_PX,
        width: Math.ceil((mEnd.getTime() - curr.getTime()) / 86400000) * DAY_PX,
      });
      curr = next;
    }
    return result;
  }, [rangeStart, totalDays]);

  const datedTasks = tasks.filter(t => getBarDays(t) !== null);
  const undatedTasks = tasks.filter(t => !t.start_date && !t.due_date);
  const timelineW = totalDays * DAY_PX;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden select-none">
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 180px)" }}>
        <div style={{ display: "inline-block", minWidth: "100%", width: LABEL_W + timelineW }}>
          {/* Header */}
          <div className="flex sticky top-0 z-20 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            <div className="sticky left-0 z-30 bg-gray-50 dark:bg-gray-800/60 border-r border-gray-200 dark:border-gray-700 flex items-end pb-2 px-4"
                 style={{ width: LABEL_W, minWidth: LABEL_W, height: 52 }}>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Task</span>
            </div>
            <div style={{ position: "relative", width: timelineW, flexShrink: 0, height: 52 }}>
              {monthHeaders.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: m.x, width: m.width, top: 0, height: 24 }}
                     className="border-r border-gray-200 dark:border-gray-700 px-2 flex items-center">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{m.label}</span>
                </div>
              ))}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 24, display: "flex" }}>
                {Array.from({ length: totalDays }, (_, i) => {
                  const d = addDays(rangeStart, i);
                  const isToday = i === todayDay;
                  const isWknd = d.getDay() === 0 || d.getDay() === 6;
                  const show = totalDays < 90 ? true : (i % 7 === 0 || d.getDate() === 1);
                  return (
                    <div key={i} style={{ width: DAY_PX, flexShrink: 0 }}
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

          {/* Dated task rows */}
          {datedTasks.map(task => {
            const days = getBarDays(task)!;
            const overdue = isOverdue(task.due_date, task.status);
            const isDone = task.status === "done";
            let barCls = "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600";
            let txtCls = "text-blue-800 dark:text-blue-200";
            if (isDone) { barCls = "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-600"; txtCls = "text-green-800 dark:text-green-200"; }
            else if (overdue) { barCls = "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-600"; txtCls = "text-red-800 dark:text-red-200"; }
            const barLeft = days.start * DAY_PX + 2;
            const barW = Math.max(DAY_PX, (days.due - days.start) * DAY_PX - 4);
            return (
              <div key={task.task_id} className="flex border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/30 dark:hover:bg-gray-800/20 group" style={{ height: ROW_H }}>
                <div className="sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex items-center gap-2 px-3"
                     style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  <button onClick={() => onToggle(task)}
                          className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${isDone ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-green-400"}`} />
                  <span className={`text-xs truncate flex-1 ${isDone ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-100"}`}>{task.title}</span>
                  {showOwner && task.owner_name && (
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" title={task.owner_name}>
                      {getInitials(task.owner_name)}
                    </div>
                  )}
                  <button onClick={() => onDelete(task.task_id)}
                          className="ml-1 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 flex-shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div style={{ position: "relative", width: timelineW, flexShrink: 0 }}>
                  <div style={{ position: "absolute", left: todayDay * DAY_PX, top: 0, bottom: 0, width: 1, pointerEvents: "none", zIndex: 1 }}
                       className="bg-blue-400/50" />
                  {Array.from({ length: totalDays }, (_, i) => {
                    const d = addDays(rangeStart, i);
                    if (d.getDay() !== 0 && d.getDay() !== 6) return null;
                    return <div key={i} style={{ position: "absolute", left: i * DAY_PX, top: 0, bottom: 0, width: DAY_PX, pointerEvents: "none" }}
                                className="bg-gray-50/50 dark:bg-gray-800/20" />;
                  })}
                  <div
                    style={{ position: "absolute", left: barLeft, width: barW, top: 5, height: ROW_H - 10, borderRadius: 5, zIndex: 2,
                             cursor: dragRef.current?.taskId === task.task_id ? "grabbing" : "grab" }}
                    className={`border flex items-center px-2 ${barCls}`}
                    onPointerDown={e => startDrag(e, task.task_id, "move", days.start, days.due)}
                  >
                    <span className={`text-[11px] truncate flex-1 pointer-events-none ${txtCls}`}>{task.title}</span>
                    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", zIndex: 3 }}
                         className="rounded-r"
                         onPointerDown={e => { e.stopPropagation(); startDrag(e, task.task_id, "resize", days.start, days.due); }} />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Undated tasks */}
          {undatedTasks.length > 0 && (
            <>
              <div className="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40" style={{ height: 28 }}>
                <div className="sticky left-0 z-10 bg-gray-50/80 dark:bg-gray-800/40 flex items-center px-4"
                     style={{ width: LABEL_W, minWidth: LABEL_W }}>
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">No date</span>
                </div>
                <div style={{ width: timelineW }} />
              </div>
              {undatedTasks.map(task => (
                <div key={task.task_id} className="flex border-b border-gray-100 dark:border-gray-800" style={{ height: ROW_H }}>
                  <div className="sticky left-0 z-10 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex items-center gap-2 px-3"
                       style={{ width: LABEL_W, minWidth: LABEL_W }}>
                    <button onClick={() => onToggle(task)}
                            className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${task.status === "done" ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-green-400"}`} />
                    <span className={`text-xs truncate ${task.status === "done" ? "line-through text-gray-400" : "text-gray-700 dark:text-gray-300"}`}>{task.title}</span>
                  </div>
                  <div style={{ width: timelineW }} className="flex items-center px-4">
                    <span className="text-xs text-gray-400 italic">Set a due date to appear on chart</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {tasks.length === 0 && (
            <div className="flex" style={{ height: 80 }}>
              <div className="sticky left-0 flex items-center justify-center px-4 text-sm text-gray-400"
                   style={{ width: LABEL_W, minWidth: LABEL_W }}>No tasks</div>
              <div style={{ width: timelineW }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kanban View ──────────────────────────────────────────────────────────────

const KANBAN_COLS = [
  {
    id: "todo" as KanbanColId,
    label: "To Do",
    headerCls: "bg-gray-50 dark:bg-gray-800/60",
    dot: "bg-gray-400",
    emptyIcon: (
      <svg className="w-8 h-8 text-gray-200 dark:text-gray-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    emptyMsg: "No tasks yet. Add one below.",
  },
  {
    id: "in_progress" as KanbanColId,
    label: "In Progress",
    headerCls: "bg-blue-50 dark:bg-blue-950/30",
    dot: "bg-blue-500",
    emptyIcon: (
      <svg className="w-8 h-8 text-blue-200 dark:text-blue-900" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    emptyMsg: "Drag tasks here to start work.",
  },
  {
    id: "review" as KanbanColId,
    label: "Review",
    headerCls: "bg-amber-50 dark:bg-amber-950/30",
    dot: "bg-amber-500",
    emptyIcon: (
      <svg className="w-8 h-8 text-amber-200 dark:text-amber-900" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    emptyMsg: "Move tasks here for review.",
  },
  {
    id: "done" as KanbanColId,
    label: "Done",
    headerCls: "bg-green-50 dark:bg-green-950/30",
    dot: "bg-green-500",
    emptyIcon: (
      <svg className="w-8 h-8 text-green-200 dark:text-green-900" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    emptyMsg: "Completed tasks will appear here.",
  },
];

function KanbanView({
  tasks,
  users,
  projects,
  onUpdate,
  onDelete,
  onCreate,
  onReorder,
  showOwner,
}: {
  tasks: Task[];
  users: User[];
  projects: { project_id: string; name: string }[];
  onUpdate: (id: string, patch: Partial<Task> & { assignment_note?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreate: (data: { title: string; kanban_status: KanbanColId; due_date?: string }) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  showOwner?: boolean;
}) {
  const dragId = useRef<string | null>(null);
  const didDrag = useRef(false);
  const [dragOverCol, setDragOverCol] = useState<KanbanColId | null>(null);
  const [dragOverCard, setDragOverCard] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<KanbanColId>>(new Set());
  const [addingIn, setAddingIn] = useState<KanbanColId | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [colSort, setColSort] = useState<Record<KanbanColId, "none" | "priority" | "due_date">>({
    todo: "none", in_progress: "none", review: "none", done: "none",
  });

  function sortColTasks(colTasks: Task[], sort: "none" | "priority" | "due_date"): Task[] {
    if (sort === "none") return colTasks;
    if (sort === "priority") {
      const order: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
      return [...colTasks].sort((a, b) => order[inferPriority(a)] - order[inferPriority(b)]);
    }
    return [...colTasks].sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }

  function cyclColSort(colId: KanbanColId) {
    setColSort(prev => {
      const order: ("none" | "priority" | "due_date")[] = ["none", "priority", "due_date"];
      const next = order[(order.indexOf(prev[colId]) + 1) % order.length];
      return { ...prev, [colId]: next };
    });
  }

  const byCol: Record<KanbanColId, Task[]> = { todo: [], in_progress: [], review: [], done: [] };
  for (const t of tasks) {
    const k = (t.kanban_status as KanbanColId) || "todo";
    if (byCol[k]) byCol[k].push(t);
  }

  function toggleCollapse(colId: KanbanColId) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId); else next.add(colId);
      return next;
    });
  }

  async function handleColDrop(col: KanbanColId) {
    if (dragId.current) {
      await onUpdate(dragId.current, { kanban_status: col });
      dragId.current = null;
    }
    setDragOverCol(null);
    setDragOverCard(null);
    setDraggingId(null);
    didDrag.current = false;
  }

  function handleCardDrop(e: React.DragEvent, targetTaskId: string, targetColId: KanbanColId) {
    const fromId = dragId.current;
    if (!fromId || fromId === targetTaskId) return;
    const fromTask = tasks.find(t => t.task_id === fromId);
    const fromCol = (fromTask?.kanban_status as KanbanColId) || "todo";

    if (fromCol === targetColId) {
      // Same column — reorder within the column using the flat task list
      e.stopPropagation();
      const fromIdx = tasks.findIndex(t => t.task_id === fromId);
      const toIdx = tasks.findIndex(t => t.task_id === targetTaskId);
      if (fromIdx === -1 || toIdx === -1) return;
      const newOrder = [...tasks];
      const [moved] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, moved);
      dragId.current = null;
      setDragOverCol(null);
      setDragOverCard(null);
      setDraggingId(null);
      setTimeout(() => { didDrag.current = false; }, 0);
      onReorder(newOrder.map(t => t.task_id));
    }
    // Different column: let event bubble to column onDrop for status change
  }

  async function addTask(col: KanbanColId) {
    if (!newTitle.trim()) return;
    await onCreate({ title: newTitle.trim(), kanban_status: col });
    setNewTitle("");
    setAddingIn(null);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 200px)" }}>
      {KANBAN_COLS.map(col => {
        const colTasks = sortColTasks(byCol[col.id], colSort[col.id]);
        const isCollapsed = collapsed.has(col.id);
        const isColOver = dragOverCol === col.id;

        if (isCollapsed) {
          return (
            <div
              key={col.id}
              className="flex-shrink-0 w-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 flex flex-col items-center py-3 gap-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/60 transition-colors"
              onClick={() => toggleCollapse(col.id)}
              title={`Expand ${col.label}`}
            >
              <div className={`w-2 h-2 rounded-full ${col.dot}`} />
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180 tracking-wide">
                {col.label}
              </span>
              <span className="text-[10px] font-bold text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center">
                {colTasks.length}
              </span>
            </div>
          );
        }

        return (
          <div
            key={col.id}
            className={`flex-shrink-0 flex flex-col rounded-xl border transition-all duration-150 ${
              isColOver
                ? "border-blue-400 dark:border-blue-500 shadow-md shadow-blue-500/10"
                : "border-gray-200 dark:border-gray-700"
            }`}
            style={{ width: 290 }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(col.id); }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverCol(null);
                setDragOverCard(null);
              }
            }}
            onDrop={() => handleColDrop(col.id)}
          >
            {/* Column header */}
            <div className={`px-3 py-2.5 rounded-t-xl border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${col.headerCls}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{col.label}</span>
                <span className="text-[10px] font-bold text-gray-500 bg-gray-200 dark:bg-gray-600 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {colTasks.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => cyclColSort(col.id)}
                  className={`h-6 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold rounded transition-colors ${
                    colSort[col.id] !== "none"
                      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                      : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60"
                  }`}
                  title={`Sort: ${colSort[col.id] === "none" ? "none" : colSort[col.id] === "priority" ? "priority" : "due date"}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M9 17h6" />
                  </svg>
                  {colSort[col.id] !== "none" && (
                    <span>{colSort[col.id] === "priority" ? "P" : "D"}</span>
                  )}
                </button>
                <button
                  onClick={() => toggleCollapse(col.id)}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                  title="Collapse column"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
                  </svg>
                </button>
                <button
                  onClick={() => { setAddingIn(col.id); setNewTitle(""); }}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-white/60 dark:hover:bg-gray-700/60 rounded transition-colors"
                  title="Add task"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Cards area */}
            <div className="flex-1 p-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
              {colTasks.map(task => {
                const overdue = isOverdue(task.due_date, task.status);
                const priority = inferPriority(task);
                const isDone = task.status === "done";
                const isBeingDragged = draggingId === task.task_id;
                const isCardOver = dragOverCard === task.task_id;

                return (
                  <div
                    key={task.task_id}
                    draggable
                    onDragStart={() => { dragId.current = task.task_id; didDrag.current = true; setDraggingId(task.task_id); }}
                    onDragEnd={() => { dragId.current = null; setDraggingId(null); setDragOverCol(null); setDragOverCard(null); setTimeout(() => { didDrag.current = false; }, 0); }}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverCard(task.task_id); }}
                    onDrop={e => handleCardDrop(e, task.task_id, col.id)}
                    onClick={() => { if (!didDrag.current) setEditTask(task); }}
                    className={`relative bg-white dark:bg-gray-800 rounded-xl border cursor-pointer group transition-all duration-150 overflow-hidden ${
                      isBeingDragged
                        ? "opacity-40 scale-95 shadow-none"
                        : isCardOver
                        ? "border-blue-400 dark:border-blue-500 shadow-sm shadow-blue-500/20 -translate-y-0.5"
                        : "border-gray-200 dark:border-gray-700 hover:shadow-md hover:shadow-gray-200/60 dark:hover:shadow-black/20 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    {/* Priority stripe */}
                    <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                      priority === "high" ? "bg-red-400" :
                      priority === "medium" ? "bg-amber-400" :
                      "bg-gray-200 dark:bg-gray-700"
                    }`} />

                    <div className="pl-4 pr-3 pt-3 pb-3">
                      {/* Title row */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className={`text-sm font-semibold leading-snug flex-1 min-w-0 ${
                          isDone ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-50"
                        }`}>
                          {task.title}
                        </p>
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(task.task_id); }}
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex-shrink-0 flex items-center justify-center text-gray-300 hover:text-red-400 rounded transition-all"
                          aria-label="Delete task"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* Description */}
                      {task.description && !isDone && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed mb-2.5 line-clamp-2">
                          {task.description}
                        </p>
                      )}

                      {/* Footer metadata row */}
                      <div className="flex items-center gap-1 flex-wrap mt-1.5">
                        <PriorityBadge
                          priority={priority}
                          onClick={e => {
                            e.stopPropagation();
                            const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(priority) + 1) % PRIORITY_CYCLE.length];
                            onUpdate(task.task_id, { priority: next });
                          }}
                        />
                        <TaskTypeBadge type={task.activity_type}
                          onClick={e => {
                            e.stopPropagation();
                            const types = TASK_TYPES as unknown as string[];
                            const cur = task.activity_type || "todo";
                            const next = types[(types.indexOf(cur) + 1) % types.length];
                            onUpdate(task.task_id, { activity_type: next } as Partial<Task>);
                          }}
                        />
                        {task.due_date && (
                          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                            overdue
                              ? "bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                          }`}>
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" />
                            </svg>
                            {fmtDate(task.due_date)}{overdue && <span className="font-semibold"> · late</span>}
                          </span>
                        )}
                        {task.project_name && (
                          <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900 font-medium max-w-[90px] truncate">
                            {task.project_name}
                          </span>
                        )}
                        {task.contact_name && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900 font-medium">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            {task.contact_name.split(" ")[0]}
                          </span>
                        )}
                        {task.estimated_minutes && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {fmtMinutes(task.estimated_minutes)}
                          </span>
                        )}
                        {(task.blocked_by_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 font-semibold">
                            ⊘ Blocked
                          </span>
                        )}
                        {task.milestone_title && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-medium max-w-[88px] truncate" title={task.milestone_title}>
                            ◆ {task.milestone_title}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-0.5">
                          {showOwner && task.owner_name && (
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" title={`Owner: ${task.owner_name}`}>
                              {getInitials(task.owner_name)}
                            </div>
                          )}
                          {task.assigned_to_name && (
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-400 to-blue-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" title={task.assigned_to_name}>
                              {getInitials(task.assigned_to_name)}
                            </div>
                          )}
                          {(task.extra_assignees ?? []).slice(0, 2).map(ea => (
                            <div key={ea.user_id} className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 -ml-1" title={ea.name}>
                              {getInitials(ea.name)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty state */}
              {colTasks.length === 0 && addingIn !== col.id && (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  {col.emptyIcon}
                  <p className="text-xs text-gray-400 dark:text-gray-600 max-w-[160px] leading-relaxed">
                    {col.emptyMsg}
                  </p>
                </div>
              )}
            </div>

            {/* Inline add */}
            <div className="p-2 border-t border-gray-100 dark:border-gray-800">
              {addingIn === col.id ? (
                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-blue-300 dark:border-blue-600 p-2.5">
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") addTask(col.id);
                      if (e.key === "Escape") setAddingIn(null);
                    }}
                    placeholder="Task title…"
                    className="w-full text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => addTask(col.id)}
                      className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setAddingIn(null)}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingIn(col.id); setNewTitle(""); }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg transition-colors group/add"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add task</span>
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Edit modal */}
      {editTask && (
        <EditTaskModal
          task={editTask}
          users={users}
          projects={projects}
          onSave={async (id, patch) => {
            await onUpdate(id, patch);
            setEditTask(prev => prev && prev.task_id === id ? { ...prev, ...patch } : prev);
          }}
          onDelete={onDelete}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

const PRIORITY_ROW: Record<Priority, string> = {
  high: "border-l-2 border-l-red-400",
  medium: "border-l-2 border-l-amber-400",
  low: "",
};

function ListView({
  tasks,
  users,
  onReorder,
  onUpdate,
  onDelete,
  onToggle,
}: {
  tasks: Task[];
  users: User[];
  onReorder: (ids: string[]) => Promise<void>;
  onUpdate: (id: string, patch: Partial<Task> & { assignment_note?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggle: (task: Task) => Promise<void>;
  onCreate: (data: Partial<Task>) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDue, setEditDue] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEst, setEditEst] = useState("");
  const [editAssigned, setEditAssigned] = useState("");

  const [rankEditId, setRankEditId] = useState<string | null>(null);
  const [rankEditVal, setRankEditVal] = useState("");

  type SortCol = "priority" | "title" | "due_date" | "est" | "assignee" | "project";
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleColSort(col: SortCol) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sortedTasks = useMemo(() => {
    const PORD: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
    if (!sortCol) return tasks;
    return [...tasks].sort((a, b) => {
      let cmp = 0;
      if (sortCol === "priority") {
        cmp = PORD[inferPriority(a)] - PORD[inferPriority(b)];
      } else if (sortCol === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortCol === "due_date") {
        if (!a.due_date && !b.due_date) cmp = 0;
        else if (!a.due_date) cmp = 1;
        else if (!b.due_date) cmp = -1;
        else cmp = a.due_date.localeCompare(b.due_date);
      } else if (sortCol === "est") {
        const ea = a.estimated_minutes ?? Infinity;
        const eb = b.estimated_minutes ?? Infinity;
        cmp = ea - eb;
      } else if (sortCol === "assignee") {
        cmp = (a.assigned_to_name ?? "").localeCompare(b.assigned_to_name ?? "");
      } else if (sortCol === "project") {
        cmp = (a.project_name ?? "").localeCompare(b.project_name ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [tasks, sortCol, sortDir]);

  const dragTask = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  function commitRank(taskId: string, total: number) {
    const n = parseInt(rankEditVal, 10);
    setRankEditId(null);
    if (isNaN(n)) return;
    const clamped = Math.max(1, Math.min(n, total));
    const fromIdx = tasks.findIndex(t => t.task_id === taskId);
    if (fromIdx === -1) return;
    const newOrder = [...tasks];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(clamped - 1, 0, moved);
    onReorder(newOrder.map(t => t.task_id));
  }

  function startEdit(task: Task) {
    setEditingId(task.task_id);
    setEditTitle(task.title);
    setEditDue(task.due_date ?? "");
    setEditStart(task.start_date ?? "");
    setEditEst(task.estimated_minutes ? String(task.estimated_minutes) : "");
    setEditAssigned(task.assigned_to ?? "");
  }

  async function saveEdit(task: Task) {
    await onUpdate(task.task_id, {
      title: editTitle.trim() || task.title,
      due_date: editDue || null,
      start_date: editStart || null,
      estimated_minutes: editEst ? parseInt(editEst, 10) : null,
      assigned_to: editAssigned || null,
    } as Partial<Task>);
    setEditingId(null);
  }

  function handleDrop(targetId: string) {
    const fromId = dragTask.current;
    if (!fromId || fromId === targetId) { setDragOver(null); return; }
    const fromIdx = tasks.findIndex(t => t.task_id === fromId);
    const toIdx = tasks.findIndex(t => t.task_id === targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragOver(null); return; }
    const newOrder = [...tasks];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    onReorder(newOrder.map(t => t.task_id));
    dragTask.current = null;
    setDragOver(null);
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center py-16 gap-3">
        <svg className="w-12 h-12 text-gray-200 dark:text-gray-700" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        <p className="text-sm text-gray-400">No tasks match your filters.</p>
      </div>
    );
  }

  function SortHeader({ col, label, className }: { col: SortCol; label: string; className?: string }) {
    const active = sortCol === col;
    return (
      <button
        onClick={() => handleColSort(col)}
        className={`flex items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors select-none ${
          active ? "text-blue-500 dark:text-blue-400" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        } ${className ?? ""}`}
        title={active ? (sortDir === "asc" ? "Sorted ascending — click for descending" : "Sorted descending — click to clear") : `Sort by ${label}`}
      >
        {label}
        <span className="ml-0.5 w-2.5 text-center">
          {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Column headers */}
      <div
        className="grid border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-2.5"
        style={{ gridTemplateColumns: "20px 20px 32px 60px 1fr 110px 70px 130px 110px 28px" }}
      >
        <div />
        <div />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">#</span>
        <SortHeader col="priority" label="Priority" />
        <SortHeader col="title" label="Title" />
        <SortHeader col="due_date" label="Due Date" />
        <SortHeader col="est" label="Est." />
        <SortHeader col="assignee" label="Assignee" />
        <SortHeader col="project" label="Project" />
        <div />
      </div>

      {sortedTasks.map((task, idx) => {
        const overdue = isOverdue(task.due_date, task.status);
        const priority = inferPriority(task);
        const editing = editingId === task.task_id;
        const isOver = dragOver === task.task_id;
        const rank = idx + 1;
        const isRankEditing = rankEditId === task.task_id;

        return (
          <div
            key={task.task_id}
            draggable={!sortCol}
            onDragStart={sortCol ? undefined : () => { dragTask.current = task.task_id; }}
            onDragEnd={sortCol ? undefined : () => { dragTask.current = null; setDragOver(null); }}
            onDragOver={sortCol ? undefined : (e => { e.preventDefault(); setDragOver(task.task_id); })}
            onDragLeave={sortCol ? undefined : () => setDragOver(null)}
            onDrop={sortCol ? undefined : () => handleDrop(task.task_id)}
            className={`grid items-center px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-0 group transition-colors ${
              PRIORITY_ROW[priority]
            } ${
              isOver ? "bg-blue-50 dark:bg-blue-950/20" : "hover:bg-gray-50/50 dark:hover:bg-gray-800/20"
            }`}
            style={{ gridTemplateColumns: "20px 20px 32px 60px 1fr 110px 70px 130px 110px 28px" }}
          >
            {/* Drag handle — hidden while a column sort is active */}
            <div className={`flex items-center justify-center ${sortCol ? "opacity-0 pointer-events-none" : "cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400"}`}>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
                <circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/>
                <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
                <circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/>
              </svg>
            </div>

            {/* Checkbox */}
            <button
              onClick={() => onToggle(task)}
              className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                task.status === "done" ? "bg-green-500 border-green-500" : "border-gray-300 dark:border-gray-600 hover:border-green-400"
              }`}
              aria-label={task.status === "done" ? "Mark open" : "Mark done"}
            >
              {task.status === "done" && (
                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {/* Rank # */}
            {isRankEditing ? (
              <input
                autoFocus
                type="number"
                min={1}
                max={tasks.length}
                value={rankEditVal}
                onChange={e => setRankEditVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRank(task.task_id, tasks.length);
                  if (e.key === "Escape") setRankEditId(null);
                }}
                onBlur={() => commitRank(task.task_id, tasks.length)}
                onClick={e => e.stopPropagation()}
                className="w-8 text-xs text-center bg-white dark:bg-gray-800 border border-blue-400 rounded px-0.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-gray-700 dark:text-gray-200"
              />
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setRankEditId(task.task_id); setRankEditVal(String(rank)); }}
                className="text-xs text-gray-300 dark:text-gray-600 hover:text-blue-500 dark:hover:text-blue-400 font-mono tabular-nums w-7 text-center transition-colors"
                title="Click to set position"
              >
                {rank}
              </button>
            )}

            {/* Priority */}
            <div className="flex items-center">
              <PriorityBadge
                priority={priority}
                onClick={e => {
                  e.stopPropagation();
                  const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(priority) + 1) % PRIORITY_CYCLE.length];
                  onUpdate(task.task_id, { priority: next });
                }}
              />
            </div>

            {/* Title / Edit */}
            {editing ? (
              <div className="flex gap-1.5 items-center col-span-full pl-2 pr-6">
                <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter") saveEdit(task); if (e.key === "Escape") setEditingId(null); }}
                       className="flex-1 text-sm bg-white dark:bg-gray-800 border border-blue-400 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-gray-900 dark:text-gray-100" />
                <input type="date" value={editDue} onChange={e => setEditDue(e.target.value)} title="Due date"
                       className="text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none text-gray-900 dark:text-gray-100" />
                <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} title="Start date"
                       className="text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none text-gray-900 dark:text-gray-100" />
                <input type="number" value={editEst} onChange={e => setEditEst(e.target.value)} placeholder="min"
                       className="w-16 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400" />
                <select value={editAssigned} onChange={e => setEditAssigned(e.target.value)}
                        className={SEL_XS}>
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>)}
                </select>
                <button onClick={() => saveEdit(task)} className="text-xs text-blue-600 font-semibold hover:underline px-1">Save</button>
                <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600 px-1">Cancel</button>
              </div>
            ) : (
              <>
                <span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                  <span
                    onClick={() => startEdit(task)}
                    className={`text-sm cursor-text truncate flex-shrink min-w-0 ${task.status === "done" ? "line-through text-gray-400 dark:text-gray-600" : "text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400"} transition-colors`}
                    title={task.title}
                  >
                    {task.title}
                    {task.contact_name && (
                      <span className="text-gray-400 dark:text-gray-500 ml-1.5 font-normal text-xs">· {task.contact_name}</span>
                    )}
                  </span>
                  <TaskTypeBadge type={task.activity_type}
                    onClick={e => {
                      e.stopPropagation();
                      const types = TASK_TYPES as unknown as string[];
                      const cur = task.activity_type || "todo";
                      const next = types[(types.indexOf(cur) + 1) % types.length];
                      onUpdate(task.task_id, { activity_type: next } as Partial<Task>);
                    }}
                  />
                  {(task.blocked_by_count ?? 0) > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 font-semibold">⊘</span>
                  )}
                  {task.milestone_title && (
                    <span className="flex-shrink-0 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 font-medium max-w-[80px] truncate" title={task.milestone_title}>◆ {task.milestone_title}</span>
                  )}
                </span>

                {/* Due Date */}
                <span className={`text-xs font-medium ${
                  overdue ? "text-red-500" : task.due_date ? "text-gray-500 dark:text-gray-400" : "text-gray-300 dark:text-gray-700"
                }`}>
                  {task.due_date ? fmtDate(task.due_date) : "—"}
                  {overdue && <span className="ml-1 text-[10px] font-semibold">late</span>}
                </span>

                {/* Est */}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {fmtMinutes(task.estimated_minutes) ?? "—"}
                </span>

                {/* Assignee */}
                <div className="flex items-center gap-1">
                  {task.assigned_to_name ? (
                    <>
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-400 to-blue-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0" title={task.assigned_to_name}>
                        {getInitials(task.assigned_to_name)}
                      </div>
                      {(task.extra_assignees ?? []).slice(0, 2).map(ea => (
                        <div key={ea.user_id} className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 -ml-1" title={ea.name}>
                          {getInitials(ea.name)}
                        </div>
                      ))}
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate ml-0.5">
                        {task.assigned_to_name.split(" ")[0]}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-700">—</span>
                  )}
                </div>

                {/* Project */}
                {task.project_name ? (
                  <Link href={`/projects/${task.project_id}`}
                        className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover:underline truncate font-medium"
                        onClick={e => e.stopPropagation()}>
                    {task.project_name}
                  </Link>
                ) : (
                  <span className="text-xs text-gray-300 dark:text-gray-700">—</span>
                )}
              </>
            )}

            {/* Delete */}
            {!editing && (
              <button
                onClick={() => onDelete(task.task_id)}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex items-center justify-center w-7 h-7 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                aria-label="Delete task"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Email Suggestions Panel ──────────────────────────────────────────────────

interface EmailSuggestion {
  suggestion_id?: string;
  message_id: string;
  from_name: string;
  from_email: string;
  subject: string;
  date: string;
  reason: string;
  suggested_action: string;
  suggested_due_date: string;
  status?: string;
}

function EmailSuggestionsPanel({ onTaskCreated }: { onTaskCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<EmailSuggestion[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/proxy/email/followup-suggestions")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.suggestions?.length) setSuggestions(d.suggestions); })
      .catch(() => {});
  }, []);

  async function scan() {
    setScanning(true); setScanError("");
    try {
      const res = await fetch("/api/proxy/email/suggest-followups?max_results=20");
      if (!res.ok) { const d = await res.json().catch(() => ({})); setScanError(d.detail || "Scan failed"); return; }
      const d = await res.json();
      setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
    } catch { setScanError("Failed to reach email service"); }
    finally { setScanning(false); }
  }

  async function createTask(s: EmailSuggestion) {
    setCreating(prev => new Set([...prev, s.message_id]));
    try {
      const res = await fetch("/api/proxy/email/accept-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: s.from_email, from_name: s.from_name,
          subject: s.subject, suggested_action: s.suggested_action,
          suggested_due_date: s.suggested_due_date, message_id: s.message_id,
        }),
      });
      if (res.ok) {
        setCreated(prev => new Set([...prev, s.message_id]));
        if (s.suggestion_id) {
          await fetch(`/api/proxy/email/followup-suggestions/${s.suggestion_id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "accepted" }),
          }).catch(() => {});
        }
        onTaskCreated();
      }
    } finally {
      setCreating(prev => { const n = new Set(prev); n.delete(s.message_id); return n; });
    }
  }

  async function dismiss(s: EmailSuggestion) {
    setSuggestions(prev => prev.filter(x => x.message_id !== s.message_id));
    if (s.suggestion_id) {
      await fetch(`/api/proxy/email/followup-suggestions/${s.suggestion_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      }).catch(() => {});
    }
  }

  const visible = suggestions.filter(s => s.status !== "dismissed");
  const pendingCount = visible.filter(s => !created.has(s.message_id)).length;

  return (
    <div className="text-right">
      {/* Compact trigger */}
      <button
        onClick={() => { setOpen(o => !o); if (!open && suggestions.length === 0) scan(); }}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
        From Email
        {pendingCount > 0 && (
          <span className="px-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">{pendingCount}</span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {open && (
        <div className="mt-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Email suggestions</span>
            <button
              onClick={e => { e.stopPropagation(); scan(); }}
              disabled={scanning}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium"
            >
              {scanning ? "Scanning…" : "Scan inbox"}
            </button>
          </div>
          {scanning ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <svg className="w-5 h-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
              <p className="text-sm text-gray-400">Scanning recent emails for follow-ups…</p>
            </div>
          ) : scanError ? (
            <div className="p-4 text-center">
              <p className="text-sm text-red-500 mb-2">{scanError}</p>
              <button onClick={scan} className="text-xs text-blue-600 hover:underline">Try again</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-center px-4">
              <svg className="w-8 h-8 text-blue-200 dark:text-blue-900" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Scan your inbox for action items and convert them to tasks</p>
                <button onClick={scan} className="mt-3 text-sm px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                  Scan inbox
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {visible.map(s => {
                const isCreated = created.has(s.message_id);
                const isCreating = creating.has(s.message_id);
                const due = s.suggested_due_date
                  ? new Date(s.suggested_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : null;
                return (
                  <div key={s.message_id}
                    className={`border rounded-lg p-3 transition-all ${isCreated ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"}`}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{s.from_name || s.from_email}</p>
                        <a href={`/email?message=${s.message_id}`} className="text-[10px] text-blue-500 hover:underline block truncate">{s.subject}</a>
                      </div>
                      {due && <span className="text-[10px] text-gray-400 flex-shrink-0">{due}</span>}
                    </div>
                    <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-snug mb-1.5">{s.suggested_action}</p>
                    <p className="text-[10px] text-gray-400 italic leading-snug mb-2.5 line-clamp-2">{s.reason}</p>
                    {isCreated ? (
                      <p className="text-[10px] text-green-600 dark:text-green-400 font-medium">✓ Task created</p>
                    ) : (
                      <div className="flex gap-1.5">
                        <button onClick={() => createTask(s)} disabled={isCreating}
                          className="flex-1 text-[10px] py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition-colors">
                          {isCreating ? "Creating…" : "→ Task"}
                        </button>
                        <button onClick={() => dismiss(s)}
                          className="text-[10px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button onClick={scan} disabled={scanning}
                className="col-span-full text-[10px] text-center text-gray-400 hover:text-gray-600 py-1 transition-colors">
                ↺ Rescan inbox
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<{ project_id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<FilterMode>("open");
  const [search, setSearch] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterPriority, setFilterPriority] = useState<Priority | "">("");
  const [showModal, setShowModal] = useState(false);
  const [modalDefaultCol, setModalDefaultCol] = useState<KanbanColId | undefined>(undefined);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [isAdmin, setIsAdmin] = useState(false);
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (filter !== "all") params.set("status", filter);
      if (scope === "all") params.set("all_users", "true");
      const res = await fetch(`/api/proxy/tasks?${params}`, { cache: "no-store" });
      if (res.ok) setTasks(await res.json());
    } finally { setLoading(false); }
  }, [filter, scope]);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/messaging/unread");
      if (res.ok) { const d = await res.json(); setUnreadMessages(d.total ?? 0); }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 20s so changes from dashboard always appear without needing a navigation
  useEffect(() => {
    const iv = setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => clearInterval(iv);
  }, [load]);

  // Instantly remove a task when marked done from dashboard (same tab or cross-tab)
  useEffect(() => {
    function onTaskDone(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setTasks(ts => ts.filter(t => t.task_id !== id));
    }
    function onVisible() { if (!document.hidden) load(); }

    // Cross-tab: BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("task-updates");
      bc.onmessage = (e) => {
        if (e.data?.type === "done" && e.data?.id) {
          setTasks(ts => ts.filter(t => t.task_id !== e.data.id));
        } else {
          load();
        }
      };
    } catch {}

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("task-assignment-accepted", onVisible);
    window.addEventListener("task-updated", onVisible);
    window.addEventListener("task-done", onTaskDone);
    return () => {
      bc?.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("task-assignment-accepted", onVisible);
      window.removeEventListener("task-updated", onVisible);
      window.removeEventListener("task-done", onTaskDone);
    };
  }, [load]);

  useEffect(() => {
    fetch("/api/proxy/tasks/users").then(r => r.ok ? r.json() : []).then(setUsers);
    fetch("/api/proxy/projects?status=active&limit=100")
      .then(r => r.ok ? r.json() : [])
      .then(data => setProjects((data.items ?? data ?? []).map((p: { project_id: string; name: string }) => ({ project_id: p.project_id, name: p.name }))));
    fetch("/api/proxy/users/me")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.effective_permissions?.manage_users) setIsAdmin(true); });
  }, []);

  useEffect(() => {
    fetchUnread();
    const iv = setInterval(fetchUnread, 30_000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  const onCreate = useCallback(async (data: Partial<Task>) => {
    const res = await fetch("/api/proxy/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) load();
  }, [load]);

  const onUpdate = useCallback(async (id: string, patch: Partial<Task> & { assignment_note?: string | null }) => {
    const res = await fetch(`/api/proxy/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setTasks(ts => ts.map(t => t.task_id === id ? { ...t, ...updated } : t));
    }
  }, []);

  const onToggle = useCallback(async (task: Task) => {
    const next = task.status === "done" ? "open" : "done";
    // Optimistic update so the UI responds immediately
    setTasks(ts => ts.map(t => t.task_id === task.task_id ? { ...t, status: next as "open" | "done", kanban_status: next === "done" ? "done" : (t.kanban_status === "done" ? "todo" : t.kanban_status) } : t));
    const res = await fetch(`/api/proxy/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) {
      const updated = await res.json();
      setTasks(ts => ts.map(t => t.task_id === task.task_id ? { ...t, ...updated } : t));
      window.dispatchEvent(new Event("task-updated"));
    } else {
      // Revert on failure
      setTasks(ts => ts.map(t => t.task_id === task.task_id ? { ...t, status: task.status } : t));
    }
  }, [setTasks]);

  const onDelete = useCallback(async (id: string) => {
    // Optimistic remove
    setTasks(ts => ts.filter(t => t.task_id !== id));
    const res = await fetch(`/api/proxy/tasks/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      // Revert: re-fetch to restore
      load();
    }
  }, [load]);

  const onReorder = useCallback(async (orderedIds: string[]) => {
    setTasks(prev => {
      const map = new Map(prev.map(t => [t.task_id, t]));
      return orderedIds.map((id, i) => ({ ...map.get(id)!, sort_order: (i + 1) * 10 })).filter(Boolean);
    });
    await fetch("/api/proxy/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_ids: orderedIds }),
    });
  }, []);

  // Stats
  const allTasksCount = tasks.length;
  const openCount = tasks.filter(t => t.status === "open").length;
  const overdueCount = tasks.filter(t => isOverdue(t.due_date, t.status)).length;
  const doneCount = tasks.filter(t => t.status === "done").length;

  // Filtered tasks
  const shown = useMemo(() => {
    let list = view === "kanban" || filter === "all" ? tasks
      : tasks.filter(t => filter === "open" ? t.status === "open" : t.status === "done");

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.contact_name?.toLowerCase().includes(q) ||
        t.project_name?.toLowerCase().includes(q)
      );
    }
    if (filterAssignee) {
      list = list.filter(t => t.assigned_to === filterAssignee);
    }
    if (filterPriority) {
      list = list.filter(t => inferPriority(t) === filterPriority);
    }
    return list;
  }, [tasks, view, filter, search, filterAssignee, filterPriority]);

  const hasActiveFilters = search || filterAssignee || filterPriority;

  function clearFilters() {
    setSearch("");
    setFilterAssignee("");
    setFilterPriority("");
  }

  return (
    <div className="space-y-2.5 max-w-full">
      {/* ── Row 1: scope · stats · actions ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Scope (admin) */}
        {isAdmin && (
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-md p-0.5">
            {(["mine", "all"] as const).map(s => (
              <button key={s} onClick={() => setScope(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${scope === s ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
                {s === "mine" ? "Mine" : "All"}
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{openCount} open</span>
        {overdueCount > 0 && <span className="text-xs text-red-500 font-medium tabular-nums">{overdueCount} overdue</span>}
        <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">{doneCount} done</span>

        <div className="flex-1" />

        {/* Inbox button */}
        <button onClick={() => setMessagingOpen(true)}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
          Inbox
          {unreadMessages > 0 && <span className="px-1 py-0.5 rounded-full bg-blue-600 text-white text-[9px] font-bold leading-none">{unreadMessages}</span>}
        </button>

        <button onClick={() => { setModalDefaultCol(undefined); setShowModal(true); }}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Task
        </button>
      </div>

      {/* ── Row 2: view tabs · filter · search ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View tabs */}
        <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-md p-0.5">
          {(["list", "kanban", "gantt", "reports"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${view === v ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"}`}>
              {v === "list" ? "List" : v === "kanban" ? "Kanban" : v === "gantt" ? "Gantt" : "Reports"}
            </button>
          ))}
        </div>

        {/* Status filter — list/gantt only */}
        {(view === "list" || view === "gantt") && (
          <div className="flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-md p-0.5">
            {(["open", "done", "all"] as FilterMode[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all capitalize ${filter === f ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Search — hide on reports view */}
        {view !== "reports" && (
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-400"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        )}

        {/* Filters — list/kanban/gantt only */}
        {view !== "reports" && (
          <>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as Priority | "")} className={SEL_XS}>
              <option value="">Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {users.length > 1 && (
              <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className={SEL_XS}>
                <option value="">Assignee</option>
                {users.map(u => <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>)}
              </select>
            )}
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition-colors">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                Clear
              </button>
            )}
            {hasActiveFilters && <span className="text-xs text-gray-400">{shown.length}/{allTasksCount}</span>}
          </>
        )}
      </div>

      {/* ── AI Suggestions ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <SuggestionsSection onTaskCreated={load} />
      </div>

      {/* ── Views ── */}
      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading tasks…</p>
        </div>
      ) : view === "list" ? (
        <ListView
          tasks={shown}
          users={users}
          onReorder={onReorder}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onToggle={onToggle}
          onCreate={onCreate}
        />
      ) : view === "kanban" ? (
        <KanbanView
          tasks={shown}
          users={users}
          projects={projects}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCreate={(data) => onCreate({ ...data })}
          onReorder={onReorder}
          showOwner={scope === "all"}
        />
      ) : (
        <GanttView
          tasks={shown}
          onUpdate={onUpdate}
          onToggle={onToggle}
          onDelete={onDelete}
          showOwner={scope === "all"}
        />
      )}

      {/* ── Reports view ── */}
      {!loading && view === "reports" && (
        <ReportsPanel isAdmin={isAdmin} />
      )}

      {/* ── New Task Modal ── */}
      {showModal && (
        <NewTaskModal
          users={users}
          projects={projects}
          defaultKanbanStatus={modalDefaultCol}
          onSubmit={onCreate}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* ── Messaging Drawer ── */}
      <MessagingDrawer
        open={messagingOpen}
        onClose={() => { setMessagingOpen(false); fetchUnread(); }}
        onUnreadChange={fetchUnread}
      />
    </div>
  );
}
