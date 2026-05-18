"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";

const NotePopup = dynamic(() => import("./NotePopup"), { ssr: false });

export default function NotebookPanel() {
  const { data: session } = useSession();
  const [popupOpen, setPopupOpen] = useState(false);

  if (!session) return null;

  return (
    <>
      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        <button
          onClick={() => setPopupOpen(o => !o)}
          title={popupOpen ? "Close notes" : "Quick notes"}
          className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
            popupOpen
              ? "bg-gray-700 text-white scale-95 rotate-45"
              : "bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105"
          }`}
        >
          {popupOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          )}
        </button>
      </div>

      <NotePopup open={popupOpen} onClose={() => setPopupOpen(false)} />
    </>
  );
}
