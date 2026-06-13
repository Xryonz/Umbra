import { z } from 'zod'

// ─────────────────────────────────────────────
// AUTH SCHEMAS
// ─────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email('E-mail inválido'),
  username: z
    .string()
    .min(3, 'Mínimo 3 caracteres')
    .max(32, 'Máximo 32 caracteres')
    .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e underscore'),
  displayName: z.string().min(1, 'Nome obrigatório').max(64, 'Máximo 64 caracteres'),
  password: z
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Deve conter ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Deve conter ao menos um número'),
})

export const LoginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

// ─────────────────────────────────────────────
// PROFILE UPDATE SCHEMA (NEW)
// ─────────────────────────────────────────────

const BANNER_COLOR_RE = /^(#[0-9a-fA-F]{6}|linear-gradient\(\s*-?\d{1,3}deg\s*,\s*#[0-9a-fA-F]{6}(?:\s*,\s*#[0-9a-fA-F]{6}){1,3}\s*\))$/

export const BANNER_BORDER_STYLES = [
  'none', 'aurora', 'pulse', 'ink',
  'marquee', 'glow', 'noise', 'shimmer',
] as const
export type BannerBorderStyle = (typeof BANNER_BORDER_STYLES)[number]

export const DISPLAY_FONTS = ['serif', 'sans', 'mono', 'rounded', 'condensed', 'handwriting', 'gothic', 'modern'] as const
export type DisplayFont = (typeof DISPLAY_FONTS)[number]

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1, 'Nome obrigatório').max(64).optional(),
  username: z
    .string()
    .min(3).max(32)
    .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e underscore')
    .optional(),
  bio:        z.string().max(300, 'Bio deve ter no máximo 300 caracteres').optional().nullable(),
  avatarUrl:  z.string().optional().nullable(), // URL ou data URI (validação extra na API)
  bannerUrl:  z.string().optional().nullable(),
  bannerColor:  z.string().regex(BANNER_COLOR_RE, 'Cor inválida').optional().nullable(),
  profileTheme: z.string().regex(BANNER_COLOR_RE, 'Cor inválida').optional().nullable(),
  bannerPositionY: z.number().int().min(0).max(100).optional(),
  bannerScale:     z.number().int().min(50).max(200).optional(),
  bannerBorder:    z.enum(BANNER_BORDER_STYLES).optional(),
  bannerTextColor: z.string().regex(HEX_COLOR_RE, 'Use hex #RRGGBB').optional().nullable(),
  pronouns:        z.string().max(32, 'Máx 32 caracteres').optional().nullable(),
  statusEmoji:     z.string().max(8, 'Apenas 1 emoji').optional().nullable(),
  displayFont:     z.enum(DISPLAY_FONTS).optional(),
})

// Guestbook (perfil-notes) schemas
export const ProfileNoteSchema = z.object({
  content: z.string().min(1, 'Nota vazia').max(120, 'Máx 120 caracteres'),
})
export type ProfileNoteInput = z.infer<typeof ProfileNoteSchema>

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

// ─────────────────────────────────────────────
// SERVER SCHEMAS
// ─────────────────────────────────────────────

export const CreateServerSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(100, 'Máximo 100 caracteres'),
  iconUrl: z.string().url().optional(),
  isGroup: z.boolean().optional().default(false),
})

export const CreateGroupSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(100),
})

// ─────────────────────────────────────────────
// CHANNEL SCHEMAS
// ─────────────────────────────────────────────

export const CreateChannelSchema = z.object({
  name: z
    .string()
    .min(1, 'Nome obrigatório')
    .max(50, 'Máximo 50 caracteres')
    .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
  type: z.enum(['TEXT', 'VOICE']).default('TEXT'),
})

// ─────────────────────────────────────────────
// MESSAGE SCHEMAS
// ─────────────────────────────────────────────

// URL precisa ser http/https/relativa (/uploads/...). Bloqueia javascript:/data:
// pra impedir XSS via <a href> renderizado no chat. Sem DOM, regex puro.
const SafeUrlSchema = z.string().min(1).max(2048).refine(
  (s) => s.startsWith('/') || /^https?:\/\//i.test(s),
  { message: 'URL inválida — só http(s) ou /relativa' },
)

export const AttachmentSchema = z.object({
  url:    SafeUrlSchema,
  type:   z.string().max(120), // mime
  name:   z.string().max(255),
  size:   z.number().int().nonnegative().max(50 * 1024 * 1024),
  width:  z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  /** Duração em segundos — pra mensagens de voz */
  duration: z.number().nonnegative().max(3600).optional(),
})

export const SendMessageSchema = z.object({
  content:      z.string().max(4000, 'Máximo 4000 caracteres').default(''),
  replyToId:    z.string().optional(),
  attachments:  z.array(AttachmentSchema).max(10).optional(),
  /** Token gerado pelo cliente pra casar exatamente o new_message do socket
   *  com a versão otimista local. Sem isso o frontend faria dedup heurístico
   *  por author+content+timestamp, que erra em mensagens duplicadas rápidas. */
  clientNonce:  z.string().min(1).max(64).optional(),
  /** TTL em segundos — mensagem efêmera, apagada pelo worker após expirar.
   *  60s mín, 7d máx. Omitir = mensagem permanente. */
  ttlSeconds:   z.number().int().min(60).max(7 * 86_400).optional(),
}).refine((d) => (d.content && d.content.trim().length > 0) || (d.attachments && d.attachments.length > 0), {
  message: 'Mensagem precisa de texto ou anexo',
})

export const EditMessageSchema = z.object({
  content: z.string().min(1).max(4000),
})

export const MessageCursorSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(30),
})

// ─────────────────────────────────────────────
// INFERRED TYPES
// ─────────────────────────────────────────────

export type RegisterInput    = z.infer<typeof RegisterSchema>
export type LoginInput       = z.infer<typeof LoginSchema>
export type CreateServerInput = z.infer<typeof CreateServerSchema>
export type CreateChannelInput = z.infer<typeof CreateChannelSchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>
export type EditMessageInput = z.infer<typeof EditMessageSchema>
export type MessageCursorInput = z.infer<typeof MessageCursorSchema>

// ─────────────────────────────────────────────
// API RESPONSE TYPES
// ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

// ─────────────────────────────────────────────
// DOMAIN TYPES
// ─────────────────────────────────────────────

export interface UserPublic {
  id:          string
  email?:      string
  username:    string
  /** Coordenada Astra (AAAA-BB). Identificador público pra adicionar amigos. */
  coordinate?: string
  displayName: string
  avatarUrl:   string | null
  bio?:        string | null
  bannerUrl?:  string | null
  bannerColor?: string | null
  profileTheme?: string | null
  bannerPositionY?: number
  bannerScale?:     number
  bannerBorder?:    BannerBorderStyle
  bannerTextColor?: string | null
  pronouns?:        string | null
  statusEmoji?:     string | null
  displayFont?:     DisplayFont
  isBot?:      boolean
}

export interface ProfileNote {
  id:        string
  content:   string
  pinned:    boolean
  createdAt: string
  author:    Pick<UserPublic, 'id' | 'username' | 'displayName' | 'avatarUrl'>
}

export interface Reaction {
  emoji: string
  count: number
  users: string[]
}

export interface Attachment {
  url:    string
  type:   string
  name:   string
  size:   number
  width?: number
  height?: number
  /** Prévia borrada (~30 chars) decodificada como placeholder instantâneo. */
  blurhash?: string
}

export interface MessageWithAuthor {
  id:          string
  content:     string
  channelId?:  string
  authorColor?: string | null
  edited:      boolean
  pinned?:     boolean
  mentions?:   string[]
  reactions?:  Reaction[]
  attachments?: Attachment[]
  replyToId?:  string | null
  replyTo?:    ReplyPreview | null
  createdAt:   string
  updatedAt?:  string
  author:      UserPublic
}

export interface ReplyPreview {
  id:           string
  content:      string
  authorName:   string
  authorAvatar: string | null
}

export interface ChannelInfo {
  id: string
  name: string
  type: 'TEXT' | 'VOICE'
  serverId: string
}

export interface ServerWithChannels {
  id: string
  name: string
  iconUrl: string | null
  /** Banner do servidor (null = constelação procedural gerada do nome) */
  bannerUrl: string | null
  inviteCode: string
  ownerId: string
  isGroup: boolean
  messageRetentionDays: number | null
  channels: ChannelInfo[]
  _count: { members: number }
}

// ─────────────────────────────────────────────
// SOCKET EVENT TYPES
// ─────────────────────────────────────────────

export interface SocketEvents {
  join_channel: (channelId: string) => void
  leave_channel: (channelId: string) => void
  typing_start: (channelId: string) => void
  typing_stop: (channelId: string) => void

  new_message: (message: MessageWithAuthor) => void
  message_edited: (payload: { messageId: string; content: string; channelId: string }) => void
  message_deleted: (payload: { messageId: string; channelId: string }) => void
  user_typing: (payload: { userId: string; username: string; channelId: string }) => void
  user_stopped_typing: (payload: { userId: string; channelId: string }) => void
  presence_update: (payload: { userId: string; status: 'online' | 'offline' }) => void
}