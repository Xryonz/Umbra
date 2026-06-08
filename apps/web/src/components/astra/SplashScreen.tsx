import { motion } from 'motion/react'
import AstraLogo from '@/components/AstraLogo'

/**
 * Splash mostrado durante bootstrapAuth() — antes do app montar.
 *
 * Visual: logo Astra central + pinwheel de 6 linhas rotativas atrás
 * (cataventro com delay incremental que cria efeito de hélice se
 * torcendo). Logo cobre o centro do pinwheel, criando ilusão de
 * raios emanando dela.
 *
 * Base do pinwheel: snippet do uiverse.io (Mikael Ainalem-style),
 * adaptado pro tema Astra:
 *   - Cor: var(--accent) prata
 *   - Tamanho maior pra ocupar bem o splash
 *   - Espessura linha + spacing pensados pra ficar legível em void
 *
 * Performance: 6 elementos × 1 keyframe transform = 6 anims compositor.
 * Zero JS no loop. Respeita prefers-reduced-motion.
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
        gap:            '1.75rem',
        background:     'var(--void)',
        pointerEvents:  visible ? 'auto' : 'none',
      }}
    >
      <div className="astra-splash-stage">
        {/* Pinwheel atrás — 6 linhas horizontais com delay incremental.
            Cada uma rota 0→180deg ease-in-out, criando torção em hélice. */}
        <div className="astra-pinwheel">
          <span className="astra-pinwheel__line" />
          <span className="astra-pinwheel__line" />
          <span className="astra-pinwheel__line" />
          <span className="astra-pinwheel__line" />
          <span className="astra-pinwheel__line" />
          <span className="astra-pinwheel__line" />
        </div>

        {/* Logo na frente — fundo void redondo cobre as linhas que passariam
            pelo centro, criando ilusão de "raios emanando" da logo. */}
        <div className="astra-splash-core">
          <AstraLogo size={64} animated />
        </div>

        {/* Glow ambiente — soft halo prata por baixo de tudo, dá profundidade. */}
        <div className="astra-splash-halo" aria-hidden />
      </div>

      <p style={{
        color:         'var(--text-3)',
        fontSize:      '0.75rem',
        fontFamily:    'var(--font-mono)',
        letterSpacing: '0.18em',
        margin:        0,
      }}>
        ASTRA
      </p>

      <style>{`
        .astra-splash-stage {
          position:        relative;
          width:           180px;
          height:          180px;
          display:         flex;
          align-items:     center;
          justify-content: center;
        }

        /* ── Pinwheel ──────────────────────────────────────────── */
        .astra-pinwheel {
          --uib-size:        180px;
          --uib-speed:       0.95s;
          --uib-color:       var(--accent);
          --uib-line-weight: 4px;

          position:        absolute;
          inset:           0;
          display:         flex;
          align-items:     center;
          justify-content: center;
          z-index:         1;
        }
        .astra-pinwheel__line {
          position:      absolute;
          top:           calc(50% - var(--uib-line-weight) / 2);
          left:          0;
          height:        var(--uib-line-weight);
          width:         100%;
          border-radius: calc(var(--uib-line-weight) / 2);
          background:    var(--uib-color);
          box-shadow:    0 0 8px color-mix(in srgb, var(--uib-color) 35%, transparent);
          animation:     astraPinwheelRot var(--uib-speed) ease-in-out infinite;
          will-change:   transform;
        }
        .astra-pinwheel__line:nth-child(2) { animation-delay: calc(var(--uib-speed) * 0.075); opacity: 0.85; }
        .astra-pinwheel__line:nth-child(3) { animation-delay: calc(var(--uib-speed) * 0.15);  opacity: 0.68; }
        .astra-pinwheel__line:nth-child(4) { animation-delay: calc(var(--uib-speed) * 0.225); opacity: 0.50; }
        .astra-pinwheel__line:nth-child(5) { animation-delay: calc(var(--uib-speed) * 0.30);  opacity: 0.32; }
        .astra-pinwheel__line:nth-child(6) { animation-delay: calc(var(--uib-speed) * 0.375); opacity: 0.18; }

        @keyframes astraPinwheelRot {
          0%   { transform: rotate(0deg);   }
          100% { transform: rotate(180deg); }
        }

        /* ── Core: logo no centro ──────────────────────────────── */
        .astra-splash-core {
          position:      relative;
          z-index:       5;
          width:         92px;
          height:        92px;
          border-radius: 50%;
          background:    radial-gradient(
            circle at center,
            var(--void) 0%,
            var(--void) 55%,
            color-mix(in srgb, var(--void) 90%, transparent) 75%,
            transparent 100%
          );
          display:       flex;
          align-items:   center;
          justify-content: center;
        }

        /* ── Halo ambiente: glow soft fixo atrás de tudo ───────── */
        .astra-splash-halo {
          position:      absolute;
          inset:         -20%;
          z-index:       0;
          pointer-events: none;
          background:    radial-gradient(
            circle at center,
            color-mix(in srgb, var(--accent) 12%, transparent) 0%,
            transparent 60%
          );
          filter:        blur(8px);
        }

        @media (prefers-reduced-motion: reduce) {
          .astra-pinwheel__line { animation: none; }
        }
      `}</style>
    </motion.div>
  )
}
