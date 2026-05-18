"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface User {
  user_id: string;
  email: string;
  full_name: string | null;
  name: string | null;
  title: string | null;
  role: string;
  user_type: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string | null;
  permissions: Record<string, boolean>;            // raw overrides
  effective_permissions: Record<string, boolean>;  // merged with role defaults
}

// ── Permission definitions (must mirror auth.py PERMISSION_KEYS / ROLE_DEFAULTS) ──

interface PermissionDef {
  key: string;
  label: string;
  description: string;
  group: string;
  roleDefaults: { admin: boolean; scientist: boolean; viewer: boolean };
}

const PERMISSIONS: PermissionDef[] = [
  // ── Core ──
  { key: "analyses",      label: "Analyses & TEA",         description: "View and create BioSTEAM techno-economic analyses",    group: "Core",    roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "contacts",      label: "Contacts & CRM",         description: "Contacts, advisors, clients, relationship graph",      group: "Core",    roleDefaults: { admin: true,  scientist: true,  viewer: false } },
  { key: "projects",      label: "Projects",               description: "Project board and task management",                    group: "Core",    roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  // ── Lab ──
  { key: "literature",    label: "Literature library",     description: "Browse approved papers and literature",                group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "queue_upload",  label: "Upload to queue",        description: "Add papers to the literature review queue",           group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: false } },
  { key: "queue_approve", label: "Approve queue items",    description: "Review, edit, and approve extracted fermentation data", group: "Lab",    roleDefaults: { admin: true,  scientist: true,  viewer: false } },
  { key: "log_runs",      label: "Log fermentation runs",  description: "Record new fermentation experiment runs",             group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: false } },
  { key: "strains",       label: "Strains & annotation",   description: "View strains, trigger genome annotation and editing",  group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "enzymes",       label: "Enzyme database",        description: "View and manage the enzyme library",                  group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "protocols",     label: "Protocol bank",          description: "View and create standard operating procedures",       group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "notebook",      label: "Lab notebook",           description: "View and write ELN entries",                         group: "Lab",     roleDefaults: { admin: true,  scientist: true,  viewer: false } },
  // ── Science ──
  { key: "model",         label: "ML model",               description: "View model metrics, predictions, and SHAP values",   group: "Science", roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  { key: "model_retrain", label: "Retrain model / AI jobs","description": "Trigger ML retraining, compound scans, annotation jobs", group: "Science", roleDefaults: { admin: true, scientist: true, viewer: false } },
  { key: "compounds",     label: "Compound discovery",     description: "View compound opportunities and biosynthetic pathways", group: "Science", roleDefaults: { admin: true, scientist: true, viewer: true  } },
  { key: "explore",       label: "AI exploration",         description: "AI-powered substrate and strain exploration",         group: "Science", roleDefaults: { admin: true,  scientist: true,  viewer: true  } },
  // ── Finance ──
  { key: "view_fpa",      label: "View FP&A",              description: "Access financial dashboard, actuals, and cash tracking", group: "Finance", roleDefaults: { admin: true, scientist: false, viewer: false } },
  { key: "edit_fpa",      label: "Edit FP&A",              description: "Upload Excel model, connect Plaid and QuickBooks",   group: "Finance", roleDefaults: { admin: true,  scientist: false, viewer: false } },
  // ── Admin ──
  { key: "manage_users",  label: "Manage users",           description: "Access admin panel, create/edit/delete users",       group: "Admin",   roleDefaults: { admin: true,  scientist: false, viewer: false } },
  { key: "dev_mode",      label: "Developer mode",         description: "Enable dev panel and experimental debug features",   group: "Admin",   roleDefaults: { admin: true,  scientist: true,  viewer: false } },
];

const GROUPS = ["Core", "Lab", "Science", "Finance", "Admin"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin"     ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
    role === "scientist" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" :
                           "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${cls}`}>{role}</span>;
}

const USER_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  employee:   { label: "Employee",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  advisor:    { label: "Advisor",    cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  partner:    { label: "Partner",    cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  contractor: { label: "Contractor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  other:      { label: "Other",      cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};
function UserTypeBadge({ type }: { type: string }) {
  const m = USER_TYPE_LABELS[type] ?? USER_TYPE_LABELS.other;
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.cls}`}>{m.label}</span>;
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`}
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function PermissionIndicator({ value, isOverride }: { value: boolean; isOverride: boolean }) {
  if (value) {
    return <span className={`text-xs font-medium ${isOverride ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`}>{isOverride ? "✓ on" : "✓"}</span>;
  }
  return <span className={`text-xs ${isOverride ? "text-red-500 dark:text-red-400 font-medium" : "text-gray-300 dark:text-gray-600"}`}>{isOverride ? "✗ off" : "✗"}</span>;
}

// ── Edit modal ─────────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: user.full_name || user.name || "",
    title: user.title || "",
    role: user.role,
    user_type: user.user_type || "employee",
    is_active: user.is_active,
  });
  // Track per-key overrides: undefined = use role default, true/false = explicit override
  const [overrides, setOverrides] = useState<Record<string, boolean | undefined>>(() => {
    const init: Record<string, boolean | undefined> = {};
    for (const p of PERMISSIONS) {
      init[p.key] = user.permissions?.[p.key] !== undefined ? user.permissions[p.key] : undefined;
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"profile" | "permissions" | "password">("profile");
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [resettingPw, setResettingPw] = useState(false);

  // Compute effective permission for display
  function effectiveFor(key: string): boolean {
    if (overrides[key] !== undefined) return overrides[key]!;
    const p = PERMISSIONS.find(p => p.key === key);
    return p ? p.roleDefaults[form.role as keyof typeof p.roleDefaults] ?? false : false;
  }

  function toggleOverride(key: string) {
    const current = overrides[key];
    const roleDefault = PERMISSIONS.find(p => p.key === key)?.roleDefaults[form.role as "admin" | "scientist" | "viewer"] ?? false;
    if (current === undefined) {
      // No override → set to opposite of role default
      setOverrides(o => ({ ...o, [key]: !roleDefault }));
    } else if (current !== roleDefault) {
      // Override differs from role default → remove override (revert to role default)
      setOverrides(o => ({ ...o, [key]: undefined }));
    } else {
      // Override equals role default → set to opposite
      setOverrides(o => ({ ...o, [key]: !current }));
    }
  }

  // When role changes, recalculate which overrides are still meaningful
  function handleRoleChange(newRole: string) {
    setForm(f => ({ ...f, role: newRole }));
    // Keep overrides that differ from the new role's defaults
    setOverrides(prev => {
      const next: Record<string, boolean | undefined> = {};
      for (const p of PERMISSIONS) {
        const roleDefault = p.roleDefaults[newRole as keyof typeof p.roleDefaults] ?? false;
        if (prev[p.key] !== undefined && prev[p.key] !== roleDefault) {
          next[p.key] = prev[p.key];
        } else {
          next[p.key] = undefined;
        }
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    // Only send actual override values (not undefined)
    const permPayload: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) permPayload[k] = v;
    }
    await fetch(`/api/proxy/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, user_type: form.user_type, permissions: permPayload }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  async function resetPassword() {
    if (!newPassword || newPassword.length < 8) { setPwMsg("Min 8 characters."); return; }
    setResettingPw(true);
    const r = await fetch(`/api/proxy/users/${user.user_id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: newPassword }),
    });
    setPwMsg(r.ok ? "Password updated." : "Failed to update password.");
    setResettingPw(false);
    setNewPassword("");
  }

  const hasOverrides = Object.values(overrides).some(v => v !== undefined);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {user.full_name || user.name || user.email}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 px-5 shrink-0">
          {(["profile", "permissions", "password"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize ${
                tab === t
                  ? "border-blue-600 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {t}
              {t === "permissions" && hasOverrides && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                  {Object.values(overrides).filter(v => v !== undefined).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {tab === "profile" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Full name</label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Title</label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-2">Base role</label>
                <div className="flex gap-3">
                  {(["admin", "scientist", "viewer"] as const).map(r => (
                    <label key={r} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`role_${user.user_id}`}
                        value={r}
                        checked={form.role === r}
                        onChange={() => handleRoleChange(r)}
                        className="accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{r}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {form.role === "admin" ? "Full platform access by default." :
                   form.role === "scientist" ? "Lab features enabled, FP&A and user management disabled by default." :
                   "Read-only access to analyses. All write features disabled by default."}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">User Type</label>
                <select value={form.user_type} onChange={e => setForm(f => ({ ...f, user_type: e.target.value }))}
                  className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 focus:outline-none">
                  <option value="employee">Employee</option>
                  <option value="advisor">Advisor</option>
                  <option value="partner">Partner</option>
                  <option value="contractor">Contractor</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <Toggle checked={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {form.is_active ? "Active — can log in" : "Deactivated — cannot log in"}
                </span>
              </div>
            </div>
          )}

          {tab === "permissions" && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">
                Overrides apply on top of the base role. Blue = override active. Leaving a toggle at its role default removes the override.
              </p>
              {GROUPS.map(group => {
                const groupPerms = PERMISSIONS.filter(p => p.group === group);
                return (
                  <div key={group}>
                    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">{group}</p>
                    <div className="space-y-2">
                      {groupPerms.map(p => {
                        const eff = effectiveFor(p.key);
                        const roleDefault = p.roleDefaults[form.role as keyof typeof p.roleDefaults] ?? false;
                        const isOverride = overrides[p.key] !== undefined;
                        return (
                          <div key={p.key} className={`flex items-center justify-between py-2 px-3 rounded-lg ${isOverride ? "bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/40" : "bg-gray-50 dark:bg-gray-800/50"}`}>
                            <div className="flex-1 min-w-0 mr-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">{p.label}</span>
                                {isOverride && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold">OVERRIDE</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5 truncate">{p.description}</p>
                              {isOverride && (
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                  Role default: {roleDefault ? "enabled" : "disabled"}
                                  {" · "}
                                  <button
                                    onClick={() => setOverrides(o => ({ ...o, [p.key]: undefined }))}
                                    className="text-blue-500 hover:underline"
                                  >
                                    remove override
                                  </button>
                                </p>
                              )}
                            </div>
                            <Toggle
                              checked={eff}
                              onChange={() => toggleOverride(p.key)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "password" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Set a new password for this user. They will use it on next login.</p>
              <div>
                <label className="text-xs text-gray-500 block mb-1">New password</label>
                <input
                  type="password"
                  className="w-full px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                />
              </div>
              {pwMsg && (
                <p className={`text-xs ${pwMsg.includes("updated") ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{pwMsg}</p>
              )}
              <button
                onClick={resetPassword}
                disabled={resettingPw || !newPassword}
                className="px-4 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50 font-medium"
              >
                {resettingPw ? "Updating…" : "Update password"}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-4 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          {(tab === "profile" || tab === "permissions") && (
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 font-medium"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm modal ───────────────────────────────────────────────────────

function DeleteConfirm({ user, onClose, onDeleted }: { user: User; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    await fetch(`/api/proxy/users/${user.user_id}`, { method: "DELETE" });
    setDeleting(false);
    onDeleted();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete user?</h3>
        <p className="text-sm text-gray-500 mb-1">
          <span className="font-medium text-gray-700 dark:text-gray-300">{user.full_name || user.email}</span> will be permanently removed.
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-5">This cannot be undone. All their data associations remain but the account is deleted.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button onClick={confirm} disabled={deleting} className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── User row ───────────────────────────────────────────────────────────────────

function UserRow({ user, onEdit, onDelete }: { user: User; onEdit: () => void; onDelete: () => void }) {
  const overrideCount = Object.keys(user.permissions || {}).length;
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <td className="py-3 pr-3">
        <div className="font-medium text-gray-800 dark:text-gray-100 text-sm">{user.full_name || user.name || "—"}</div>
        <div className="text-xs text-gray-400 mt-0.5">{user.email}</div>
        {user.title && <div className="text-xs text-gray-400">{user.title}</div>}
      </td>
      <td className="py-3 pr-3">
        <div className="flex flex-wrap gap-1">
          <RoleBadge role={user.role} />
          <UserTypeBadge type={user.user_type || "employee"} />
        </div>
      </td>
      <td className="py-3 pr-3">
        {overrideCount > 0 ? (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-medium">
            {overrideCount} override{overrideCount > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs text-gray-300 dark:text-gray-600">Role defaults</span>
        )}
      </td>
      <td className="py-3 pr-3">
        <span className={`text-xs font-medium ${user.is_active ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-gray-500"}`}>
          {user.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="py-3 pr-3 text-xs text-gray-400">{fmt(user.last_login)}</td>
      <td className="py-3 text-right">
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onEdit} className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">Edit</button>
          <button onClick={onDelete} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [invite, setInvite] = useState({ email: "", full_name: "", title: "", role: "viewer", password: "" });
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviting, setInviting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/proxy/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleInvite() {
    setInviting(true);
    setInviteMsg("");
    const res = await fetch("/api/proxy/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
    if (res.ok) {
      setInviteMsg("User created successfully.");
      setInvite({ email: "", full_name: "", title: "", role: "viewer", password: "" });
      fetchUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      setInviteMsg(err.detail || "Failed to create user.");
    }
    setInviting(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
  );

  const activeUsers = users.filter(u => u.is_active);
  const inactiveUsers = users.filter(u => !u.is_active);

  return (
    <div className="max-w-5xl space-y-6">

      {/* Analytics link */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex items-center gap-4">
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Integrations
        </Link>
      </div>

      {/* Users table */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Users</h2>
            <p className="text-xs text-gray-400 mt-0.5">{activeUsers.length} active · {inactiveUsers.length} inactive</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-5 py-2.5 font-medium">User</th>
                <th className="text-left py-2.5 font-medium">Role</th>
                <th className="text-left py-2.5 font-medium">Permissions</th>
                <th className="text-left py-2.5 font-medium">Status</th>
                <th className="text-left py-2.5 font-medium">Last login</th>
                <th className="py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  onEdit={() => setEditUser(u)}
                  onDelete={() => setDeleteUser(u)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add user */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">Add user</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {(["email", "full_name", "title", "password"] as const).map(f => (
            <div key={f}>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                {f === "full_name" ? "Full name" : f === "password" ? "Temporary password" : f.charAt(0).toUpperCase() + f.slice(1)}
              </label>
              <input
                type={f === "password" ? "password" : "text"}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                value={invite[f]}
                onChange={e => setInvite(v => ({ ...v, [f]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="mb-4">
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-2">Base role</label>
          <div className="flex gap-4">
            {(["admin", "scientist", "viewer"] as const).map(r => (
              <label key={r} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="invite_role"
                  value={r}
                  checked={invite.role === r}
                  onChange={() => setInvite(v => ({ ...v, role: r }))}
                  className="accent-blue-600"
                />
                <span className="capitalize text-gray-700 dark:text-gray-300">{r}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Permission overrides can be set after creating the user.</p>
        </div>
        {inviteMsg && (
          <p className={`text-sm mb-3 ${inviteMsg.includes("successfully") ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {inviteMsg}
          </p>
        )}
        <button
          onClick={handleInvite}
          disabled={inviting || !invite.email || !invite.password}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {inviting ? "Creating…" : "Create user"}
        </button>
      </div>

      {/* Role permissions reference */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Role defaults</h2>
        <p className="text-xs text-gray-400 mb-4">Per-user overrides take precedence over these defaults.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left pb-2 font-medium">Permission</th>
                <th className="text-left pb-2 font-medium">Group</th>
                <th className="text-center pb-2 font-medium">Admin</th>
                <th className="text-center pb-2 font-medium">Scientist</th>
                <th className="text-center pb-2 font-medium">Viewer</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map(p => (
                <tr key={p.key} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 text-gray-700 dark:text-gray-300 pr-4">
                    <div className="font-medium">{p.label}</div>
                    <div className="text-gray-400">{p.description}</div>
                  </td>
                  <td className="py-1.5 pr-4 text-gray-400">{p.group}</td>
                  <td className="text-center py-1.5"><PermissionIndicator value={p.roleDefaults.admin} isOverride={false} /></td>
                  <td className="text-center py-1.5"><PermissionIndicator value={p.roleDefaults.scientist} isOverride={false} /></td>
                  <td className="text-center py-1.5"><PermissionIndicator value={p.roleDefaults.viewer} isOverride={false} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={fetchUsers}
        />
      )}

      {/* Delete confirm */}
      {deleteUser && (
        <DeleteConfirm
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDeleted={fetchUsers}
        />
      )}
    </div>
  );
}
