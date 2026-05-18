"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/strains",      label: "Strains"      },
  { href: "/enzymes",      label: "Enzymes"      },
  { href: "/chemicals",    label: "Chemicals"    },
  { href: "/consumables",  label: "Consumables"  },
  { href: "/equipment",    label: "Equipment"    },
];

export default function InventoryTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-5">
      {TABS.map(tab => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
