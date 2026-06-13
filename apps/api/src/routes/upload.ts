import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import sharp from 'sharp'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { putAttachment, storageMode } from '../lib/storage'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

/**
 * ⚠️ AVISO DE PRODUÇÃO ⚠️
 *
 * Esta implementação grava arquivos no filesystem local. Em hosts com disco
 * EFÊMERO (Render free, Railway, Fly volumes não-attached, Vercel), TODO upload
 * é DESTRUÍDO em cada redeploy/restart do container.
 *
 * Em produção real (não-dev/portfolio), migrar pra:
 *   - Cloudflare R2 (S3-compatible, 10GB grátis, ZERO egress fee — recomendado)
 *   - AWS S3 + presigned uploads
 *   - Disco persistente Render ($1/GB/mês)
 *
 * Aviso emitido uma vez no startup pra ficar grudado nos logs de deploy.
 */
if (process.env.NODE_ENV === 'production' && storageMode === 'local' && !process.env.UPLOAD_PERSISTENT) {
  // eslint-disable-next-line no-console
  console.warn(
    '[uploads] ⚠ Storage em filesystem local. Arquivos serão perdidos em cada redeploy.\n' +
    '          Configure R2 (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_URL)\n' +
    '          ou seta UPLOAD_PERSISTENT=1 se tem volume montado.',
  )
}

// SVG removido propositalmente: pode conter <script> e dispara XSS quando
// servido com Content-Type image/svg+xml e renderizado inline. Pra suportar
// SVG no futuro: sanitizar via dompurify server-side OU servir com
// Content-Disposition: attachment.
const ALLOWED_MIMES = new Set([
  'image/png','image/jpeg','image/gif','image/webp','image/avif',
  'video/mp4','video/webm','video/quicktime',
  'audio/mpeg','audio/wav','audio/ogg','audio/webm','audio/mp4','audio/x-m4a','audio/aac',
  'application/pdf','text/plain','application/zip','application/json',
])

// Browser pode mandar mime com codec suffix (ex: 'audio/webm;codecs=opus').
// Normalizamos comparando só a parte antes do ';'.
function isMimeAllowed(raw: string): boolean {
  const base = raw.split(';')[0].trim().toLowerCase()
  return ALLOWED_MIMES.has(base)
}

const MAX_FILE_SIZE  = 25 * 1024 * 1024 // 25 MB
const MAX_PER_REQUEST = 10

// Memory storage pra imagens — vão passar pelo sharp antes de ir pro disco.
// Não-imagens (vídeo, áudio, PDF) ainda vão direto pro disco via callback.
const memoryStorage = multer.memoryStorage()

const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (!isMimeAllowed(file.mimetype)) return cb(new Error('TYPE_NOT_ALLOWED'))
    cb(null, true)
  },
})

/**
 * Recompressa imagem em WebP. Reduz banda ~70% vs PNG/JPG sem perda visual
 * relevante. Limita altura 2048 (smartphones modernos têm fotos 4032×3024
 * = 12MP que viram 4MB+ JPG — desperdício pra avatar/banner/anexo chat).
 *
 * GIF e SVG: pula (animação/escalável preservadas).
 */
async function maybeTranscode(file: Express.Multer.File): Promise<{
  buffer:  Buffer
  mime:    string
  ext:     string
  width?:  number
  height?: number
}> {
  const mime = file.mimetype.split(';')[0].toLowerCase()

  // Não-imagem ou GIF/SVG: passa direto
  if (!mime.startsWith('image/') || mime === 'image/gif' || mime === 'image/svg+xml') {
    return { buffer: file.buffer, mime, ext: path.extname(file.originalname).toLowerCase() }
  }

  try {
    const img = sharp(file.buffer, { failOn: 'none' })
    const meta = await img.metadata()
    const buffer = await img
      .rotate()  // respeita EXIF orientation (foto retrato vira retrato)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
    return {
      buffer,
      mime:   'image/webp',
      ext:    '.webp',
      width:  meta.width,
      height: meta.height,
    }
  } catch (e) {
    console.warn('[upload] sharp falhou, fallback p/ original:', (e as Error).message)
    return { buffer: file.buffer, mime, ext: path.extname(file.originalname).toLowerCase() }
  }
}

const router = Router()

// POST /api/upload — multipart, campo "files"
router.post(
  '/',
  requireAuth,
  (req: Request, res: Response, next) => {
    upload.array('files', MAX_PER_REQUEST)(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo maior que 25MB' })
        if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ error: `Máximo ${MAX_PER_REQUEST} arquivos` })
        if (err.message === 'TYPE_NOT_ALLOWED') return res.status(415).json({ error: 'Tipo não permitido' })
        return res.status(400).json({ error: 'Falha no upload' })
      }
      next()
    })
  },
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado' })

    const attachments = await Promise.all(files.map(async (f) => {
      const processed = await maybeTranscode(f)
      const id = crypto.randomBytes(16).toString('hex')
      const filename = `${id}${processed.ext}`
      const url = await putAttachment(filename, processed.buffer, processed.mime)
      return {
        url,
        type:   processed.mime,
        name:   f.originalname,
        size:   processed.buffer.length,
        width:  processed.width,
        height: processed.height,
      }
    }))
    res.json({ data: { attachments } })
  })
)

export default router
export { UPLOAD_DIR }
