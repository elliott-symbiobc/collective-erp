"use client";

import { useEffect, useRef, useState } from "react";
import InventoryTabs from "@/components/InventoryTabs";

interface Consumable {
  consumable_id: string;
  name: string;
  catalog_number: string | null;
  manufacturer: string | null;
  supplier: string | null;
  category: string | null;
  stock_quantity: number;
  unit: string;
  reorder_level: number | null;
  location: string | null;
  expiry_date: string | null;
  price_per_unit: number | null;
  currency: string;
  url: string | null;
  notes: string | null;
  archived: boolean | null;
}

const CATEGORIES = ["Plasticware", "Media", "Reagent Kit", "Filter", "Glassware", "Buffer", "Stain", "Other"];

const STOCK_STATUS = (qty: number, reorder: number | null) => {
  if (qty === 0) return { label: "Out of stock", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" };
  if (reorder != null && qty <= reorder) return { label: "Low stock", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" };
  return { label: "In stock", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" };
};

function fmtDate(s: string | null) { return s ? s.slice(0, 10) : "—"; }
function fmtMoney(n: number | null, cur = "USD") { return n == null ? "—" : `${cur} ${n.toFixed(2)}`; }

// ── Add / Edit Modal ──────────────────────────────────────────────────────────

function ConsumableModal({ item, onSave, onClose }: {
  item: Partial<Consumable> | null;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!item?.consumable_id;
  const [form, setForm] = useState({
    name: item?.name ?? "",
    catalog_number: item?.catalog_number ?? "",
    manufacturer: item?.manufacturer ?? "",
    supplier: item?.supplier ?? "",
    category: item?.category ?? "",
    stock_quantity: String(item?.stock_quantity ?? 0),
    unit: item?.unit ?? "each",
    reorder_level: String(item?.reorder_level ?? ""),
    location: item?.location ?? "",
    expiry_date: item?.expiry_date ?? "",
    price_per_unit: String(item?.price_per_unit ?? ""),
    currency: item?.currency ?? "USD",
    url: item?.url ?? "",
    notes: item?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      payload.stock_quantity = parseFloat(form.stock_quantity) || 0;
      payload.reorder_level = form.reorder_level ? parseFloat(form.reorder_level) : null;
      payload.price_per_unit = form.price_per_unit ? parseFloat(form.price_per_unit) : null;
      for (const k of ["catalog_number","manufacturer","supplier","category","location","expiry_date","url","notes"]) {
        if (!payload[k]) payload[k] = null;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  }

  const LI = "block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1";
  const IN = "w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? "Edit Consumable" : "Add Consumable"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={LI}>Name *</label>
              <input required value={form.name} onChange={F("name")} className={IN} placeholder="e.g. 1.5 mL Eppendorf tubes" />
            </div>
            <div>
              <label className={LI}>Category</label>
              <select value={form.category} onChange={F("category")} className={IN}>
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={LI}>Location</label>
              <input value={form.location} onChange={F("location")} className={IN} placeholder="e.g. Shelf B3" />
            </div>
            <div>
              <label className={LI}>Catalog #</label>
              <input value={form.catalog_number} onChange={F("catalog_number")} className={IN} />
            </div>
            <div>
              <label className={LI}>Manufacturer</label>
              <input value={form.manufacturer} onChange={F("manufacturer")} className={IN} />
            </div>
            <div>
              <label className={LI}>Supplier</label>
              <input value={form.supplier} onChange={F("supplier")} className={IN} />
            </div>
            <div>
              <label className={LI}>Expiry Date</label>
              <input type="date" value={form.expiry_date} onChange={F("expiry_date")} className={IN} />
            </div>
            <div>
              <label className={LI}>Stock Quantity</label>
              <input type="number" min="0" step="0.01" value={form.stock_quantity} onChange={F("stock_quantity")} className={IN} />
            </div>
            <div>
              <label className={LI}>Unit</label>
              <input value={form.unit} onChange={F("unit")} className={IN} placeholder="each, box, mL…" />
            </div>
            <div>
              <label className={LI}>Reorder Level</label>
              <input type="number" min="0" step="0.01" value={form.reorder_level} onChange={F("reorder_level")} className={IN} placeholder="Alert when below this" />
            </div>
            <div>
              <label className={LI}>Price / Unit</label>
              <input type="number" min="0" step="0.01" value={form.price_per_unit} onChange={F("price_per_unit")} className={IN} />
            </div>
            <div>
              <label className={LI}>Currency</label>
              <input value={form.currency} onChange={F("currency")} className={IN} />
            </div>
            <div className="col-span-2">
              <label className={LI}>URL</label>
              <input type="url" value={form.url} onChange={F("url")} className={IN} placeholder="https://…" />
            </div>
            <div className="col-span-2">
              <label className={LI}>Notes</label>
              <textarea value={form.notes} onChange={F("notes")} rows={2} className={IN + " resize-none"} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving} className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 font-medium">
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add consumable"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConsumablesPage() {
  const [items, setItems] = useState<Consumable[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<Partial<Consumable> | null | false>(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [archiveTarget, setArchiveTarget] = useState<Consumable | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (showArchived) params.set("include_archived", "true");
    if (catFilter) params.set("category", catFilter);
    if (search) params.set("search", search);
    const res = await fetch(`/api/proxy/consumables?${params}`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, [search, catFilter, showArchived]); // eslint-disable-line

  async function save(data: Record<string, unknown>) {
    if (modal && (modal as Consumable).consumable_id) {
      await fetch(`/api/proxy/consumables/${(modal as Consumable).consumable_id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
    } else {
      await fetch("/api/proxy/consumables", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
    }
    setModal(false);
    load();
  }

  async function doArchive(id: string) {
    await fetch(`/api/proxy/consumables/${id}`, { method: "DELETE" });
    setArchiveTarget(null);
    load();
  }

  async function doRestore(id: string) {
    await fetch(`/api/proxy/consumables/${id}/restore`, { method: "PATCH" });
    load();
  }

  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="p-6 max-w-full">
      <InventoryTabs />
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search consumables…"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-56"
          />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="rounded" />
            Show archived
          </label>
        </div>
        <button
          onClick={() => setModal({})}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-1.5 font-medium"
        >
          <span className="text-lg leading-none">+</span> Add consumable
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-10 text-center">No consumables found. Add one to get started.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Stock</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Expiry</th>
                <th className="px-4 py-3 text-left">Price / Unit</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const st = STOCK_STATUS(item.stock_quantity, item.reorder_level);
                const open = expanded.has(item.consumable_id);
                const expiring = item.expiry_date && new Date(item.expiry_date) < new Date(Date.now() + 30 * 86400000);
                return (
                  <>
                    <tr key={item.consumable_id}
                      className={`border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${item.archived ? "opacity-50" : ""}`}
                      onClick={() => toggle(item.consumable_id)}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        {item.name}
                        {item.archived && <span className="ml-2 text-xs text-gray-400">(archived)</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.category ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-medium">
                        {item.stock_quantity} {item.unit}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.location ?? "—"}</td>
                      <td className={`px-4 py-3 text-xs ${expiring ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                        {fmtDate(item.expiry_date)}
                        {expiring && " ⚠"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{fmtMoney(item.price_per_unit, item.currency)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => setModal(item)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline px-1">Edit</button>
                          {item.archived
                            ? <button onClick={() => doRestore(item.consumable_id)} className="text-xs text-green-600 hover:underline px-1">Restore</button>
                            : <button onClick={() => setArchiveTarget(item)} className="text-xs text-red-500 hover:underline px-1">Archive</button>
                          }
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr key={item.consumable_id + "-detail"} className="bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid grid-cols-4 gap-4 text-xs text-gray-600 dark:text-gray-400">
                            <div><span className="font-medium text-gray-800 dark:text-gray-200">Catalog #</span><p>{item.catalog_number ?? "—"}</p></div>
                            <div><span className="font-medium text-gray-800 dark:text-gray-200">Manufacturer</span><p>{item.manufacturer ?? "—"}</p></div>
                            <div><span className="font-medium text-gray-800 dark:text-gray-200">Supplier</span><p>{item.supplier ?? "—"}</p></div>
                            <div><span className="font-medium text-gray-800 dark:text-gray-200">Reorder Level</span><p>{item.reorder_level != null ? `${item.reorder_level} ${item.unit}` : "—"}</p></div>
                          </div>
                          {item.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 italic">{item.notes}</p>}
                          {item.url && (
                            <a href={item.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block">
                              Product page ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal !== false && (
        <ConsumableModal item={modal || null} onSave={save} onClose={() => setModal(false)} />
      )}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Archive {archiveTarget.name}?</h3>
            <p className="text-sm text-gray-500 mb-4">It will be hidden from the active list and can be restored later.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setArchiveTarget(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
              <button onClick={() => doArchive(archiveTarget.consumable_id)} className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700">Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
