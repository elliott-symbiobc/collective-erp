import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Collective ERP",
  description: "An integrated open-source operations system for entrepreneurs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
