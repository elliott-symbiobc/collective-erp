"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskOverview {
  period_days: number;
  totals: { total: number; done: number; open: number; overdue: number };
  by_priority: { priority: string; total: number; done: number; overdue: number }[];
  by_kanban: { kanban_status: string; count: number }[];
  by_category: { category: string; total: number; done: number }[];
  weekly_done: { week: string; tasks_done: number }[];
}

interface TeamMember {
  user_id: string; name: string; email: string; role: string;
  total: number; done: number; open: number; overdue: number; completion_pct: number;
}

interface CrmData {
  pipeline: { total_deals: number; total_pipeline: number; weighted_pipeline: number };
  deals_by_stage: { stage: string; count: number; total_revenue: number; avg_probability: number; weighted_revenue: number }[];
  projects_by_stage: { section: string; stage: string; count: number; total_revenue: number }[];
  project_tasks: { name: string; section: string; stage: string; open_tasks: number; overdue_tasks: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444"];

const PRIORITY_COLOR: Record<string, string> = {
  high: "#ef4444", medium: "#f59e0b", low: "#22c55e", none: "#9ca3af",
};

const KANBAN_LABEL: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", review: "Review", done: "Done",
};

const SECTION_COLOR: Record<string, string> = {
  client: "#3b82f6", partnership: "#8b5cf6", other: "#9ca3af",
};

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: "red" | "green" | "yellow";
}) {
  const valColor =
    accent === "red" ? "text-red-500" :
    accent === "green" ? "text-green-500" :
    accent === "yellow" ? "text-yellow-500" :
    "text-gray-900 dark:text-gray-100";
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`text-2xl font-semibold leading-tight ${valColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{children}</h2>;
}

function CompletionBar({ pct, color = "#3b82f6" }: { pct: number; color?: string }) {
  return (
    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

function TasksTab({ data }: { data: TaskOverview }) {
  const { totals, by_priority, by_kanban, by_category, weekly_done } = data;
  const completionPct = totals.total > 0 ? Math.round(100 * totals.done / totals.total) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Tasks" value={totals.total} />
        <StatCard label="Completed" value={totals.done} sub={`${completionPct}% completion`} accent="green" />
        <StatCard label="Open" value={totals.open} />
        <StatCard label="Overdue" value={totals.overdue} accent={totals.overdue > 0 ? "red" : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {by_priority.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <SectionHeader>By Priority</SectionHeader>
            <div className="mt-4 space-y-3">
              {by_priority.map(p => {
                const pct = p.total > 0 ? Math.round(100 * p.done / p.total) : 0;
                return (
                  <div key={p.priority}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium capitalize" style={{ color: PRIORITY_COLOR[p.priority] }}>
                        {p.priority === "none" ? "No priority" : p.priority}
                      </span>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        {p.overdue > 0 && <span className="text-red-500">{p.overdue} overdue</span>}
                        <span>{p.done}/{p.total}</span>
                        <span className="w-8 text-right text-gray-600 dark:text-gray-300">{pct}%</span>
                      </div>
                    </div>
                    <CompletionBar pct={pct} color={PRIORITY_COLOR[p.priority]} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {by_category.length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <SectionHeader>By Type</SectionHeader>
            <ResponsiveContainer width="100%" height={200} className="mt-3">
              <BarChart data={by_category} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={78} />
                <Tooltip />
                <Bar dataKey="done" name="Done" stackId="a" fill="#10b981" />
                <Bar dataKey="total" name="Total" stackId="b" fill="#e5e7eb" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {by_kanban.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <SectionHeader>Open Tasks by Stage</SectionHeader>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {by_kanban.map((k, i) => (
              <div key={k.kanban_status} className="rounded-lg p-3 text-center"
                style={{ backgroundColor: `${COLORS[i]}18`, border: `1px solid ${COLORS[i]}44` }}>
                <p className="text-xs font-medium" style={{ color: COLORS[i] }}>
                  {KANBAN_LABEL[k.kanban_status] ?? k.kanban_status}
                </p>
                <p className="text-2xl font-bold mt-1" style={{ color: COLORS[i] }}>{k.count}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {weekly_done.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <SectionHeader>Weekly Tasks Completed</SectionHeader>
          <ResponsiveContainer width="100%" height={200} className="mt-3">
            <BarChart data={weekly_done} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip labelFormatter={d => `Week of ${d}`} />
              <Bar dataKey="tasks_done" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function CrmTab({ data }: { data: CrmData }) {
  const { pipeline, deals_by_stage, projects_by_stage, project_tasks } = data;
  const clientProjects = projects_by_stage.filter(p => p.section === "client");
  const partnerProjects = projects_by_stage.filter(p => p.section === "partnership");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active Deals" value={pipeline.total_deals} />
        <StatCard label="Total Pipeline" value={fmt$(pipeline.total_pipeline)} sub="sum of expected revenue" />
        <StatCard label="Weighted Pipeline" value={fmt$(pipeline.weighted_pipeline)} sub="probability-adjusted" />
      </div>

      {deals_by_stage.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <SectionHeader>CRM Deals by Stage</SectionHeader>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left pb-2 font-medium">Stage</th>
                  <th className="text-right pb-2 font-medium">Deals</th>
                  <th className="text-right pb-2 font-medium">Pipeline</th>
                  <th className="text-right pb-2 font-medium">Avg Prob.</th>
                  <th className="text-right pb-2 font-medium">Weighted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {deals_by_stage.map((s, i) => (
                  <tr key={s.stage}>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="font-medium text-gray-800 dark:text-gray-200">{s.stage}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{s.count}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{fmt$(s.total_revenue)}</td>
                    <td className="py-2 text-right text-gray-600 dark:text-gray-400">{s.avg_probability.toFixed(0)}%</td>
                    <td className="py-2 text-right font-medium text-gray-800 dark:text-gray-200">{fmt$(s.weighted_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[
          { label: "Client Projects", rows: clientProjects, color: SECTION_COLOR.client },
          { label: "Partnership Projects", rows: partnerProjects, color: SECTION_COLOR.partnership },
        ].map(({ label, rows, color }) =>
          rows.length > 0 ? (
            <div key={label} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <SectionHeader>{label}</SectionHeader>
              <div className="mt-3 space-y-2">
                {rows.map(r => (
                  <div key={`${r.section}-${r.stage}`} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-28 truncate">{r.stage}</span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(r.count * 20, 100)}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-xs text-gray-500 w-6 text-right">{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>

      {project_tasks.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <SectionHeader>Open Tasks by Project</SectionHeader>
          <div className="mt-4 space-y-2">
            {project_tasks.map(p => (
              <div key={p.name} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full capitalize"
                      style={{ backgroundColor: `${SECTION_COLOR[p.section] ?? "#9ca3af"}22`, color: SECTION_COLOR[p.section] ?? "#9ca3af" }}>
                      {p.section}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">{p.stage}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.open_tasks}</span>
                  {p.overdue_tasks > 0 && <span className="ml-2 text-xs text-red-500">{p.overdue_tasks} overdue</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamTab({ members }: { members: TeamMember[] }) {
  const totalOpen = members.reduce((s, m) => s + (m.open ?? 0), 0);
  const totalOverdue = members.reduce((s, m) => s + (m.overdue ?? 0), 0);
  const avgCompletion = members.length > 0
    ? Math.round(members.reduce((s, m) => s + Number(m.completion_pct), 0) / members.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Team Open Tasks" value={totalOpen} />
        <StatCard label="Team Overdue" value={totalOverdue} accent={totalOverdue > 0 ? "red" : undefined} />
        <StatCard label="Avg Completion Rate" value={`${avgCompletion}%`} accent="green" />
      </div>

      {members.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <SectionHeader>Task Completion Rate per Employee</SectionHeader>
          <ResponsiveContainer width="100%" height={Math.max(180, members.length * 44)} className="mt-3">
            <BarChart data={members} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={116} />
              <Tooltip formatter={(v: number) => [`${v}%`, "Completion"]} />
              <Bar dataKey="completion_pct" name="Completion %" radius={[0, 3, 3, 0]}>
                {members.map((m) => (
                  <Cell key={m.user_id}
                    fill={Number(m.completion_pct) >= 75 ? "#10b981" : Number(m.completion_pct) >= 50 ? "#f59e0b" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <SectionHeader>Employee Task Breakdown</SectionHeader>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <th className="text-left pb-2 font-medium">Employee</th>
                <th className="text-right pb-2 font-medium">Total</th>
                <th className="text-right pb-2 font-medium">Done</th>
                <th className="text-right pb-2 font-medium">Open</th>
                <th className="text-right pb-2 font-medium">Overdue</th>
                <th className="text-right pb-2 font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {members.map(m => (
                <tr key={m.user_id}>
                  <td className="py-2">
                    <p className="font-medium text-gray-800 dark:text-gray-200">{m.name}</p>
                    <p className="text-xs text-gray-400 capitalize">{m.role}</p>
                  </td>
                  <td className="py-2 text-right text-gray-600 dark:text-gray-400">{m.total}</td>
                  <td className="py-2 text-right text-green-600">{m.done}</td>
                  <td className="py-2 text-right text-gray-600 dark:text-gray-400">{m.open}</td>
                  <td className={`py-2 text-right ${m.overdue > 0 ? "text-red-500 font-medium" : "text-gray-400"}`}>{m.overdue}</td>
                  <td className="py-2 text-right">
                    <span className={`font-semibold ${
                      Number(m.completion_pct) >= 75 ? "text-green-500" :
                      Number(m.completion_pct) >= 50 ? "text-yellow-500" : "text-red-500"
                    }`}>{m.completion_pct}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main exported panel ────────────────────────────────────────────────────

export default function ReportsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<"tasks" | "crm" | "team">("tasks");
  const [taskData, setTaskData] = useState<TaskOverview | null>(null);
  const [crmData, setCrmData] = useState<CrmData | null>(null);
  const [teamData, setTeamData] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/proxy/reports/tasks/overview?days=${days}`)
        .then(r => r.ok ? r.json() : null).then(d => { if (d) setTaskData(d); }),
      fetch("/api/proxy/reports/crm")
        .then(r => r.ok ? r.json() : null).then(d => { if (d) setCrmData(d); }),
    ]).finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/proxy/reports/tasks/team")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.members) setTeamData(d.members); });
  }, [isAdmin]);

  const tabs = [
    { key: "tasks" as const, label: "My Tasks" },
    { key: "crm" as const, label: "CRM & Projects" },
    ...(isAdmin ? [{ key: "team" as const, label: "Team" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Loading…
        </div>
      )}

      {!loading && tab === "tasks" && (
        taskData ? <TasksTab data={taskData} /> : <p className="text-sm text-gray-400 py-12 text-center">No task data yet.</p>
      )}
      {!loading && tab === "crm" && (
        crmData ? <CrmTab data={crmData} /> : <p className="text-sm text-gray-400 py-12 text-center">No CRM data yet.</p>
      )}
      {!loading && tab === "team" && isAdmin && (
        teamData ? <TeamTab members={teamData} /> : <p className="text-sm text-gray-400 py-12 text-center">Loading team data…</p>
      )}
    </div>
  );
}
