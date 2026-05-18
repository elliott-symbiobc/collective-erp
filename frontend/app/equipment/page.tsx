"use client";

import { useEffect, useState, useRef } from "react";
import InventoryTabs from "@/components/InventoryTabs";

interface Equipment {
  equipment_id: string;
  name: string;
  model: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  manufacturer: string | null;
  supplier: string | null;
  category: string | null;
  location: string | null;
  status: string;
  date_acquired: string | null;
  warranty_expiry: string | null;
  last_service_date: string | null;
  next_service_date: string | null;
  purchase_price: number | null;
  est_value: number | null;
  currency: string;
  condition: string | null;
  price_ref_url: string | null;
  notes: string | null;
  manual_url: string | null;
  archived: boolean | null;
}

interface StatusMeta { name: string; color: string; }

// Color palette for auto-assigning to categories and new statuses
const CAT_PALETTE = [
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
];

const STATUS_COLOR_MAP: Record<string,string> = {
  green:  "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  amber:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  red:    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  blue:   "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  gray:   "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
};
const STATUS_COLORS_LIST = ["green","amber","red","blue","purple","gray"];

function fmtDate(s: string | null) { return s ? s.slice(0,10) : "—"; }
function fmtMoney(n: number | null | undefined, cur = "USD") {
  if (n == null) return "—";
  return `${cur} ${Number(n).toFixed(2)}`;
}

const IN  = "w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400";
const LBL = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

// ── Free-text input with dropdown suggestions ─────────────────────────────────
function ComboInput({ value, onChange, options, listId, placeholder = "", className = "" }: {
  value: string; onChange: (v: string) => void; options: string[];
  listId: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder || "Type or select…"}
        autoComplete="off"
        className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
      />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}

// ── Styled select ─────────────────────────────────────────────────────────────
function Sel({ value, onChange, children, className = "" }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 pr-8 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 cursor-pointer"
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
        </svg>
      </div>
    </div>
  );
}

// ── Manage panel ──────────────────────────────────────────────────────────────
function ManagePanel({ onClose }: { onClose: () => void }) {
  const [cats, setCats]           = useState<string[]>([]);
  const [sts, setSts]             = useState<StatusMeta[]>([]);
  const [newCat, setNewCat]       = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newColor, setNewColor]   = useState("gray");

  async function reload() {
    const [cr, sr] = await Promise.all([
      fetch("/api/proxy/equipment/meta/categories"),
      fetch("/api/proxy/equipment/meta/statuses"),
    ]);
    if (cr.ok) setCats(await cr.json());
    if (sr.ok) setSts(await sr.json());
  }

  useEffect(() => { reload(); }, []); // eslint-disable-line

  async function addCat() {
    const name = newCat.trim();
    if (!name) return;
    const res = await fetch("/api/proxy/equipment/meta/categories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) { setNewCat(""); setCats(prev => [...prev, name].sort()); }
  }

  async function delCat(name: string) {
    const res = await fetch(`/api/proxy/equipment/meta/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) setCats(prev => prev.filter(c => c !== name));
  }

  async function addSt() {
    const name = newStatus.trim();
    if (!name) return;
    const res = await fetch("/api/proxy/equipment/meta/statuses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: newColor }),
    });
    if (res.ok) { setNewStatus(""); setSts(prev => [...prev, { name, color: newColor }]); }
  }

  async function delSt(name: string) {
    const res = await fetch(`/api/proxy/equipment/meta/statuses/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (res.ok) setSts(prev => prev.filter(s => s.name !== name));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Manage Categories & Statuses</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4 space-y-6 max-h-[70vh] overflow-y-auto">

          {/* Categories */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Categories</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {cats.map((c, i) => (
                <span key={c} className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium ${CAT_PALETTE[i % CAT_PALETTE.length]}`}>
                  {c}
                  <button onClick={() => delCat(c)} className="hover:opacity-70 ml-0.5 text-current">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newCat} onChange={e => setNewCat(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCat()}
                placeholder="New category name…"
                className={IN + " flex-1"}
              />
              <button onClick={addCat} disabled={!newCat.trim()}
                className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium whitespace-nowrap">
                Add
              </button>
            </div>
          </div>

          {/* Statuses */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Statuses</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {sts.map(s => (
                <span key={s.name} className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLOR_MAP[s.color] ?? STATUS_COLOR_MAP.gray}`}>
                  {s.name.replace(/_/g," ")}
                  <button onClick={() => delSt(s.name)} className="hover:opacity-70 ml-0.5 text-current">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newStatus} onChange={e => setNewStatus(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSt()}
                placeholder="New status name…"
                className={IN + " flex-1"}
              />
              <Sel value={newColor} onChange={setNewColor} className="w-28">
                {STATUS_COLORS_LIST.map(c => <option key={c} value={c}>{c}</option>)}
              </Sel>
              <button onClick={addSt} disabled={!newStatus.trim()}
                className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium whitespace-nowrap">
                Add
              </button>
            </div>
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 px-4 py-1.5">Done</button>
        </div>
      </div>
    </div>
  );
}

// ── Inline expanded edit panel ────────────────────────────────────────────────
function InlineEditPanel({ item, categories, statuses, onSave, onCancel }: {
  item: Equipment;
  categories: string[];
  statuses: StatusMeta[];
  onSave: (data: Partial<Equipment>) => Promise<void>;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Record<string,string>>({
    name:              item.name ?? "",
    model:             item.model ?? "",
    serial_number:     item.serial_number ?? "",
    asset_tag:         item.asset_tag ?? "",
    manufacturer:      item.manufacturer ?? "",
    supplier:          item.supplier ?? "",
    category:          item.category ?? "",
    location:          item.location ?? "",
    status:            item.status ?? "operational",
    date_acquired:     item.date_acquired?.slice(0,10) ?? "",
    warranty_expiry:   item.warranty_expiry?.slice(0,10) ?? "",
    last_service_date: item.last_service_date?.slice(0,10) ?? "",
    next_service_date: item.next_service_date?.slice(0,10) ?? "",
    purchase_price:    item.purchase_price != null ? String(item.purchase_price) : "",
    est_value:         item.est_value != null ? String(item.est_value) : "",
    currency:          item.currency ?? "USD",
    condition:         item.condition ?? "",
    price_ref_url:     item.price_ref_url ?? "",
    notes:             item.notes ?? "",
    manual_url:        item.manual_url ?? "",
  });
  const [saving, setSaving] = useState(false);
  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD(p => ({ ...p, [k]: e.target.value }));

  async function submit() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...d };
      payload.purchase_price = d.purchase_price ? parseFloat(d.purchase_price) : null;
      payload.est_value = d.est_value ? parseFloat(d.est_value) : null;
      for (const k of ["model","serial_number","asset_tag","manufacturer","supplier",
                       "category","location","date_acquired","warranty_expiry",
                       "last_service_date","next_service_date","condition",
                       "price_ref_url","notes","manual_url"])
        if (!payload[k]) payload[k] = null;
      await onSave(payload as Partial<Equipment>);
    } finally { setSaving(false); }
  }

  return (
    <tr className="bg-blue-50/40 dark:bg-blue-950/20 border-t border-blue-100 dark:border-blue-900/30">
      <td colSpan={9} className="px-6 py-5">
        <div className="grid grid-cols-4 gap-x-5 gap-y-3 text-sm">
          <div className="col-span-2">
            <label className={LBL}>Name</label>
            <input value={d.name} onChange={F("name")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Model</label>
            <input value={d.model} onChange={F("model")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Serial #</label>
            <input value={d.serial_number} onChange={F("serial_number")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Category</label>
            <ComboInput
              value={d.category} onChange={v => setD(p => ({ ...p, category: v }))}
              options={categories} listId="inline-cat-list" placeholder="Type or select…"
            />
          </div>
          <div>
            <label className={LBL}>Status</label>
            <ComboInput
              value={d.status} onChange={v => setD(p => ({ ...p, status: v }))}
              options={statuses.map(s => s.name)} listId="inline-status-list" placeholder="Type or select…"
            />
          </div>
          <div>
            <label className={LBL}>Location</label>
            <input value={d.location} onChange={F("location")} className={IN} placeholder="e.g. Lab 2, Bench A" />
          </div>
          <div>
            <label className={LBL}>Asset Tag</label>
            <input value={d.asset_tag} onChange={F("asset_tag")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Manufacturer</label>
            <input value={d.manufacturer} onChange={F("manufacturer")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Supplier</label>
            <input value={d.supplier} onChange={F("supplier")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Date Acquired</label>
            <input type="date" value={d.date_acquired} onChange={F("date_acquired")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Warranty Expiry</label>
            <input type="date" value={d.warranty_expiry} onChange={F("warranty_expiry")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Last Service</label>
            <input type="date" value={d.last_service_date} onChange={F("last_service_date")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Next Service</label>
            <input type="date" value={d.next_service_date} onChange={F("next_service_date")} className={IN} />
          </div>
          <div>
            <label className={LBL}>Purchase Price</label>
            <input type="number" min="0" step="0.01" value={d.purchase_price} onChange={F("purchase_price")} className={IN} placeholder="Actual price paid" />
          </div>
          <div>
            <label className={LBL}>Currency</label>
            <input value={d.currency} onChange={F("currency")} className={IN} />
          </div>
          <div className="col-span-4 border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Estimated Value</p>
            <div className="grid grid-cols-4 gap-x-5 gap-y-3">
              <div>
                <label className={LBL}>Est. Value</label>
                <input type="number" min="0" step="0.01" value={d.est_value} onChange={F("est_value")} className={IN} placeholder="Market estimate" />
              </div>
              <div>
                <label className={LBL}>Based on</label>
                <Sel value={d.condition} onChange={v => setD(p => ({ ...p, condition: v }))}>
                  <option value="">— Unknown —</option>
                  <option value="new">New price</option>
                  <option value="used">Used price</option>
                </Sel>
              </div>
              <div className="col-span-2">
                <label className={LBL}>Price Reference URL</label>
                <input type="url" value={d.price_ref_url} onChange={F("price_ref_url")} className={IN} placeholder="https://… source for estimate" />
              </div>
            </div>
          </div>
          <div className="col-span-2">
            <label className={LBL}>Manual URL</label>
            <input type="url" value={d.manual_url} onChange={F("manual_url")} className={IN} placeholder="https://…" />
          </div>
          <div className="col-span-2">
            <label className={LBL}>Notes</label>
            <textarea value={d.notes} onChange={F("notes")} rows={1} className={IN + " resize-none"} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={submit} disabled={saving}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-4 py-1.5 font-medium">
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Add modal ─────────────────────────────────────────────────────────────────
function AddModal({ categories, statuses, onSave, onClose }: {
  categories: string[];
  statuses: StatusMeta[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: "", model: "", serial_number: "", asset_tag: "", manufacturer: "",
    supplier: "", category: "", location: "", status: "operational",
    date_acquired: "", warranty_expiry: "", last_service_date: "", next_service_date: "",
    purchase_price: "", est_value: "", currency: "USD", condition: "",
    price_ref_url: "", notes: "", manual_url: "",
  });
  const [saving, setSaving] = useState(false);
  const F = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      payload.purchase_price = form.purchase_price ? parseFloat(form.purchase_price) : null;
      payload.est_value = form.est_value ? parseFloat(form.est_value) : null;
      for (const k of ["model","serial_number","asset_tag","manufacturer","supplier",
                       "category","location","date_acquired","warranty_expiry",
                       "last_service_date","next_service_date","condition",
                       "price_ref_url","notes","manual_url"])
        if (!payload[k]) payload[k] = null;
      await onSave(payload);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Add Equipment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={LBL}>Name *</label>
              <input required value={form.name} onChange={F("name")} className={IN} placeholder="e.g. Eppendorf 5424 Centrifuge" />
            </div>
            <div>
              <label className={LBL}>Category</label>
              <ComboInput
                value={form.category} onChange={v => setForm(p => ({ ...p, category: v }))}
                options={categories} listId="add-cat-list" placeholder="Type or select…"
              />
            </div>
            <div>
              <label className={LBL}>Status</label>
              <ComboInput
                value={form.status} onChange={v => setForm(p => ({ ...p, status: v }))}
                options={statuses.map(s => s.name)} listId="add-status-list" placeholder="Type or select…"
              />
            </div>
            <div>
              <label className={LBL}>Model</label>
              <input value={form.model} onChange={F("model")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Serial #</label>
              <input value={form.serial_number} onChange={F("serial_number")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Asset Tag</label>
              <input value={form.asset_tag} onChange={F("asset_tag")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Location</label>
              <input value={form.location} onChange={F("location")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Manufacturer</label>
              <input value={form.manufacturer} onChange={F("manufacturer")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Supplier</label>
              <input value={form.supplier} onChange={F("supplier")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Date Acquired</label>
              <input type="date" value={form.date_acquired} onChange={F("date_acquired")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Warranty Expiry</label>
              <input type="date" value={form.warranty_expiry} onChange={F("warranty_expiry")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Last Service</label>
              <input type="date" value={form.last_service_date} onChange={F("last_service_date")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Next Service</label>
              <input type="date" value={form.next_service_date} onChange={F("next_service_date")} className={IN} />
            </div>
            <div>
              <label className={LBL}>Purchase Price</label>
              <input type="number" min="0" step="0.01" value={form.purchase_price} onChange={F("purchase_price")} className={IN} placeholder="Actual price paid" />
            </div>
            <div>
              <label className={LBL}>Currency</label>
              <input value={form.currency} onChange={F("currency")} className={IN} />
            </div>
            <div className="col-span-2 border-t border-gray-100 dark:border-gray-800 pt-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Estimated Value</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LBL}>Est. Value</label>
                  <input type="number" min="0" step="0.01" value={form.est_value} onChange={F("est_value")} className={IN} placeholder="Market estimate" />
                </div>
                <div>
                  <label className={LBL}>Based on</label>
                  <Sel value={form.condition} onChange={v => setForm(p => ({ ...p, condition: v }))}>
                    <option value="">— Unknown —</option>
                    <option value="new">New price</option>
                    <option value="used">Used price</option>
                  </Sel>
                </div>
                <div className="col-span-2">
                  <label className={LBL}>Price Reference URL</label>
                  <input type="url" value={form.price_ref_url} onChange={F("price_ref_url")} className={IN} placeholder="https://… source for estimate" />
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <label className={LBL}>Manual URL</label>
              <input type="url" value={form.manual_url} onChange={F("manual_url")} className={IN} placeholder="https://…" />
            </div>
            <div className="col-span-2">
              <label className={LBL}>Notes</label>
              <textarea value={form.notes} onChange={F("notes")} rows={2} className={IN + " resize-none"} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button type="submit" disabled={saving}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-4 py-2 font-medium">
              {saving ? "Saving…" : "Add equipment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EquipmentPage() {
  const [items, setItems]           = useState<Equipment[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [statuses, setStatuses]     = useState<StatusMeta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [catFilter, setCatFilter]   = useState("");
  const [statusFilter, setStatus]   = useState("");
  const [showArchived, setShowArch] = useState(false);
  const [addOpen, setAddOpen]       = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [archiveTarget, setArchive] = useState<Equipment | null>(null);
  const [inlinePatch, setInlinePatch] = useState<{id: string; field: "category"|"status"} | null>(null);

  async function loadMeta() {
    const [catRes, stRes] = await Promise.all([
      fetch("/api/proxy/equipment/meta/categories"),
      fetch("/api/proxy/equipment/meta/statuses"),
    ]);
    if (catRes.ok) setCategories(await catRes.json());
    if (stRes.ok)  setStatuses(await stRes.json());
  }

  async function load() {
    const p = new URLSearchParams();
    if (showArchived) p.set("include_archived","true");
    if (catFilter)    p.set("category", catFilter);
    if (statusFilter) p.set("status", statusFilter);
    if (search)       p.set("search", search);
    const res = await fetch(`/api/proxy/equipment?${p}`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadMeta(); }, []);
  useEffect(() => { load(); }, [search, catFilter, statusFilter, showArchived]); // eslint-disable-line

  // Build maps from loaded data
  const catColorMap = Object.fromEntries(categories.map((c,i) => [c, CAT_PALETTE[i % CAT_PALETTE.length]]));
  const stColorMap  = Object.fromEntries(statuses.map(s => [s.name, STATUS_COLOR_MAP[s.color] ?? STATUS_COLOR_MAP.gray]));

  async function add(data: Record<string, unknown>) {
    await fetch("/api/proxy/equipment", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    setAddOpen(false);
    load();
  }

  async function patch(id: string, data: Partial<Equipment>) {
    await fetch(`/api/proxy/equipment/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    setExpanded(null);
    load();
  }

  async function patchField(id: string, field: "category"|"status", value: string) {
    setInlinePatch(null);
    const payload = { [field]: value || null };
    setItems(prev => prev.map(it => it.equipment_id === id ? { ...it, ...payload } as Equipment : it));
    await fetch(`/api/proxy/equipment/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
  }

  function downloadCsv() {
    const cols = ["Name","Manufacturer","Model","Category","Status","Location","Serial #",
      "Asset Tag","Supplier","Date Acquired","Warranty Expiry","Last Service","Next Service",
      "Purchase Price","Est. Value","Condition","Currency","Price Ref URL","Manual URL","Notes"];
    const esc = (v: unknown) => v == null ? "" : `"${String(v).replace(/"/g,'""')}"`;
    const rows = items.map(i => [
      i.name, i.manufacturer, i.model, i.category, i.status, i.location,
      i.serial_number, i.asset_tag, i.supplier,
      i.date_acquired?.slice(0,10), i.warranty_expiry?.slice(0,10),
      i.last_service_date?.slice(0,10), i.next_service_date?.slice(0,10),
      i.purchase_price, i.est_value, i.condition, i.currency,
      i.price_ref_url, i.manual_url, i.notes,
    ].map(esc).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `equipment-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  async function doArchive(id: string) {
    await fetch(`/api/proxy/equipment/${id}`, { method: "DELETE" });
    setArchive(null); setExpanded(null);
    load();
  }

  async function doRestore(id: string) {
    await fetch(`/api/proxy/equipment/${id}/restore`, { method: "PATCH" });
    load();
  }

  const today = new Date().toISOString().split("T")[0];
  const svcWarn = (d: string | null) =>
    d != null && d >= today && d <= new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  return (
    <div className="p-6 max-w-full">
      <InventoryTabs />
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search equipment…"
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-56"
          />
          <Sel value={catFilter} onChange={setCatFilter} className="w-40">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Sel>
          <Sel value={statusFilter} onChange={setStatus} className="w-36">
            <option value="">All statuses</option>
            {statuses.map(s => <option key={s.name} value={s.name}>{s.name.replace(/_/g," ")}</option>)}
          </Sel>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArch(e.target.checked)} className="rounded" />
            Show archived
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setManageOpen(true)}
            className="flex items-center gap-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-1.5"
            title="Manage categories & statuses"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            Manage
          </button>
          <button onClick={downloadCsv}
            className="flex items-center gap-1.5 text-sm border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg px-3 py-1.5"
            title="Download as CSV">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
            </svg>
            Export
          </button>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-1.5 font-medium">
            <span className="text-lg leading-none">+</span> Add equipment
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 py-10 text-center">No equipment found.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Manufacturer</th>
                <th className="px-4 py-3 text-left">Model</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-left">Next Service</th>
                <th className="px-4 py-3 text-left">Warranty</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            {/* datalists for inline editing */}
            <datalist id="row-cat-list">{categories.map(c => <option key={c} value={c}/>)}</datalist>
            <datalist id="row-status-list">{statuses.map(s => <option key={s.name} value={s.name}/>)}</datalist>
            <tbody>
              {items.map(item => {
                const stCls  = stColorMap[item.status] ?? STATUS_COLOR_MAP.gray;
                const catCls = item.category ? (catColorMap[item.category] ?? CAT_PALETTE[CAT_PALETTE.length-1]) : "";
                const warn   = svcWarn(item.next_service_date);
                const warnExp = item.warranty_expiry && item.warranty_expiry < today;
                const open   = expanded === item.equipment_id;
                const editingCat = inlinePatch?.id === item.equipment_id && inlinePatch.field === "category";
                const editingSt  = inlinePatch?.id === item.equipment_id && inlinePatch.field === "status";
                return (
                  <>
                    <tr
                      key={item.equipment_id}
                      onClick={() => { setInlinePatch(null); setExpanded(open ? null : item.equipment_id); }}
                      className={`border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${item.archived ? "opacity-50" : ""}`}
                    >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <svg className={`w-3 h-3 text-gray-400 transition-transform shrink-0 ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
                          </svg>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {item.name}
                            {item.archived && <span className="ml-1 text-xs text-gray-400">(archived)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.manufacturer ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.model ?? "—"}</td>
                      {/* Category — click to edit inline */}
                      <td className="px-4 py-2" onClick={e => { e.stopPropagation(); setExpanded(null); setInlinePatch({id: item.equipment_id, field: "category"}); }}>
                        {editingCat ? (
                          <select
                            autoFocus
                            defaultValue={item.category ?? ""}
                            onBlur={e => patchField(item.equipment_id, "category", e.target.value)}
                            onChange={e => patchField(item.equipment_id, "category", e.target.value)}
                            onKeyDown={e => { if (e.key === "Escape") setInlinePatch(null); }}
                            onClick={e => e.stopPropagation()}
                            className="text-xs border border-blue-400 dark:border-blue-500 rounded-lg px-2 py-1 w-36 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          >
                            <option value="">— None —</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : item.category ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-75 ${catCls}`}>
                            {item.category}
                            <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">+ add</span>
                        )}
                      </td>
                      {/* Status — click to edit inline */}
                      <td className="px-4 py-2" onClick={e => { e.stopPropagation(); setExpanded(null); setInlinePatch({id: item.equipment_id, field: "status"}); }}>
                        {editingSt ? (
                          <select
                            autoFocus
                            defaultValue={item.status}
                            onBlur={e => patchField(item.equipment_id, "status", e.target.value || "operational")}
                            onChange={e => patchField(item.equipment_id, "status", e.target.value || "operational")}
                            onKeyDown={e => { if (e.key === "Escape") setInlinePatch(null); }}
                            onClick={e => e.stopPropagation()}
                            className="text-xs border border-blue-400 dark:border-blue-500 rounded-lg px-2 py-1 w-36 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          >
                            {statuses.map(s => <option key={s.name} value={s.name}>{s.name.replace(/_/g," ")}</option>)}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-75 ${stCls}`}>
                            {item.status.replace(/_/g," ")}
                            <svg className="w-2.5 h-2.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.location ?? "—"}</td>
                      <td className={`px-4 py-3 text-xs ${warn ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                        {fmtDate(item.next_service_date)}{warn ? " ⚠" : ""}
                      </td>
                      <td className={`px-4 py-3 text-xs ${warnExp ? "text-red-500 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                        {fmtDate(item.warranty_expiry)}{warnExp ? " ✗" : ""}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {item.archived
                          ? <button onClick={() => doRestore(item.equipment_id)} className="text-xs text-green-600 hover:underline">Restore</button>
                          : <button onClick={() => setArchive(item)} className="text-xs text-red-500 hover:underline">Archive</button>}
                      </td>
                    </tr>
                    {open && (
                      <InlineEditPanel
                        key={item.equipment_id + "-edit"}
                        item={item}
                        categories={categories}
                        statuses={statuses}
                        onSave={data => patch(item.equipment_id, data)}
                        onCancel={() => setExpanded(null)}
                      />
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddModal categories={categories} statuses={statuses} onSave={add} onClose={() => setAddOpen(false)} />
      )}

      {manageOpen && (
        <ManagePanel onClose={() => { setManageOpen(false); loadMeta(); }} />
      )}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Archive {archiveTarget.name}?</h3>
            <p className="text-sm text-gray-500 mb-4">It will be hidden from the active list and can be restored later.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setArchive(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
              <button onClick={() => doArchive(archiveTarget.equipment_id)} className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700">Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
