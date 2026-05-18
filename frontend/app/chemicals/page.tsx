"use client";

import { useEffect, useRef, useState } from "react";
import InventoryTabs from "@/components/InventoryTabs";

// ── Types ──────────────────────────────────────────────────────────────────

interface Chemical {
  chemical_id: string;
  item_name: string;
  cas_number: string | null;
  catalog_number: string | null;
  manufacturer: string | null;
  supplier: string | null;
  item_type: string | null;
  comments: string | null;
  grant_id: string | null;
  requested_by: string | null;
  quote_id: string | null;
  purchase_order_number: string | null;
  requisition_number: string | null;
  confirmation_number: string | null;
  tracking_number: string | null;
  invoice_number: string | null;
  status: string;
  pack_size: string | null;
  quantity: number;
  currency: string;
  price: number | null;
  tax: number | null;
  total: number | null;
  url: string | null;
  shipping: number | null;
  date_requested: string | null;
  date_approved: string | null;
  date_ordered: string | null;
  date_cancelled: string | null;
  date_received: string | null;
  approved_by: string | null;
  ordered_by: string | null;
  cancelled_by: string | null;
  received_by: string | null;
  approved_message: string | null;
  ordered_message: string | null;
  cancelled_message: string | null;
  received_message: string | null;
  archived: boolean | null;
  archived_at: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  received:  "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ordered:   "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  approved:  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  requested: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const TYPE_COLORS: Record<string, string> = {
  "Chemical":       "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  "General Supply": "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  "Protein":        "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  return s.slice(0, 10);
}

function fmtMoney(n: number | null, currency = "USD") {
  if (n == null) return "—";
  return `${currency} ${n.toFixed(2)}`;
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3 h-3 inline ml-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

// ── Archive confirmation ───────────────────────────────────────────────────

function ArchiveModal({ item, onConfirm, onCancel }: {
  item: Chemical;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Archive {item.item_name}?
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          This item will be hidden from the active list. It can be restored at any time.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
          <button onClick={onConfirm} className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700">Archive</button>
        </div>
      </div>
    </div>
  );
}

// ── Row actions menu ───────────────────────────────────────────────────────

function ActionsMenu({ item, onArchive, onRestore }: {
  item: Chemical;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
          {item.archived ? (
            <button
              onClick={() => { setOpen(false); onRestore(); }}
              className="w-full text-left px-3 py-1.5 text-sm text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => { setOpen(false); onArchive(); }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
            >
              Archive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Expandable row ─────────────────────────────────────────────────────────

function ChemicalRow({ item, onArchive, onRestore }: {
  item: Chemical;
  onArchive: (c: Chemical) => void;
  onRestore: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const statusColor = STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-600";
  const typeColor = TYPE_COLORS[item.item_type ?? ""] ?? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300";

  return (
    <>
      <tr
        className={`border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${item.archived ? "opacity-50" : ""}`}
        onClick={() => setOpen(o => !o)}
      >
        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 max-w-xs">
          <div className="truncate" title={item.item_name}>{item.item_name}</div>
          {item.archived && <span className="ml-2 text-xs text-gray-400">(archived)</span>}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{item.cas_number ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{item.catalog_number ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{item.supplier ?? "—"}</td>
        <td className="px-4 py-3">
          {item.item_type ? (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeColor}`}>
              {item.item_type}
            </span>
          ) : <span className="text-gray-400 text-xs">—</span>}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
            {item.status}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{item.pack_size ?? "—"}</td>
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 font-medium">
          {item.total != null ? fmtMoney(item.total, item.currency) : "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmtDate(item.date_requested)}</td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
            <ActionsMenu
              item={item}
              onArchive={() => onArchive(item)}
              onRestore={() => onRestore(item.chemical_id)}
            />
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50 dark:bg-gray-800/40">
          <td colSpan={10} className="px-6 py-4">
            <div className="grid grid-cols-4 gap-4 text-xs text-gray-600 dark:text-gray-400 mb-3">
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Manufacturer</span>
                <p>{item.manufacturer ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Grant</span>
                <p>{item.grant_id ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Requested by</span>
                <p>{item.requested_by ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Received by</span>
                <p>{item.received_by ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">PO Number</span>
                <p>{item.purchase_order_number ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Quote ID</span>
                <p>{item.quote_id ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Confirmation</span>
                <p>{item.confirmation_number ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Tracking</span>
                <p>{item.tracking_number ?? "—"}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Price</span>
                <p>{fmtMoney(item.price, item.currency)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Tax</span>
                <p>{fmtMoney(item.tax, item.currency)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Shipping</span>
                <p>{fmtMoney(item.shipping, item.currency)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-200">Total</span>
                <p className="font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(item.total, item.currency)}</p>
              </div>
            </div>

            {/* Timeline */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mb-3">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Timeline</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                {item.date_requested && <span><span className="text-gray-400">Requested</span> {fmtDate(item.date_requested)}</span>}
                {item.date_approved  && <span><span className="text-gray-400">Approved</span> {fmtDate(item.date_approved)}</span>}
                {item.date_ordered   && <span><span className="text-gray-400">Ordered</span> {fmtDate(item.date_ordered)}</span>}
                {item.date_received  && <span><span className="text-gray-400">Received</span> {fmtDate(item.date_received)}</span>}
                {item.date_cancelled && <span><span className="text-red-400">Cancelled</span> {fmtDate(item.date_cancelled)}</span>}
              </div>
            </div>

            {/* Comments & messages */}
            {(item.comments || item.received_message || item.cancelled_message) && (
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1">
                {item.comments && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Comments: </span>
                    {item.comments}
                  </p>
                )}
                {item.received_message && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">Receipt note: </span>
                    {item.received_message}
                  </p>
                )}
                {item.cancelled_message && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    <span className="font-medium">Cancelled: </span>
                    {item.cancelled_message}
                  </p>
                )}
              </div>
            )}

            {/* Link */}
            {item.url && (
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-950"
                >
                  View on supplier site <ExternalLinkIcon />
                </a>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Add chemical modal ─────────────────────────────────────────────────────

function AddChemicalModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({
    item_name: "", cas_number: "", catalog_number: "",
    manufacturer: "", supplier: "", item_type: "Chemical",
    comments: "", grant_id: "General Grant", requested_by: "",
    status: "requested", pack_size: "", quantity: "1",
    currency: "USD", price: "", tax: "", total: "", url: "", shipping: "",
    date_requested: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.item_name.trim()) {
      setError("Item name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        item_name: form.item_name,
        cas_number: form.cas_number || null,
        catalog_number: form.catalog_number || null,
        manufacturer: form.manufacturer || null,
        supplier: form.supplier || null,
        item_type: form.item_type || null,
        comments: form.comments || null,
        grant_id: form.grant_id || null,
        requested_by: form.requested_by || null,
        status: form.status,
        pack_size: form.pack_size || null,
        quantity: form.quantity ? Number(form.quantity) : 1,
        currency: form.currency,
        price: form.price ? Number(form.price) : null,
        tax: form.tax ? Number(form.tax) : null,
        total: form.total ? Number(form.total) : null,
        url: form.url || null,
        shipping: form.shipping ? Number(form.shipping) : null,
        date_requested: form.date_requested || null,
      };
      const resp = await fetch("/api/proxy/chemicals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${resp.status}`);
      }
      onAdded();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add Chemical / Supply Item</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="px-6 py-4 space-y-3 text-sm">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Item Name *</label>
              <input className={inputCls} value={form.item_name} onChange={e => set("item_name", e.target.value)} placeholder="e.g. Sodium Hydroxide" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CAS Number</label>
              <input className={inputCls} value={form.cas_number} onChange={e => set("cas_number", e.target.value)} placeholder="e.g. 1310-73-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Catalog #</label>
              <input className={inputCls} value={form.catalog_number} onChange={e => set("catalog_number", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Manufacturer</label>
              <input className={inputCls} value={form.manufacturer} onChange={e => set("manufacturer", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Supplier</label>
              <input className={inputCls} value={form.supplier} onChange={e => set("supplier", e.target.value)} placeholder="e.g. Sigma-Aldrich" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Item Type</label>
              <select className={inputCls} value={form.item_type} onChange={e => set("item_type", e.target.value)}>
                <option value="Chemical">Chemical</option>
                <option value="General Supply">General Supply</option>
                <option value="Protein">Protein</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
              <select className={inputCls} value={form.status} onChange={e => set("status", e.target.value)}>
                <option value="requested">Requested</option>
                <option value="approved">Approved</option>
                <option value="ordered">Ordered</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Pack Size</label>
              <input className={inputCls} value={form.pack_size} onChange={e => set("pack_size", e.target.value)} placeholder="e.g. 500 mL" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Quantity</label>
              <input type="number" min="1" className={inputCls} value={form.quantity} onChange={e => set("quantity", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Price</label>
              <input type="number" step="0.01" className={inputCls} value={form.price} onChange={e => set("price", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tax</label>
              <input type="number" step="0.01" className={inputCls} value={form.tax} onChange={e => set("tax", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Shipping</label>
              <input type="number" step="0.01" className={inputCls} value={form.shipping} onChange={e => set("shipping", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Total</label>
              <input type="number" step="0.01" className={inputCls} value={form.total} onChange={e => set("total", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Grant</label>
              <input className={inputCls} value={form.grant_id} onChange={e => set("grant_id", e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Requested By</label>
              <input className={inputCls} value={form.requested_by} onChange={e => set("requested_by", e.target.value)} placeholder="email" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date Requested</label>
              <input type="date" className={inputCls} value={form.date_requested} onChange={e => set("date_requested", e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL</label>
              <input className={inputCls} value={form.url} onChange={e => set("url", e.target.value)} placeholder="https://supplier.com/product" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Comments</label>
              <textarea rows={2} className={`${inputCls} resize-none`} value={form.comments} onChange={e => set("comments", e.target.value)} />
            </div>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ChemicalsPage() {
  const [items, setItems] = useState<Chemical[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Chemical | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = showArchived
        ? "/api/proxy/chemicals?include_archived=true"
        : "/api/proxy/chemicals";
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setItems(await resp.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [showArchived]); // eslint-disable-line

  async function archiveItem(item: Chemical) {
    await fetch(`/api/proxy/chemicals/${item.chemical_id}`, { method: "DELETE" });
    setArchiveTarget(null);
    load();
  }

  async function restoreItem(id: string) {
    await fetch(`/api/proxy/chemicals/${id}/restore`, { method: "PATCH" });
    load();
  }

  const visible = items.filter(c => {
    if (filterType !== "all" && c.item_type !== filterType) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.item_name.toLowerCase().includes(q) &&
        !(c.supplier ?? "").toLowerCase().includes(q) &&
        !(c.cas_number ?? "").toLowerCase().includes(q) &&
        !(c.catalog_number ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const types = Array.from(new Set(items.map(c => c.item_type).filter(Boolean))).sort() as string[];
  const statuses = Array.from(new Set(items.map(c => c.status))).sort();

  const totalSpend = visible.reduce((sum, c) => sum + (c.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <InventoryTabs />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Chemicals &amp; Lab Supplies</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Procurement tracker for chemicals, reagents, and consumables.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
        >
          + Add Item
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search name, CAS, catalog, supplier…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 w-64"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="all">All types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="all">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
          Show archived
        </label>
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>{visible.length} of {items.length} items</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">
            Total: USD {totalSpend.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400 py-8 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No items match your filters.</p>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Item</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">CAS</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Catalog #</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Supplier</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Pack Size</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Requested</th>
                <th className="px-4 py-2.5 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <ChemicalRow
                  key={c.chemical_id}
                  item={c}
                  onArchive={setArchiveTarget}
                  onRestore={restoreItem}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddChemicalModal onClose={() => setShowAdd(false)} onAdded={load} />
      )}

      {archiveTarget && (
        <ArchiveModal
          item={archiveTarget}
          onConfirm={() => archiveItem(archiveTarget)}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  );
}
