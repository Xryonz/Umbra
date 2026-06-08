import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  ACCENT_OPTIONS, BG_OPTIONS, applyTheme,
  THEME_PRESETS, applyPreset,
  FONT_SIZE_OPTIONS, applyFontSize, type FontSize,
  DENSITY_OPTIONS,   applyDensity,   type Density,
  applyMotion,
} from '@/lib/theme'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { SectionHeader, Row } from './_shared'

/**
 * Aparência: cor de destaque + fundo. Aplica direto no DOM via applyTheme,
 * persiste no localStorage. Sem botão "Salvar" — feedback é instantâneo.
 *
 * Sync server: PATCH /api/profile/preferences debounced (600ms). Erro silencioso
 * — local já está aplicado, sync server eventualmente refaz.
 */
export default function AppearanceSection() {
  const [accentId, setAccentId] = useState(() =>
    localStorage.getItem('astra-accent') ?? localStorage.getItem('umbra-accent') ?? 'white',
  )
  const [bgId,     setBgId]     = useState(() =>
    localStorage.getItem('astra-bg')     ?? localStorage.getItem('umbra-bg')     ?? 'void',
  )
  const [fontSize, setFontSize] = useState<FontSize>(() =>
    (localStorage.getItem('astra-font-size') as FontSize) ?? 'md',
  )
  const [density,  setDensity]  = useState<Density>(() =>
    (localStorage.getItem('astra-density')   as Density)  ?? 'comfortable',
  )
  const [reducedMotion, setReducedMotion] = useState(() =>
    localStorage.getItem('astra-motion-reduced') === '1',
  )

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    applyTheme(accentId, bgId)
    if (!isAuthenticated) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      api.patch('/api/profile/preferences', {
        preferences: { accent: accentId, bg: bgId },
      }).catch(() => {})
    }, 600)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [accentId, bgId, isAuthenticated])

  return (
    <div>
      <SectionHeader
        title="Aparência"
        description="Personalize as cores da interface. Mudanças aparecem na hora."
      />

      <Row label="Tema rápido" hint="Combinações pré-pensadas de cor + fundo. Você ainda pode ajustar individualmente abaixo.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {THEME_PRESETS.map((p) => {
            const active = accentId === p.accent && bgId === p.bg
            const accent = ACCENT_OPTIONS.find((a) => a.id === p.accent)
            const bg     = BG_OPTIONS.find((b) => b.id === p.bg)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  applyPreset(p.id)
                  setAccentId(p.accent)
                  setBgId(p.bg)
                }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border text-left',
                  active
                    ? 'border-(--accent) bg-(--accent-dim)'
                    : 'border-(--border) hover:border-(--accent)',
                )}
              >
                <div className="relative w-10 h-7 border border-white/10 shrink-0" style={{ background: bg?.base }}>
                  <span className="absolute right-1 top-1 size-3 rounded-full" style={{ background: accent?.value }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.label}</div>
                  <div className="text-marg text-(--text-3) truncate">{p.hint}</div>
                </div>
                {active && <Check className="size-4 text-(--accent) shrink-0" />}
              </button>
            )
          })}
        </div>
      </Row>

      <Row label="Cor de destaque" hint="Usada em botões, links, hover e elementos ativos.">
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map((a) => {
            const active = accentId === a.id
            return (
              <button
                key={a.id}
                type="button"
                title={a.label}
                onClick={() => setAccentId(a.id)}
                className={cn(
                  'size-9 cursor-pointer transition-all border-2',
                  active ? 'border-foreground scale-110' : 'border-transparent hover:scale-105',
                )}
                style={{ background: a.value }}
              >
                {active && <Check className="size-3.5 text-white mx-auto" />}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-(--text-3) mt-2 m-0">
          Atual: <span className="text-foreground">{ACCENT_OPTIONS.find((a) => a.id === accentId)?.label}</span>
        </p>
      </Row>

      <Row label="Fundo da interface" hint="Tom base do app. Afeta todas as telas.">
        <div className="flex flex-col gap-1.5">
          {BG_OPTIONS.map((b) => {
            const active = bgId === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBgId(b.id)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border text-left',
                  active
                    ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                    : 'border-(--border) text-(--text-2) hover:border-(--accent)',
                )}
              >
                <div className="w-9 h-6 border border-white/10 shrink-0" style={{ background: b.base }} />
                <span className="text-sm font-medium flex-1">{b.label}</span>
                {active && <Check className="size-4" />}
              </button>
            )
          })}
        </div>
      </Row>

      <Row label="Tamanho da fonte" hint="Escala TODA a UI (rem-based). Útil pra telas grandes/pequenas.">
        <div className="grid grid-cols-4 gap-2">
          {FONT_SIZE_OPTIONS.map((f) => {
            const active = fontSize === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => { applyFontSize(f.id); setFontSize(f.id) }}
                className={cn(
                  'px-3 py-2 cursor-pointer transition-colors border',
                  active
                    ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                    : 'border-(--border) text-(--text-2) hover:border-(--accent)',
                )}
              >
                <span className="text-sm font-medium">{f.label}</span>
              </button>
            )
          })}
        </div>
      </Row>

      <Row label="Espaçamento das mensagens" hint="Compacta = mais mensagens visíveis; Espaçosa = mais respiro.">
        <div className="grid grid-cols-3 gap-2">
          {DENSITY_OPTIONS.map((d) => {
            const active = density === d.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => { applyDensity(d.id); setDensity(d.id) }}
                className={cn(
                  'px-3 py-2 cursor-pointer transition-colors border',
                  active
                    ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
                    : 'border-(--border) text-(--text-2) hover:border-(--accent)',
                )}
              >
                <span className="text-sm font-medium">{d.label}</span>
              </button>
            )
          })}
        </div>
      </Row>

      <Row label="Reduzir animações" hint="Diminui ou elimina movimentos da UI. Útil em máquinas modestas ou sensibilidade vestibular.">
        <button
          type="button"
          onClick={() => { const next = !reducedMotion; applyMotion(next); setReducedMotion(next) }}
          className={cn(
            'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border w-full text-left',
            reducedMotion
              ? 'border-(--accent) bg-(--accent-dim) text-(--accent)'
              : 'border-(--border) text-(--text-2) hover:border-(--accent)',
          )}
        >
          <span className="text-sm font-medium flex-1">
            {reducedMotion ? 'Animações reduzidas' : 'Animações ativas'}
          </span>
          {reducedMotion && <Check className="size-4" />}
        </button>
      </Row>
    </div>
  )
}
