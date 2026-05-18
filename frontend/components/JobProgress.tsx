"use client";

import { useEffect, useRef, useState } from "react";

export type JobType = "annotation" | "tea" | "discovery" | "regulatory";

interface JobProgressProps {
  jobType: JobType;
  entityId: string;
  label?: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
  compact?: boolean;
}

// Step definitions for each job type
const ANNOTATION_STEPS = [
  { key: "queued",    label: "Job queued",                   est_s: 5 },
  { key: "running",   label: "Genome download (NCBI datasets)", est_s: 600 },
  { key: "dbcan",     label: "dbCAN2 CAZyme annotation",     est_s: 1200 },
  { key: "merops",    label: "MEROPS protease BLAST",        est_s: 300 },
  { key: "parse",     label: "Writing results to database",  est_s: 60 },
  { key: "complete",  label: "Annotation complete",          est_s: 0 },
];

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function useElapsed() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return elapsed;
}

function AnnotationProgress({
  entityId,
  onComplete,
  onError,
  compact,
}: {
  entityId: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<string>("queued");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cazymeSummary, setCazymeSummary] = useState<Record<string, number> | null>(null);
  const elapsed = useElapsed();
  const completedRef = useRef(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/proxy/strains/${entityId}/annotation-status`);
        if (!r.ok) return;
        const data = await r.json();
        const s = data.annotation_status ?? "queued";
        setStatus(s);
        if (data.annotation_error) setErrorMsg(data.annotation_error);
        if (data.cazyme_summary) setCazymeSummary(data.cazyme_summary);

        if (s === "complete" && !completedRef.current) {
          completedRef.current = true;
          onComplete?.();
        } else if (s === "error" && !completedRef.current) {
          completedRef.current = true;
          onError?.(data.annotation_error ?? "Annotation failed");
        }
      } catch {}
    };

    poll();
    const timer = setInterval(poll, 8000);
    return () => clearInterval(timer);
  }, [entityId, onComplete, onError]);

  const isDone = status === "complete" || status === "error";

  // Determine current step index
  const stepIndex =
    status === "complete" ? ANNOTATION_STEPS.length - 1
    : status === "error" ? 1
    : status === "running" ? 2
    : 1; // queued

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5">
        {status === "complete" ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-100 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            Annotated
            {cazymeSummary?.total != null && ` · ${cazymeSummary.total} CAZymes`}
          </span>
        ) : status === "error" ? (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5" title={errorMsg ?? undefined}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
            Error
          </span>
        ) : status === "running" ? (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
            Annotating… {formatDuration(elapsed)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            Queued
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          {status === "complete" ? "Annotation complete" : status === "error" ? "Annotation failed" : "Running annotation…"}
        </span>
        {!isDone && (
          <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{formatDuration(elapsed)}</span>
        )}
      </div>

      {/* Progress bar */}
      {!isDone && (
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-amber-400 h-1.5 rounded-full transition-all duration-1000"
            style={{ width: `${Math.min(95, (elapsed / 30) * 100)}%` }}
          />
        </div>
      )}

      {/* Steps */}
      <div className="space-y-1">
        {ANNOTATION_STEPS.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex && !isDone;
          const pending = i > stepIndex && !isDone;
          return (
            <div key={step.key} className="flex items-center gap-2 text-xs">
              {done ? (
                <span className="w-4 h-4 flex items-center justify-center text-green-500">✓</span>
              ) : active ? (
                <span className="w-4 h-4 flex items-center justify-center">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                </span>
              ) : (
                <span className="w-4 h-4 flex items-center justify-center text-gray-300">○</span>
              )}
              <span className={done ? "text-green-700" : active ? "text-amber-700 font-medium" : "text-gray-400"}>
                {step.label}
              </span>
              {active && step.est_s > 0 && (
                <span className="text-gray-400 ml-auto">~{formatDuration(step.est_s)}</span>
              )}
            </div>
          );
        })}
      </div>

      {status === "error" && errorMsg && (
        <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {status === "complete" && cazymeSummary && (
        <div className="rounded border border-green-100 bg-green-50 px-2 py-1.5 text-xs text-green-700">
          Found: GH13={cazymeSummary.gh13_count ?? 0} · AA9={cazymeSummary.aa9_count ?? 0} · CE1={cazymeSummary.ce1_count ?? 0} · Total={cazymeSummary.total ?? 0} CAZymes
        </div>
      )}
    </div>
  );
}

export default function JobProgress({
  jobType,
  entityId,
  label,
  onComplete,
  onError,
  compact = false,
}: JobProgressProps) {
  if (jobType === "annotation") {
    return (
      <AnnotationProgress
        entityId={entityId}
        onComplete={onComplete}
        onError={onError}
        compact={compact}
      />
    );
  }

  // Generic progress for other job types
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-xs text-gray-600 dark:text-gray-400">{label ?? `Running ${jobType}…`}</span>
      </div>
    </div>
  );
}
