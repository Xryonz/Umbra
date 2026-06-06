-- ─────────────────────────────────────────────────────────────
-- RefreshToken: metadados de sessão (User-Agent + IP) pra UI de devices.
-- Idempotente — IF NOT EXISTS em colunas.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "RefreshToken"
  ADD COLUMN IF NOT EXISTS "userAgent" text,
  ADD COLUMN IF NOT EXISTS "ip"        text,
  ADD COLUMN IF NOT EXISTS "lastUsedAt" timestamp(3);
