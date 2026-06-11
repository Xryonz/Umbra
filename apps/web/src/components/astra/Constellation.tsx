/**
 * Constellation — renderiza a constelação-assinatura de um nome como SVG.
 *
 * Mesmo nome = mesmo desenho, sempre (ver lib/constellation.ts). Usos:
 * banner default do servidor, fundo do ícone default, página de convite.
 *
 * Cor: herda currentColor — o pai controla via text-(--accent) etc.
 * animated: twinkle sutil de opacidade (compositor-only, barato).
 */
import { memo, useMemo } from 'react'
import { generateConstellation } from '@/lib/constellation'

interface Props {
  name:      string
  /** 1 estrela por membro (clamp 1–28). Sem isso: 5–9 via hash do nome. */
  stars?:    number
  className?: string
  animated?: boolean
}

// memo: o pai (Sidebar) re-renderiza com presença/unread a cada tick —
// o SVG só re-gera quando nome ou nº de membros mudam de verdade.
export const Constellation = memo(function Constellation({ name, stars: starCount, className, animated = false }: Props) {
  const { stars, edges, dust } = useMemo(
    () => generateConstellation(name, starCount),
    [name, starCount],
  )

  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {animated && (
        <style>{`
          @keyframes astraTwinkle { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        `}</style>
      )}

      {/* Poeira de fundo */}
      {dust.map((d, i) => (
        <circle key={`d${i}`} cx={d.x} cy={d.y} r={d.r} fill="currentColor" opacity={0.25} />
      ))}

      {/* Traçado */}
      {edges.map((e, i) => (
        <line
          key={`e${i}`}
          x1={stars[e.a].x} y1={stars[e.a].y}
          x2={stars[e.b].x} y2={stars[e.b].y}
          stroke="currentColor" strokeWidth={0.5} opacity={0.4}
        />
      ))}

      {/* Estrelas (alfa ganha halo) */}
      {stars.map((s, i) => (
        <g key={`s${i}`}>
          {s.alpha && <circle cx={s.x} cy={s.y} r={s.r * 2.2} fill="currentColor" opacity={0.15} />}
          <circle
            cx={s.x} cy={s.y} r={s.r} fill="currentColor"
            style={animated ? {
              animation: `astraTwinkle ${2.6 + (i % 3) * 0.9}s ease-in-out ${i * 0.35}s infinite`,
            } : undefined}
          />
        </g>
      ))}
    </svg>
  )
})

/**
 * ConstellationBanner — banner default de servidor: gradiente do void com
 * a constelação do nome em âmbar. Usado quando não há banner custom.
 */
export function ConstellationBanner({ name, stars, className }: { name: string; stars?: number; className?: string }) {
  return (
    <div
      className={`relative overflow-hidden bg-linear-to-br from-(--void) via-(--base) to-(--raised) ${className ?? ''}`}
    >
      <Constellation
        name={name}
        stars={stars}
        animated
        className="absolute inset-0 w-full h-full text-(--accent)"
      />
    </div>
  )
}
