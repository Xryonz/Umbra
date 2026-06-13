/**
 * Camada de storage de anexos — Cloudflare R2 (S3-compatível) OU disco local.
 *
 * Por quê: disco local em host efêmero (Railway/Render) PERDE todo upload a
 * cada redeploy. R2 é storage de objetos persistente (10GB grátis, ZERO taxa
 * de egress). Esta camada decide em runtime:
 *
 *   - R2 configurado (4 env vars abaixo) → PUT no bucket, devolve URL pública
 *   - senão → grava em /uploads (comportamento de dev, some no redeploy)
 *
 * Trocar de um pro outro é só setar/limpar as env vars — zero mudança de código.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import path from 'path'
import fs from 'fs'

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,   // ex: https://cdn.seusite.com  (domínio público do bucket)
} = process.env

const R2_READY = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_URL)

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

const s3 = R2_READY
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    })
  : null

export const storageMode = R2_READY ? 'r2' : 'local'

/**
 * Persiste um arquivo e devolve a URL pública pra salvar na mensagem.
 * @param key   nome único já gerado (ex: "a1b2c3.webp")
 * @param body  buffer do arquivo (já transcodado)
 * @param mime  content-type pro header (R2 serve com esse Content-Type)
 */
export async function putAttachment(key: string, body: Buffer, mime: string): Promise<string> {
  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: mime,
      // Cache forte: o nome é único (hash), o conteúdo nunca muda.
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    return `${R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}`
  }

  // Fallback disco local
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  await fs.promises.writeFile(path.join(UPLOAD_DIR, key), body)
  return `/uploads/${key}`
}
