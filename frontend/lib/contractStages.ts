export interface StageGroup {
  parent: string;
  stages: string[];
  autoCollapse?: boolean;
  color: {
    header: string;
    badge: string;
    card: string;
    dot: string;
    bg: string;
  };
}

export const RD_STAGE_GROUPS: StageGroup[] = [
  {
    parent: "Prospect",
    stages: ["Prospect"],
    color: {
      header: "text-blue-600 dark:text-blue-300",
      badge: "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700/60",
      card: "border-blue-200 dark:border-blue-800/40",
      dot: "bg-blue-500",
      bg: "bg-blue-50 dark:bg-blue-900/10",
    },
  },
  {
    parent: "Qualification",
    stages: ["Qualification"],
    color: {
      header: "text-purple-600 dark:text-purple-300",
      badge: "bg-purple-100 text-purple-700 border border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700/60",
      card: "border-purple-200 dark:border-purple-800/40",
      dot: "bg-purple-500",
      bg: "bg-purple-50 dark:bg-purple-900/10",
    },
  },
  {
    parent: "Initial Assessment",
    stages: ["Prelim. Report & TEA", "Initial Sample Analysis & POC Proposal"],
    color: {
      header: "text-amber-600 dark:text-amber-300",
      badge: "bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700/60",
      card: "border-amber-200 dark:border-amber-800/40",
      dot: "bg-amber-500",
      bg: "bg-amber-50 dark:bg-amber-900/10",
    },
  },
  {
    parent: "Lab-Scale POC",
    stages: ["Lab-Scale POC"],
    color: {
      header: "text-orange-600 dark:text-orange-300",
      badge: "bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700/60",
      card: "border-orange-200 dark:border-orange-800/40",
      dot: "bg-orange-500",
      bg: "bg-orange-50 dark:bg-orange-900/10",
    },
  },
  {
    parent: "Pilot System",
    stages: ["Pilot System"],
    color: {
      header: "text-rose-600 dark:text-rose-300",
      badge: "bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-300 dark:border-rose-700/60",
      card: "border-rose-200 dark:border-rose-800/40",
      dot: "bg-rose-500",
      bg: "bg-rose-50 dark:bg-rose-900/10",
    },
  },
  {
    parent: "Commercial Deployment",
    stages: ["Commercial Deployment"],
    color: {
      header: "text-teal-600 dark:text-teal-300",
      badge: "bg-teal-100 text-teal-700 border border-teal-300 dark:bg-teal-900/50 dark:text-teal-300 dark:border-teal-700/60",
      card: "border-teal-200 dark:border-teal-800/40",
      dot: "bg-teal-500",
      bg: "bg-teal-50 dark:bg-teal-900/10",
    },
  },
  {
    parent: "Active",
    stages: ["Active"],
    color: {
      header: "text-green-600 dark:text-green-300",
      badge: "bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700/60",
      card: "border-green-200 dark:border-green-800/40",
      dot: "bg-green-500",
      bg: "bg-green-50 dark:bg-green-900/10",
    },
  },
  {
    parent: "Inactive",
    stages: ["Inactive"],
    autoCollapse: true,
    color: {
      header: "text-gray-500 dark:text-gray-400",
      badge: "bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700/60",
      card: "border-gray-200 dark:border-gray-700/40",
      dot: "bg-gray-400",
      bg: "bg-gray-50 dark:bg-gray-900/10",
    },
  },
];

export const PORTFOLIO_STAGE_GROUPS: StageGroup[] = [
  {
    parent: "Prospect",
    stages: ["Prospect"],
    color: {
      header: "text-blue-600 dark:text-blue-300",
      badge: "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700/60",
      card: "border-blue-200 dark:border-blue-800/40",
      dot: "bg-blue-500",
      bg: "bg-blue-50 dark:bg-blue-900/10",
    },
  },
  {
    parent: "Qualification",
    stages: ["Qualification"],
    color: {
      header: "text-purple-600 dark:text-purple-300",
      badge: "bg-purple-100 text-purple-700 border border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700/60",
      card: "border-purple-200 dark:border-purple-800/40",
      dot: "bg-purple-500",
      bg: "bg-purple-50 dark:bg-purple-900/10",
    },
  },
  {
    parent: "Prelim. TEA and Quote",
    stages: ["Prelim. TEA and Quote"],
    color: {
      header: "text-amber-600 dark:text-amber-300",
      badge: "bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700/60",
      card: "border-amber-200 dark:border-amber-800/40",
      dot: "bg-amber-500",
      bg: "bg-amber-50 dark:bg-amber-900/10",
    },
  },
  {
    parent: "Engineering",
    stages: ["Engineering"],
    color: {
      header: "text-orange-600 dark:text-orange-300",
      badge: "bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700/60",
      card: "border-orange-200 dark:border-orange-800/40",
      dot: "bg-orange-500",
      bg: "bg-orange-50 dark:bg-orange-900/10",
    },
  },
  {
    parent: "Manufacturing",
    stages: ["Manufacturing"],
    color: {
      header: "text-rose-600 dark:text-rose-300",
      badge: "bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/50 dark:text-rose-300 dark:border-rose-700/60",
      card: "border-rose-200 dark:border-rose-800/40",
      dot: "bg-rose-500",
      bg: "bg-rose-50 dark:bg-rose-900/10",
    },
  },
  {
    parent: "Active",
    stages: ["Active"],
    color: {
      header: "text-green-600 dark:text-green-300",
      badge: "bg-green-100 text-green-700 border border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700/60",
      card: "border-green-200 dark:border-green-800/40",
      dot: "bg-green-500",
      bg: "bg-green-50 dark:bg-green-900/10",
    },
  },
  {
    parent: "Inactive",
    stages: ["Inactive"],
    autoCollapse: true,
    color: {
      header: "text-gray-500 dark:text-gray-400",
      badge: "bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700/60",
      card: "border-gray-200 dark:border-gray-700/40",
      dot: "bg-gray-400",
      bg: "bg-gray-50 dark:bg-gray-900/10",
    },
  },
];

export function findGroup(stage: string | null, groups: StageGroup[]): StageGroup | undefined {
  if (!stage) return undefined;
  return groups.find(g => g.stages.includes(stage));
}

export function allStages(groups: StageGroup[]): string[] {
  return groups.flatMap(g => g.stages);
}
