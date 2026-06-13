/**
 * MessageToolbar — toolbar de hover sobre a mensagem.
 *
 * Botões: reagir, responder, traduzir, criar thread, salvar/bookmark,
 * fixar/pin, editar (mine), apagar (mine, danger).
 *
 * Extraído de MessageItem (overhaul Fase 4d).
 */
import {
  Smile, Reply, Languages, MessageSquarePlus, Bookmark, BookmarkCheck,
  Pin, PinOff, Pencil, Trash2,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface Props {
  isMine:            boolean
  isPinned:          boolean
  isBookmarked?:     boolean
  onPickEmoji:       () => void
  onReply?:          () => void
  onCreateThread?:   () => void
  onEdit?:           () => void
  onDelete?:         () => void
  onTogglePin?:      () => void
  onToggleBookmark?: () => void
  onTranslate?:      () => void
}

export function MessageToolbar({
  isMine, isPinned, isBookmarked, onPickEmoji, onReply, onCreateThread,
  onEdit, onDelete, onTogglePin, onToggleBookmark, onTranslate,
}: Props) {
  return (
    <div className="absolute -top-3 right-3 z-10 flex gap-0 px-0 py-0 bg-(--overlay) border border-(--border-mid) shadow-3 animate-in fade-in-0 zoom-in-95 duration-150">
      <ToolBtn title="Reagir" onClick={onPickEmoji}><Smile className="size-4" /></ToolBtn>
      {onReply && <ToolBtn title="Responder" onClick={onReply}><Reply className="size-3.5" /></ToolBtn>}
      {onTranslate && <ToolBtn title="Traduzir" onClick={onTranslate}><Languages className="size-3.5" /></ToolBtn>}
      {onCreateThread && (
        <ToolBtn title="Soltar cometa (thread)" onClick={onCreateThread}><MessageSquarePlus className="size-3.5" /></ToolBtn>
      )}
      {onToggleBookmark && (
        <ToolBtn title={isBookmarked ? 'Remover dos salvos' : 'Salvar'} onClick={onToggleBookmark}>
          {isBookmarked ? <BookmarkCheck className="size-3.5 text-(--accent)" /> : <Bookmark className="size-3.5" />}
        </ToolBtn>
      )}
      {onTogglePin && (
        <ToolBtn title={isPinned ? 'Desafixar' : 'Fixar'} onClick={onTogglePin}>
          {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </ToolBtn>
      )}
      {isMine && onEdit   && <ToolBtn title="Editar"  onClick={onEdit}><Pencil className="size-3.5" /></ToolBtn>}
      {isMine && onDelete && <ToolBtn title="Apagar"  onClick={onDelete} danger><Trash2 className="size-3.5" /></ToolBtn>}
    </div>
  )
}

function ToolBtn({ title, onClick, danger, children }: {
  title:    string
  onClick:  () => void
  danger?:  boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={(e) => { e.stopPropagation(); onClick() }}
          aria-label={title}
          className={cn(
            'px-2.5 py-2 cursor-pointer transition-colors border-0 bg-transparent flex items-center justify-center border-r border-(--border) last:border-r-0',
            danger
              ? 'text-(--text-3) hover:bg-(--danger)/15 hover:text-(--danger)'
              : 'text-(--text-3) hover:bg-(--accent-dim) hover:text-(--accent)',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  )
}
