type Status = "GO" | "HOLD" | "REDIRECT";

interface StatusBadgeProps {
  status: Status | string;
}

const STATUS_STYLES: Record<Status, string> = {
  GO: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  REDIRECT: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status?.toUpperCase() as Status;
  const className = STATUS_STYLES[normalized] ?? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${className}`}
    >
      {normalized}
    </span>
  );
}
