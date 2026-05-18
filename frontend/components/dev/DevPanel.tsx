"use client";

import React, { useEffect, useRef, useState } from "react";

interface TraceStep {
  label: string;
  elapsed_ms: number;
  data?: Record<string, unknown>;
}

interface TraceDetail {
  trace_id: string;
  pipeline: string;
  function_name: string | null;
  status: string;
  started_at: string;
  duration_ms: number | null;
  inputs: Record<string, unknown> | null;
  steps: TraceStep[];
  outputs: Record<string, unknown> | null;
  assumptions: Array<{ key: string; value: unknown; source: string; confidence: string; note?: string }> | null;
  citations: Array<{ key: string; text: string; doi: string | null }> | null;
  error_message: string | null;
}

interface ModuleDoc {
  module: string;
  display_name: string;
  functions: Array<{ name: string; signature: string; docstring: string; async: boolean }>;
  error?: string;
}

interface AssumptionsData {
  assumptions: Record<string, unknown>;
}

type Tab = "trace" | "assumptions" | "source";

interface DevPanelProps {
  traceId: string | null;
  entityId: string | null;
  open: boolean;
  onClose: () => void;
}

export default function DevPanel({ traceId, entityId, open, onClose }: DevPanelProps) {
  const [tab, setTab] = useState<Tab>("trace");
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [liveSteps, setLiveSteps] = useState<TraceStep[]>([]);
  const [liveStatus, setLiveStatus] = useState<string>("running");
  const [docs, setDocs] = useState<ModuleDoc[] | null>(null);
  const [assumptions, setAssumptions] = useState<AssumptionsData | null>(null);
  const [sourceModule, setSourceModule] = useState("app.agents.tea_agent");
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  // Load trace detail when traceId changes
  useEffect(() => {
    if (!traceId) return;
    setLiveSteps([]);
    setLiveStatus("running");
    setTrace(null);

    fetch(`/api/proxy/dev/traces/detail/${traceId}`)
      .then((r) => r.json())
      .then((data: TraceDetail) => {
        setTrace(data);
        setLiveSteps(data.steps || []);
        setLiveStatus(data.status);
      })
      .catch(() => {});

    // Start SSE stream if trace is running
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/api/proxy/dev/traces/stream/${traceId}`);
    esRef.current = es;

    es.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "step") {
          setLiveSteps((prev) => [...prev, msg.step]);
        } else if (msg.type === "done") {
          setLiveStatus(msg.status);
          es.close();
          // Refresh full trace
          fetch(`/api/proxy/dev/traces/detail/${traceId}`)
            .then((r) => r.json())
            .then((data: TraceDetail) => setTrace(data))
            .catch(() => {});
        }
      } catch {}
    };

    return () => {
      es.close();
    };
  }, [traceId]);

  // Auto-scroll steps
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveSteps]);

  // Load docs/assumptions on tab switch
  useEffect(() => {
    if (tab === "assumptions" && !assumptions) {
      setLoading(true);
      Promise.all([
        fetch("/api/proxy/dev/docs").then((r) => r.json()),
        fetch("/api/proxy/dev/assumptions").then((r) => r.json()),
      ])
        .then(([docsData, assumData]) => {
          setDocs(docsData.modules);
          setAssumptions(assumData);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [tab, assumptions]);

  // Load source
  function loadSource() {
    setSourceText(null);
    fetch(`/api/proxy/dev/source/${sourceModule}`)
      .then((r) => r.json())
      .then((d) => setSourceText(d.source || d.error || "No source"))
      .catch(() => setSourceText("Failed to load source"));
  }

  if (!open) return null;

  const statusColor =
    liveStatus === "success"
      ? "text-green-600"
      : liveStatus === "error"
      ? "text-red-600"
      : "text-amber-500";

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] z-50 flex flex-col bg-gray-950 border-l border-gray-700 shadow-2xl text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold text-amber-400">DEV MODE</span>
          {traceId && (
            <span className="text-xs font-mono text-gray-400 truncate max-w-[200px]">
              {traceId.slice(0, 8)}…
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-lg leading-none px-1"
          aria-label="Close dev panel"
        >
          ×
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-900">
        {(["trace", "assumptions", "source"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize ${
              tab === t
                ? "text-amber-400 border-b-2 border-amber-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t === "trace" ? "Live Trace" : t === "assumptions" ? "Assumptions" : "Source"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Live Trace ── */}
        {tab === "trace" && (
          <div className="p-4 space-y-3">
            {trace && (
              <div className="text-xs font-mono space-y-1">
                <div>
                  <span className="text-gray-400">pipeline: </span>
                  <span className="text-blue-400">{trace.pipeline}</span>
                </div>
                {trace.function_name && (
                  <div>
                    <span className="text-gray-400">fn: </span>
                    <span className="text-purple-400">{trace.function_name}</span>
                  </div>
                )}
                <div>
                  <span className="text-gray-400">status: </span>
                  <span className={statusColor}>{liveStatus}</span>
                </div>
                {trace.duration_ms != null && (
                  <div>
                    <span className="text-gray-400">duration: </span>
                    <span>{trace.duration_ms}ms</span>
                  </div>
                )}
              </div>
            )}

            {!traceId && (
              <p className="text-xs text-gray-500 italic">
                Trigger a pipeline run (TEA, Discovery, Regulatory) to see live execution steps here.
              </p>
            )}

            {/* Steps */}
            <div className="space-y-1.5">
              {liveSteps.map((step, i) => (
                <div
                  key={i}
                  className="font-mono text-xs bg-gray-900 rounded px-3 py-2 border border-gray-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={
                        step.label.startsWith("WARNING")
                          ? "text-amber-400"
                          : "text-green-400"
                      }
                    >
                      {step.label}
                    </span>
                    <span className="text-gray-500 shrink-0">{step.elapsed_ms}ms</span>
                  </div>
                  {step.data && Object.keys(step.data).length > 0 && (
                    <pre className="mt-1 text-gray-400 text-[10px] overflow-x-auto">
                      {JSON.stringify(step.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
              <div ref={stepsEndRef} />
            </div>

            {/* Outputs */}
            {trace?.outputs && (
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-1">Outputs</p>
                <pre className="text-[10px] font-mono bg-gray-900 rounded p-2 border border-gray-700 overflow-x-auto">
                  {JSON.stringify(trace.outputs, null, 2)}
                </pre>
              </div>
            )}

            {/* Error */}
            {trace?.error_message && (
              <div className="rounded border border-red-700 bg-red-950 px-3 py-2">
                <p className="text-xs font-semibold text-red-400 mb-1">Error</p>
                <pre className="text-[10px] font-mono text-red-300 whitespace-pre-wrap">
                  {trace.error_message}
                </pre>
              </div>
            )}

            {/* Assumptions from trace */}
            {trace?.assumptions && trace.assumptions.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-1">Run-time Assumptions</p>
                <div className="space-y-1">
                  {trace.assumptions.map((a, i) => (
                    <div key={i} className="font-mono text-[10px] bg-gray-900 rounded px-2 py-1 border border-gray-700">
                      <span className="text-yellow-400">{a.key}</span>
                      <span className="text-gray-400"> = </span>
                      <span className="text-green-400">{String(a.value)}</span>
                      {a.note && <span className="text-gray-500"> — {a.note}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Citations from trace */}
            {trace?.citations && trace.citations.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-1">Citations</p>
                <div className="space-y-1">
                  {trace.citations.map((c, i) => (
                    <div key={i} className="font-mono text-[10px] bg-gray-900 rounded px-2 py-1 border border-gray-700">
                      <span className="text-blue-400">[{c.key}]</span>{" "}
                      <span className="text-gray-300">{c.text}</span>
                      {c.doi && <div className="text-gray-500">doi:{c.doi}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Assumptions ── */}
        {tab === "assumptions" && (
          <div className="p-4 space-y-4">
            {loading && <p className="text-xs text-gray-400">Loading…</p>}

            {assumptions && (
              <div className="space-y-3">
                {Object.entries(assumptions.assumptions).map(([key, val]) => (
                  <div key={key}>
                    <p className="text-[10px] font-mono text-amber-400 mb-1">{key}</p>
                    <pre className="text-[10px] font-mono bg-gray-900 rounded p-2 border border-gray-700 overflow-x-auto max-h-64">
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {docs && (
              <div className="space-y-3 pt-2 border-t border-gray-700">
                <p className="text-xs font-semibold text-gray-300">Module Functions</p>
                {docs.map((mod) => (
                  <div key={mod.module}>
                    <p className="text-[10px] font-mono text-blue-400 mb-1">{mod.display_name}</p>
                    {mod.error ? (
                      <p className="text-[10px] text-red-400">{mod.error}</p>
                    ) : (
                      <div className="space-y-1">
                        {mod.functions.map((fn) => (
                          <div
                            key={fn.name}
                            className="font-mono text-[10px] bg-gray-900 rounded px-2 py-1.5 border border-gray-700"
                          >
                            <div>
                              {fn.async && <span className="text-purple-400">async </span>}
                              <span className="text-green-400">{fn.name}</span>
                              <span className="text-gray-400">{fn.signature}</span>
                            </div>
                            {fn.docstring && (
                              <div className="text-gray-500 mt-0.5 whitespace-pre-wrap">
                                {fn.docstring.slice(0, 120)}
                                {fn.docstring.length > 120 ? "…" : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Source ── */}
        {tab === "source" && (
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={sourceModule}
                onChange={(e) => setSourceModule(e.target.value)}
                className="flex-1 text-xs font-mono bg-gray-900 border border-gray-600 rounded px-2 py-1 text-gray-200 focus:outline-none focus:border-amber-500"
                placeholder="app.agents.tea_agent"
              />
              <button
                onClick={loadSource}
                className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded text-white font-medium"
              >
                Load
              </button>
            </div>
            {sourceText && (
              <pre className="text-[10px] font-mono bg-gray-900 rounded p-3 border border-gray-700 overflow-x-auto whitespace-pre-wrap max-h-[calc(100vh-200px)]">
                {sourceText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
