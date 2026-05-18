"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import DrawioModal from "./DrawioModal";

function DrawioNodeView({
  node,
  updateAttributes,
  deleteNode,
}: {
  node: { attrs: { xml: string; svg: string } };
  updateAttributes: (attrs: Partial<{ xml: string; svg: string }>) => void;
  deleteNode: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { xml, svg } = node.attrs;

  // Render SVG as an img data URL so prose/Tailwind CSS can't interfere with fill/stroke
  const svgDataUrl = svg
    ? `data:image/svg+xml,${encodeURIComponent(svg)}`
    : null;

  return (
    <NodeViewWrapper>
      <div
        contentEditable={false}
        className="relative group my-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 select-none"
      >
        {svgDataUrl ? (
          <img
            src={svgDataUrl}
            alt="Flowchart diagram"
            className="w-full h-auto block"
            style={{ minHeight: 80 }}
          />
        ) : (
          <div className="h-20 flex items-center justify-center text-gray-400 text-sm bg-gray-50 dark:bg-gray-800">
            Empty diagram — click Edit to open
          </div>
        )}

        {/* Hover controls */}
        <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 z-10">
          <button
            onClick={() => setEditing(true)}
            className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={deleteNode}
            className="px-2 py-1 text-xs bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 rounded shadow text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {editing && typeof document !== "undefined" &&
        createPortal(
          <DrawioModal
            initialXml={xml}
            onSave={(newXml, newSvg) => {
              updateAttributes({ xml: newXml, svg: newSvg });
              setEditing(false);
            }}
            onClose={() => setEditing(false)}
          />,
          document.body
        )}
    </NodeViewWrapper>
  );
}

export const DrawioExtension = Node.create({
  name: "drawio",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      xml: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-xml") || "",
        renderHTML: (attrs) => ({ "data-xml": attrs.xml }),
      },
      svg: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-svg") || "",
        renderHTML: (attrs) => ({ "data-svg": attrs.svg }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawio"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "drawio" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioNodeView);
  },
});
