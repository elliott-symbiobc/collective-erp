"use client";

import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DrawioExtension } from "./DrawioExtension";
import DrawioModal from "./DrawioModal";

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  autoFocus?: boolean;
  editable?: boolean;
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded transition-colors text-sm leading-none select-none ${
        active
          ? "bg-indigo-600 text-white"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-1 flex-shrink-0" />;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({
  editor,
  onInsertFlowchart,
}: {
  editor: Editor | null;
  onInsertFlowchart: () => void;
}) {
  if (!editor) return null;

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-t-xl">
      {/* Text style */}
      <select
        onMouseDown={(e) => e.preventDefault()}
        onChange={(e) => {
          const val = e.target.value;
          if (val === "p") editor.chain().focus().setParagraph().run();
          else if (val === "h1") editor.chain().focus().toggleHeading({ level: 1 }).run();
          else if (val === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
          else if (val === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
          e.target.value = "";
        }}
        value=""
        className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:border-indigo-400 cursor-pointer mr-1"
      >
        <option value="" disabled>Style</option>
        <option value="p">Paragraph</option>
        <option value="h1">Title</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>

      <Divider />

      {/* Inline formatting */}
      <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (⌘B)">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (⌘I)">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4h-8z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (⌘U)">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/></svg>
      </ToolBtn>

      <Divider />

      {/* Lists */}
      <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
      </ToolBtn>

      <Divider />

      {/* Block elements */}
      <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Dividing line">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
      </ToolBtn>

      <Divider />

      {/* Table */}
      <ToolBtn active={editor.isActive("table")} onClick={insertTable} title="Insert table">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
      </ToolBtn>

      {/* Flowchart */}
      <ToolBtn active={false} onClick={onInsertFlowchart} title="Insert flowchart (draw.io)">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <polygon points="12,10 17,13.5 12,17 7,13.5" />
          <rect x="8" y="20" width="8" height="2" rx="1" />
          <line x1="12" y1="6" x2="12" y2="10" />
          <line x1="12" y1="17" x2="12" y2="20" />
        </svg>
      </ToolBtn>

      <Divider />

      {/* Alignment */}
      <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z"/></svg>
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"/></svg>
      </ToolBtn>

      <Divider />

      {/* Undo / Redo */}
      <ToolBtn active={false} onClick={() => editor.chain().focus().undo().run()} title="Undo (⌘Z)" disabled={!editor.can().undo()}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
      </ToolBtn>
      <ToolBtn active={false} onClick={() => editor.chain().focus().redo().run()} title="Redo (⌘⇧Z)" disabled={!editor.can().redo()}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
      </ToolBtn>
    </div>
  );
}

// ── Main editor ────────────────────────────────────────────────────────────────

export default function RichTextEditor({
  content,
  onChange,
  placeholder = "Start writing…",
  minHeight = "240px",
  autoFocus = false,
  editable = true,
}: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [drawioOpen, setDrawioOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: {},
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
      DrawioExtension,
    ],
    content: content || "",
    editable,
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getHTML());
    },
  });

  const handleDrawioSave = useCallback((xml: string, svg: string) => {
    editor?.commands.insertContent({ type: "drawio", attrs: { xml, svg } });
    setDrawioOpen(false);
  }, [editor]);

  // Sync external content changes (e.g. when entry switches)
  useEffect(() => {
    if (!editor) return;
    const currentHtml = editor.getHTML();
    if (content !== currentHtml) {
      editor.commands.setContent(content || "", false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <div className="rich-editor border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden transition-shadow">
      {editable && (
        <Toolbar
          editor={editor}
          onInsertFlowchart={() => setDrawioOpen(true)}
        />
      )}
      <EditorContent
        editor={editor}
        style={{ minHeight }}
        className="prose prose-sm max-w-none px-5 py-4 focus:outline-none text-gray-800 dark:text-gray-200 leading-relaxed dark:bg-gray-900"
      />
      <style>{`
        .rich-editor .ProseMirror {
          min-height: ${minHeight};
          outline: none;
        }
        .rich-editor [contenteditable] { outline: none; box-shadow: none; }
        .rich-editor [contenteditable]:focus { outline: none; box-shadow: none; }
        .rich-editor [contenteditable]:focus-visible { outline: none; box-shadow: none; }
        .rich-editor .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #d1d5db;
          pointer-events: none;
          float: left;
          height: 0;
        }
        .dark .rich-editor .ProseMirror p.is-editor-empty:first-child::before { color: #555555; }
        .rich-editor .ProseMirror h1 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.5rem; line-height: 1.3; }
        .rich-editor .ProseMirror h2 { font-size: 1.15rem; font-weight: 600; margin: 1rem 0 0.4rem; line-height: 1.35; }
        .rich-editor .ProseMirror h3 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin: 0.9rem 0 0.3rem; }
        .dark .rich-editor .ProseMirror h3 { color: #909090; }
        .rich-editor .ProseMirror ul { list-style: disc; padding-left: 1.5rem; margin: 0.5rem 0; }
        .rich-editor .ProseMirror ol { list-style: decimal; padding-left: 1.5rem; margin: 0.5rem 0; }
        .rich-editor .ProseMirror li { margin: 0.15rem 0; }
        .rich-editor .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.25rem; }
        .rich-editor .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0.25rem 0; }
        .rich-editor .ProseMirror ul[data-type="taskList"] li input[type="checkbox"] { margin-top: 0.2rem; accent-color: #4f46e5; cursor: pointer; flex-shrink: 0; }
        .rich-editor .ProseMirror ul[data-type="taskList"] li > div { flex: 1; }
        .rich-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #9ca3af; }
        .dark .rich-editor .ProseMirror ul[data-type="taskList"] li[data-checked="true"] > div { color: #606060; }
        .rich-editor .ProseMirror blockquote { border-left: 3px solid #e5e7eb; padding-left: 1rem; color: #6b7280; margin: 0.75rem 0; font-style: italic; }
        .dark .rich-editor .ProseMirror blockquote { border-left-color: #555555; color: #909090; }
        .rich-editor .ProseMirror hr { border: none; border-top: 2px solid #e5e7eb; margin: 1.25rem 0; }
        .dark .rich-editor .ProseMirror hr { border-top-color: #555555; }
        .rich-editor .ProseMirror code { background: #f3f4f6; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: ui-monospace, monospace; color: #4f46e5; }
        .dark .rich-editor .ProseMirror code { background: #3d3d3d; color: #a5b4fc; }
        .rich-editor .ProseMirror pre { background: #1e1e2e; color: #cdd6f4; padding: 1rem 1.25rem; border-radius: 8px; margin: 0.75rem 0; overflow-x: auto; }
        .rich-editor .ProseMirror pre code { background: none; color: inherit; padding: 0; font-size: 0.85em; }
        .rich-editor .ProseMirror table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; table-layout: auto; }
        .rich-editor .ProseMirror th, .rich-editor .ProseMirror td { border: 1px solid #e5e7eb; padding: 0.4rem 0.75rem; text-align: left; min-width: 80px; }
        .dark .rich-editor .ProseMirror th, .dark .rich-editor .ProseMirror td { border-color: #555555; }
        .rich-editor .ProseMirror th { background: #f9fafb; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
        .dark .rich-editor .ProseMirror th { background: #3d3d3d; color: #909090; }
        .rich-editor .ProseMirror .selectedCell:after { z-index: 2; position: absolute; content: ""; left: 0; right: 0; top: 0; bottom: 0; background: rgba(99,102,241,0.08); pointer-events: none; }
        .rich-editor .ProseMirror p { margin: 0.25rem 0; }
        .rich-editor .ProseMirror > *:first-child { margin-top: 0; }
        .rich-editor .ProseMirror strong { font-weight: 600; }
        .rich-editor .ProseMirror em { font-style: italic; }
        .rich-editor .ProseMirror s { text-decoration: line-through; color: #9ca3af; }
        .dark .rich-editor .ProseMirror s { color: #606060; }
      `}</style>

      {drawioOpen && typeof document !== "undefined" &&
        createPortal(
          <DrawioModal
            onSave={handleDrawioSave}
            onClose={() => setDrawioOpen(false)}
          />,
          document.body
        )}
    </div>
  );
}
