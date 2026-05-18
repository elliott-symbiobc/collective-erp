"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Portal {
  portal_id: string;
  token: string;
  slug: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  portal_drive_folder_id: string | null;
  portal_drive_folder_name: string | null;
  project_id: string | null;
  project_name: string;
  project_drive_folder_name: string | null;
  created_by_name: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  client_name: string | null;
  category: "client" | "investor" | "partner";
  is_password_protected: boolean;
  is_standalone: boolean;
  viewer_count: number;
}

interface User {
  user_id: string;
  name: string;
  email: string;
}

interface Project {
  project_id: string;
  name: string;
}

type Tab = "client" | "investor" | "partner";

const TAB_LABELS: Record<Tab, string> = {
  client: "Clients",
  investor: "Investors",
  partner: "Partners",
};

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PortalsPage() {
  const [portals, setPortals]   = useState<Portal[]>([]);
  const [loading, setLoading]   = useState(true);
  const [users, setUsers]       = useState<User[]>([]);
  const [copied, setCopied]     = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [tab, setTab]           = useState<Tab>("client");

  // Create portal flow
  const [showCreateForm, setShowCreateForm]   = useState(false);
  const [createMode, setCreateMode]           = useState<"project" | "standalone">("standalone");
  const [projects, setProjects]               = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [roomName, setRoomName]               = useState("");
  const [creating, setCreating]               = useState(false);
  const [createError, setCreateError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/proxy/portals");
      if (r.ok) setPortals(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const r = await fetch("/api/proxy/tasks/users");
    if (r.ok) setUsers(await r.json());
  }, []);

  useEffect(() => { load(); loadUsers(); }, [load, loadUsers]);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const r = await fetch("/api/proxy/projects");
      if (r.ok) {
        const data = await r.json();
        setProjects(data.projects ?? data ?? []);
      }
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  function openCreateForm() {
    setShowCreateForm(true);
    setCreateMode("standalone");
    setSelectedProject("");
    setRoomName("");
    setCreateError(null);
    loadProjects();
  }

  async function createPortal(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      let r: Response;
      if (createMode === "standalone") {
        if (!roomName.trim()) return;
        r = await fetch("/api/proxy/portals/standalone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roomName.trim() }),
        });
      } else {
        if (!selectedProject) return;
        r = await fetch(`/api/proxy/projects/${selectedProject}/portal`, { method: "POST" });
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.detail ?? "Failed to create portal");
      }
      setShowCreateForm(false);
      load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Error creating portal");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(portal: Portal) {
    setRevoking(portal.portal_id);
    if (portal.is_standalone) {
      await fetch(`/api/proxy/portals/room/${portal.portal_id}`, { method: "DELETE" });
    } else {
      await fetch(`/api/proxy/projects/${portal.project_id}/portal`, { method: "DELETE" });
    }
    setRevoking(null);
    load();
  }

  function copyLink(portal: Portal) {
    const identifier = portal.slug ?? portal.token;
    const url = `${window.location.origin}/portal/${identifier}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(portal.token);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function assignPortal(portal: Portal, userId: string | null) {
    const url = portal.is_standalone
      ? `/api/proxy/portals/room/${portal.portal_id}/assign`
      : `/api/proxy/projects/${portal.project_id}/portal/assign`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to: userId }),
    });
    if (r.ok) {
      setPortals(prev => prev.map(p =>
        p.portal_id === portal.portal_id
          ? { ...p, assigned_to_id: userId, assigned_to_name: users.find(u => u.user_id === userId)?.name ?? null }
          : p
      ));
    }
  }

  async function setCategory(portal: Portal, category: Tab) {
    const url = portal.is_standalone
      ? `/api/proxy/portals/room/${portal.portal_id}/category`
      : `/api/proxy/projects/${portal.project_id}/portal/category`;
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (r.ok) {
      setPortals(prev => prev.map(p =>
        p.portal_id === portal.portal_id ? { ...p, category } : p
      ));
    }
  }

  // Split by tab
  const tabPortals  = portals.filter(p => p.category === tab);
  const active      = tabPortals.filter(p => p.is_active);
  const inactive    = tabPortals.filter(p => !p.is_active);
  const totalActive = portals.filter(p => p.is_active).length;

  const tabCounts: Record<Tab, number> = {
    client:   portals.filter(p => p.is_active && p.category === "client").length,
    investor: portals.filter(p => p.is_active && p.category === "investor").length,
    partner:  portals.filter(p => p.is_active && p.category === "partner").length,
  };

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Client Portals</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Manage shared document portals for clients and investors.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{totalActive} active</span>
          <button
            onClick={openCreateForm}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            + New portal
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-200 dark:border-gray-800">
        {(["client", "investor", "partner"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {TAB_LABELS[t]}
            {tabCounts[t] > 0 && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                tab === t
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              }`}>
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Create portal modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Create new portal</h2>
              <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs font-medium">
              {(["standalone", "project"] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCreateMode(mode)}
                  className={`flex-1 py-2 transition-colors ${
                    createMode === mode
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-750"
                  }`}
                >
                  {mode === "standalone" ? "Investor Data Room" : "Link to Project"}
                </button>
              ))}
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400">
              {createMode === "standalone"
                ? "Create a standalone data room not tied to any project. Perfect for investor due diligence."
                : "Link a portal to an existing project. Any previous active portal for that project will be revoked."}
            </p>

            <form onSubmit={createPortal} className="space-y-3">
              {createMode === "standalone" ? (
                <input
                  type="text"
                  placeholder="Data room name (e.g. Series A Due Diligence)…"
                  value={roomName}
                  onChange={e => setRoomName(e.target.value)}
                  required
                  autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              ) : projectsLoading ? (
                <p className="text-sm text-gray-400">Loading projects…</p>
              ) : (
                <select
                  value={selectedProject}
                  onChange={e => setSelectedProject(e.target.value)}
                  required
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select a project…</option>
                  {projects.map(p => (
                    <option key={p.project_id} value={p.project_id}>{p.name}</option>
                  ))}
                </select>
              )}

              {createError && <p className="text-sm text-red-500">{createError}</p>}

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || (createMode === "standalone" ? !roomName.trim() : !selectedProject)}
                  className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 font-medium"
                >
                  {creating ? "Creating…" : createMode === "standalone" ? "Create data room" : "Create portal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Portal list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : tabPortals.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-12 text-center">
          <p className="text-sm text-gray-400 mb-2">No {TAB_LABELS[tab].toLowerCase()} portals yet.</p>
          <p className="text-xs text-gray-400">
            Click <span className="font-medium text-gray-500">+ New portal</span> to create one.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Active — {active.length}
              </h2>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {active.map(p => (
                  <PortalRow
                    key={p.portal_id}
                    portal={p}
                    users={users}
                    currentTab={tab}
                    copied={copied === p.token}
                    revoking={revoking === p.portal_id}
                    onCopy={() => copyLink(p)}
                    onRevoke={() => revoke(p)}
                    onAssign={(uid) => assignPortal(p, uid)}
                    onCategory={(cat) => setCategory(p, cat)}
                  />
                ))}
              </div>
            </div>
          )}

          {inactive.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Revoked — {inactive.length}
              </h2>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 opacity-60">
                {inactive.map(p => (
                  <PortalRow
                    key={p.portal_id}
                    portal={p}
                    users={users}
                    currentTab={tab}
                    copied={false}
                    revoking={false}
                    onCopy={() => {}}
                    onRevoke={() => {}}
                    onAssign={() => {}}
                    onCategory={() => {}}
                    revoked
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Portal Row ────────────────────────────────────────────────────────────────

function PortalRow({
  portal,
  users,
  currentTab,
  copied,
  revoking,
  onCopy,
  onRevoke,
  onAssign,
  onCategory,
  revoked,
}: {
  portal: Portal;
  users: User[];
  currentTab: Tab;
  copied: boolean;
  revoking: boolean;
  onCopy: () => void;
  onRevoke: () => void;
  onAssign: (uid: string | null) => void;
  onCategory: (cat: Tab) => void;
  revoked?: boolean;
}) {
  const [showAssign, setShowAssign]     = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const assignRef   = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const folderName  = portal.portal_drive_folder_name ?? portal.project_drive_folder_name;

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) setShowAssign(false);
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) setShowCategory(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const CATEGORY_COLORS: Record<string, string> = {
    client:   "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800",
    investor: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800",
    partner:  "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-100 dark:border-green-800",
  };

  return (
    <div className="px-5 py-4 flex items-start gap-4">
      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${revoked ? "bg-gray-300 dark:bg-gray-600" : "bg-green-500"}`} />

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">

        {/* Row 1: name + badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={portal.is_standalone ? `/portals/room/${portal.portal_id}` : `/portals/${portal.project_id}`}
            className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
          >
            {portal.project_name}
          </Link>
          {portal.is_password_protected && (
            <span className="flex items-center gap-1 text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full font-medium shrink-0">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Password
            </span>
          )}
          {portal.viewer_count > 0 && (
            <span className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded-full font-medium shrink-0">
              {portal.viewer_count} viewer{portal.viewer_count !== 1 ? "s" : ""}
            </span>
          )}
          {folderName && (
            <span className="flex items-center gap-1 text-[11px] text-gray-400 truncate">
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              {folderName}
            </span>
          )}
        </div>

        {/* Row 2: client + assigned to */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Client name */}
          {portal.client_name ? (
            <span className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300">
              <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.768-.231-1.48-.634-2.073M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.768.231-1.48.634-2.073M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {portal.client_name}
            </span>
          ) : (
            <span className="text-[11px] text-gray-300 dark:text-gray-600 italic">No client</span>
          )}

          <span className="text-gray-200 dark:text-gray-700">·</span>

          {/* Assigned employee — inline dropdown */}
          {!revoked ? (
            <div ref={assignRef} className="relative">
              <button
                onClick={() => { setShowAssign(v => !v); setShowCategory(false); }}
                className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {portal.assigned_to_name ?? <span className="italic">Unassigned</span>}
                <svg className="w-2.5 h-2.5 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showAssign && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg py-1 min-w-[160px]">
                  <button
                    onClick={() => { onAssign(null); setShowAssign(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 italic"
                  >
                    Unassign
                  </button>
                  {users.map(u => (
                    <button
                      key={u.user_id}
                      onClick={() => { onAssign(u.user_id); setShowAssign(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        u.user_id === portal.assigned_to_id
                          ? "text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-gray-400">
              {portal.assigned_to_name ?? <span className="italic">Unassigned</span>}
            </span>
          )}

          <span className="text-gray-200 dark:text-gray-700">·</span>

          {/* Category badge — inline switcher */}
          {!revoked ? (
            <div ref={categoryRef} className="relative">
              <button
                onClick={() => { setShowCategory(v => !v); setShowAssign(false); }}
                className={`text-[10px] border px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[portal.category]}`}
              >
                {portal.category.charAt(0).toUpperCase() + portal.category.slice(1)}
              </button>
              {showCategory && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg py-1 min-w-[120px]">
                  {(["client", "investor", "partner"] as Tab[]).map(cat => (
                    <button
                      key={cat}
                      onClick={() => { onCategory(cat); setShowCategory(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 ${
                        cat === portal.category
                          ? "text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className={`text-[10px] border px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[portal.category]}`}>
              {portal.category.charAt(0).toUpperCase() + portal.category.slice(1)}
            </span>
          )}
        </div>

        {/* Row 3: meta */}
        <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap">
          <span>Created {timeAgo(portal.created_at)}</span>
          {portal.created_by_name && <span>by {portal.created_by_name}</span>}
          {portal.expires_at && (
            <span className={new Date(portal.expires_at) < new Date() ? "text-red-500" : ""}>
              expires {new Date(portal.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {!revoked && (
            <span className="font-mono text-[10px] text-gray-300 dark:text-gray-600 truncate max-w-[200px]">
              {portal.slug ? `/${portal.slug}` : portal.token.slice(0, 16) + "…"}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {!revoked && (
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <Link
            href={portal.is_standalone ? `/portals/room/${portal.portal_id}` : `/portals/${portal.project_id}`}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Manage
          </Link>
          {!portal.is_standalone && portal.project_id && (
            <Link
              href={`/projects/${portal.project_id}`}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Project ↗
            </Link>
          )}
          <a
            href={`/portal/${portal.slug ?? portal.token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Preview ↗
          </a>
          <button
            onClick={onCopy}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            onClick={onRevoke}
            disabled={revoking}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40"
          >
            {revoking ? "Revoking…" : "Revoke"}
          </button>
        </div>
      )}
    </div>
  );
}
