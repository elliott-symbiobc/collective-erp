"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BrandFile {
  id: string;
  category: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

type GroupedAssets = Record<string, BrandFile[]>;

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES: { key: string; label: string }[] = [
  { key: "logo",             label: "Logo"             },
  { key: "letter_mark",      label: "Letter Mark"      },
  { key: "brand_guidelines", label: "Brand Guidelines" },
  { key: "tagline",          label: "Tagline"          },
  { key: "icons",            label: "Icons"            },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mime: string, name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png","jpg","jpeg","gif","svg","webp"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (["ppt","pptx"].includes(ext) || mime.includes("presentation")) return "ppt";
  if (["doc","docx"].includes(ext) || mime.includes("word")) return "doc";
  if (["zip","ai","eps","sketch","fig","xd"].includes(ext)) return "archive";
  return "file";
}

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
  const type = fileIcon(mime, name);
  const configs: Record<string, { color: string; label: string }> = {
    image:   { color: "text-violet-500", label: "IMG" },
    pdf:     { color: "text-red-500",    label: "PDF" },
    ppt:     { color: "text-orange-500", label: "PPT" },
    doc:     { color: "text-blue-500",   label: "DOC" },
    archive: { color: "text-amber-500",  label: "ZIP" },
    file:    { color: "text-gray-400",   label: "FILE"},
  };
  const { color, label } = configs[type] ?? configs.file;
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-gray-100 dark:bg-gray-800 shrink-0`}>
      <span className={`text-[10px] font-bold ${color}`}>{label}</span>
    </div>
  );
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`/api/proxy${path}`, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail));
  }
  return r.json();
}

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  label,
  files,
  onUploaded,
  onDeleted,
}: {
  category: string;
  label: string;
  files: BrandFile[];
  onUploaded: () => void;
  onDeleted: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.append("category", category);
        form.append("file", file);
        const r = await fetch("/api/proxy/marketing/brand-assets/upload", {
          method: "POST",
          body: form,
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({ detail: r.statusText }));
          throw new Error(typeof err.detail === "string" ? err.detail : "Upload failed");
        }
      }
      onUploaded();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await apiFetch(`/marketing/brand-assets/${id}`, { method: "DELETE" });
      onDeleted(id);
    } catch { /* ignore */ }
    finally { setDeleting(null); setDeleteConfirm(null); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-wide uppercase">
          {label}
        </h3>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-colors"
        >
          {uploading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* Drop zone + file list */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        className="min-h-[120px]"
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-xs text-gray-400 dark:text-gray-500">Drop files here or click Upload</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {files.map(f => (
              <li key={f.id} className="group flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                <FileTypeIcon mime={f.mime_type} name={f.original_name} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-gray-100 truncate font-medium">
                    {f.original_name}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {fmtSize(f.file_size)}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Download */}
                  <a
                    href={`/api/proxy/marketing/brand-assets/${f.id}/download`}
                    download={f.original_name}
                    className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                    title="Download"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>

                  {/* Delete */}
                  {deleteConfirm === f.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(f.id)}
                        disabled={deleting === f.id}
                        className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {deleting === f.id ? "…" : "Delete"}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(f.id)}
                      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {uploadError && (
          <p className="px-5 pb-3 text-xs text-red-500">{uploadError}</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const [assets, setAssets] = useState<GroupedAssets>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/marketing/brand-assets");
      setAssets(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleUploaded() { load(); }

  function handleDeleted(id: string) {
    setAssets(prev => {
      const next = { ...prev };
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].filter(f => f.id !== id);
      }
      return next;
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 pb-16">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Assets</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Upload and download brand assets. Drag and drop supported.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {CATEGORIES.map(({ key, label }) => (
          <CategoryCard
            key={key}
            category={key}
            label={label}
            files={assets[key] ?? []}
            onUploaded={handleUploaded}
            onDeleted={handleDeleted}
          />
        ))}
      </div>
    </div>
  );
}
