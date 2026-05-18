"""
RAG (Retrieval-Augmented Generation) utilities for Symbio platform.

Provides vector similarity search over the context_chunks table,
which contains embeddings of paper text (title + abstract + summary).

Embedding model: OpenAI text-embedding-3-small (1536 dimensions)
Index: ivfflat cosine (context_chunks_embedding_idx)
Similarity metric: cosine (pgvector <=> operator)

Usage:
    results = retrieve_relevant_chunks(
        query="Aspergillus oryzae solid state fermentation bakery waste",
        source_table="papers",
        top_k=5,
        conn=conn
    )

Reference: Lewis et al. 2020, "Retrieval-Augmented Generation for
Knowledge-Intensive NLP Tasks", NeurIPS 2020.
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
_OPENAI_CLIENT = None


def _get_openai_client():
    global _OPENAI_CLIENT
    if _OPENAI_CLIENT is None:
        import openai
        _OPENAI_CLIENT = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _OPENAI_CLIENT


def embed_query(query: str) -> list[float]:
    """Generate an embedding for a query string using text-embedding-3-small."""
    client = _get_openai_client()
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=query[:8192],
    )
    return response.data[0].embedding


def retrieve_relevant_chunks(
    query: str,
    conn,
    source_table: str = "papers",
    top_k: int = 5,
    min_similarity: float = 0.3,
    filter_paper_ids: Optional[list] = None,
) -> list[dict]:
    """Retrieve the most relevant text chunks for a query.

    Parameters
    ----------
    query : str
        Natural language query describing what to retrieve
    conn : psycopg2 connection
    source_table : str
        Which source to search ('papers' or other context_chunks sources)
    top_k : int
        Maximum number of chunks to return
    min_similarity : float
        Minimum cosine similarity threshold (0-1, higher = more similar)
    filter_paper_ids : list, optional
        Restrict search to specific paper UUIDs

    Returns
    -------
    list of dicts with keys:
        source_id, chunk_text, similarity, paper_title, paper_year, paper_doi

    Notes
    -----
    Returns [] gracefully if OpenAI API is unavailable or corpus is empty.
    pgvector <=> computes cosine distance; similarity = 1 - distance.
    The context_chunks index is ivfflat (embedding vector_cosine_ops).
    """
    if not os.environ.get("OPENAI_API_KEY"):
        logger.debug("retrieve_relevant_chunks: OPENAI_API_KEY not set, skipping")
        return []

    try:
        query_embedding = embed_query(query)
    except Exception as exc:
        logger.warning("retrieve_relevant_chunks: embed_query failed: %s", exc)
        return []

    vec_str = "[" + ",".join(str(v) for v in query_embedding) + "]"
    cur = conn.cursor()

    try:
        if source_table == "papers":
            # Paper chunks are shared (no user_id filter); source_id is TEXT = paper_id::text
            if filter_paper_ids:
                filter_strs = [str(pid) for pid in filter_paper_ids]
                cur.execute(
                    """
                    SELECT
                        cc.source_id,
                        cc.content AS chunk_text,
                        1 - (cc.embedding <=> %s::vector) AS similarity,
                        p.title  AS paper_title,
                        p.year   AS paper_year,
                        p.doi    AS paper_doi
                    FROM context_chunks cc
                    JOIN papers p ON p.paper_id::text = cc.source_id
                    WHERE cc.source_table = 'papers'
                      AND cc.source_id = ANY(%s)
                      AND 1 - (cc.embedding <=> %s::vector) >= %s
                    ORDER BY cc.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (vec_str, filter_strs, vec_str, min_similarity, vec_str, top_k),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        cc.source_id,
                        cc.content AS chunk_text,
                        1 - (cc.embedding <=> %s::vector) AS similarity,
                        p.title  AS paper_title,
                        p.year   AS paper_year,
                        p.doi    AS paper_doi
                    FROM context_chunks cc
                    JOIN papers p ON p.paper_id::text = cc.source_id
                    WHERE cc.source_table = 'papers'
                      AND 1 - (cc.embedding <=> %s::vector) >= %s
                    ORDER BY cc.embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (vec_str, vec_str, min_similarity, vec_str, top_k),
                )
        else:
            # Generic source_table query (no papers JOIN)
            cur.execute(
                """
                SELECT
                    cc.source_id,
                    cc.content AS chunk_text,
                    1 - (cc.embedding <=> %s::vector) AS similarity,
                    NULL::text AS paper_title,
                    NULL::int  AS paper_year,
                    NULL::text AS paper_doi
                FROM context_chunks cc
                WHERE cc.source_table = %s
                  AND 1 - (cc.embedding <=> %s::vector) >= %s
                ORDER BY cc.embedding <=> %s::vector
                LIMIT %s
                """,
                (vec_str, source_table, vec_str, min_similarity, vec_str, top_k),
            )

        rows = cur.fetchall()
    except Exception as exc:
        logger.warning("retrieve_relevant_chunks: query failed: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return []
    finally:
        cur.close()

    results = []
    for source_id, chunk_text, similarity, title, year, doi in rows:
        results.append({
            "source_id":   str(source_id),
            "chunk_text":  chunk_text,
            "similarity":  float(similarity),
            "paper_title": title,
            "paper_year":  year,
            "paper_doi":   doi,
        })

    logger.info(
        "RAG retrieval: query='%s...', source=%s, returned %d chunks",
        query[:50], source_table, len(results),
    )
    return results


def format_chunks_for_context(
    chunks: list[dict],
    max_chars: int = 3000,
) -> str:
    """Format retrieved chunks as context text for Claude.

    Returns a concise, citable context block:
        --- Literature context (from paper corpus) ---
        [1] Title (year) doi:... (similarity: 0.82):
          "...chunk text..."
        ---
    Returns "" if chunks is empty.
    """
    if not chunks:
        return ""

    lines = ["--- Literature context (from paper corpus) ---"]
    total_chars = 0

    for i, chunk in enumerate(chunks, 1):
        title      = (chunk.get("paper_title") or "Unknown")[:60]
        year       = chunk.get("paper_year") or ""
        doi        = chunk.get("paper_doi") or ""
        similarity = chunk.get("similarity", 0.0)
        text       = chunk.get("chunk_text") or ""

        remaining = max_chars - total_chars
        if remaining < 100:
            break

        text_preview = text[: min(len(text), remaining - 60)]
        cite = f"{title} ({year})"
        if doi:
            cite += f" doi:{doi}"

        entry = f"[{i}] {cite} (similarity: {similarity:.2f}):\n  \"{text_preview}\"\n"
        lines.append(entry)
        total_chars += len(entry)

    lines.append("---")
    return "\n".join(lines)
