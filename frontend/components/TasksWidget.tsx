"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface TaskSummary {
  open_count: number;
  done_count: number;
  overdue_count: number;
}

interface Task {
  task_id: string;
  title: string;
  due_date: string | null;
  project_name: string | null;
}

interface MyModule {
  module_key: string;
  module_label: string;
}

const MODULE_PATHS: Record<string, string> = {
  dashboard: "/dashboard",
  tasks: "/tasks",
  calendar: "/calendar",
  reports: "/reports",
  notebook: "/notebook",
  crm: "/crm",
  projects: "/projects",
  portals: "/portals",
  contacts: "/contacts",
  fpa: "/fpa",
  funding: "/funding",
  receivables: "/invoices",
  payables: "/payables",
  analyses: "/analyses",
  model: "/model",
  literature: "/kb",
  "system-design": "/system-design",
  runs: "/runs",
  protocols: "/protocols",
  strains: "/strains",
  enzymes: "/enzymes",
  chemicals: "/chemicals",
  consumables: "/consumables",
  equipment: "/equipment",
  inventory: "/inventory",
  marketing: "/marketing",
};

function fmt(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(due: string | null) {
  if (!due) return false;
  return new Date(due) < new Date(new Date().toDateString());
}

export default function TasksWidget() {
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [myModules, setMyModules] = useState<MyModule[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/proxy/tasks/summary").then(r => r.ok ? r.json() : null),
      fetch("/api/proxy/tasks?status=open&limit=5").then(r => r.ok ? r.json() : []),
      fetch("/api/proxy/module-owners/my").then(r => r.ok ? r.json() : []),
    ]).then(([s, t, m]) => {
      if (s) setSummary(s);
      if (Array.isArray(t)) setTasks(t);
      if (Array.isArray(m)) setMyModules(m);
    }).catch(() => {});
  }, []);

  if (!summary && tasks.length === 0 && myModules.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* My Responsibilities */}
      {myModules.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">My Responsibilities</h2>
          <div className="space-y-1">
            {myModules.map(m => (
              <Link
                key={m.module_key}
                href={MODULE_PATHS[m.module_key] ?? "/dashboard"}
                className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-xs font-medium text-gray-800 dark:text-gray-200 flex-1">{m.module_label}</span>
                <svg className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* My Tasks */}
      {(summary || tasks.length > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">My Tasks</h2>
            <Link href="/tasks" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              All tasks →
            </Link>
          </div>
          {summary && (
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>{summary.open_count} open</span>
              {summary.overdue_count > 0 && (
                <span className="text-red-500 font-medium">{summary.overdue_count} overdue</span>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            {tasks.length === 0 ? (
              <Link
                href="/tasks"
                className="block text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1"
              >
                No open tasks. Add one →
              </Link>
            ) : (
              tasks.map(t => (
                <Link
                  key={t.task_id}
                  href="/tasks"
                  className="flex items-start gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                >
                  <div className="w-3.5 h-3.5 mt-0.5 rounded border-2 border-gray-300 dark:border-gray-600 shrink-0 group-hover:border-green-400 transition-colors" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{t.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.due_date && (
                        <span className={`text-[10px] ${isOverdue(t.due_date) ? "text-red-500 font-medium" : "text-gray-400 dark:text-gray-500"}`}>
                          {isOverdue(t.due_date) ? "Overdue · " : ""}{fmt(t.due_date)}
                        </span>
                      )}
                      {t.project_name && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                          {t.project_name}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
          <Link
            href="/tasks"
            className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xs"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add task
          </Link>
        </div>
      )}
    </div>
  );
}
