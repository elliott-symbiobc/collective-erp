"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ProjectCard, type Project } from "@/components/project/ProjectCard";
import { RD_STAGE_GROUPS, PORTFOLIO_STAGE_GROUPS, findGroup, type StageGroup } from "@/lib/contractStages";

const CHEVRON = "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22M19%209l-7%207-7-7%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.4rem_center] bg-[length:1rem]";
const SEL = `w-full text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30 pr-8 ${CHEVRON}`;

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>;
}
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 transition-transform ${collapsed ? "-rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
function CloseIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
}

// ── New Project Modal ─────────────────────────────────────────────────────────

function NewProjectModal({
  initialStage,
  stageGroups,
  projectType,
  crmType,
  onClose,
  onCreate,
}: {
  initialStage: string;
  stageGroups: StageGroup[];
  projectType: string;
  crmType: string;
  onClose: () => void;
  onCreate: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState(initialStage);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const allStages = stageGroups.flatMap(g => g.stages);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    const r = await fetch("/api/proxy/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(), project_type: projectType,
        crm_type: crmType,
        stage, status: "in_progress",
        notes: notes.trim() || undefined,
      }),
    });
    if (r.ok) {
      const { project_id } = await r.json();
      const r2 = await fetch(`/api/proxy/projects/${project_id}`);
      if (r2.ok) onCreate(await r2.json());
      else onClose();
    } else { setErr("Failed to create"); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit}
        className="bg-white dark:bg-[#141824] border border-gray-200 dark:border-white/10 rounded-xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-white/8">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">New Opportunity</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><CloseIcon /></button>
        </div>
        <div className="p-5 space-y-3">
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name *</label>
            <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Stage</label>
            <select value={stage} onChange={e => setStage(e.target.value)} className={SEL}>
              {allStages.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full bg-white dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button type="button" onClick={onClose}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-white/8 dark:hover:bg-white/12 text-sm text-gray-600 dark:text-gray-300 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-sm text-white rounded-lg disabled:opacity-50">
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Contract Pipeline Board ───────────────────────────────────────────────────

function ContractBoard({
  stageGroups,
  projectType,
  crmType,
  emptyLabel,
}: {
  stageGroups: StageGroup[];
  projectType: string;
  crmType: string;
  emptyLabel: string;
}) {
  const router = useRouter();
  const [byGroup, setByGroup] = useState<Record<string, Project[]>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newStage, setNewStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    // For crm_opportunity projects, don't filter by crm_type (legacy data has crm_type="lead")
    const qs = (crmType && projectType !== "crm_opportunity")
      ? `project_type=${projectType}&crm_type=${crmType}`
      : `project_type=${projectType}`;
    const r = await fetch(`/api/proxy/projects?${qs}`);
    if (r.ok) {
      const list: Project[] = await r.json();
      const grouped: Record<string, Project[]> = {};
      for (const g of stageGroups) grouped[g.parent] = [];
      for (const p of list) {
        const stage = p.stage ?? stageGroups[0]?.stages[0] ?? "";
        const group = findGroup(stage, stageGroups);
        const key = group?.parent ?? stageGroups[0]?.parent ?? "";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(p);
      }
      setByGroup(grouped);
      // Auto-collapse Inactive group
      const autoCollapse = new Set(stageGroups.filter(g => g.autoCollapse).map(g => g.parent));
      setCollapsed(autoCollapse);
    }
    setLoading(false);
  }, [stageGroups, projectType, crmType]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  function toggleCollapse(parent: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(parent) ? next.delete(parent) : next.add(parent);
      return next;
    });
  }

  function handleCreated(p: Project) {
    setNewStage(null);
    router.push(`/projects/${p.project_id}`);
  }

  async function moveCard(projectId: string, toGroup: StageGroup) {
    const newStageVal = toGroup.stages[0];
    // Find which group the project is currently in
    const fromGroup = stageGroups.find(g => (byGroup[g.parent] ?? []).some(p => p.project_id === projectId));
    if (!fromGroup || fromGroup.parent === toGroup.parent) return;

    // Optimistic local update
    setByGroup(prev => {
      const next = { ...prev };
      const project = (next[fromGroup.parent] ?? []).find(p => p.project_id === projectId);
      if (!project) return prev;
      next[fromGroup.parent] = (next[fromGroup.parent] ?? []).filter(p => p.project_id !== projectId);
      next[toGroup.parent] = [{ ...project, stage: newStageVal }, ...(next[toGroup.parent] ?? [])];
      return next;
    });

    await fetch(`/api/proxy/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStageVal }),
    });
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><p className="text-sm text-gray-500">Loading…</p></div>;
  }

  return (
    <>
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-2 p-4 h-full min-w-max items-start">
          {stageGroups.map(group => {
            const projects = byGroup[group.parent] ?? [];
            const st = group.color;
            const isCollapsed = collapsed.has(group.parent);

            return (
              <div key={group.parent} className={`flex flex-col shrink-0 transition-all ${isCollapsed ? "w-10" : "w-60"}`}>
                {/* Column header */}
                <div
                  className={`flex items-center gap-1.5 mb-2 px-1 cursor-pointer select-none ${isCollapsed ? "flex-col gap-2" : "justify-between"}`}
                  onClick={() => toggleCollapse(group.parent)}
                  title={isCollapsed ? `Expand ${group.parent}` : `Collapse ${group.parent}`}
                >
                  {isCollapsed ? (
                    <>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide ${st.header} whitespace-nowrap`}
                        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                      >
                        {group.parent}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">{projects.length}</span>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                        <span className={`text-xs font-semibold uppercase tracking-wide ${st.header}`}>{group.parent}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400 dark:text-gray-600 tabular-nums">{projects.length}</span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setNewStage(group.stages[group.stages.length - 1]);
                          }}
                          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-0.5 p-0.5"
                          title={`Add to ${group.parent}`}
                        >
                          <PlusIcon />
                        </button>
                        <ChevronIcon collapsed={false} />
                      </div>
                    </>
                  )}
                </div>

                {/* Cards — drop zone */}
                {!isCollapsed && (
                  <div
                    className={`flex flex-col gap-2 flex-1 overflow-y-auto pr-0.5 rounded-lg transition-colors ${draggedId && dragOverGroup === group.parent ? `${st.bg} ring-1 ring-inset ${st.card}` : ""}`}
                    onDragOver={e => { e.preventDefault(); setDragOverGroup(group.parent); }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverGroup(null); }}
                    onDrop={e => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("projectId");
                      if (id) moveCard(id, group);
                      setDraggedId(null); setDragOverGroup(null);
                    }}
                  >
                    {projects.length === 0 ? (
                      <div className={`border border-dashed rounded-lg p-4 text-center transition-colors ${draggedId && dragOverGroup === group.parent ? `${st.card} border-solid` : "border-gray-200 dark:border-white/8"}`}>
                        <p className="text-xs text-gray-400 dark:text-gray-600">{emptyLabel}</p>
                      </div>
                    ) : projects.map(p => (
                      <div
                        key={p.project_id}
                        draggable
                        onDragStart={e => { e.dataTransfer.setData("projectId", p.project_id); e.dataTransfer.effectAllowed = "move"; setDraggedId(p.project_id); }}
                        onDragEnd={() => { setDraggedId(null); setDragOverGroup(null); }}
                        className={`transition-opacity ${draggedId === p.project_id ? "opacity-40" : "opacity-100"}`}
                      >
                        <ProjectCard p={p} compact onUpdate={fetchBoard} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Collapsed pill */}
                {isCollapsed && projects.length > 0 && (
                  <div className={`mt-1 rounded-lg ${st.bg} border ${st.card} flex items-center justify-center py-4`}
                    style={{ minHeight: "60px" }}>
                    <span className={`text-xs font-semibold ${st.header}`}>{projects.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* New project modal */}
      {newStage && (
        <NewProjectModal
          initialStage={newStage}
          stageGroups={stageGroups}
          projectType={projectType}
          crmType={crmType}
          onClose={() => setNewStage(null)}
          onCreate={handleCreated}
        />
      )}

    </>
  );
}



// ── Main Page ─────────────────────────────────────────────────────────────────

type MainTab = "rd_contracts" | "portfolio_contracts";

export default function CRMPage() {
  const [tab, setTab] = useState<MainTab>("rd_contracts");

  const TAB_CONFIG: { key: MainTab; label: string }[] = [
    { key: "rd_contracts",        label: "R&D Contracts" },
    { key: "portfolio_contracts", label: "Portfolio Contracts" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-white/8 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">CRM</h1>
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-white/8 rounded-lg p-0.5">
            {TAB_CONFIG.map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === key ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      {tab === "rd_contracts" && (
        <ContractBoard
          key="rd"
          stageGroups={RD_STAGE_GROUPS}
          projectType="crm_opportunity"
          crmType="rd_contract"
          emptyLabel="No R&D contracts"
        />
      )}
      {tab === "portfolio_contracts" && (
        <ContractBoard
          key="portfolio"
          stageGroups={PORTFOLIO_STAGE_GROUPS}
          projectType="portfolio"
          crmType="portfolio_contract"
          emptyLabel="No portfolio contracts"
        />
      )}
    </div>
  );
}
