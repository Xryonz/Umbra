// Tema do app: paleta de acento + fundo. Carregado no boot
// (main.tsx) para evitar flash de cores padrão antes do React montar.

// 18 cores accent: 12 editoriais (saturação média/dessaturada) + 6 simples
// (cores puras pra quem prefere mais saturação).
// Glow segue padrão rgba(r,g,b,0.25).
export const ACCENT_OPTIONS = [
  // ─── Editorial (dessaturado) ────────────────────────────────
  { id: 'gold',    label: 'Âmbar',     value: '#c9a96e', glow: 'rgba(201,169,110,0.25)' },
  { id: 'violet',  label: 'Violeta',   value: '#9b7ac4', glow: 'rgba(155,122,196,0.25)' },
  { id: 'teal',    label: 'Ciano',     value: '#6aaeca', glow: 'rgba(106,174,202,0.25)' },
  { id: 'rose',    label: 'Rosa',      value: '#ca7a9b', glow: 'rgba(202,122,155,0.25)' },
  { id: 'emerald', label: 'Esmeralda', value: '#6ec99b', glow: 'rgba(110,201,155,0.25)' },
  { id: 'orange',  label: 'Laranja',   value: '#ca9a6e', glow: 'rgba(202,154,110,0.25)' },
  { id: 'crimson', label: 'Carmim',    value: '#c46a6a', glow: 'rgba(196,106,106,0.25)' },
  { id: 'indigo',  label: 'Índigo',    value: '#7a78c4', glow: 'rgba(122,120,196,0.25)' },
  { id: 'sage',    label: 'Salva',     value: '#9eb98a', glow: 'rgba(158,185,138,0.25)' },
  { id: 'copper',  label: 'Cobre',     value: '#c98660', glow: 'rgba(201,134,96,0.25)' },
  { id: 'slate',   label: 'Ardósia',   value: '#7a8da0', glow: 'rgba(122,141,160,0.25)' },
  { id: 'lilac',   label: 'Lilás',     value: '#b48cc9', glow: 'rgba(180,140,201,0.25)' },
  // ─── Simples (puras) ────────────────────────────────────────
  { id: 'red',     label: 'Vermelho',  value: '#ef4444', glow: 'rgba(239,68,68,0.25)'    },
  { id: 'yellow',  label: 'Amarelo',   value: '#facc15', glow: 'rgba(250,204,21,0.25)'   },
  { id: 'blue',    label: 'Azul',      value: '#3b82f6', glow: 'rgba(59,130,246,0.25)'   },
  { id: 'green',   label: 'Verde',     value: '#22c55e', glow: 'rgba(34,197,94,0.25)'    },
  { id: 'white',   label: 'Branco',    value: '#f5f5f5', glow: 'rgba(245,245,245,0.25)'  },
  // Aviso: preto como accent em bg dark fica quase invisível
  // (botões/links somem). Incluído por completude — use com cuidado.
  { id: 'black',   label: 'Preto',     value: '#18181b', glow: 'rgba(24,24,27,0.25)'     },
] as const

// 10 fundos dark: 5 editoriais (sutis, quase pretos com hint) + 5 puros
// (saturação mais óbvia + AMOLED preto puro).
export const BG_OPTIONS = [
  // ─── Editorial (sutis) ──────────────────────────────────────
  { id: 'void',   label: 'Obsidiana', base: '#06060e', raised: '#0f0f24' },
  { id: 'dark',   label: 'Carvão',    base: '#0d0d0d', raised: '#161616' },
  { id: 'navy',   label: 'Marinho',   base: '#05080f', raised: '#0b1020' },
  { id: 'forest', label: 'Floresta',  base: '#060e09', raised: '#0c1a10' },
  { id: 'wine',   label: 'Vinho',     base: '#0e0609', raised: '#1a0c10' },
  // ─── Puros (saturação mais óbvia) ───────────────────────────
  { id: 'pure-black',  label: 'Preto AMOLED', base: '#000000', raised: '#0a0a0a' },
  { id: 'pure-red',    label: 'Vermelho',     base: '#1a0808', raised: '#2a1010' },
  { id: 'pure-yellow', label: 'Amarelo',      base: '#1a1605', raised: '#2a2410' },
  { id: 'pure-blue',   label: 'Azul',         base: '#08081a', raised: '#10102a' },
  { id: 'pure-green',  label: 'Verde',        base: '#081a08', raised: '#102a10' },
] as const

export function applyTheme(accentId: string, bgId: string) {
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId) ?? ACCENT_OPTIONS[0]
  const bg     = BG_OPTIONS.find((b) => b.id === bgId)         ?? BG_OPTIONS[0]
  const root   = document.documentElement
  root.style.setProperty('--accent',      accent.value)
  root.style.setProperty('--accent-h',    accent.value + 'dd')
  root.style.setProperty('--accent-dim',  accent.glow.replace('0.25', '0.10'))
  root.style.setProperty('--accent-glow', accent.glow)
  root.style.setProperty('--void',   bg.base)
  root.style.setProperty('--base',   bg.base === '#06060e' ? '#09091a' : bg.base + '18')
  root.style.setProperty('--raised', bg.raised)
  localStorage.setItem('astra-accent', accentId)
  localStorage.setItem('astra-bg',     bgId)
}

// ── Presets temáticos (accent + bg combo) ─────────────────────
// Identidades pré-pensadas pra user trocar de "skin" inteira num
// clique, sem mexer em accent/bg individualmente.
export const THEME_PRESETS = [
  { id: 'obsidian', label: 'Obsidiana',  hint: 'Prata fria + void',     accent: 'white',   bg: 'void'        },
  { id: 'solar',    label: 'Solar',      hint: 'Âmbar editorial',       accent: 'gold',    bg: 'void'        },
  { id: 'nebula',   label: 'Nebulosa',   hint: 'Violeta cósmica',       accent: 'violet',  bg: 'navy'        },
  { id: 'aurora',   label: 'Aurora',     hint: 'Ciano + floresta',      accent: 'teal',    bg: 'forest'      },
  { id: 'eclipse',  label: 'Eclipse',    hint: 'Carmim sobre vinho',    accent: 'crimson', bg: 'wine'        },
  { id: 'meridian', label: 'Meridiano',  hint: 'Esmeralda + carvão',    accent: 'emerald', bg: 'dark'       },
  { id: 'amoled',   label: 'AMOLED',     hint: 'Branco em preto puro',  accent: 'white',   bg: 'pure-black' },
] as const

export function applyPreset(presetId: string): void {
  const p = THEME_PRESETS.find((x) => x.id === presetId) ?? THEME_PRESETS[0]
  applyTheme(p.accent, p.bg)
  localStorage.setItem('astra-preset', p.id)
}

// ── Font size global ──────────────────────────────────────────
// Aplica via data-font-size em <html>. Tailwind v4 escala junto
// porque suas unidades em rem derivam de html font-size.
export const FONT_SIZE_OPTIONS = [
  { id: 'sm', label: 'Pequena' },
  { id: 'md', label: 'Padrão'  },
  { id: 'lg', label: 'Grande'  },
  { id: 'xl', label: 'Maior'   },
] as const
export type FontSize = typeof FONT_SIZE_OPTIONS[number]['id']

export function applyFontSize(id: FontSize): void {
  document.documentElement.setAttribute('data-font-size', id)
  localStorage.setItem('astra-font-size', id)
}

// ── Density (espaçamento mensagens) ───────────────────────────
export const DENSITY_OPTIONS = [
  { id: 'compact',     label: 'Compacta'    },
  { id: 'comfortable', label: 'Confortável' },
  { id: 'spacious',    label: 'Espaçosa'    },
] as const
export type Density = typeof DENSITY_OPTIONS[number]['id']

export function applyDensity(id: Density): void {
  document.documentElement.setAttribute('data-density', id)
  localStorage.setItem('astra-density', id)
}

// ── Reduced motion (opt-in user) ──────────────────────────────
// Browser tem prefers-reduced-motion mas alguns users querem ligar
// manualmente sem mexer em config OS.
export function applyMotion(reduced: boolean): void {
  document.documentElement.toggleAttribute('data-reduced-motion', reduced)
  localStorage.setItem('astra-motion-reduced', reduced ? '1' : '0')
}

export function restoreTheme() {
  applyTheme(
    localStorage.getItem('astra-accent') ?? 'white',
    localStorage.getItem('astra-bg')     ?? 'void',
  )
  applyFontSize((localStorage.getItem('astra-font-size') as FontSize) ?? 'md')
  applyDensity((localStorage.getItem('astra-density')   as Density)  ?? 'comfortable')
  if (localStorage.getItem('astra-motion-reduced') === '1') applyMotion(true)
}
