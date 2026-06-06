import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { pushSubscriptions } from '../db/schema'
import { env } from './env'

let isConfigured = false

/** Inicializa VAPID. Se faltar key, push fica desligado (no-op). */
export function initPush() {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.warn('[Push] VAPID_PUBLIC_KEY/PRIVATE_KEY ausentes — push desabilitado')
    console.warn('[Push] gerar: npx web-push generate-vapid-keys --json')
    return
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  isConfigured = true
  console.log('[Push] VAPID configurado')
}

export function isPushEnabled() { return isConfigured }

export function getVapidPublicKey() { return env.VAPID_PUBLIC_KEY ?? null }

export interface PushPayload {
  title: string
  body:  string
  url?:  string
  icon?: string
  tag?:  string
  /** se true, replaces qualquer notificação anterior com mesma `tag` */
  renotify?: boolean
  /** Quando true, SW renderiza com [Abrir] [Responder] (input inline). */
  actionable?: boolean
  /** Necessário pra reply inline funcionar (SW posta no canal certo). */
  channelId?: string
  /** Idem pra DMs. */
  dmConvId?:  string
}

/**
 * Envia push pra todas as subscriptions de um user. Sub gone (410/404)
 * é removida automaticamente — best-effort, não bloqueia o caller.
 */
export async function sendPush(userId: string, payload: PushPayload) {
  if (!isConfigured) return

  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (subs.length === 0) return

  const body = JSON.stringify(payload)

  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      }, body)
    } catch (err: any) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        // Endpoint expirou/cancelado — limpa
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {})
      } else {
        console.error('[Push] erro:', code ?? err?.message ?? err)
      }
    }
  }))
}
