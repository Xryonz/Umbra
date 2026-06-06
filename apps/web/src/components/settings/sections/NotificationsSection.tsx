import { useState } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/sonner'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useNotificationPrefs, useUpdatePrefs, type NotificationPrefs } from '@/hooks/useNotifications'
import { cn } from '@/lib/utils'
import { SectionHeader, Row } from './_shared'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function NotificationsSection() {
  const { state, subscribe, unsubscribe, sendTest } = usePushNotifications()
  const { data: prefsData } = useNotificationPrefs()
  const updatePrefs = useUpdatePrefs()

  const prefs = prefsData?.prefs

  const [localMute, setLocalMute] = useState<boolean>(() => localStorage.getItem('astra-sound') === '0')
  const toggleLocalMute = () => {
    const next = !localMute
    setLocalMute(next)
    localStorage.setItem('astra-sound', next ? '0' : '1')
  }

  const togglePref = (key: keyof NotificationPrefs) => () => {
    if (!prefs) return
    updatePrefs.mutate({ [key]: !prefs[key] } as Partial<NotificationPrefs>)
  }

  const updateQuiet = (key: 'quietStart' | 'quietEnd') => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value === '' ? null : parseInt(e.target.value, 10)
    updatePrefs.mutate({ [key]: v } as Partial<NotificationPrefs>)
  }

  const localTest = async () => {
    if (!('Notification' in window)) {
      toast.error('Browser sem suporte a notificações.')
      return
    }
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission()
      if (p !== 'granted') {
        toast.info('Permissão negada — libere nas configs do navegador.')
        return
      }
    }
    new Notification('Astra · Teste local', {
      body: 'Se você vê isso, notificações do browser funcionam.',
      icon: '/astra-logo.png',
    })
  }

  return (
    <div>
      <SectionHeader
        title="Notificações"
        description="Decida o que te interrompe — e quando."
      />

      {/* ── Push (device) ─────────────────────────────────── */}
      <Row label="Notificações push" hint="Receba alertas mesmo com a Astra fechada — depende do navegador permitir.">
        {state === 'unsupported' && (
          <div className="border border-(--border) bg-(--raised)/40 p-3 text-sm text-(--text-3)">
            Navegador sem suporte a push ou backend sem chaves VAPID configuradas.
          </div>
        )}
        {state === 'denied' && (
          <div className="border border-(--danger)/40 bg-(--danger)/5 p-3 text-sm">
            <p className="m-0 text-(--danger) flex items-center gap-2"><BellOff className="size-3.5" /> Permissão bloqueada</p>
            <p className="m-0 mt-1 text-(--text-3) text-xs">
              Libere notificações nas configurações do site no navegador e recarregue.
            </p>
          </div>
        )}
        {state === 'unsubscribed' && (
          <div className="flex gap-2 flex-wrap">
            <Button onClick={subscribe} className="gap-2"><Bell className="size-4" /> Ativar push</Button>
            <Button variant="outline" onClick={localTest} className="gap-2"><BellRing className="size-3.5" /> Testar local</Button>
          </div>
        )}
        {state === 'subscribed' && (
          <div className="flex flex-col gap-2">
            <div className="border border-(--accent)/40 bg-(--accent-dim) px-3 py-2 text-sm flex items-center gap-2">
              <BellRing className="size-4 text-(--accent)" />
              <span className="text-(--accent) font-medium">Ativadas</span>
              <span className="text-(--text-3) text-xs">· neste dispositivo</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={sendTest}>Testar push</Button>
              <Button variant="outline" size="sm" onClick={localTest}>Testar local</Button>
              <Button variant="outline" size="sm" onClick={unsubscribe} className="gap-2">
                <BellOff className="size-3.5" /> Desativar
              </Button>
            </div>
          </div>
        )}
        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-(--text-3)">
            <Spinner size={12} /> Carregando…
          </div>
        )}
      </Row>

      {/* ── Tipos ────────────────────────────────────────── */}
      <Row label="O que quero receber" hint="Cada tipo pode ser ligado/desligado independente.">
        {!prefs ? (
          <div className="flex items-center gap-2 text-xs text-(--text-3)">
            <Spinner size={12} /> Carregando preferências…
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            <PrefToggle label="Menções"  hint="Quando alguém usa @você"          active={prefs.mentions}  onClick={togglePref('mentions')} />
            <PrefToggle label="DMs"      hint="Mensagens diretas"                 active={prefs.dms}       onClick={togglePref('dms')} />
            <PrefToggle label="Respostas" hint="Quando respondem sua msg"         active={prefs.replies}   onClick={togglePref('replies')} />
            <PrefToggle label="Reações"  hint="Quando reagem à sua msg"           active={prefs.reactions} onClick={togglePref('reactions')} />
          </div>
        )}
      </Row>

      {/* ── Som ──────────────────────────────────────────── */}
      <Row label="Som ao receber" hint="Toca som curto por tipo (mais agudo pra menção, mais grave pra DM).">
        {prefs && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={togglePref('sounds')}
              className={cn(
                'self-start px-3 h-9 border text-sm transition-colors cursor-pointer flex items-center gap-2',
                prefs.sounds
                  ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                  : 'border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent)',
              )}
            >
              {prefs.sounds ? <BellRing className="size-3.5" /> : <BellOff className="size-3.5" />}
              {prefs.sounds ? 'Som habilitado' : 'Som desabilitado'}
            </button>
            <button
              onClick={toggleLocalMute}
              className="self-start px-3 h-9 border border-(--border) text-(--text-2) hover:border-(--accent) hover:text-(--accent) text-sm transition-colors cursor-pointer flex items-center gap-2"
            >
              {localMute ? 'Som global mutado neste dispositivo' : 'Mutar só neste dispositivo'}
            </button>
          </div>
        )}
      </Row>

      {/* ── Quiet hours ──────────────────────────────────── */}
      <Row
        label="Horas silenciosas"
        hint="Durante essa janela, notificações ainda aparecem no sino — só não tocam som nem mostram pop-up."
      >
        {prefs && (
          <div className="flex items-end gap-3 flex-wrap">
            <HourPicker label="Início"  value={prefs.quietStart} onChange={updateQuiet('quietStart')} />
            <HourPicker label="Término" value={prefs.quietEnd}   onChange={updateQuiet('quietEnd')} />
            {prefs.quietStart != null && prefs.quietEnd != null && (
              <button
                onClick={() => updatePrefs.mutate({ quietStart: null, quietEnd: null })}
                className="h-9 px-3 text-xs text-(--text-3) hover:text-(--text-2) transition-colors"
              >
                Limpar
              </button>
            )}
          </div>
        )}
      </Row>
    </div>
  )
}

function PrefToggle({
  label, hint, active, onClick,
}: { label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left p-3 border transition-colors cursor-pointer flex items-start gap-3',
        active
          ? 'border-(--accent)/40 bg-(--accent)/4'
          : 'border-(--border) hover:border-(--accent)/40',
      )}
    >
      <span className={cn(
        'mt-0.5 size-3.5 rounded-full border shrink-0 transition-colors',
        active ? 'bg-(--accent) border-(--accent)' : 'border-(--border-mid)',
      )} />
      <span className="flex-1 min-w-0">
        <span className={cn('block text-sm font-medium', active ? 'text-foreground' : 'text-(--text-2)')}>{label}</span>
        <span className="block text-xs text-(--text-3) mt-0.5">{hint}</span>
      </span>
    </button>
  )
}

function HourPicker({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-(--text-3)">{label}</span>
      <select
        value={value ?? ''}
        onChange={onChange}
        className="h-9 px-2 border border-(--border) bg-(--raised) text-sm text-foreground"
      >
        <option value="">—</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
        ))}
      </select>
    </label>
  )
}
