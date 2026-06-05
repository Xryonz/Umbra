/**
 * Campo de estrelas — fundo atmosférico da Astra.
 *
 * - Fixed inset-0, z-index -1, pointer-events none
 * - 70 dots estáticos via radial-gradient (zero overhead — 1 elemento, 1 bg)
 * - 12 estrelas com twinkle individual (DOM span + CSS animation, delays
 *   determinísticos pra não sincronizar visualmente)
 * - mix-blend-mode: 'screen' → estrelas adaptam: em fundo escuro ficam
 *   claras, em --raised/--base mais visíveis sem precisar de query JS
 * - Opacidade 14% pra ler com o conteúdo sem dominar
 * - Determinístico (seed fixa) → mesma constelação em todos os clients
 */

const TWO_TONES = ['2px', '3px']

function seededRand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

interface TwinkleStar {
  x:        number
  y:        number
  size:     number
  delay:    number
  dur:      number
  driftDur: number
  driftDir: number    // 1 ou -1 (horário/anti-horário)
}

function buildBackground(): string {
  const rand = seededRand(424242)
  const parts: string[] = []
  for (let i = 0; i < 70; i++) {
    const x = (rand() * 100).toFixed(2)
    const y = (rand() * 100).toFixed(2)
    const size = TWO_TONES[Math.floor(rand() * 2)]
    parts.push(`radial-gradient(${size} ${size} at ${x}% ${y}%, currentColor 0, transparent 100%)`)
  }
  return parts.join(', ')
}

function buildTwinkleStars(): TwinkleStar[] {
  const rand = seededRand(99883)
  return Array.from({ length: 14 }, () => ({
    x:        rand() * 100,
    y:        rand() * 100,
    size:     2 + Math.floor(rand() * 2),       // 2 ou 3px (era 1-2)
    delay:    rand() * 6,
    dur:      2.6 + rand() * 2.4,
    driftDur: 22 + rand() * 16,                 // 22-38s (mais rápido pra perceber)
    driftDir: rand() > 0.5 ? 1 : -1,
  }))
}

// Computed once on module load — não recalcula a cada render
const STARS_BG       = buildBackground()
const TWINKLE_STARS  = buildTwinkleStars()

/**
 * StarField — fundo atmosférico.
 *
 * Estrutura:
 *  <stars container> (mix-blend-mode: screen)
 *    bg-image: 70 estrelas estáticas via radial-gradient (1 elem, 0 cost)
 *    14 twinkles: outer (drift translate) + inner (twinkle scale/opacity)
 *
 * Performance:
 *  - mix-blend-mode no parent — paint once
 *  - cada twinkle = 2 elements GPU (translate/scale = compositor-only)
 *  - drift = 28-52s loop deslocando ±6-10px → quase imperceptível mas vivo
 */
export default function StarField() {
  return (
    <div
      aria-hidden
      className="astra-stars"
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         -1,
        pointerEvents:  'none',
        color:          'var(--accent)',      // ← cor de destaque do user
        backgroundImage: STARS_BG,
        opacity:        0.32,                  // mais visível (era 0.14)
        mixBlendMode:   'screen',
      }}
    >
      {TWINKLE_STARS.map((s, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            position:    'absolute',
            display:     'block',
            left:        `${s.x}%`,
            top:         `${s.y}%`,
            width:       `${s.size}px`,
            height:      `${s.size}px`,
            // animation shorthand inline → vence cascata sem ambiguidade
            // de class vs longhands. Direção alternada por índice (sem chance
            // de prop ignorada). 1 anim só: translate sutil em loop.
            animation:   `astraDrift ${s.driftDur}s linear infinite ${s.driftDir > 0 ? 'normal' : 'reverse'} ${(s.delay * -1.5).toFixed(2)}s`,
            willChange:  'transform',
          }}
        >
          <span
            aria-hidden
            style={{
              display:      'block',
              width:        '100%',
              height:       '100%',
              borderRadius: '50%',
              background:   'currentColor',
              animation:    `astraTwinkle ${s.dur}s ease-in-out infinite ${s.delay.toFixed(2)}s`,
              willChange:   'transform, opacity',
            }}
          />
        </span>
      ))}
    </div>
  )
}
