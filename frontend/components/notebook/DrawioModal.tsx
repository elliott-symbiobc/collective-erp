"use client";

import { useEffect, useRef, useCallback } from "react";

interface Props {
  initialXml?: string;
  onSave: (xml: string, svg: string) => void;
  onClose: () => void;
}

export default function DrawioModal({ initialXml, onSave, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pendingXml = useRef<string>("");

  const post = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
  }, []);

  useEffect(() => {
    function handle(event: MessageEvent) {
      if (typeof event.data !== "string") return;
      let msg: { event: string; xml?: string; data?: string };
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === "init") {
        post({ action: "load", xml: initialXml || "", autosave: 0 });
      } else if (msg.event === "save") {
        pendingXml.current = msg.xml || "";
        post({ action: "export", format: "svg", xml: msg.xml, spin: "Exporting…" });
      } else if (msg.event === "export") {
        const b64 = (msg.data || "").split(",")[1] || "";
        const svg = b64 ? atob(b64) : "";
        onSave(pendingXml.current, svg);
      } else if (msg.event === "exit") {
        onClose();
      }
    }
    window.addEventListener("message", handle);
    return () => window.removeEventListener("message", handle);
  }, [initialXml, post, onSave, onClose]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "92vw", height: "88vh" }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            Flowchart Editor — draw.io
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="https://embed.diagrams.net/?embed=1&spin=1&proto=json&ui=atlas&lang=en"
          className="flex-1 border-0 w-full"
          title="Flowchart Editor"
        />
      </div>
    </div>
  );
}
