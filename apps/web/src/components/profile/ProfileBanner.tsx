import { useState } from 'react'
import { Constellation } from '@/components/astra/Constellation'

/**
 * Banner do perfil — imagem com fallback pra gradient/cor sólida.
 * Gradient overlay no rodapé pra contraste do texto/avatar sobreposto.
 * Sem animated borders (dropado no overhaul 2026-06-02).
 */
interface Props {
  bannerUrl?:        string | null
  bannerColor?:      string | null  // hex ou gradient string
  fallbackGradient:  string         // gradient determinístico do user.id
  /** Username — desenha a constelação-assinatura quando não há imagem custom. */
  username?:         string
  /** Posição vertical da img (0-100). Default 50 (centro). */
  positionY?:        number
  /** Zoom da img (100-200). Default 100. */
  scale?:            number
}

export function ProfileBanner({
  bannerUrl, bannerColor, fallbackGradient, username, positionY = 50, scale = 100,
}: Props) {
  const [imgError, setImgError] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const showImage = bannerUrl && !imgError
  // Mostra fallback até a img estar carregada (evita flash de "transparente" quando cor é só img).
  const bg = (!showImage || !imgLoaded) ? (bannerColor ?? fallbackGradient) : undefined

  return (
    <div className="relative h-48 overflow-hidden shrink-0" style={{ background: bg }}>
      {/* Pessoas = estrelas: constelação do username sobre o gradient quando não há banner custom */}
      {!showImage && username && (
        <Constellation
          name={username}
          animated
          className="absolute inset-0 w-full h-full text-white/35 mix-blend-screen"
        />
      )}
      {showImage && (
        <img
          src={bannerUrl!}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          onLoad={() => setImgLoaded(true)}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-(--ease-out-soft)"
          style={{
            opacity:        imgLoaded ? 1 : 0,
            objectPosition: `center ${positionY}%`,
            transform:      `scale(${scale / 100})`,
            transformOrigin: 'center center',
          }}
        />
      )}
      {/* Overlay pra contraste de texto/avatar acima */}
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-linear-to-t from-black/55 to-transparent pointer-events-none" />
    </div>
  )
}
