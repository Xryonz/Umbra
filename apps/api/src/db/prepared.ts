/**
 * Prepared statements pro hot path do chat.
 *
 * Por que: cada INSERT/SELECT no postgres recompila o execution plan.
 * Pra queries idênticas batidas várias vezes por segundo (msg envio,
 * autor lookup), isso é desperdício — 5-10ms por query.
 *
 * Prepared statement reusa o plan: o postgres parseia 1x e executa
 * milhares com substituição de placeholders. Ganho típico: 30-50%
 * em INSERT simples.
 *
 * Drizzle: `.prepare(name)` cacheia o plan na connection do pg-pool.
 * Reuso entre requests é automático (cada conn no pool prepara
 * sob demanda, depois reutiliza).
 */
import { sql } from 'drizzle-orm'
import { db } from '.'
import { users, serverMembers } from './schema'
import { eq, and } from 'drizzle-orm'

// NOTA: INSERT prepared com placeholders nullable (replyToId, expiresAt)
// causou regressão — Drizzle 0.45 + pg gera SQL inválido em casos edge.
// Mantemos só SELECTs prepared (read-only, sem nullable) que são seguros
// e ainda dão ganho considerável (lookup de autor + membership = 2x p/ msg).

// ── SELECT autor pelo userId ───────────────────────────────────
// Bate em cada send_message pra montar payload do socket emit.
export const selectAuthorById = db.select({
  id:          users.id,
  username:    users.username,
  displayName: users.displayName,
  avatarUrl:   users.avatarUrl,
  displayFont: users.displayFont,
}).from(users)
  .where(eq(users.id, sql.placeholder('userId')))
  .limit(1)
  .prepare('select_author_by_id')

// ── SELECT cor do membro no servidor ───────────────────────────
// Bate em cada send_message pra resolver authorColor.
export const selectMemberColor = db.select({ nameColor: serverMembers.nameColor })
  .from(serverMembers)
  .where(and(
    eq(serverMembers.userId, sql.placeholder('userId')),
    eq(serverMembers.serverId, sql.placeholder('serverId')),
  ))
  .limit(1)
  .prepare('select_member_color')
