import { motion } from 'motion/react'
import AstraLogo from '@/components/AstraLogo'

/**
 * Splash mostrado durante bootstrapAuth() — antes do app montar.
 *
 * Logo Astra ao centro + 3 dots orbitando ao redor (sugerindo
 * carregamento + estabelecendo identidade astral).
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
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <div style={{
          position:       'absolute',
          inset:          0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
        }}>
          <AstraLogo size={64} animated />
        </div>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            style={{
              position:     'absolute',
              top:          '50%',
              left:         '50%',
              width:        4,
              height:       4,
              marginTop:    -2,
              marginLeft:   -2,
              borderRadius: '50%',
              background:   'var(--accent)',
              boxShadow:    '0 0 8px var(--accent)',
            }}
            animate={{
              x: Array.from({ length: 13 }, (_, k) => 50 * Math.cos((k / 12) * 2 * Math.PI + i * (2 * Math.PI / 3))),
              y: Array.from({ length: 13 }, (_, k) => 50 * Math.sin((k / 12) * 2 * Math.PI + i * (2 * Math.PI / 3))),
            }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </div>
      <p style={{
        color:      'var(--text-3)',
        fontSize:   '0.75rem',
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.1em',
        margin: 0,
      }}>
        ASTRA
      </p>
    </motion.div>
  )
}
