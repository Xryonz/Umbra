/**
 * PageTransition — fade + lift sutil entre rotas.
 *
 * Wrap o elemento da rota; usa AnimatePresence no parent (Routes) pra
 * permitir exit animations. Curva spring orgânica.
 *
 * Uso:
 *   <AnimatePresence mode="wait">
 *     <Routes location={location} key={location.pathname}>
 *       <Route ... element={<PageTransition><MyPage /></PageTransition>} />
 *     </Routes>
 *   </AnimatePresence>
 */
import { motion } from 'motion/react'

// Touch device: blur animado repinta a página inteira por frame — jank
// garantido em GPU mobile. Lá animamos só opacity+x (compositor-only);
// desktop mantém o blur. pointer não muda em runtime → check 1x no módulo.
const COARSE = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

// Mobile: troca de rota quase instantânea (norma de apps nativos — WhatsApp/
// Telegram não têm transição perceptível). Exit de 50ms porque o
// AnimatePresence mode=wait do AppPage espera a saída terminar antes de
// montar a rota nova: exit longo = atraso percebido em CADA navegação.
const VARIANTS = COARSE
  ? {
      initial: { opacity: 0, x: 10 },
      animate: { opacity: 1, x: 0 },
      exit:    { opacity: 0, transition: { duration: 0.05 } },
    }
  : {
      initial: { opacity: 0, x: 18, filter: 'blur(2px)' },
      animate: { opacity: 1, x: 0,  filter: 'blur(0px)' },
      exit:    { opacity: 0, x: -10, filter: 'blur(2px)' },
    }

const DURATION = COARSE ? 0.15 : 0.34

export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={VARIANTS.initial}
      animate={VARIANTS.animate}
      exit={VARIANTS.exit}
      transition={{ duration: DURATION, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      style={{ width: '100%', height: '100%', willChange: COARSE ? 'transform, opacity' : 'transform, opacity, filter' }}
    >
      {children}
    </motion.div>
  )
}
