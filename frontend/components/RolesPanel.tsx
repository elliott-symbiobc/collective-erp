"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const MODULE_PATHS: Record<string, string> = {
  dashboard: "/dashboard", tasks: "/tasks", calendar: "/calendar", reports: "/reports",
  notebook: "/notebook", crm: "/crm", projects: "/projects", portals: "/portals",
  contacts: "/contacts", fpa: "/fpa", funding: "/funding", receivables: "/invoices",
  payables: "/payables", analyses: "/analyses", model: "/model", literature: "/kb",
  "system-design": "/system-design", runs: "/runs", protocols: "/protocols",
  strains: "/strains", enzymes: "/enzymes", chemicals: "/chemicals",
  consumables: "/consumables", equipment: "/equipment", inventory: "/inventory",
  marketing: "/marketing",
};

interface MyModule {
  module_key: string;
  module_label: string;
}

export default function RolesPanel() {
  const [open, setOpen] = useState(false);
  const [modules, setModules] = useState<MyModule[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/proxy/module-owners/my")
      .then(r => r.ok ? r.json() : [])
      .then(setModules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="My Roles"
        title="My Roles"
        className={`flex items-center justify-center p-2 rounded-md transition-colors ${open ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400" : "text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100"}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">My Roles</h2>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-3 max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm">Loading…</span>
              </div>
            ) : modules.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
                <p className="text-sm text-gray-400 dark:text-gray-500">No modules assigned to you yet</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">An admin can assign ownership from any module&apos;s header</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {modules.map(m => (
                  <Link
                    key={m.module_key}
                    href={MODULE_PATHS[m.module_key] ?? "/tasks"}
                    onClick={() => setOpen(false)}
                    className="group flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 rounded-lg px-3 py-2.5 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all"
                  >
                    <div className="w-7 h-7 rounded-md bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center shrink-0">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.module_label}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">Module owner</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-indigo-400 transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
