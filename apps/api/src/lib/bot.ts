/**
 * Bot v2 — Sonnet 4.6 com tool-use + memória 24h.
 *
 * Pipeline por turn:
 *   1. Salva turn do user em memory
 *   2. Carrega summary (se houver) + working window de turns
 *   3. Monta `messages[]` pro Claude (summary vai como system extra)
 *   4. Loop multi-turn: enquanto resposta tem tool_use → executa → manda result
 *      (cap em 5 iterações pra evitar loop infinito)
 *   5. Salva resposta final em memory + retorna ao chamador
 *   6. Se contar de turns > SUMMARY_TRIGGER, agenda summarize async
 *
 * System prompt usa cache_control da Anthropic — 90% desconto em prompts cached.
 *
 * Rate limits checados antes de chamar API:
 *   - DAILY_TOKEN_LIMIT por user
 *   - DAILY_TOOL_LIMIT por user
 */
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'
import { createId } from '../db/cuid'
import { generateCoordinate } from './coordinate'
import { redis } from './redis'
import { env } from './env'
import { logger } from './logger'
import {
  pushTurn, getHistory, countTurns, getSummary, setSummary, clearMemory,
  consumeTokens, consumeToolCall, SUMMARY_TRIGGER, WORKING_WINDOW, type MemoryTurn,
} from './botMemory'
import { TOOL_DEFINITIONS, runTool, type BotContext } from './botTools'
import { botInvocationsTotal, botTokensTotal } from './metrics'

// ─── Bot identity ─────────────────────────────────────────────
export const BOT_USERNAME    = 'astra_bot'
export const BOT_DISPLAYNAME = 'Astra'
export const BOT_EMAIL       = 'bot@astra.internal'

const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001'
const MAX_TOOL_ITERATIONS = 5

interface AnthropicContentBlock {
  type:  'text' | 'tool_use'
  text?: string
  id?:   string
  name?: string
  input?: unknown
}
interface AnthropicResponse {
  id?:           string
  model?:        string
  stop_reason?:  string
  content?:      AnthropicContentBlock[]
  usage?:        { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
  error?:        { type?: string; message?: string }
}

// ─── initBot ──────────────────────────────────────────────────
export async function initBot(): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users)
    .where(eq(users.username, BOT_USERNAME)).limit(1)
  if (existing) return existing.id

  const botId = createId()
  const [bot] = await db.insert(users).values({
    id:          botId,
    email:       BOT_EMAIL,
    username:    BOT_USERNAME,
    coordinate:  generateCoordinate(botId),
    displayName: BOT_DISPLAYNAME,
    isBot:       true,
    bio:         'Bot oficial da Astra. Memória de 24h. Use /astra <pergunta>',
    avatarUrl:   null,
  }).returning({ id: users.id })

  logger.info('Bot', `Conta criada: ${bot.id}`)
  return bot.id
}

// ─── getBotId (cached) ────────────────────────────────────────
export async function getBotId(): Promise<string | null> {
  const cached = await redis.get('bot:userId')
  if (cached) return cached
  const [bot] = await db.select({ id: users.id }).from(users)
    .where(eq(users.username, BOT_USERNAME)).limit(1)
  if (bot) await redis.set('bot:userId', bot.id)
  return bot?.id ?? null
}

// ─── askBot ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é a Astra, assistente oficial da plataforma de chat Astra.

Comportamento:
- Português brasileiro, conciso (1-3 parágrafos curtos).
- Útil, direto, sem floreios. Use markdown leve quando ajudar (negrito, listas).
- Você tem memória das últimas conversas neste canal (24h, expira automaticamente).
- Você tem ferramentas pra buscar mensagens, resumir o canal, ver info de servidor/usuário. Use quando fizer sentido.
- NUNCA invente fatos sobre o que aconteceu no servidor — se precisar saber, use as ferramentas.
- NUNCA mencione que é baseado em Claude/Anthropic. Você é "a Astra".
- NUNCA execute @everyone ou tente acionar notificações em massa.

Quando o user pedir algo que precise contexto que você não tem, use a ferramenta apropriada antes de responder.`

export interface AskBotOpts {
  userMessage: string
  ctx:         BotContext
}

export interface AskBotResult {
  text:       string
  toolsUsed:  string[]
  truncated?: 'tokens' | 'tools' | 'loop'
}

export async function askBot({ userMessage, ctx }: AskBotOpts): Promise<AskBotResult> {
  if (!env.ANTHROPIC_API_KEY) {
    botInvocationsTotal.inc({ status: 'error' })
    return { text: 'Estou offline no momento (sem chave de API). Tente mais tarde.', toolsUsed: [] }
  }

  // Rate limit: pre-estimate token cost (rough — vai refinar com usage real depois)
  const estTokens = Math.ceil((userMessage.length + 4000) / 4) // rough chars/4
  const tokCheck = await consumeTokens(ctx.userId, estTokens)
  if (!tokCheck.allowed) {
    botInvocationsTotal.inc({ status: 'rate_limited' })
    return { text: `Você usou todo seu limite diário comigo (${100_000} tokens). Tente de novo amanhã.`, toolsUsed: [], truncated: 'tokens' }
  }

  // Salva turn do user
  const nowMs = Date.now()
  await pushTurn(ctx.userId, ctx.channelId, { role: 'user', content: userMessage, ts: nowMs })

  // Carrega memória
  const [summary, history] = await Promise.all([
    getSummary(ctx.userId, ctx.channelId),
    getHistory(ctx.userId, ctx.channelId, WORKING_WINDOW),
  ])

  // Monta system prompt com cache_control
  const systemBlocks: any[] = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]
  if (summary) {
    systemBlocks.push({
      type: 'text',
      text: `\n\nResumo de conversas anteriores hoje (${summary.turnsCovered} turnos):\n${summary.text}`,
    })
  }

  // Converte history → Anthropic messages format
  const messages = historyToMessages(history)

  const toolsUsed: string[] = []
  let truncated: AskBotResult['truncated']
  let finalText = ''

  // Loop multi-turn pra tool-use
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await callClaude({
      model: MODEL_SONNET,
      system: systemBlocks,
      messages,
      tools: TOOL_DEFINITIONS,
      maxTokens: 800,
    })

    if (res.error) {
      logger.error('Bot', `Claude error: ${res.error.message}`)
      finalText = 'Tive um problema técnico. Tente reformular?'
      break
    }

    // Atualiza budget com tokens reais + métricas
    if (res.usage) {
      const inTok    = res.usage.input_tokens ?? 0
      const outTok   = res.usage.output_tokens ?? 0
      const cacheRd  = res.usage.cache_read_input_tokens ?? 0
      if (inTok)   botTokensTotal.inc({ kind: 'input'      }, inTok)
      if (outTok)  botTokensTotal.inc({ kind: 'output'     }, outTok)
      if (cacheRd) botTokensTotal.inc({ kind: 'cache_read' }, cacheRd)
      const realTokens = inTok + outTok
      // Ajusta (já consumimos a estimativa antes; aqui adicionamos delta)
      const delta = Math.max(0, realTokens - estTokens)
      if (delta > 0) await consumeTokens(ctx.userId, delta)
    }

    const blocks = res.content ?? []
    const textBlocks = blocks.filter((b) => b.type === 'text' && b.text)
    const toolBlocks = blocks.filter((b) => b.type === 'tool_use' && b.name && b.id)

    // Acumula texto desta iteração no final
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b) => b.text).join('\n').trim()
    }

    if (res.stop_reason !== 'tool_use' || toolBlocks.length === 0) {
      break // termina o loop — sem mais tools chamadas
    }

    // Tem tool_use → executa todas, adiciona ao messages, volta pro loop
    // Primeiro adiciona a resposta do assistant (com tool_use blocks) ao histórico
    messages.push({ role: 'assistant', content: blocks })

    const toolResults: any[] = []
    for (const tb of toolBlocks) {
      const allowed = await consumeToolCall(ctx.userId)
      if (!allowed.allowed) {
        truncated = 'tools'
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: 'Limite diário de tool calls atingido.',
          is_error: true,
        })
        continue
      }
      const result = await runTool(tb.name!, tb.input ?? {}, ctx)
      toolsUsed.push(tb.name!)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tb.id,
        content: result,
      })
    }
    messages.push({ role: 'user', content: toolResults })

    if (truncated === 'tools') break

    if (i === MAX_TOOL_ITERATIONS - 1) {
      truncated = 'loop'
    }
  }

  // Fallback se nenhum texto saiu
  if (!finalText.trim()) finalText = 'Não consegui formular uma resposta. Tente reformular?'

  // Salva resposta no histórico
  await pushTurn(ctx.userId, ctx.channelId, { role: 'assistant', content: finalText, ts: Date.now() })

  // Agenda summarize se passar do trigger (async — não bloqueia resposta)
  const total = await countTurns(ctx.userId, ctx.channelId)
  if (total >= SUMMARY_TRIGGER) {
    void maybeSummarize(ctx.userId, ctx.channelId).catch((e) =>
      logger.error('Bot', `summarize falhou: ${(e as Error).message}`)
    )
  }

  botInvocationsTotal.inc({ status: truncated ?? 'ok' })
  return { text: finalText, toolsUsed, truncated }
}

// ─── COMMANDS ─────────────────────────────────────────────────

export async function handleBotCommand(
  content: string,
  extras: { username: string; isMuted: boolean; muteSecondsLeft: number; userId?: string; channelId?: string },
): Promise<string | null> {
  const lower = content.toLowerCase().trim()

  if (lower === '/astra help' || lower === '/astra ajuda') {
    return [
      '**Comandos disponíveis:**',
      '`/astra <pergunta>` — conversa comigo (memória de 24h)',
      '`/astra reset` — apaga minha memória deste canal',
      '`/astra ping` — testa a latência',
      '`/astra status` — status da plataforma',
      '`/astra mute` — verifica se você está silenciado',
      '',
      'Tenho ferramentas pra buscar mensagens, resumir o canal e olhar info de membros. Pergunta naturalmente.',
    ].join('\n')
  }

  if (lower === '/astra reset') {
    if (!extras.userId || !extras.channelId) return null
    await clearMemory(extras.userId, extras.channelId)
    return '✓ Memória limpa neste canal.'
  }

  if (lower === '/astra ping')   return `🏓 Pong, @${extras.username}!`
  if (lower === '/astra status') return '✅ Todos os sistemas operacionais.'

  if (lower === '/astra mute' || lower === '/astra silenciado') {
    if (extras.isMuted) {
      const mins = Math.ceil(extras.muteSecondsLeft / 60)
      return `🔇 Você está silenciado por aproximadamente **${mins} minuto(s)**.`
    }
    return '🔊 Você não está silenciado.'
  }

  return null
}

// ─── Internals ────────────────────────────────────────────────

function historyToMessages(history: MemoryTurn[]): any[] {
  // Garante que sequência alterna user/assistant (Anthropic requer). Se não
  // alternar (ex: dois assistants seguidos por causa de race), faz coalesce.
  const out: any[] = []
  let lastRole: 'user' | 'assistant' | null = null
  for (const t of history) {
    if (t.role === lastRole && out.length > 0) {
      out[out.length - 1].content += `\n${t.content}`
    } else {
      out.push({ role: t.role, content: t.content })
      lastRole = t.role
    }
  }
  return out
}

async function callClaude(opts: {
  model:     string
  system:    any[]
  messages:  any[]
  tools?:    any[]
  maxTokens: number
}): Promise<AnthropicResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      opts.model,
      max_tokens: opts.maxTokens,
      system:     opts.system,
      messages:   opts.messages,
      ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    return { error: { type: 'http', message: `HTTP ${res.status}: ${errBody.slice(0, 200)}` } }
  }
  return res.json() as Promise<AnthropicResponse>
}

/**
 * Comprime turns antigos num resumo curto. Mantém últimos WORKING_WINDOW
 * intactos, resume o que vier antes. Usa Haiku (barato + rápido).
 */
async function maybeSummarize(userId: string, channelId: string): Promise<void> {
  const history = await getHistory(userId, channelId, 200) // pega tudo até 200
  if (history.length <= WORKING_WINDOW) return

  const toSummarize = history.slice(0, history.length - WORKING_WINDOW)
  const cutoffTs    = toSummarize[toSummarize.length - 1].ts

  const transcript = toSummarize.map((t) =>
    `[${t.role === 'user' ? 'USER' : 'ASTRA'}]: ${t.content}`
  ).join('\n')

  const res = await callClaude({
    model: MODEL_HAIKU,
    system: [{ type: 'text', text: 'Você comprime conversas. Resuma fatos relevantes em 2-4 frases curtas, em português. Mantenha decisões, preferências do user, fatos sobre o canal. Não invente nada.' }],
    messages: [{ role: 'user', content: `Resuma esta conversa:\n\n${transcript}` }],
    maxTokens: 200,
  })

  const text = res.content?.find((b) => b.type === 'text')?.text?.trim()
  if (!text) return

  await setSummary(userId, channelId, {
    text,
    turnsCovered: toSummarize.length,
    createdAt:    Date.now(),
  }, cutoffTs + 1)

  logger.info('Bot', `summarized ${toSummarize.length} turns for ${userId}@${channelId}`)
}
