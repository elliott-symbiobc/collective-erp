interface SkeletonProps {
  className?: string;
}

/** Single shimmer block. Compose multiples to build a skeleton screen. */
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`skeleton ${className}`}
    />
  );
}

/** Pre-built skeleton for a standard table row (icon + two text columns). */
export function SkeletonRow() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <Skeleton className="h-4 w-4 rounded shrink-0" />
      <Skeleton className="h-4 flex-1 max-w-[40%]" />
      <Skeleton className="h-4 flex-1 max-w-[25%]" />
      <Skeleton className="h-4 flex-1 max-w-[15%]" />
    </div>
  );
}

/** Pre-built skeleton for a card (title + body lines). */
export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
}

/** Pre-built skeleton for a full table with configurable row count. */
export function SkeletonTable({ rows = 5 }: SkeletonTableProps) {
  return (
    <div role="status" aria-label="Loading…" className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        <Skeleton className="h-3 w-[15%]" />
        <Skeleton className="h-3 w-[25%]" />
        <Skeleton className="h-3 w-[20%]" />
        <Skeleton className="h-3 w-[12%]" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}