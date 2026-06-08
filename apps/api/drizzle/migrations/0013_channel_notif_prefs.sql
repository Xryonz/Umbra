-- ─────────────────────────────────────────────────────────────
-- ChannelNotifPref: preferência de notificação por canal/user.
--
-- mode: 'all'      → todas as msgs notificam (default, sem row)
--       'mentions' → só @me + replies a mim
--       'mute'     → silencia tudo
--
-- Lookup hot path: notification dispatcher consulta antes de
-- emitir 'mention'/'reply'/'reaction'. UNIQUE (userId, channelId)
-- pra ser O(1) por user-canal.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ChannelNotifPref" (
  "id"        text PRIMARY KEY,
  "userId"    text NOT NULL REFERENCES "User"("id")    ON DELETE CASCADE,
  "channelId" text NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE,
  "mode"      text NOT NULL DEFAULT 'all',
  "updatedAt" timestamp(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelNotifPref_userId_channelId_key"
  ON "ChannelNotifPref" ("userId", "channelId");
