import { motion } from 'motion/react'
import AstraLogo from '@/components/AstraLogo'

/**
 * Splash mostrado durante bootstrapAuth() — antes do app montar.
 *
 * Sistema "Anéis de Saturno 3D": logo Astra ao centro + 3 anéis que
 * passam EM FRENTE e ATRÁS da logo, dando ilusão real de profundidade.
 *
 * Truque 3D sem JS: cada anel é DOIS elementos sobrepostos:
 *   - "back"  : clip-path inset(0 0 50% 0) — mostra só a metade
 *               visual de cima do anel; renderiza com z-index BAIXO
 *               (atrás da logo).
 *   - "front" : clip-path inset(50% 0 0 0) — mostra só a metade
 *               visual de baixo; renderiza com z-index ALTO (na
 *               frente da logo).
 *
 * Como o anel está tiltado em rotateX(~72°), a "metade superior raw"
 * do elemento fica no espaço Z negativo (atrás) e a "metade inferior
 * raw" no Z positivo (na frente). Combinado com a z-index manual,
 * o anel passa visualmente pela logo a cada giro — o efeito de
 * Saturno. Browser não precisa fazer z-sort 3D real.
 *
 * Ambos os elementos do mesmo anel rotacionam juntos (mesma keyframe,
 * mesmas vars CSS), então visualmente parece um único anel contínuo.
 *
 * Performance:
 *   - 1 propriedade animada por elemento (transform): 6 anims totais.
 *   - GPU compositor cuida; sem layout/paint no hot loop.
 *   - clip-path é mascaramento puro, custo trivial.
 *
 * Fade out controlado pelo parent via prop `visible`.
 */
export default function SplashScreen({ visible = true }: { visible?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.4 }}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         9999,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            '1.5rem',
        background:     'var(--void)',
        pointerEvents:  visible ? 'auto' : 'none',
      }}
    >
      <div className="astra-saturn">
        {/* Cada anel = par (back, front). Ordem DOM importa só pra back-side. */}
        <div className="astra-ring astra-ring-a astra-ring-back" />
        <div className="astra-ring astra-ring-b astra-ring-back" />
        <div className="astra-ring astra-ring-c astra-ring-back" />

        <div className="astra-saturn-core">
          <AstraLogo size={64} animated />
        </div>

        <div className="astra-ring astra-ring-a astra-ring-front" />
        <div className="astra-ring astra-ring-b astra-ring-front" />
        <div className="astra-ring astra-ring-c astra-ring-front" />
      </div>

      <p style={{
        color:         'var(--text-3)',
        fontSize:      '0.75rem',
        fontFamily:    'var(--font-mono)',
        letterSpacing: '0.1em',
        margin:        0,
      }}>
        ASTRA
      </p>

      <style>{`
        .astra-saturn {
          position:        relative;
          width:           220px;
          height:          220px;
          perspective:     1000px;
          transform-style: preserve-3d;
        }
        .astra-saturn-core {
          position:  absolute;
          top:       50%;
          left:      50%;
          transform: translate(-50%, -50%);
          z-index:   5;
        }

        /* Anel base: posicionado via top/left 50% + margin negativa
           (não usa translate no transform pois ele é puramente animado). */
        .astra-ring {
          position:      absolute;
          top:           50%;
          left:          50%;
          border-radius: 50%;
          pointer-events: none;
          /* Iluminação assimétrica: top brilhante (sol), bottom sombra.
             O ponto brilhante gira junto com o anel (border é solidário). */
          border-top:    2px   solid var(--accent);
          border-bottom: 1px   solid color-mix(in srgb, var(--accent) 25%, transparent);
          border-left:   1.5px solid color-mix(in srgb, var(--accent) 65%, transparent);
          border-right:  1.5px solid color-mix(in srgb, var(--accent) 65%, transparent);
          box-shadow:    0 0 10px color-mix(in srgb, var(--accent) 18%, transparent);
          animation:     saturnSpin var(--dur, 8s) linear infinite var(--dir, normal);
          will-change:   transform;
        }

        /* Back: metade visual de cima do anel — fica atrás da logo. */
        .astra-ring-back {
          z-index:   1;
          clip-path: inset(0 0 50% 0);
        }
        /* Front: metade visual de baixo — fica na frente da logo. */
        .astra-ring-front {
          z-index:   10;
          clip-path: inset(50% 0 0 0);
        }

        /* 3 anéis em raios crescentes + planos 3D distintos. */
        .astra-ring-a {
          width:  120px;
          height: 120px;
          margin: -60px 0 0 -60px;
          --tx:   72deg;
          --ty:   -8deg;
          --dur:  6s;
        }
        .astra-ring-b {
          width:  155px;
          height: 155px;
          margin: -77.5px 0 0 -77.5px;
          --tx:   68deg;
          --ty:   12deg;
          --dur:  9s;
          --dir:  reverse;
          border-top-width: 1.5px;
        }
        .astra-ring-c {
          width:  190px;
          height: 190px;
          margin: -95px 0 0 -95px;
          --tx:   74deg;
          --ty:   -4deg;
          --dur:  13s;
          border-top-width: 1px;
          opacity: 0.75;
        }

        @keyframes saturnSpin {
          from { transform: rotateX(var(--tx)) rotateY(var(--ty)) rotateZ(0deg);   }
          to   { transform: rotateX(var(--tx)) rotateY(var(--ty)) rotateZ(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .astra-ring { animation: none !important; }
        }
      `}</style>
    </motion.div>
  )
}
