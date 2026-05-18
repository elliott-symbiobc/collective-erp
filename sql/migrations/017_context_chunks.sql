-- 017_context_chunks.sql — Semantic context store for RAG pipeline

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS context_chunks (
    chunk_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    source_table TEXT NOT NULL,   -- 'notes','eln_entries','papers','contacts','tasks'
    source_id    TEXT NOT NULL,   -- the PK of the source row (as text)
    chunk_index  INT  NOT NULL DEFAULT 0,  -- for multi-chunk docs
    content      TEXT NOT NULL,
    embedding    vector(1536),    -- text-embedding-3-small
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness: one chunk_index per source row
CREATE UNIQUE INDEX IF NOT EXISTS context_chunks_source_idx
    ON context_chunks (source_table, source_id, chunk_index);

-- IVFFlat ANN index (tune lists after bulk insert)
CREATE INDEX IF NOT EXISTS context_chunks_embedding_idx
    ON context_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS context_chunks_user_idx
    ON context_chunks (user_id, updated_at DESC);
