import { motion } from 'motion/react'
import AstraLogo from '@/components/AstraLogo'

/**
 * Splash mostrado durante bootstrapAuth() — antes do app montar.
 *
 * Sistema "Kepler orbital": logo Astra central + 3 estrelas em órbitas
 * de raios e velocidades distintas (referência à 3ª lei de Kepler:
 * órbitas internas são mais rápidas). Cada estrela leva uma trilha
 * gradient atrás (cauda de cometa).
 *
 * Performance:
 *   - 100% CSS keyframes — antes era Motion.dev animando x/y via JS
 *     em 13 keyframes × 3 estrelas (39 props animadas).
 *   - Agora: 1 propriedade animada por órbita (rotate). Container faz
 *     o trabalho, estrela é stub fixo no raio. GPU/compositor only.
 *   - Trilha via ::before pseudo-element (zero nós DOM extras).
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
      <div className="astra-system">
        <div className="astra-system-core">
          <AstraLogo size={64} animated />
        </div>

        {/* Cada .astra-orbit-* é um wrapper invisível centrado.
            O conjunto inteiro rotaciona; a estrela fica em raio fixo. */}
        <div className="astra-orbit astra-orbit-a">
          <span className="astra-star astra-star-a" />
        </div>
        <div className="astra-orbit astra-orbit-b">
          <span className="astra-star astra-star-b" />
        </div>
        <div className="astra-orbit astra-orbit-c">
          <span className="astra-star astra-star-c" />
        </div>
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
        .astra-system {
          position: relative;
          width:    180px;
          height:   180px;
        }
        .astra-system-core {
          position:  absolute;
          top:       50%;
          left:      50%;
          transform: translate(-50%, -50%);
          z-index:   2;
        }

        /* Wrappers de órbita: 0×0 no centro, rotam em torno deles mesmos.
           --tilt: inclinação fixa (faz órbitas parecerem em planos diferentes).
           A keyframe combina tilt + rotação infinita.  */
        .astra-orbit {
          position:        absolute;
          top:             50%;
          left:            50%;
          width:           0;
          height:          0;
          transform-origin: center;
          will-change:     transform;
        }
        @keyframes astraSpinTilt {
          from { transform: rotateZ(var(--tilt, 0deg)) rotateZ(0deg);   }
          to   { transform: rotateZ(var(--tilt, 0deg)) rotateZ(360deg); }
        }

        /* 3ª lei de Kepler aproximada: órbita interna mais rápida.
           Raios: 50, 68, 88px (estrela fica em left: raio). */
        .astra-orbit-a { --tilt: 0deg;   animation: astraSpinTilt 3.8s linear infinite; }
        .astra-orbit-b { --tilt: 32deg;  animation: astraSpinTilt 6.4s linear infinite; }
        .astra-orbit-c { --tilt: -22deg; animation: astraSpinTilt 9.5s linear infinite; }

        .astra-star {
          position:     absolute;
          top:          -3px;
          width:        6px;
          height:       6px;
          border-radius: 50%;
          background:    var(--accent);
          box-shadow:    0 0 6px var(--accent), 0 0 14px var(--accent-glow);
          will-change:   transform;
        }
        .astra-star-a { left:  50px; }
        .astra-star-b { left:  68px; width: 5px; height: 5px; top: -2.5px; }
        .astra-star-c { left:  88px; width: 4px; height: 4px; top: -2px;
                        background: var(--accent-h); }

        /* Trilha de cometa: gradient antes da estrela na direção
           contrária ao movimento de rotação. Direção positiva da rotZ
           = perceptualmente "puxa" pra esquerda do centro da estrela. */
        .astra-star::before {
          content:    '';
          position:   absolute;
          top:        50%;
          right:      100%;
          width:      26px;
          height:     1.5px;
          transform:  translateY(-50%);
          background: linear-gradient(
            to right,
            transparent 0%,
            color-mix(in srgb, var(--accent) 20%, transparent) 40%,
            color-mix(in srgb, var(--accent) 60%, transparent) 100%
          );
          border-radius: 1px;
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .astra-orbit { animation: none; }
        }
      `}</style>
    </motion.div>
  )
}
