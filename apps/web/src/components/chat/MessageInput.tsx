import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, VolumeX, X, CornerDownRight, Paperclip, File as FileIcon, Mic, Square, Play } from 'lucide-react'
import { motion } from 'motion/react'
import { api, resolveApiUrl } from '@/lib/api'
import { getSocket, fastSendText } from '@/lib/socket'
import { useTyping } from '@/hooks/useSocket'
import { applySlashCommand } from '@/lib/slashCommands'
import { parseReminderCommand } from '@/lib/reminderCommand'
import { useAuthStore } from '@/store/authStore'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { toast } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import type { MessageWithAuthor, Attachment } from '@astra/types'

// Lazy: pickers pesados (emoji-mart ~300KB, giphy w/ network) só carregam ao abrir
const GifPicker       = lazy(() => import('@/components/chat/GifPicker'))
const FullEmojiPicker = lazy(() => import('@/components/chat/FullEmojiPicker'))
const PollComposer    = lazy(() => import('@/components/chat/PollComposer'))
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { probeStart } from '@/lib/latencyProbe'
import { RecordingDisplay } from '@/components/chat/RecordingDisplay'
import { ComposerActionsMenu } from '@/components/chat/ComposerActionsMenu'

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

let optimisticCounter = 0
const nextOptimisticId = () => `opt-${++optimisticCounter}`

interface MemberSuggestion { id: string; username: string; displayName: string; avatarUrl?: string | null }

interface MessageInputProps {
  channelId:           string
  channelName:         string
  serverId:            string
  replyingTo?:         MessageWithAuthor | null
  onCancelReply?:      () => void
  onOptimisticMessage: (msg: OptimisticMessage) => void
  onOptimisticFailed:  (id: string) => void
}

export default function MessageInput({
  channelId, channelName, serverId,
  replyingTo, onCancelReply,
  onOptimisticMessage, onOptimisticFailed,
}: MessageInputProps) {
  const user    = useAuthStore((s) => s.user)
  const [content,     setContent]     = useState('')
  const [muted,       setMuted]       = useState(false)
  const [muteSeconds, setMuteSeconds] = useState(0)
  const [mentionQuery,    setMentionQuery]    = useState<string | null>(null)
  const [mentionAnchor,   setMentionAnchor]   = useState(0)
  const [mentionSelected, setMentionSelected] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading,   setUploading]   = useState(false)
  const [dragOver,    setDragOver]    = useState(false)
  const [uploadErr,   setUploadErr]   = useState<string | null>(null)
  const [gifOpen,     setGifOpen]     = useState(false)
  const [emojiOpen,   setEmojiOpen]   = useState(false)
  const [pollOpen,    setPollOpen]    = useState(false)
  // ttlSeconds: 0 = sem TTL (permanente). Opções comuns: 1h, 6h, 24h, 7d
  const [ttlSeconds,  setTtlSeconds]  = useState<number>(0)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)
  const { startTyping, stopTyping } = useTyping(channelId)

  // ─── Audio recorder ──────────────────────────────────────────
  // Estado mora aqui (sobe da UI antiga). Send arrow finaliza, Square
  // pausa/retoma, X cancela. Bug do botão de áudio "não funcionar"
  // era UX: tinha 2 ações (square=enviar, X=cancelar) dentro do
  // recorder, e a seta principal não atuava no áudio. Agora a seta é
  // a única ação de "enviar" — texto OU áudio, conforme estado.
  const recorder = useAudioRecorder(async (att) => {
    const optimisticId = nextOptimisticId()
    const optimisticMsg: OptimisticMessage = {
      id: optimisticId, content: '', edited: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      optimisticId, isPending: true,
      author: { id: user!.id, username: user!.username, displayName: user!.displayName, avatarUrl: user!.avatarUrl ?? null },
      attachments: [att],
      replyTo: null,
    } as any
    onOptimisticMessage(optimisticMsg)
    probeStart(optimisticId)
    try {
      await api.post(`/api/channels/${channelId}/messages`, {
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

  const { data: members = [] } = useQuery<MemberSuggestion[]>({
    queryKey: ['members-typeahead', serverId],
    queryFn: async () => {
      const res = await api.get(`/api/servers/${serverId}/members`)
      return res.data.data.map((m: any) => ({
        id:          m.user.id,
        username:    m.user.username,
        displayName: m.user.displayName,
        avatarUrl:   m.user.avatarUrl,
      }))
    },
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const suggestions = mentionQuery !== null
    ? members.filter(
        (m) =>
          m.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          m.displayName.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 5)
    : []

  useEffect(() => {
    if (!muted || muteSeconds <= 0) return
    const t = setInterval(() => {
      setMuteSeconds((s) => { if (s <= 1) { setMuted(false); return 0 } return s - 1 })
    }, 1000)
    return () => clearInterval(t)
  }, [muted, muteSeconds])

  useEffect(() => {
    let socket: ReturnType<typeof getSocket>
    try { socket = getSocket() } catch { return }

    const onBlocked = (p: { channelId: string; secondsLeft: number; optimisticId?: string }) => {
      if (p.channelId !== channelId) return
      setMuted(true)
      setMuteSeconds(p.secondsLeft)
      if (p.optimisticId) onOptimisticFailed(p.optimisticId)
    }

    socket.on('message_blocked', onBlocked)
    return () => { socket.off('message_blocked', onBlocked) }
  }, [channelId, onOptimisticFailed])

  const detectMention = (value: string, cursorPos: number) => {
    const textBeforeCursor = value.slice(0, cursorPos)
    const match = textBeforeCursor.match(/@([a-z0-9_]*)$/i)
    if (match) {
      setMentionQuery(match[1])
      setMentionAnchor(cursorPos - match[0].length)
      setMentionSelected(0)
    } else {
      setMentionQuery(null)
    }
  }

  const insertMention = (member: MemberSuggestion) => {
    const textarea = inputRef.current
    if (!textarea) return
    const before = content.slice(0, mentionAnchor)
    const after  = content.slice(textarea.selectionStart)
    const newContent = `${before}@${member.username} ${after}`
    setContent(newContent)
    setMentionQuery(null)

    requestAnimationFrame(() => {
      const pos = mentionAnchor + member.username.length + 2
      textarea.setSelectionRange(pos, pos)
      textarea.focus()
    })
  }

  const send = useCallback(async () => {
    let trimmed = content.trim()
    const hasAttachments = attachments.length > 0
    if ((!trimmed && !hasAttachments) || muted || !user) return

    if (trimmed.toLowerCase().startsWith('/astra') || trimmed.toLowerCase().startsWith('/umbra')) {
      setContent('')
      stopTyping()
      try { getSocket().emit('bot_command', { channelId, serverId, content: trimmed }) } catch {}
      return
    }

    // /lembre <texto> em <duração> — POST API, não envia msg (gera reminder)
    const rem = parseReminderCommand(trimmed)
    if (rem) {
      setContent('')
      stopTyping()
      try {
        await api.post('/api/reminders', { content: rem.content, durationMs: rem.durationMs, channelId })
        toast.success(`Lembrete agendado: "${rem.content}"`)
      } catch (e: any) {
        console.error('[lembre]', e?.response?.data ?? e?.message)
        toast.error(e?.response?.data?.error ?? 'Falha ao criar lembrete')
      }
      return
    }

    // Slash commands client-side (/me /shrug /tableflip /flip /unflip /spoiler)
    const transformed = applySlashCommand(trimmed)
    if (transformed !== null) {
      if (!transformed) {
        // Command vazio sem args (ex: "/me" sem texto) — não envia
        setContent('')
        stopTyping()
        return
      }
      trimmed = transformed
    }

    const attachmentsToSend = attachments
    setContent('')
    setAttachments([])
    setMentionQuery(null)
    stopTyping()
    inputRef.current?.focus()

    const optimisticId = nextOptimisticId()
    const replyToSnapshot = replyingTo
      ? {
          id:           replyingTo.id,
          content:      replyingTo.content.slice(0, 160),
          authorName:   replyingTo.author.displayName,
          authorAvatar: replyingTo.author.avatarUrl ?? null,
        }
      : null

    const optimisticMsg: OptimisticMessage = {
      id: optimisticId, content: trimmed, edited: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      optimisticId, isPending: true,
      author: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl ?? null },
      attachments: attachmentsToSend,
      replyTo: replyToSnapshot,
    } as any
    onOptimisticMessage(optimisticMsg)
    onCancelReply?.()
    probeStart(optimisticId)

    // FAST PATH: texto puro, sem anexos/reply/TTL → socket direto
    // (poupa ~30-50ms do handshake HTTP). Casos complexos caem no POST.
    const canFastSend =
      attachmentsToSend.length === 0 &&
      !replyToSnapshot &&
      (!ttlSeconds || ttlSeconds <= 0)

    if (canFastSend) {
      const r = await fastSendText(channelId, trimmed, optimisticId)
      if (r.ok) return
      // Fast path falhou (timeout/disconnect/erro) → cai pro HTTP abaixo.
      // Mantém optimistic visível; HTTP completa ou marca como failed.
    }

    try {
      await api.post(`/api/channels/${channelId}/messages`, {
        content:     trimmed,
        replyToId:   replyToSnapshot?.id,
        attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
        clientNonce: optimisticId,
        ttlSeconds:  ttlSeconds > 0 ? ttlSeconds : undefined,
      })
    } catch (err: any) {
      if (err?.response?.status !== 403) {
        onOptimisticFailed(optimisticId)
        setContent(trimmed)
        setAttachments(attachmentsToSend)
      }
    }
  }, [content, attachments, muted, user, channelId, serverId, replyingTo, ttlSeconds, onCancelReply, onOptimisticMessage, onOptimisticFailed, stopTyping])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelected((i) => Math.min(i + 1, suggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionSelected((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0)) {
        e.preventDefault()
        insertMention(suggestions[mentionSelected])
        return
      }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    detectMention(val, e.target.selectionStart)
    val.length > 0 ? startTyping() : stopTyping()
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`
  }

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !muted && !uploading
  const mins    = Math.ceil(muteSeconds / 60)

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

  return (
    <div
      className="px-4 sm:px-6 pt-3 pb-safe shrink-0 relative bg-(--void)"
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

      {/* Hidden file input */}
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
                <img
                  src={resolveApiUrl(a.url)}
                  alt={a.name}
                  className="size-10 object-cover border border-(--border)"
                />
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

      {/* GIF picker — popover acima do input (só monta quando aberto) */}
      {gifOpen && (
        <Suspense fallback={null}>
          <GifPicker
            open={gifOpen}
            onClose={() => setGifOpen(false)}
            onPick={(att) => setAttachments((prev) => [...prev, att])}
          />
        </Suspense>
      )}

      {/* Poll composer — dialog */}
      {pollOpen && (
        <Suspense fallback={null}>
          <PollComposer
            open={pollOpen}
            onClose={() => setPollOpen(false)}
            channelId={channelId}
          />
        </Suspense>
      )}

      {/* Emoji picker — popover acima do composer (só monta quando aberto) */}
      {emojiOpen && (
        <div className="absolute bottom-16 left-6 z-40">
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

      {/* Mention autocomplete — editorial popover */}
      {mentionQuery !== null && suggestions.length > 0 && (
        <div className="absolute bottom-full left-6 right-6 mb-2 z-50 bg-(--overlay) border border-(--border-mid) p-2 shadow-2xl">
          <div className="flex items-center gap-2 mb-2 px-2">
            <span className="ed-marg">— Membros</span>
            <div className="flex-1 h-px bg-(--border)" />
          </div>
          {suggestions.map((m, i) => (
            <button
              key={m.id}
              onClick={() => insertMention(m)}
              onMouseEnter={() => setMentionSelected(i)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 border-none cursor-pointer text-left transition-[color,background-color,border-color] duration-150',
                i === mentionSelected
                  ? 'bg-(--accent-dim) border-l-2 border-(--accent)'
                  : 'bg-transparent border-l-2 border-transparent'
              )}
            >
              <Avatar className="size-7 border border-(--border)">
                {m.avatarUrl && <AvatarImage src={m.avatarUrl} />}
                <AvatarFallback className="text-[11px] font-(family-name:--font-display)">
                  {m.displayName.slice(0,1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-tight">
                <span className={cn(
                  'text-sm font-normal font-(family-name:--font-display)',
                  i === mentionSelected ? 'text-(--accent)' : 'text-foreground'
                )}>
                  {m.displayName}
                </span>
                <span className="font-mono text-[10px] text-(--text-3) tracking-wide">@{m.username}</span>
              </div>
            </button>
          ))}
          <p className="ed-marg px-2 pt-2 mt-1 border-t border-(--border)">
            Tab/Enter selecionar · Esc fechar
          </p>
        </div>
      )}

      {/* Mute banner — editorial */}
      {muted && (
        <div className="flex items-start gap-3 mb-3 px-4 py-3 border border-(--danger)/40 bg-(--danger)/5">
          <VolumeX className="size-4 text-(--danger) shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="ed-marg text-(--danger)!">Silenciado por spam</span>
            <p className="text-sm text-(--text-2) m-0">
              Aguarde {muteSeconds > 60 ? `${mins} min` : `${muteSeconds}s`} para voltar a escrever.
            </p>
          </div>
        </div>
      )}

      {/* Reply banner */}
      {replyingTo && (
        <div className="flex items-center gap-3 mb-2 px-3 py-2 border border-(--border-mid) bg-(--raised)/50 anim-fade-up">
          <CornerDownRight className="size-3.5 text-(--accent) shrink-0" />
          <span className="ed-marg shrink-0">Respondendo a</span>
          <span
            className="text-sm shrink-0"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}
          >
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

      {/* Composer row — pill input com radius suave.
          Mobile: 48px de altura mínima (norma de toque Material/WhatsApp)
          e foco indicado só pela borda — ring extra ficava poluído na tela
          pequena. Desktop mantém o ring suave. */}
      <div
        className={cn(
          'flex items-center gap-0.5 sm:gap-1.5 min-h-12 sm:min-h-10 px-1.5 sm:px-2 py-1 rounded-xl border border-(--border-mid) bg-(--raised)/40',
          'focus-within:border-(--accent) focus-within:bg-(--raised)/60 sm:focus-within:ring-2 sm:focus-within:ring-(--accent)/15',
          'transition-[border-color,background-color,box-shadow] duration-200',
          muted && 'opacity-50',
        )}
      >
        {/* Attach */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={muted || uploading || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Anexar arquivo"
          title="Anexar arquivo"
          className={cn(
            // hidden sm:flex — no mobile o anexo vive dentro do "+" (extras),
            // Discord-style: menos botões disputando largura com o textarea.
            'shrink-0 size-8 hidden sm:flex items-center justify-center cursor-pointer transition-colors duration-200',
            muted || uploading || attachments.length >= MAX_ATTACHMENTS
              ? 'text-(--text-3) opacity-50 cursor-default'
              : 'text-(--text-3) hover:text-(--accent)',
          )}
        >
          <Paperclip className="size-4" />
        </button>

        {/* Menu de extras: Anexo (mobile) / GIF / Emoji / Enquete / Efêmera */}
        <ComposerActionsMenu
          disabled={muted}
          ttlSeconds={ttlSeconds}
          onGif={() => setGifOpen(true)}
          onEmoji={() => setEmojiOpen(true)}
          onPoll={() => setPollOpen(true)}
          onTtlChange={(s) => setTtlSeconds(s)}
          onAttach={() => fileRef.current?.click()}
          attachDisabled={muted || uploading || attachments.length >= MAX_ATTACHMENTS}
        />

        {/* Mic trigger — só visível quando idle. Recording UI assume a row. */}
        {recorder.state === 'idle' && (
          <button
            type="button"
            onClick={() => recorder.start()}
            disabled={muted}
            aria-label="Gravar áudio"
            title="Gravar áudio"
            className={cn(
              'shrink-0 size-11 sm:size-9 grid place-items-center cursor-pointer transition-colors',
              muted ? 'text-(--text-3) opacity-50 cursor-default' : 'text-(--text-3) hover:text-(--accent)',
            )}
          >
            <Mic className="size-4" />
          </button>
        )}

        {/* TTL indicator chip — clicável só pra status visual */}
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

        {/* Vertical hairline separator */}
        <span className="h-5 w-px bg-(--border) shrink-0" aria-hidden />

        {/* Center: textarea OU UI de gravação (bars + timer) */}
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
            disabled={muted}
            placeholder={muted ? 'Silenciado…' : attachments.length > 0 ? 'Mensagem opcional…' : `Mensagem em #${channelName}`}
            rows={1}
            className="
              flex-1 bg-transparent text-foreground text-base sm:text-sm leading-6 sm:leading-5
              border-0 outline-none resize-none max-h-32 px-1 py-1
              placeholder:text-(--text-3) placeholder:font-normal
              font-(family-name:--font-body)
            "
          />
        )}

        {/* Durante gravação: Cancel + Pause/Resume ao lado da seta */}
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

        {/* Send — única ação de "enviar" (texto OU áudio).
            Durante gravação, manda recorder.finalize() (stop + upload). */}
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

