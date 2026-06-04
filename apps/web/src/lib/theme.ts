// Tema do app: paleta de acento + fundo. Carregado no boot
// (main.tsx) para evitar flash de cores padrão antes do React montar.

// Paleta editorial: saturação média + tom dessaturado (anti-stock).
// 12 cores sólidas. Glow segue padrão rgba(r,g,b,0.25).
export const ACCENT_OPTIONS = [
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
] as const

export const BG_OPTIONS = [
  { id: 'void',   label: 'Obsidiana', base: '#06060e', raised: '#0f0f24' },
  { id: 'dark',   label: 'Carvão',   base: '#0d0d0d',  raised: '#161616' },
  { id: 'navy',   label: 'Marinho',  base: '#05080f',  raised: '#0b1020' },
  { id: 'forest', label: 'Floresta', base: '#060e09',  raised: '#0c1a10' },
  { id: 'wine',   label: 'Vinho',    base: '#0e0609',  raised: '#1a0c10' },
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
  localStorage.setItem('umbra-accent', accentId)
  localStorage.setItem('umbra-bg',     bgId)
}

export function restoreTheme() {
  applyTheme(
    localStorage.getItem('umbra-accent') ?? 'gold',
    localStorage.getItem('umbra-bg')     ?? 'void',
  )
}
