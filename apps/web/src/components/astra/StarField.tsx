/**
 * StarField — atmosfera completa em 3 camadas, 1 componente.
 *
 *  Layer 1 (BG)         — 70 mini-estrelas estáticas via radial-gradient,
 *                          inteiro contêiner faz drift slow (1 GPU layer).
 *                          "Todas se deslocam" sem custo por estrela.
 *  Layer 2 (TWINKLES)   — 14 estrelas individuais com twinkle + micro-drift
 *                          local pra variação além do drift global.
 *  Layer 3 (METEORS)    — 3 estrelas grandes (lucide Star) caindo na
 *                          diagonal esquerda-baixo, RARAS (1 a cada ~10s).
 *                          Animation com pausa longa (visible 12% do ciclo).
 *
 * Cor: var(--accent) — segue Aparência do user.
 * mix-blend-mode: screen — pega contraste em qualquer fundo.
 * Performance: zero will-change exceto na 1 layer global; transforms only.
 * prefers-reduced-motion: tudo respeitado via classes nas keyframes.
 */
import { Star } from 'lucide-react'

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
  driftDir: number
}

interface Meteor {
  startX:   number
  delay:    number   // negativo pra stagger
  duration: number
  size:     number
  cw:       boolean
  mx:       number   // deslocamento horizontal em vw (destino da queda)
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
    size:     2 + Math.floor(rand() * 2),
    delay:    rand() * 6,
    dur:      2.6 + rand() * 2.4,
    driftDur: 22 + rand() * 16,
    driftDir: rand() > 0.5 ? 1 : -1,
  }))
}

function buildMeteors(): Meteor[] {
  // Seed por sessão (Date.now()): cada reload muda startX/delay/duration,
  // mas mantém estável dentro do mesmo render. Evita "sempre mesmo lugar".
  const rand = seededRand(Date.now() & 0x7fffffff)
  // 3 meteoros com ciclo 30s; visível só 12% (3.6s). Stagger -10s entre
  // cada → aparece 1 a cada ~10s. Sensação de "de vez em quando".
  return Array.from({ length: 3 }, (_, i) => {
    // mx: sempre negativo (esquerda-inferior) — chuva de meteoros estética,
    // direção consistente. Magnitude varia 25-70vw pra trajetórias distintas.
    const mag = 25 + rand() * 45
    return {
      startX:   25 + rand() * 70,        // 25-95% (margem pra cair pra esquerda)
      delay:    -(i * 10) + rand() * 8,
      duration: 24 + rand() * 12,
      size:     18 + Math.floor(rand() * 14),
      cw:       rand() > 0.5,
      mx:       -mag,                    // sempre esquerda
    }
  })
}

const STARS_BG  = buildBackground()
const TWINKLES  = buildTwinkleStars()
const METEORS   = buildMeteors()

export default function StarField() {
  return (
    <div
      aria-hidden
      style={{
        position:      'fixed',
        inset:         0,
        zIndex:        -1,
        pointerEvents: 'none',
        overflow:      'hidden',
        color:         'var(--accent)',
        mixBlendMode:  'screen',
      }}
    >
      {/* ── Layer 1: 70 mini-stars com drift GLOBAL (1 anim, todas se mexem) */}
      <div
        style={{
          position:        'absolute',
          inset:           0,
          backgroundImage: STARS_BG,
          opacity:         0.34,
          animation:       'astraGlobalDrift 90s linear infinite',
          willChange:      'transform',
        }}
      />

      {/* ── Layer 2: 14 twinkles individuais (twinkle + micro-drift) */}
      {TWINKLES.map((s, i) => (
        <span
          key={`t${i}`}
          style={{
            position:  'absolute',
            display:   'block',
            left:      `${s.x}%`,
            top:       `${s.y}%`,
            width:     `${s.size}px`,
            height:    `${s.size}px`,
            animation: `astraDrift ${s.driftDur}s linear infinite ${s.driftDir > 0 ? 'normal' : 'reverse'} ${(s.delay * -1.5).toFixed(2)}s`,
          }}
        >
          <span
            style={{
              display:      'block',
              width:        '100%',
              height:       '100%',
              borderRadius: '50%',
              background:   'currentColor',
              animation:    `astraTwinkle ${s.dur}s ease-in-out infinite ${s.delay.toFixed(2)}s`,
            }}
          />
        </span>
      ))}

      {/* ── Layer 3: 3 meteoros (lucide Star, raros, big) */}
      {METEORS.map((m, i) => (
        <span
          key={`m${i}`}
          style={{
            position:  'absolute',
            top:       0,
            left:      `${m.startX}%`,
            ['--mx' as any]: `${m.mx}vw`,
            animation: `${m.cw ? 'astraMeteorCW' : 'astraMeteorCCW'} ${m.duration}s linear infinite ${m.delay.toFixed(2)}s`,
          }}
        >
          <Star
            size={m.size}
            strokeWidth={1.25}
            fill="currentColor"
            style={{ display: 'block' }}
          />
        </span>
      ))}
    </div>
  )
}
