-- ─────────────────────────────────────────────────────────────
-- pg_trgm + GIN indexes pra busca textual rápida.
--
-- ILIKE '%q%' faz seq-scan por default (slow >10k rows). pg_trgm permite
-- GIN index em texto que cobre ILIKE automaticamente — 100x mais rápido
-- em messages.content quando há volume.
--
-- Não muda query nenhuma — o planner usa o índice transparente.
-- Idempotente — IF NOT EXISTS em extensão + indexes.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Messages: content (busca livre)
CREATE INDEX IF NOT EXISTS "Message_content_trgm_idx"
  ON "Message" USING gin (content gin_trgm_ops);

-- Channels: name (autocomplete)
CREATE INDEX IF NOT EXISTS "Channel_name_trgm_idx"
  ON "Channel" USING gin (name gin_trgm_ops);

-- Servers: name (autocomplete)
CREATE INDEX IF NOT EXISTS "Server_name_trgm_idx"
  ON "Server" USING gin (name gin_trgm_ops);

-- Users: displayName + username (mention picker + search)
CREATE INDEX IF NOT EXISTS "User_displayName_trgm_idx"
  ON "User" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_username_trgm_idx"
  ON "User" USING gin (username gin_trgm_ops);
