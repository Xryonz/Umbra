/**
 * Store global de chamada de voz (Zustand).
 *
 * livekit-client é importado APENAS via `loadLK()` quando o user entra numa call.
 * No boot do app, esse store é só metadata (state, participants vazio).
 * Isso tira ~120KB gzip do main bundle pra um path que talvez nunca ocorra.
 */
import { create } from 'zustand'
import type {
  Room, RoomEvent as RoomEventT, Track as TrackT, ConnectionState as ConnectionStateT,
  LocalParticipant, Participant,
} from 'livekit-client'
import { api } from '@/lib/api'

export type CallState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error'

export interface CallParticipantInfo {
  identity:        string
  isLocal:         boolean
  isSpeaking:      boolean
  isMicEnabled:    boolean
  isScreenSharing: boolean
  isCameraEnabled: boolean
  participant:     Participant
}

interface VoiceState {
  state:        CallState
  roomName:     string | null
  participants: CallParticipantInfo[]
  error:        string | null
  deafened:     boolean
  /** Volume master 0–1 — aplicado em todos os <audio> remotos */
  volume:       number

  join:         (kind: 'channel' | 'dm', id: string) => Promise<void>
  leave:        () => Promise<void>
  toggleMic:    () => Promise<void>
  toggleScreen: () => Promise<void>
  toggleCamera: () => Promise<void>
  toggleDeafen: () => void
  setVolume:    (v: number) => void
}

const VOLUME_STORAGE_KEY = 'astra-voice-volume'
function loadInitialVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (v === null) return 1
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
  } catch { return 1 }
}

// Mensagens humanas pros erros mais comuns de getUserMedia / LiveKit. Sem
// isso o user vê "NotAllowedError" cru e não sabe o que fazer.
function humanizeMediaError(err: any): string | null {
  const name = err?.name ?? err?.error?.name
  const msg  = String(err?.message ?? '').toLowerCase()
  if (name === 'NotAllowedError' || msg.includes('permission denied')) {
    return 'Permissão negada. Libere mic/câmera nas configs do navegador (cadeado na barra de endereço).'
  }
  if (name === 'NotFoundError' || msg.includes('not found') || msg.includes('no device')) {
    return 'Nenhum microfone/câmera encontrado neste dispositivo.'
  }
  if (name === 'NotReadableError' || msg.includes('in use')) {
    return 'Dispositivo em uso por outro app. Feche zoom/meet/discord e tente de novo.'
  }
  if (name === 'NotSupportedError' || msg.includes('not supported')) {
    return 'Recurso não suportado neste navegador. Atualize ou tente outro browser.'
  }
  if (msg.includes('secure context') || msg.includes('https')) {
    return 'Voz/vídeo exige HTTPS. Acesse a versão segura do site.'
  }
  return null
}

// Singleton — única conexão por aba
let activeRoom: Room | null = null

// LiveKit namespace cache. null antes do primeiro join.
type LKNs = typeof import('livekit-client')
let lkNs: LKNs | null = null
async function loadLK(): Promise<LKNs> {
  if (!lkNs) lkNs = await import('livekit-client')
  return lkNs
}

function snapshot(room: Room, TrackC: typeof TrackT): CallParticipantInfo[] {
  const all: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
  return all.map((p) => ({
    identity:        p.identity,
    isLocal:         p === room.localParticipant,
    isSpeaking:      p.isSpeaking,
    isMicEnabled:    p.isMicrophoneEnabled,
    isScreenSharing: p.getTrackPublications().some(
      (t) => t.source === TrackC.Source.ScreenShare && !!t.track && !t.isMuted,
    ),
    isCameraEnabled: p.getTrackPublications().some(
      (t) => t.source === TrackC.Source.Camera && !!t.track && !t.isMuted,
    ),
    participant:     p,
  }))
}

function bindRoomEvents(
  RoomEventC: typeof RoomEventT,
  room: Room,
  refresh: () => void,
  onDisc: () => void,
) {
  const onUpdate = () => refresh()
  room.on(RoomEventC.ParticipantConnected,    onUpdate)
  room.on(RoomEventC.ParticipantDisconnected, onUpdate)
  room.on(RoomEventC.TrackMuted,              onUpdate)
  room.on(RoomEventC.TrackUnmuted,            onUpdate)
  room.on(RoomEventC.TrackSubscribed,         onUpdate)
  room.on(RoomEventC.TrackUnsubscribed,       onUpdate)
  room.on(RoomEventC.LocalTrackPublished,     onUpdate)
  room.on(RoomEventC.LocalTrackUnpublished,   onUpdate)
  room.on(RoomEventC.ActiveSpeakersChanged,   onUpdate)
  room.on(RoomEventC.Disconnected,            onDisc)
}

export const useVoiceStore = create<VoiceState>((set, get) => {
  const refresh = () => {
    if (activeRoom && lkNs) set({ participants: snapshot(activeRoom, lkNs.Track) })
  }
  const handleDisc = () => {
    activeRoom = null
    set({ state: 'idle', roomName: null, participants: [], error: null })
  }

  return {
    state:        'idle',
    roomName:     null,
    participants: [],
    error:        null,
    deafened:     false,
    volume:       loadInitialVolume(),

    join: async (kind, id) => {
      const targetName = `${kind}:${id}`
      const lk = await loadLK()
      const { Room, ConnectionState, RoomEvent, Track } = lk

      if (activeRoom?.state === ConnectionState.Connected && activeRoom.name === targetName) return

      if (activeRoom) {
        try { await activeRoom.disconnect() } catch {}
        activeRoom = null
      }
      set({ state: 'connecting', error: null })
      try {
        const tokenRes = await api.post('/api/voice/token', { roomKind: kind, roomId: id })
        const { token, url } = tokenRes.data.data

        // adaptiveStream OFF: pra screen share, ele pausava/retomava a
        // layer alta baseado em visibilidade do <video> remoto → flicker
        // visível em tile pequeno ou troca de aba. Em calls pequenas a
        // economia de banda não compensa.
        // dynacast continua ON — publisher-side, escala simulcast layers
        // pela demanda agregada dos subscribers.
        const room = new Room({
          adaptiveStream: false,
          dynacast:       true,
          // Limpeza de captura: o trio que WhatsApp/Discord ligam por
          // padrão — eco, ruído de fundo e ganho automático.
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
          },
          // Voz a 48kbps (preset music) em vez dos ~32k default — mais
          // corpo na voz. dtx (silêncio não transmite) + red (pacotes
          // redundantes) explícitos pra resiliência em wifi/4G oscilando.
          publishDefaults: {
            audioPreset: lk.AudioPresets.music,
            dtx: true,
            red: true,
          },
        })
        bindRoomEvents(RoomEvent, room, refresh, handleDisc)
        await room.connect(url, token)

        // Mic habilitado pós-connect — se permissão negada (NotAllowedError no
        // mobile / browser bloqueou), entra mudo e o user pode reativar depois
        // via botão. Antes a exception derrubava a call inteira.
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
        } catch (micErr: any) {
          console.warn('[voice] mic permission denied/error — entrando mudo:', micErr?.message)
        }

        activeRoom = room
        set({
          state:        'connected',
          roomName:     room.name,
          participants: snapshot(room, Track),
        })
      } catch (e: any) {
        const msg = humanizeMediaError(e) ?? e?.response?.data?.error ?? e?.message ?? 'Falha ao conectar'
        if (activeRoom) { try { await activeRoom.disconnect() } catch {} activeRoom = null }
        set({ state: 'error', error: msg })
      }
    },

    leave: async () => {
      if (!activeRoom) { set({ state: 'idle' }); return }
      set({ state: 'disconnecting' })
      try { await activeRoom.disconnect() } catch {}
      activeRoom = null
      set({ state: 'idle', roomName: null, participants: [] })
    },

    toggleMic: async () => {
      if (!activeRoom) return
      const lp = activeRoom.localParticipant as LocalParticipant
      try {
        await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
        set({ error: null })
      } catch (e: any) {
        set({ error: humanizeMediaError(e) ?? 'Falha ao acessar microfone' })
      }
      refresh()
    },

    toggleScreen: async () => {
      if (!activeRoom || !lkNs) return
      const lp = activeRoom.localParticipant as LocalParticipant
      const sharing = lp.getTrackPublications().some(
        (t) => t.source === lkNs!.Track.Source.ScreenShare && !!t.track && !t.isMuted,
      )
      if (sharing) {
        try { await lp.setScreenShareEnabled(false) } catch {}
      } else {
        // Detecta screen-share não-suportado (mobile, certos webviews) ANTES
        // de pedir permissão pra dar erro humano em vez de NotAllowedError.
        if (typeof navigator === 'undefined' ||
            !navigator.mediaDevices ||
            !('getDisplayMedia' in navigator.mediaDevices)) {
          set({ error: 'Compartilhamento de tela não é suportado neste navegador (mobile, em geral).' })
          return
        }
        try {
          // ── 1080p60 estável ──────────────────────────────────
          //  - resolution.frameRate: 60 vai no getDisplayMedia (browser
          //    pede 60fps ao OS). Sem isso, default = 30fps.
          //  - publishOptions.videoEncoding.maxFramerate: 60 informa o
          //    encoder. Sem ambos sincronizados, o encoder pode capear em 30.
          //  - simulcast OFF pra screen: 1 camada full bitrate em vez de
          //    3 camadas, evita layers switching → flicker visual.
          //  - audio: false (compartilhar áudio do sistema é separado).
          //  - contentHint: ainda não tipado em options.d.ts; aplicado direto
          //    na MediaStreamTrack após publish (vê hook abaixo).
          const pub = await lp.setScreenShareEnabled(
            true,
            { resolution: { width: 1920, height: 1080, frameRate: 60 }, audio: false },
            // 8Mbps: a 5Mbps, 1080p60 com muito movimento (jogo) mostrava
            // macroblocking. Browser entrega no máx 60fps de captura —
            // 120fps não existe em getDisplayMedia, o teto é do Chrome.
            { videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 }, simulcast: false },
          )
          // contentHint = 'motion' diz ao encoder pra priorizar fluidez
          // (smearing aceitável) em vez de nitidez por frame — crítico
          // pra screen com vídeo/jogo. Pra "detail" (código, slides), o
          // browser já tende a usar text por padrão do getDisplayMedia.
          const track = pub?.track?.mediaStreamTrack
          if (track && 'contentHint' in track) {
            try { (track as any).contentHint = 'motion' } catch {}
          }
          set({ error: null })
        } catch (e: any) {
          set({ error: humanizeMediaError(e) ?? 'Falha ao compartilhar tela' })
        }
      }
      refresh()
    },

    toggleCamera: async () => {
      if (!activeRoom || !lkNs) return
      const lp = activeRoom.localParticipant as LocalParticipant
      const on = lp.getTrackPublications().some(
        (t) => t.source === lkNs!.Track.Source.Camera && !!t.track && !t.isMuted,
      )
      try {
        if (on) {
          await lp.setCameraEnabled(false)
        } else {
          // 720p @ 30fps padrão LiveKit — suficiente pra webcam, baixo CPU.
          // dynacast escala pra baixo quando tile do subscriber é pequeno.
          await lp.setCameraEnabled(true)
        }
        set({ error: null })
      } catch (e: any) {
        set({ error: humanizeMediaError(e) ?? 'Falha ao acessar câmera' })
      }
      refresh()
    },

    toggleDeafen: () => {
      const next = !get().deafened
      set({ deafened: next })
      // Aplica APENAS em audio[data-astra-voice] — não polui VoiceMessage / outros
      document.querySelectorAll<HTMLAudioElement>('audio[data-astra-voice]').forEach((a) => {
        a.muted = next
      })
    },

    setVolume: (v) => {
      const clamped = Math.max(0, Math.min(1, v))
      set({ volume: clamped })
      const deafened = get().deafened
      document.querySelectorAll<HTMLAudioElement>('audio[data-astra-voice]').forEach((a) => {
        a.volume = clamped
        a.muted  = deafened
      })
      try { localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped)) } catch {}
    },
  }
})

export function parseRoomName(name: string | null): { kind: 'channel' | 'dm'; id: string } | null {
  if (!name) return null
  const [kind, id] = name.split(':')
  if ((kind === 'channel' || kind === 'dm') && id) return { kind, id }
  return null
}

// Silenciar warning unused — tipos importados são usados via parâmetros tipados.
export type _UnusedKeepTypes = ConnectionStateT
