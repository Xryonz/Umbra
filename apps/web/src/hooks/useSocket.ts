import { useEffect, useRef } from 'react'
import { getSocket, trackJoin, trackLeave } from '@/lib/socket'
import type { MessageWithAuthor } from '@astra/types'
import { probeEnd } from '@/lib/latencyProbe'

interface ChannelHandlers {
  onNewMessage:  (msg: MessageWithAuthor) => void
  onMessageEdited?:  (p: { messageId: string; content: string; channelId: string; edited: boolean }) => void
  onMessageDeleted?: (p: { messageId: string; channelId: string }) => void
  onMessagePinned?:  (p: { messageId: string; channelId: string; pinned: boolean }) => void
  onReactionUpdate?: (p: { messageId: string; channelId: string; reactions: Array<{ emoji: string; count: number; users: string[] }> }) => void
  onPollUpdated?:    (p: { messageId: string; channelId: string; poll: unknown }) => void
}

// Backwards-compat: aceita callback simples ou objeto com handlers
export function useChannel(
  channelId: string | null,
  handlersOrOnNew: ChannelHandlers | ((msg: MessageWithAuthor) => void),
) {
  const handlers: ChannelHandlers =
    typeof handlersOrOnNew === 'function'
      ? { onNewMessage: handlersOrOnNew }
      : handlersOrOnNew

  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (!channelId) return

    let socket: ReturnType<typeof getSocket>
    try { socket = getSocket() } catch { return }

    trackJoin(channelId)
    socket.emit('join_channel', channelId)

    const onNew  = (msg: MessageWithAuthor & { clientNonce?: string }) => {
      // Mede round-trip se a msg é eco da minha própria (tem clientNonce que enviei).
      probeEnd(msg.clientNonce)
      ref.current.onNewMessage(msg)
    }
    const onEdit = (p: any) => ref.current.onMessageEdited?.(p)
    const onDel  = (p: any) => ref.current.onMessageDeleted?.(p)
    const onPin  = (p: any) => ref.current.onMessagePinned?.(p)
    const onReact = (p: any) => ref.current.onReactionUpdate?.(p)
    const onPoll  = (p: any) => ref.current.onPollUpdated?.(p)

    socket.on('new_message',      onNew)
    socket.on('message_edited',   onEdit)
    socket.on('message_deleted',  onDel)
    socket.on('message_pinned',   onPin)
    socket.on('reaction_update',  onReact)
    socket.on('poll_updated',     onPoll)

    return () => {
      trackLeave(channelId)
      socket.emit('leave_channel', channelId)
      socket.off('new_message',      onNew)
      socket.off('message_edited',   onEdit)
      socket.off('message_deleted',  onDel)
      socket.off('message_pinned',   onPin)
      socket.off('reaction_update',  onReact)
      socket.off('poll_updated',     onPoll)
    }
  }, [channelId])
}

export function useTyping(channelId: string | null) {
  return useTypingFor('channel', channelId)
}

export function useDMTyping(conversationId: string | null) {
  return useTypingFor('dm', conversationId)
}

function useTypingFor(scope: 'channel' | 'dm', id: string | null) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Throttle: emite no máx 1x por 1.5s. Sem isso, cada keystroke dispara
  // socket emit → backpressure e CPU desperdiçada server-side.
  const lastEmitRef = useRef<number>(0)
  const startEv = scope === 'channel' ? 'typing_start' : 'dm_typing_start'
  const stopEv  = scope === 'channel' ? 'typing_stop'  : 'dm_typing_stop'

  const startTyping = () => {
    if (!id) return
    try {
      const socket = getSocket()
      const now = Date.now()
      if (now - lastEmitRef.current >= 1500) {
        socket.emit(startEv, id)
        lastEmitRef.current = now
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit(stopEv, id)
        lastEmitRef.current = 0
      }, 3000)
    } catch {/* socket não conectado */}
  }

  const stopTyping = () => {
    if (!id) return
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    lastEmitRef.current = 0
    try { getSocket().emit(stopEv, id) } catch {/* socket não conectado */}
  }

  return { startTyping, stopTyping }
}
