-- Migration 031: make context_chunks.user_id nullable for system-generated content
--
-- Root cause: embed_task.py queries user_id from papers table (which has no
-- user_id column). The NOT NULL constraint on context_chunks.user_id caused
-- every paper embedding INSERT to fail silently, leaving the entire paper
-- corpus unindexed for RAG retrieval.
--
-- Papers are platform content, not user-owned. All other user-scoped sources
-- (notes, eln_entries, tasks, contacts) continue to populate user_id normally.

ALTER TABLE context_chunks ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN context_chunks.user_id IS
    'User who owns this content. NULL for system-generated content
     (papers, platform reference data). NOT NULL for user-created
     content (notes, ELN entries, tasks, contacts).';
