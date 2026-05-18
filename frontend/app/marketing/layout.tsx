"use client";

import MarketingTabBar from "@/components/marketing/MarketingTabBar";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full -m-6">
      <MarketingTabBar />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
