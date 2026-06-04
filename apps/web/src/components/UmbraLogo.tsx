interface UmbraLogoProps {
  size?: number
  style?: React.CSSProperties
  animated?: boolean
}

/**
 * Logo do Umbra — crescente hairline editorial.
 *
 * SVG custom (substitui Moon do Lucide que era gross/cheia demais).
 * Forma: arc externo R=14 + arc interno R=11 fechando o crescente.
 * Espessura na "barriga": 3px no canvas 32x32 (~9% do diâmetro).
 * Pontas afinam organicamente via geometria dos dois arcs.
 *
 * `fill="currentColor"` herda --accent via `color` no wrapper.
 * Glow via drop-shadow do --accent-glow.
 */
export default function UmbraLogo({ size = 40, style, animated = true }: UmbraLogoProps) {
  const inner = Math.round(size * 0.85)
  return (
    <div
      className={animated ? 'umbra-br' : undefined}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        width:          size,
        height:         size,
        flexShrink:     0,
        color:          'var(--accent)',
        filter:         `drop-shadow(0 0 ${Math.max(4, size * 0.15)}px var(--accent-glow))`,
        ...style,
      }}
      aria-label="Umbra"
    >
      <svg
        width={inner}
        height={inner}
        viewBox="0 0 32 32"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M 22 4 A 14 14 0 1 1 22 28 A 11 11 0 1 0 22 4 Z" />
      </svg>
      {animated && (
        <style>{`@keyframes umbraFlk{0%,100%{opacity:1}45%{opacity:.82}70%{opacity:.91}}.umbra-br{animation:umbraFlk 2.4s ease-in-out infinite}`}</style>
      )}
    </div>
  )
}
