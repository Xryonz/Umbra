/**
 * DMInput — composer rico pra DMs.
 *
 * Features: anexos (drag/paste/click), GIF, emoji, voz, mensagem efêmera,
 * reply, drag-and-drop. Sem mentions/poll/bot (não fazem sentido em DM 1:1).
 *
 * Layout: shadcn-style hairline border, focus accent.
 */
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import { ArrowRight, X, CornerDownRight, Paperclip, File as FileIcon, Mic, Square, Play } from 'lucide-react'
import { motion } from 'motion/react'
import { api, resolveApiUrl } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import type { MessageWithAuthor, Attachment } from '@astra/types'
import { ComposerActionsMenu } from '@/components/chat/ComposerActionsMenu'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { RecordingDisplay } from '@/components/chat/RecordingDisplay'
import { useDMTyping } from '@/hooks/useSocket'

const GifPicker       = lazy(() => import('@/components/chat/GifPicker'))
const FullEmojiPicker = lazy(() => import('@/components/chat/FullEmojiPicker'))

const MAX_ATTACHMENTS = 10
const MAX_FILE_SIZE   = 25 * 1024 * 1024
function fmtSize(b: number) { return b < 1024 ? `${b}B` : b < 1024*1024 ? `${(b/1024).toFixed(0)}KB` : `${(b/1024/1024).toFixed(1)}MB` }
function formatTtl(secs: number) {
  if (secs >= 86400) return `${Math.round(secs / 86400)}d`
  if (secs >= 3600)  return `${Math.round(secs / 3600)}h`
  if (secs >= 60)    return `${Math.round(secs / 60)}min`
  return `${secs}s`
}
function isImage(a: { type?: string; name?: string; url?: string }) {
  if (a.type?.startsWith('image/')) return true
  const target = a.url || a.name || ''
  return /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)(\?|#|$)/i.test(target)
}

type OptimisticMessage = MessageWithAuthor & { optimisticId?: string; isPending?: boolean }
let counter = 0
const nextId = () => `dm-opt-${++counter}`

interface OtherUser {
  id: string; username: string; displayName: string; avatarUrl: string | null
}

interface DMInputProps {
  conversationId:      string
  otherUser:           OtherUser
  replyingTo?:         MessageWithAuthor | null
  onCancelReply?:      () => void
  onOptimisticMessage: (msg: OptimisticMessage) => void
  onOptimisticFailed:  (id: string) => void
}

export default function DMInput({
  conversationId, otherUser, replyingTo, onCancelReply,
  onOptimisticMessage, onOptimisticFailed,
}: DMInputProps) {
  const user = useAuthStore((s) => s.user)
  const { startTyping, stopTyping } = useDMTyping(conversationId)
  const [content,     setContent]     = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading,   setUploading]   = useState(false)
  const [dragOver,    setDragOver]    = useState(false)
  const [uploadErr,   setUploadErr]   = useState<string | null>(null)
  const [gifOpen,     setGifOpen]     = useState(false)
  const [emojiOpen,   setEmojiOpen]   = useState(false)
  const [ttlSeconds,  setTtlSeconds]  = useState<number>(0)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  // ─── Audio recorder (mesmo padrão do MessageInput) ───────────
  const recorder = useAudioRecorder(async (att) => {
    const optimisticId = nextId()
    const optimisticMsg: OptimisticMessage = {
      id: optimisticId, content: '', edited: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      optimisticId, isPending: true,
      author: { id: user!.id, username: user!.username, displayName: user!.displayName, avatarUrl: user!.avatarUrl ?? null },
      attachments: [att],
      replyTo: null,
    } as any
    onOptimisticMessage(optimisticMsg)
    try {
      await api.post(`/api/dm/${conversationId}/messages`, {
        content: '', attachments: [att], clientNonce: optimisticId,
      })
    } catch {
      onOptimisticFailed(optimisticId)
    }
  })

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploadErr(null)
    const arr = Array.from(files)
    if (arr.length === 0) return
    if (attachments.length + arr.length > MAX_ATTACHMENTS) {
      setUploadErr(`Máximo ${MAX_ATTACHMENTS} anexos por mensagem`)
      return
    }
    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) { setUploadErr(`${f.name} maior que 25MB`); return }
    }
    setUploading(true)
    try {
      const fd = new FormData()
      arr.forEach((f) => fd.append('files', f, f.name))
      const res = await api.post('/api/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const newAtt = res.data?.data?.attachments as Attachment[] | undefined
      if (newAtt) setAttachments((prev) => [...prev, ...newAtt])
    } catch (err: any) {
      setUploadErr(err?.response?.data?.error ?? 'Falha no upload')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [attachments.length])

  const removeAttachment = (idx: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx))

  const send = useCallback(async () => {
    const trimmed = content.trim()
    const hasAtt  = attachments.length > 0
    if ((!trimmed && !hasAtt) || !user) return

    const attachmentsToSend = attachments
    const replyToSnapshot = replyingTo ? {
      id:           replyingTo.id,
      content:      replyingTo.content.slice(0, 160),
      authorName:   replyingTo.author.displayName,
      authorAvatar: replyingTo.author.avatarUrl ?? null,
    } : null

    setContent('')
    stopTyping()
    setAttachments([])
    inputRef.current?.focus()

    const optimisticId = nextId()
    const optimisticMsg: OptimisticMessage = {
      id:          optimisticId,
      content:     trimmed,
      edited:      false,
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      optimisticId,
      isPending:   true,
      author: {
        id:          user.id,
        username:    user.username,
        displayName: user.displayName,
        avatarUrl:   user.avatarUrl ?? null,
      },
      attachments: attachmentsToSend,
      replyTo:     replyToSnapshot,
    } as any
    onOptimisticMessage(optimisticMsg)
    onCancelReply?.()

    try {
      await api.post(`/api/dm/${conversationId}/messages`, {
        content:     trimmed,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        replyToId:   replyToSnapshot?.id,
        ttlSeconds:  ttlSeconds > 0 ? ttlSeconds : undefined,
        clientNonce: optimisticId,
      })
    } catch {
      onOptimisticFailed(optimisticId)
      setContent(trimmed)
      setAttachments(attachmentsToSend)
    }
  }, [content, attachments, user, conversationId, replyingTo, onCancelReply, onOptimisticMessage, onOptimisticFailed, ttlSeconds])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape' && replyingTo) { onCancelReply?.() }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`
    if (e.target.value.length > 0) startTyping()
    else stopTyping()
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f) }
    }
    if (files.length > 0) { e.preventDefault(); handleFiles(files) }
  }

  // Foco auto quando inicia reply
  useEffect(() => {
    if (replyingTo) inputRef.current?.focus()
  }, [replyingTo?.id])

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !uploading

  return (
    <div
      className="px-3 sm:px-6 pt-2 pb-safe shrink-0 relative bg-(--void)"
      onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false)
        if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
      }}
    >
      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-(--accent-dim)/90 border-2 border-dashed border-(--accent) pointer-events-none">
          <div className="text-center">
            <Paperclip className="size-8 mx-auto mb-2 text-(--accent)" />
            <p className="text-(--accent) m-0 font-(family-name:--font-display) text-lg">Solte para anexar</p>
            <p className="ed-marg mt-1">até 25MB · 10 arquivos</p>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files) }}
      />

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((a, i) => (
            <div key={`${a.url}-${i}`} className="relative group border border-(--border) bg-(--raised)/60 flex items-center gap-2 pl-2 pr-7 py-1.5">
              {isImage(a) ? (
                <img src={resolveApiUrl(a.url)} alt={a.name} className="size-10 object-cover border border-(--border)" />
              ) : (
                <div className="size-10 border border-(--border) bg-(--base) flex items-center justify-center">
                  <FileIcon className="size-4 text-(--text-3)" />
                </div>
              )}
              <div className="flex flex-col leading-tight">
                <span className="text-xs text-(--text-2) truncate max-w-40">{a.name}</span>
                <span className="text-[10px] font-mono text-(--text-3)">{fmtSize(a.size)}</span>
              </div>
              <button
                onClick={() => removeAttachment(i)}
                className="absolute top-1 right-1 size-5 flex items-center justify-center text-(--text-3) hover:text-(--danger) transition-colors cursor-pointer"
                aria-label="Remover anexo"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="flex items-center gap-2 border border-(--border) bg-(--raised)/60 px-3 py-1.5">
              <div className="size-3 border border-(--border-mid) border-t-(--accent) rounded-full animate-spin" />
              <span className="text-xs text-(--text-3)">Enviando…</span>
            </div>
          )}
        </div>
      )}

      {uploadErr && (
        <p className="text-xs text-(--danger) mb-2 px-1 flex items-center gap-2">
          <X className="size-3" /> {uploadErr}
        </p>
      )}

      {/* GIF picker */}
      {gifOpen && (
        <Suspense fallback={null}>
          <GifPicker
            open={gifOpen}
            onClose={() => setGifOpen(false)}
            onPick={(att) => setAttachments((prev) => [...prev, att])}
          />
        </Suspense>
      )}

      {/* Emoji picker — popover acima do composer */}
      {emojiOpen && (
        <div className="absolute bottom-16 left-4 z-40">
          <Suspense fallback={null}>
            <FullEmojiPicker
              onPick={(emoji) => {
                setContent((c) => c + emoji)
                inputRef.current?.focus()
              }}
              onClose={() => setEmojiOpen(false)}
            />
          </Suspense>
        </div>
      )}

      {/* Reply banner */}
      {replyingTo && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 border border-(--border-mid) bg-(--raised)/50 anim-fade-up">
          <CornerDownRight className="size-3.5 text-(--accent) shrink-0" />
          <span className="ed-marg shrink-0">Respondendo a</span>
          <span className="text-sm shrink-0" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
            {replyingTo.author.displayName}
          </span>
          <span className="text-sm text-(--text-3) italic truncate flex-1">
            {replyingTo.content.slice(0, 80)}
          </span>
          <button
            onClick={onCancelReply}
            className="size-6 flex items-center justify-center text-(--text-3) hover:text-(--danger) transition-colors cursor-pointer shrink-0"
            aria-label="Cancelar reply"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Composer row — pill input com radius suave */}
      <div className={cn(
        'flex items-center gap-0.5 sm:gap-1.5 min-h-12 sm:min-h-10 px-1.5 sm:px-2 py-1 rounded-xl border border-(--border-mid) bg-(--raised)/40',
        'focus-within:border-(--accent) focus-within:bg-(--raised)/60 sm:focus-within:ring-2 sm:focus-within:ring-(--accent)/15',
        'transition-[border-color,background-color,box-shadow] duration-200',
      )}>
        {/* Attach — desktop only; no mobile vive dentro do "+" (extras) */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Anexar arquivo"
          title="Anexar arquivo"
          className={cn(
            'shrink-0 size-8 hidden sm:flex items-center justify-center cursor-pointer transition-colors duration-200',
            uploading || attachments.length >= MAX_ATTACHMENTS
              ? 'text-(--text-3) opacity-50 cursor-default'
              : 'text-(--text-3) hover:text-(--accent)',
          )}
        >
          <Paperclip className="size-4" />
        </button>

        {/* Menu de extras (sem poll em DM) */}
        <ComposerActionsMenu
          ttlSeconds={ttlSeconds}
          onGif={() => setGifOpen(true)}
          onEmoji={() => setEmojiOpen(true)}
          onPoll={() => { /* não-op em DM — passamos handler vazio */ }}
          onTtlChange={(s) => setTtlSeconds(s)}
          hidePoll
          onAttach={() => fileRef.current?.click()}
          attachDisabled={uploading || attachments.length >= MAX_ATTACHMENTS}
        />

        {/* Mic trigger — só visível idle. Recording UI assume a row. */}
        {recorder.state === 'idle' && (
          <button
            type="button"
            onClick={() => recorder.start()}
            aria-label="Gravar áudio"
            title="Gravar áudio"
            className="shrink-0 size-11 sm:size-9 grid place-items-center cursor-pointer text-(--text-3) hover:text-(--accent) transition-colors"
          >
            <Mic className="size-4" />
          </button>
        )}

        {/* TTL indicator chip */}
        {ttlSeconds > 0 && (
          <button
            onClick={() => setTtlSeconds(0)}
            title={`Some em ${formatTtl(ttlSeconds)} · clique pra desativar`}
            className="shrink-0 h-6 px-1.5 flex items-center gap-1 border border-(--accent)/40 bg-(--accent)/5 text-(--accent) text-[10px] font-mono cursor-pointer hover:bg-(--accent)/10 transition-colors"
          >
            {formatTtl(ttlSeconds)}
            <X className="size-2.5" />
          </button>
        )}

        <span className="h-5 w-px bg-(--border) shrink-0" aria-hidden />

        {recorder.isActive ? (
          <RecordingDisplay
            state={recorder.state}
            bars={recorder.bars}
            elapsedMs={recorder.elapsed}
            error={recorder.error}
          />
        ) : (
          <textarea
            ref={inputRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachments.length > 0 ? 'Mensagem opcional…' : `Mensagem para ${otherUser.displayName}`}
            rows={1}
            className="
              flex-1 bg-transparent text-foreground text-base sm:text-sm leading-6 sm:leading-5
              border-0 outline-none resize-none max-h-32 px-1 py-1
              placeholder:text-(--text-3) placeholder:font-normal
              font-(family-name:--font-body)
            "
          />
        )}

        {/* Cancel + Pause/Resume ao lado da seta durante gravação */}
        {recorder.isActive && recorder.state !== 'uploading' && (
          <>
            <button
              type="button"
              onClick={() => recorder.cancel()}
              aria-label="Cancelar gravação"
              title="Cancelar"
              className="shrink-0 size-11 sm:size-9 grid place-items-center text-(--text-3) hover:text-(--danger) transition-colors cursor-pointer"
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => recorder.state === 'paused' ? recorder.resume() : recorder.pause()}
              aria-label={recorder.state === 'paused' ? 'Retomar gravação' : 'Pausar gravação'}
              title={recorder.state === 'paused' ? 'Retomar' : 'Pausar'}
              className="shrink-0 size-11 sm:size-9 grid place-items-center text-(--accent) hover:opacity-80 transition-opacity cursor-pointer"
            >
              {recorder.state === 'paused' ? <Play className="size-4" /> : <Square className="size-4" fill="currentColor" />}
            </button>
          </>
        )}

        <motion.button
          onClick={() => {
            if (recorder.isActive && recorder.state !== 'uploading') {
              recorder.finalize()
            } else {
              send()
            }
          }}
          disabled={recorder.state === 'uploading' ? true : (!recorder.isActive && !canSend)}
          aria-label="Enviar"
          title="Enviar (Enter)"
          whileTap={(canSend || recorder.isActive) ? { scale: 0.85, rotate: -8 } : undefined}
          whileHover={(canSend || recorder.isActive) ? { scale: 1.08 } : undefined}
          transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          className={cn(
            'shrink-0 size-11 sm:size-8 rounded-full flex items-center justify-center transition-[background-color,box-shadow] duration-200',
            (canSend || (recorder.isActive && recorder.state !== 'uploading'))
              ? 'bg-(--accent) text-(--text-inv) hover:shadow-[0_4px_16px_var(--accent-glow)] cursor-pointer'
              : 'bg-(--raised) text-(--text-3) cursor-default',
          )}
        >
          <ArrowRight className="size-4 sm:size-3.5" strokeWidth={2} />
        </motion.button>
      </div>
    </div>
  )
}
