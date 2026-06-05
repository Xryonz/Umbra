import { useState, useRef, useCallback, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, ArrowLeft } from 'lucide-react'
import DMList from '@/components/dm/DMList'
import DMChat from '@/components/dm/DMChat'
import DMInput from '@/components/dm/DMInput'
import { DMCallButton } from '@/components/voice/DMCallButton'
import { Reveal } from '@/components/anim/Reveal'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import type { MessageWithAuthor } from '@umbra/types'

type OptimisticMessage = MessageWithAuthor & { optimisticId?: string; isPending?: boolean }

interface ActiveDM {
  conversationId: string
  otherUser: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
}

export default function DMPage() {
  const location   = useLocation()
  const navState   = location.state as ActiveDM | null
  const [activeDM, setActiveDM] = useState<ActiveDM | null>(navState ?? null)
  const [replyingTo, setReplyingTo] = useState<MessageWithAuthor | null>(null)
  const openMobile = useUIStore((s) => s.openMobileSidebar)

  // Quando navegamos para /app/dm com state (ex: vindo de FriendsPage)
  // sincroniza activeDM. Re-sync se conversationId muda.
  useEffect(() => {
    if (navState && navState.conversationId !== activeDM?.conversationId) {
      setActiveDM(navState)
    }
  }, [navState?.conversationId])

  // Reset reply ao trocar de conversa
  useEffect(() => { setReplyingTo(null) }, [activeDM?.conversationId])

  // Optimistic message callbacks (same pattern as AppPage)
  const addOptimisticRef    = useRef<((msg: OptimisticMessage) => void) | null>(null)
  const removeOptimisticRef = useRef<((id: string) => void) | null>(null)

  const handleRegisterOptimistic = useCallback(
    (add: (msg: OptimisticMessage) => void, remove: (id: string) => void) => {
      addOptimisticRef.current    = add
      removeOptimisticRef.current = remove
    }, []
  )
  const handleOptimisticMessage = useCallback((msg: OptimisticMessage) => {
    addOptimisticRef.current?.(msg)
  }, [])
  const handleOptimisticFailed = useCallback((id: string) => {
    removeOptimisticRef.current?.(id)
  }, [])

  return (
    <div className="flex h-full w-full font-(family-name:--font-body) anim-fade-in">

      {/* ── Conversation list ─────────────────────────────
          Desktop: sempre visível. Mobile: visível só quando nenhuma DM ativa. */}
      <aside
        className={cn(
          'w-full md:w-70 shrink-0 h-full bg-(--base) border-r border-(--border) flex flex-col anim-fade-left',
          activeDM ? 'hidden md:flex' : 'flex'
        )}
      >
        {/* Header */}
        <div className="h-14 px-4 flex items-center gap-3 border-b border-(--border) shrink-0">
          {/* Burger mobile-only */}
          <button
            onClick={openMobile}
            className="md:hidden size-9 flex items-center justify-center border border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent) transition-all duration-300 ease-(--ease-spring) cursor-pointer shrink-0"
            aria-label="Abrir menu"
          >
            <Menu className="size-4" />
          </button>
          <h2
            className="text-lg m-0 font-normal tracking-tight text-foreground truncate"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Mensagens diretas
          </h2>
        </div>

        <DMList
          activeDMId={activeDM?.conversationId ?? null}
          onSelectDM={setActiveDM}
        />
      </aside>

      {/* ── Chat area ──────────────────────────────────────
          Desktop: sempre visível. Mobile: visível só quando DM ativa. */}
      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col',
          activeDM ? 'flex' : 'hidden md:flex'
        )}
      >
        {activeDM ? (
          <>
            {/* DM header */}
            <div
              key={activeDM.conversationId + '-hdr'}
              className="h-14 px-4 sm:px-6 flex items-center gap-3 border-b border-(--border) bg-(--base) shrink-0 anim-fade-up"
            >
              {/* Back-to-list mobile-only */}
              <button
                onClick={() => setActiveDM(null)}
                className="md:hidden size-9 flex items-center justify-center border border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent) transition-all duration-300 ease-(--ease-spring) cursor-pointer shrink-0"
                aria-label="Voltar à lista"
              >
                <ArrowLeft className="size-4" />
              </button>

              <div className="size-8 rounded-full bg-(--raised) border border-(--border-mid) overflow-hidden shrink-0 flex items-center justify-center">
                {activeDM.otherUser.avatarUrl
                  ? <img src={activeDM.otherUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-sm font-bold text-(--accent)">
                      {activeDM.otherUser.displayName.slice(0, 1).toUpperCase()}
                    </span>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: 14, margin: 0 }}>
                  {activeDM.otherUser.displayName}
                </p>
                <p style={{ color: 'var(--text-3)', fontSize: 11, margin: 0 }}>
                  @{activeDM.otherUser.username}
                </p>
              </div>

              <DMCallButton
                conversationId={activeDM.conversationId}
                otherUserId={activeDM.otherUser.id}
                otherDisplayName={activeDM.otherUser.displayName}
              />
            </div>

            <DMChat
              key={activeDM.conversationId}
              conversationId={activeDM.conversationId}
              otherUser={activeDM.otherUser}
              onRegisterOptimistic={handleRegisterOptimistic}
              onReply={setReplyingTo}
            />

            <DMInput
              conversationId={activeDM.conversationId}
              otherUser={activeDM.otherUser}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              onOptimisticMessage={handleOptimisticMessage}
              onOptimisticFailed={handleOptimisticFailed}
            />
          </>
        ) : (
          /* Empty state — asymmetric serif renaissance editorial */
          <div className="flex-1 relative overflow-hidden">
            <div className="ed-vignette" />

            <div className="absolute inset-0 grid grid-cols-12 gap-6 px-6 sm:px-12 py-16">
              <div className="col-span-12 md:col-span-7 md:col-start-4 flex flex-col justify-center max-w-[44ch]">
                <Reveal delay={0.10}>
                  <span className="ed-script mb-2">D</span>
                </Reveal>

                <Reveal delay={0.20}>
                  <span className="ed-marg block mb-3">— Conversas íntimas</span>
                </Reveal>

                <Reveal delay={0.32}>
                  <h2 className="ed-h text-4xl sm:text-5xl m-0 leading-[1.05]">
                    Onde a voz
                  </h2>
                </Reveal>

                <Reveal delay={0.42}>
                  <h2 className="ed-h text-4xl sm:text-5xl m-0 italic text-(--accent) leading-[1.05]">
                    encontra escuta.
                  </h2>
                </Reveal>

                <Reveal delay={0.58}>
                  <div className="ed-hr-accent w-20 my-7" />
                </Reveal>

                <Reveal delay={0.68}>
                  <p className="ed-lede max-w-[34ch] m-0 text-(--text-2)">
                    Selecione uma conversa à esquerda, ou abra o perfil de alguém para começar um diálogo.
                  </p>
                </Reveal>
              </div>

              <div className="hidden lg:flex col-span-2 col-start-11 items-end pb-12">
                <Reveal delay={1.0}>
                  <p className="ed-aside max-w-[20ch]">
                    Mensagens diretas só você e ele leem.
                  </p>
                </Reveal>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}