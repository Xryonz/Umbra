/**
 * MessageAttachments — anexos da mensagem (imagens, áudios, arquivos).
 *
 * - Imagens: grid responsivo (1/2/3+ cols), click abre Lightbox via onOpenImage
 * - Áudios: VoiceMessage player
 * - Outros: link de download com size + mime
 *
 * Extraído de MessageItem (overhaul Fase 4d).
 */
import { memo, useMemo, useState } from 'react'
import { File as FileIcon, Download } from 'lucide-react'
import { resolveApiUrl } from '@/lib/api'
import { blurhashToDataURL } from '@/lib/blurhash'
import { VoiceMessage } from '@/components/chat/VoiceRecorder'
import { cn } from '@/lib/utils'

interface Attachment {
  url:       string
  type:      string
  name:      string
  size:      number
  duration?: number
  width?:    number
  height?:   number
  blurhash?: string
}

function fmtBytes(b: number) {
  return b < 1024
    ? `${b}B`
    : b < 1024 * 1024
      ? `${(b / 1024).toFixed(0)}KB`
      : `${(b / 1024 / 1024).toFixed(1)}MB`
}

function isImageAttachment(a: { type?: string; name?: string; url?: string }) {
  if (a.type?.startsWith('image/')) return true
  // Fallback: detecta por extensão se mime veio vazio/errado
  const target = a.url || a.name || ''
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)(\?|#|$)/i.test(target)
}

function ImageTile({ att, onOpen, fullWidth }: { att: Attachment; onOpen: () => void; fullWidth: boolean }) {
  const [errored, setErrored] = useState(false)
  const [loaded, setLoaded]   = useState(false)
  const src = resolveApiUrl(att.url)
  // Placeholder borrado do blurhash (instantâneo) + aspect-ratio reservando
  // o espaço certo: a lista não "pula" quando a foto real chega.
  const blurUrl = useMemo(() => (att.blurhash ? blurhashToDataURL(att.blurhash) : null), [att.blurhash])
  const aspect  = fullWidth && att.width && att.height ? `${att.width} / ${att.height}` : undefined
  // "Sized": a caixa tem altura definida antes da imagem carregar (square
  // sempre; fullWidth só com dimensões). Sem isso (GIF/legado), a imagem
  // dirige a própria altura como antes.
  const sized = !fullWidth || (!!att.width && !!att.height)
  if (errored) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-start gap-1 p-3 border border-(--danger)/40 bg-(--raised) rounded-xl"
        title="Imagem não carregou"
      >
        <span className="text-xs text-(--danger)">⚠ Imagem não carregou</span>
        <span className="text-[10px] font-mono text-(--text-3) break-all">{att.name}</span>
        <span className="text-[10px] text-(--accent) underline">Abrir em nova aba</span>
      </a>
    )
  }
  // fullWidth=true (1 imagem só): mostra na proporção real, completa, com altura
  // generosa. fullWidth=false (>=2): grid items cropam pra alinhar visualmente.
  return (
    <button
      onClick={onOpen}
      style={aspect ? { aspectRatio: aspect, maxHeight: '30rem' } : undefined}
      className={cn(
        'group relative overflow-hidden bg-(--raised) cursor-zoom-in',
        'rounded-xl border border-(--border)',
        fullWidth ? 'block w-full' : 'aspect-square',
      )}
    >
      {/* Placeholder borrado: aparece na hora, some quando a real carrega */}
      {blurUrl && !loaded && (
        <img
          src={blurUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-110"
        />
      )}
      <img
        src={src}
        alt={att.name}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
        className={cn(
          'transition-[transform,opacity] duration-500 ease-(--ease-spring) group-hover:scale-[1.02]',
          loaded ? 'opacity-100' : 'opacity-0',
          sized
            ? cn('absolute inset-0 w-full h-full', fullWidth ? 'object-contain' : 'object-cover')
            : 'block w-full h-auto max-h-120 object-contain',
        )}
      />
    </button>
  )
}

interface Props {
  attachments:  Attachment[]
  onOpenImage:  (imageIdx: number) => void
}

export const MessageAttachments = memo(function MessageAttachments({ attachments, onOpenImage }: Props) {
  if (!attachments?.length) return null

  const images = attachments.filter(isImageAttachment)
  const audios = attachments.filter((a) => a.type?.startsWith('audio/'))
  const others = attachments.filter((a) => !isImageAttachment(a) && !a.type?.startsWith('audio/'))
  const imageGlobalIdx = (att: { url: string }) => images.findIndex((im) => im.url === att.url)

  return (
    <div className="flex flex-col gap-2 mt-2">
      {images.length > 0 && (
        <div className={cn(
          'grid gap-1.5 max-w-md',
          images.length === 1 && 'grid-cols-1',
          images.length === 2 && 'grid-cols-2',
          images.length >= 3 && 'grid-cols-2 sm:grid-cols-3',
        )}>
          {images.map((a) => (
            <ImageTile
              key={a.url}
              att={a}
              onOpen={() => onOpenImage(imageGlobalIdx(a))}
              fullWidth={images.length === 1}
            />
          ))}
        </div>
      )}

      {audios.map((a) => (
        <VoiceMessage key={a.url} url={a.url} duration={a.duration} />
      ))}

      {others.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {others.map((a) => (
            <li key={a.url}>
              <a
                href={resolveApiUrl(a.url)}
                target="_blank"
                rel="noopener noreferrer"
                download={a.name}
                className="flex items-center gap-3 px-3 py-2 rounded-xl border border-(--border) bg-(--raised)/60 hover:border-(--accent) hover:bg-(--raised) transition-colors"
              >
                <div className="size-9 shrink-0 rounded-lg border border-(--border) bg-(--base) flex items-center justify-center">
                  <FileIcon className="size-4 text-(--text-3)" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-(--text-1) m-0 truncate" style={{ fontFamily: 'var(--font-display)' }}>{a.name}</p>
                  <p className="text-[11px] font-mono text-(--text-3) m-0">{a.type} · {fmtBytes(a.size)}</p>
                </div>
                <Download className="size-4 text-(--text-3) shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
