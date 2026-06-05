import OrbitSpinner from '@/components/astra/OrbitSpinner'

interface SpinnerProps {
  size?:      number
  className?: string
}

/**
 * Spinner — loader minimal. Delega ao OrbitSpinner (3 dots em órbita)
 * pra manter identidade Astra. Mesma API que antes (size + className).
 */
export function Spinner({ size = 16, className }: SpinnerProps) {
  return <OrbitSpinner size={size} className={className} />
}
