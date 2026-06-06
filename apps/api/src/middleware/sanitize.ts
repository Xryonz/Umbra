import { Request, Response, NextFunction } from 'express'

/**
 * Defesa em profundidade contra payloads HTML/JS em params e query.
 *
 * IMPORTANTE: este middleware NÃO sanitiza req.body. Razões:
 *  - O frontend renderiza tudo como texto via React (escape automático).
 *    Não há HTML perigoso no fluxo: a sanitização no input só destruía
 *    conteúdo legítimo (ex: data: URIs de upload, código com tags em
 *    mensagens).
 *  - O lugar correto para escapar é na renderização, não no armazenamento.
 *  - Esquemas Zod (`@astra/types`) já validam shape/tamanho de cada campo.
 *
 * Aqui só fazemos um saneamento defensivo de strings em params/query —
 * que costumam ir para logs ou serem ecoadas em headers.
 */
function sanitizeShallowString(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '')      // remove tags HTML
      .replace(/on\w+\s*=/gi, '')   // remove on*= handlers
      .replace(/javascript\s*:/gi, '') // remove javascript: URIs
      .trim()
  }
  if (Array.isArray(value)) return value.map(sanitizeShallowString)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeShallowString(v)])
    )
  }
  return value
}

export function sanitizeInputs(req: Request, _res: Response, next: NextFunction) {
  if (req.query)  req.query  = sanitizeShallowString(req.query)  as Record<string, string>
  if (req.params) req.params = sanitizeShallowString(req.params) as Record<string, string>
  next()
}