/**
 * UserFooter — rodapé da Sidebar com avatar, nome, status e ações.
 *
 * Extraído do Sidebar (overhaul 2026-06-02). Self-contained:
 * pull state direto das stores/hooks, só recebe callback pra abrir
 * o ProfileCard (parent controla esse state pra evitar duplicação).
 */
import { useNavigate } from 'react-router-dom'
import { Pencil, Settings as SettingsIcon, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { usePresenceStore } from '@/store/presenceStore'
import { useUIStore } from '@/store/uiStore'
import { useAuth } from '@/hooks/useAuth'
import StatusDot, { STATUS_META } from '@/components/StatusDot'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const PALETTE = ['#c9a96e','#7c6fc4','#6fa8c9','#c97c6e','#6ec98a']
function userColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

interface Props {
  onProfileClick: () => void
}

export function UserFooter({ onProfileClick }: Props) {
  const user        = useAuthStore((s) => s.user)
  const myStatus    = usePresenceStore((s) => s.myStatus)
  const closeMobile = useUIStore((s) => s.closeMobileSidebar)
  const { logout }  = useAuth()
  const navigate    = useNavigate()

  const accentColor = user?.id ? userColor(user.id) : 'var(--accent)'

  return (
    <div className="h-14 px-2 bg-background border-t border-border flex items-center gap-1.5 shrink-0">
      <button
        onClick={onProfileClick}
        className="relative size-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center cursor-pointer p-0 border-2 transition-colors"
        style={{ background: accentColor + '33', borderColor: accentColor + '66' }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = accentColor)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = accentColor + '66')}
        title="Ver meu perfil"
        aria-label="Ver meu perfil"
      >
        {user?.avatarUrl
          ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          : <span className="text-xs font-bold" style={{ color: accentColor }}>{user?.displayName?.slice(0,1).toUpperCase()}</span>
        }
        <span className="absolute -bottom-0.5 -right-0.5">
          <StatusDot status={myStatus} size={11} bordered borderColor="var(--background)" />
        </span>
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold m-0 truncate text-foreground">{user?.displayName}</p>
        <p className="text-[10px] m-0 truncate text-muted-foreground flex items-center gap-1">
          <StatusDot status={myStatus} size={7} />
          <span className="truncate">{STATUS_META[myStatus].label}</span>
        </p>
      </div>

      <FooterBtn title="Editar perfil" onClick={() => { navigate('/app/profile'); closeMobile() }}>
        <Pencil className="size-3.5" />
      </FooterBtn>
      <FooterBtn title="Configurações" onClick={() => { navigate('/app/settings'); closeMobile() }}>
        <SettingsIcon className="size-3.5" />
      </FooterBtn>
      <FooterBtn title="Sair" onClick={() => { closeMobile(); logout() }} danger>
        <LogOut className="size-3.5" />
      </FooterBtn>
    </div>
  )
}

function FooterBtn({ title, onClick, danger, children }: {
  title:    string
  onClick:  () => void
  danger?:  boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={title}
          className={cn(
            'bg-transparent border-none cursor-pointer p-1 rounded-lg flex items-center transition-colors',
            danger ? 'text-muted-foreground hover:text-destructive' : 'text-muted-foreground hover:text-primary',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  )
}
