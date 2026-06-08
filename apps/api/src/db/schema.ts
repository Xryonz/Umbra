import {
  pgTable, text, boolean, timestamp, integer, pgEnum, uniqueIndex, index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { createId } from './cuid'

// ─── Enums ────────────────────────────────────────────────────
export const roleEnum        = pgEnum('Role',        ['OWNER', 'ADMIN', 'MEMBER'])
export const channelTypeEnum = pgEnum('ChannelType', ['TEXT', 'VOICE'])
export const userStatusEnum  = pgEnum('UserStatus',  ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'])

// ─── User ─────────────────────────────────────────────────────
export const users = pgTable('User', {
  id:           text('id').primaryKey().$defaultFn(createId),
  email:        text('email').notNull().unique(),
  username:     text('username').notNull().unique(),
  /** Coordenada Astra: 'AAAA-BB' (6 hex + hífen). Identificador público
   *  pra adicionar amigos via convite. Derivado deterministicamente de md5(id). */
  coordinate:   text('coordinate').notNull().unique(),
  displayName:  text('displayName').notNull(),
  avatarUrl:    text('avatarUrl'),
  bio:          text('bio'),
  googleId:     text('googleId').unique(),
  passwordHash: text('passwordHash'),
  isBot:        boolean('isBot').notNull().default(false),
  bannerUrl:    text('bannerUrl'),
  bannerColor:  text('bannerColor'),
  profileTheme: text('profileTheme'),
  /** Posição vertical do banner em %. 0=topo, 100=base. Default 50 (centro). */
  bannerPositionY: integer('bannerPositionY').notNull().default(50),
  /** Zoom do banner em %. 100=nativo, 200=2x. Limite seguro [100,200]. */
  bannerScale:     integer('bannerScale').notNull().default(100),
  /** Estilo de borda animada: 'none' | 'aurora' | 'pulse' | 'ink'. */
  bannerBorder:    text('bannerBorder').notNull().default('none'),
  /** Pronouns (livre, max 32). Ex: "ela/dela", "they/them". */
  pronouns:     text('pronouns'),
  /** Emoji opcional antes do custom status. 1 codepoint (até 8 bytes UTF). */
  statusEmoji:  text('statusEmoji'),
  /** Family p/ displayName + bio. Enum: serif|sans|mono|... */
  displayFont:  text('displayFont').notNull().default('serif'),
  /** Cor de texto no banner (label "Profil · No."). Hex. null = auto contrast. */
  bannerTextColor: text('bannerTextColor'),
  status:       userStatusEnum('status').notNull().default('ONLINE'),
  /** Frase curta tipo "Compilando…" / "Fora hoje". Limite 100 chars no app. */
  customStatus: text('customStatus'),
  /** JSON: { mentions, dms, reactions, replies, sounds, quietStart, quietEnd }. null = defaults */
  notificationPrefs: text('notificationPrefs'),
  /** JSON: { accent, bg, ...future }. Tema/aparência sincronizado entre devices.
   *  Salvo no PATCH /profile/preferences; lido em /auth/me e aplicado no bootstrap. */
  preferences:  text('preferences'),
  createdAt:    timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  updatedAt:    timestamp('updatedAt', { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
})

// ─── ProfileNote ──────────────────────────────────────────────
// Guestbook: outras pessoas deixam 1 nota curta no perfil de alguém.
// Unique(profileUserId, authorId) — cada user pode deixar 1 nota só por perfil.
export const profileNotes = pgTable('ProfileNote', {
  id:            text('id').primaryKey().$defaultFn(createId),
  profileUserId: text('profileUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  authorId:      text('authorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content:       text('content').notNull(),
  pinned:        boolean('pinned').notNull().default(false),
  createdAt:     timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byProfileTime: index('ProfileNote_profileUserId_createdAt_idx').on(t.profileUserId, t.createdAt),
  uniqAuthor:    uniqueIndex('ProfileNote_profileUserId_authorId_key').on(t.profileUserId, t.authorId),
}))

// ─── MutedMember ──────────────────────────────────────────────
export const mutedMembers = pgTable('MutedMember', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  serverId:  text('serverId').notNull(),
  mutedById: text('mutedById').notNull(),
  reason:    text('reason').notNull().default('Spam automático'),
  expiresAt: timestamp('expiresAt', { precision: 3 }).notNull(),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqUserServer: uniqueIndex('MutedMember_userId_serverId_key').on(t.userId, t.serverId),
  byServer:       index('MutedMember_serverId_idx').on(t.serverId),
  byExpires:      index('MutedMember_expiresAt_idx').on(t.expiresAt),
}))

// ─── RefreshToken ─────────────────────────────────────────────
export const refreshTokens = pgTable('RefreshToken', {
  id:         text('id').primaryKey().$defaultFn(createId),
  token:      text('token').notNull().unique(),
  userId:     text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt:  timestamp('expiresAt', { precision: 3 }).notNull(),
  createdAt:  timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  revokedAt:  timestamp('revokedAt', { precision: 3 }),
  /** User-Agent do login — pra UI mostrar "iPhone Safari", "Chrome Mac" */
  userAgent:  text('userAgent'),
  /** IP de origem (truncado /24 IPv4 ou /48 IPv6 por privacidade) */
  ip:         text('ip'),
  /** Atualizado a cada /refresh — UI marca "ativa há 2min" / "há 3d" */
  lastUsedAt: timestamp('lastUsedAt', { precision: 3 }),
}, (t) => ({
  byUser: index('RefreshToken_userId_idx').on(t.userId),
}))

// ─── Server ───────────────────────────────────────────────────
export const servers = pgTable('Server', {
  id:         text('id').primaryKey().$defaultFn(createId),
  name:       text('name').notNull(),
  iconUrl:    text('iconUrl'),
  inviteCode: text('inviteCode').notNull().unique().$defaultFn(createId),
  ownerId:    text('ownerId').notNull().references(() => users.id),
  isGroup:    boolean('isGroup').notNull().default(false),
  /** dias de retenção das mensagens (null = guarda pra sempre) */
  messageRetentionDays: integer('messageRetentionDays'),
  createdAt:  timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  updatedAt:  timestamp('updatedAt', { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
})

// ─── ServerMember ─────────────────────────────────────────────
export const serverMembers = pgTable('ServerMember', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  serverId:  text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  role:      roleEnum('role').notNull().default('MEMBER'),
  nameColor: text('nameColor'),
  joinedAt:  timestamp('joinedAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqUserServer: uniqueIndex('ServerMember_userId_serverId_key').on(t.userId, t.serverId),
  byServer:       index('ServerMember_serverId_idx').on(t.serverId),
  byUser:         index('ServerMember_userId_idx').on(t.userId),
}))

// ─── ServerEmoji ──────────────────────────────────────────────
// Emojis custom (estilo Discord). Cada server tem até MAX_EMOJIS.
// Uso: msg.content vira ":nome:" — frontend resolve via servidor ativo.
export const serverEmojis = pgTable('ServerEmoji', {
  id:        text('id').primaryKey().$defaultFn(createId),
  serverId:  text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  url:       text('url').notNull(),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqName: uniqueIndex('ServerEmoji_serverId_name_key').on(t.serverId, t.name),
  byServer: index('ServerEmoji_serverId_idx').on(t.serverId),
}))

// ─── Role ─────────────────────────────────────────────────────
// Cargo customizado por servidor (estilo Discord).
// permissions é um JSON array de strings tipo ["MANAGE_CHANNELS","KICK_MEMBERS",...]
// Tabela chamada 'ServerRole' pra não conflitar com o pgEnum 'Role' legado (OWNER/ADMIN/MEMBER)
export const roles = pgTable('ServerRole', {
  id:          text('id').primaryKey().$defaultFn(createId),
  serverId:    text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  color:       text('color'),                   // hex tipo '#c9a96e' ou null = sem cor
  position:    integer('position').notNull().default(0), // maior = mais alto
  permissions: text('permissions').notNull().default('[]'),
  hoist:       boolean('hoist').notNull().default(false), // exibe em seção separada na member list
  createdAt:   timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byServer: index('ServerRole_serverId_idx').on(t.serverId),
}))

// ─── MemberRole ───────────────────────────────────────────────
export const memberRoles = pgTable('ServerMemberRole', {
  id:        text('id').primaryKey().$defaultFn(createId),
  memberId:  text('memberId').notNull().references(() => serverMembers.id, { onDelete: 'cascade' }),
  roleId:    text('roleId').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqMemberRole: uniqueIndex('ServerMemberRole_memberId_roleId_key').on(t.memberId, t.roleId),
  byMember:       index('ServerMemberRole_memberId_idx').on(t.memberId),
  byRole:         index('ServerMemberRole_roleId_idx').on(t.roleId),
}))

// ─── ServerBan ────────────────────────────────────────────────
// Banimento por user (não por member, pra sobreviver ao kick) → bloqueia rejoin.
export const serverBans = pgTable('ServerBan', {
  id:          text('id').primaryKey().$defaultFn(createId),
  serverId:    text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  userId:      text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bannedById:  text('bannedById').notNull().references(() => users.id),
  reason:      text('reason'),
  createdAt:   timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqServerUser: uniqueIndex('ServerBan_serverId_userId_key').on(t.serverId, t.userId),
  byServer:       index('ServerBan_serverId_idx').on(t.serverId),
}))

// ─── ServerAuditLog ───────────────────────────────────────────
// Trilha de auditoria de ações administrativas. action é string livre tipo
// 'MEMBER_KICK', 'ROLE_CREATE', etc. metadata é JSON encoded.
export const auditLogs = pgTable('ServerAuditLog', {
  id:        text('id').primaryKey().$defaultFn(createId),
  serverId:  text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  actorId:   text('actorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action:    text('action').notNull(),
  targetId:  text('targetId'),         // userId / channelId / roleId / messageId conforme action
  metadata:  text('metadata').notNull().default('{}'),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byServerCreated: index('ServerAuditLog_serverId_createdAt_idx').on(t.serverId, t.createdAt.desc()),
}))

// ─── Channel ──────────────────────────────────────────────────
// isPrivate=true → só visível pra members com role listada em ChannelRolePerm.
// isPrivate=false (default) → todos members veem.
export const channels = pgTable('Channel', {
  id:        text('id').primaryKey().$defaultFn(createId),
  name:      text('name').notNull(),
  type:      channelTypeEnum('type').notNull().default('TEXT'),
  serverId:  text('serverId').notNull().references(() => servers.id, { onDelete: 'cascade' }),
  isPrivate: boolean('isPrivate').notNull().default(false),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byServer: index('Channel_serverId_idx').on(t.serverId),
}))

// ─── ChannelRolePerm ──────────────────────────────────────────
// Quais roles tem acesso ao canal privado. Owner sempre vê (não precisa de row).
// Se canal é privado e não tem nenhuma row → ninguém (exceto owner) vê.
export const channelRolePerms = pgTable('ChannelRolePerm', {
  id:        text('id').primaryKey().$defaultFn(createId),
  channelId: text('channelId').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  roleId:    text('roleId').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqChannelRole: uniqueIndex('ChannelRolePerm_channelId_roleId_key').on(t.channelId, t.roleId),
  byChannel:       index('ChannelRolePerm_channelId_idx').on(t.channelId),
  byRole:          index('ChannelRolePerm_roleId_idx').on(t.roleId),
}))

// ─── Thread ───────────────────────────────────────────────────
export const threads = pgTable('Thread', {
  id:              text('id').primaryKey().$defaultFn(createId),
  channelId:       text('channelId').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  parentMessageId: text('parentMessageId').notNull(),  // sem FK — msg pode ser apagada
  name:            text('name').notNull(),
  createdById:     text('createdById').notNull().references(() => users.id),
  createdAt:       timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  updatedAt:       timestamp('updatedAt', { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  byChannel: index('Thread_channelId_idx').on(t.channelId),
  byParent:  index('Thread_parentMessageId_idx').on(t.parentMessageId),
}))

// ─── Message ──────────────────────────────────────────────────
export const messages = pgTable('Message', {
  id:          text('id').primaryKey().$defaultFn(createId),
  content:     text('content').notNull(),
  authorId:    text('authorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId:   text('channelId').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  threadId:    text('threadId'),   // null = msg do canal raiz; setado = msg em thread
  replyToId:   text('replyToId'),  // self-ref sem FK — validação no app
  authorColor: text('authorColor'),
  /** JSON-encoded array of { url, type, name, size, width?, height? } */
  attachments: text('attachments').notNull().default('[]'),
  mentions:    text('mentions').notNull().default(''),
  edited:      boolean('edited').notNull().default(false),
  pinned:      boolean('pinned').notNull().default(false),
  /** JSON: { question, options: [{id, text, votes: userId[]}], allowMultiple, expiresAt }. null = não-poll */
  poll:        text('poll'),
  /** Mensagem efêmera: depois deste timestamp, retention worker apaga + clients escondem */
  expiresAt:   timestamp('expiresAt', { precision: 3 }),
  deletedAt:   timestamp('deletedAt', { precision: 3 }),
  createdAt:   timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
  updatedAt:   timestamp('updatedAt', { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  byChannelCreated: index('Message_channelId_createdAt_idx').on(t.channelId, t.createdAt.desc()),
  byAuthor:         index('Message_authorId_idx').on(t.authorId),
  byChannelPinned:  index('Message_channelId_pinned_idx').on(t.channelId, t.pinned),
  byReplyTo:        index('Message_replyToId_idx').on(t.replyToId),
  byThread:         index('Message_threadId_idx').on(t.threadId),
  byExpires:        index('Message_expiresAt_idx').on(t.expiresAt),
}))

// ─── ChannelRead ──────────────────────────────────────────────
// Read receipt por user × canal. Last time the user "saw" the channel.
// Frontend usa pra calcular unread (msgs.createdAt > lastReadAt).
export const channelReads = pgTable('ChannelRead', {
  id:         text('id').primaryKey().$defaultFn(createId),
  userId:     text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId:  text('channelId').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('lastReadAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqUserChannel: uniqueIndex('ChannelRead_userId_channelId_key').on(t.userId, t.channelId),
  byUser:          index('ChannelRead_userId_idx').on(t.userId),
}))

// ─── ChannelNotifPref ─────────────────────────────────────────
// Preferência de notificação por canal: 'all' (todas msgs), 'mentions'
// (só @me + replies), 'mute' (silencia tudo). Default = 'all' (sem row).
// Lookup O(1) via uniqueIndex (userId, channelId).
export const channelNotifPrefs = pgTable('ChannelNotifPref', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: text('channelId').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  /** 'all' | 'mentions' | 'mute' */
  mode:      text('mode').notNull().default('all'),
  updatedAt: timestamp('updatedAt', { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqUserChannel: uniqueIndex('ChannelNotifPref_userId_channelId_key').on(t.userId, t.channelId),
}))

// ─── MessageEdit ──────────────────────────────────────────────
// Histórico de edições. Cada vez que user edita uma msg, salva versão anterior.
// Permite "ver histórico" no chat (tipo Slack).
export const messageEdits = pgTable('MessageEdit', {
  id:        text('id').primaryKey().$defaultFn(createId),
  messageId: text('messageId').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  content:   text('content').notNull(),
  editedAt:  timestamp('editedAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byMessage: index('MessageEdit_messageId_idx').on(t.messageId, t.editedAt.desc()),
}))

// ─── MessageReaction ──────────────────────────────────────────
export const messageReactions = pgTable('MessageReaction', {
  id:        text('id').primaryKey().$defaultFn(createId),
  messageId: text('messageId').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji:     text('emoji').notNull(),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniq:      uniqueIndex('MessageReaction_messageId_userId_emoji_key').on(t.messageId, t.userId, t.emoji),
  byMessage: index('MessageReaction_messageId_idx').on(t.messageId),
}))

// ─── DMConversation ───────────────────────────────────────────
// lastReadByA/B = quando A (ou B) viu a conv pela última vez. Frontend usa
// pra mostrar "Visto" no último envio do user e dot de unread na lista de DMs.
export const dmConversations = pgTable('DMConversation', {
  id:           text('id').primaryKey().$defaultFn(createId),
  userAId:      text('userAId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userBId:      text('userBId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadByA:  timestamp('lastReadByA', { precision: 3 }),
  lastReadByB:  timestamp('lastReadByB', { precision: 3 }),
  createdAt:    timestamp('createdAt',   { precision: 3 }).notNull().defaultNow(),
  updatedAt:    timestamp('updatedAt',   { precision: 3 }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  uniqPair: uniqueIndex('DMConversation_userAId_userBId_key').on(t.userAId, t.userBId),
  // Composite (user, updatedAt desc) cobre o GET /api/dm que lista conversas
  // ordenadas por última atividade — Postgres usa index-only scan + sem ordenação.
  byAUpdated: index('DMConversation_userAId_updatedAt_idx').on(t.userAId, t.updatedAt.desc()),
  byBUpdated: index('DMConversation_userBId_updatedAt_idx').on(t.userBId, t.updatedAt.desc()),
}))

// ─── DirectMessage ────────────────────────────────────────────
export const directMessages = pgTable('DirectMessage', {
  id:             text('id').primaryKey().$defaultFn(createId),
  content:        text('content').notNull(),
  senderId:       text('senderId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  receiverId:     text('receiverId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversationId').notNull().references(() => dmConversations.id, { onDelete: 'cascade' }),
  /** JSON array de anexos — mesmo shape do Message.attachments */
  attachments:    text('attachments').notNull().default('[]'),
  /** Self-ref pra reply (validação no app, sem FK) */
  replyToId:      text('replyToId'),
  /** Mensagem efêmera — apaga após esse timestamp */
  expiresAt:      timestamp('expiresAt', { precision: 3 }),
  edited:         boolean('edited').notNull().default(false),
  deletedAt:      timestamp('deletedAt', { precision: 3 }),
  createdAt:      timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byConversation: index('DirectMessage_conversationId_createdAt_idx').on(t.conversationId, t.createdAt.desc()),
  bySender:       index('DirectMessage_senderId_idx').on(t.senderId),
  byReplyTo:      index('DirectMessage_replyToId_idx').on(t.replyToId),
  byExpires:      index('DirectMessage_expiresAt_idx').on(t.expiresAt),
}))

// ─── PushSubscription ─────────────────────────────────────────
export const pushSubscriptions = pgTable('PushSubscription', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint:  text('endpoint').notNull(),
  p256dh:    text('p256dh').notNull(),
  auth:      text('auth').notNull(),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqEndpoint: uniqueIndex('PushSubscription_endpoint_key').on(t.endpoint),
  byUser:       index('PushSubscription_userId_idx').on(t.userId),
}))

// ─── Friendship ───────────────────────────────────────────────
// Par sempre normalizado (id menor primeiro) pra evitar duplicatas (A,B)+(B,A).
// requesterId guarda quem mandou — quem RECEBE pode aceitar.
export const friendships = pgTable('Friendship', {
  id:          text('id').primaryKey().$defaultFn(createId),
  userAId:     text('userAId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userBId:     text('userBId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requesterId: text('requesterId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status:      text('status').notNull().default('pending'), // 'pending' | 'accepted'
  acceptedAt:  timestamp('acceptedAt', { precision: 3 }),
  createdAt:   timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqPair: uniqueIndex('Friendship_userAId_userBId_key').on(t.userAId, t.userBId),
  // (userX, status) cobre os filtros mais comuns: "todos os amigos aceitos" e
  // "pedidos pendentes recebidos". status tem alta cardinalidade só de 2 valores
  // mas o sub-conjunto por user é pequeno → ainda compensa.
  byAStatus: index('Friendship_userAId_status_idx').on(t.userAId, t.status),
  byBStatus: index('Friendship_userBId_status_idx').on(t.userBId, t.status),
}))

// ─── Reminder ─────────────────────────────────────────────────
// User cria lembrete (/lembre ... em 2h). Worker dispara dueAt, marca deliveredAt.
// targetUserId pode ser diferente do creator quando user pinga outro alguém.
export const reminders = pgTable('Reminder', {
  id:           text('id').primaryKey().$defaultFn(createId),
  creatorId:    text('creatorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: text('targetUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content:      text('content').notNull(),
  channelId:    text('channelId'),       // se setado, manda no canal; senão DM
  dueAt:        timestamp('dueAt', { precision: 3 }).notNull(),
  deliveredAt:  timestamp('deliveredAt', { precision: 3 }),
  createdAt:    timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byDuePending: index('Reminder_dueAt_deliveredAt_idx').on(t.dueAt, t.deliveredAt),
  byTarget:     index('Reminder_targetUserId_idx').on(t.targetUserId),
  byCreator:    index('Reminder_creatorId_idx').on(t.creatorId),
}))

// ─── Bookmark ─────────────────────────────────────────────────
// User salva uma msg (qualquer canal/dm) pra reler depois. Note pessoal opcional.
export const bookmarks = pgTable('Bookmark', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Pode ser messageId (canal/thread) ou directMessageId (DM). Discriminado por `kind`. */
  targetId:  text('targetId').notNull(),
  kind:      text('kind').notNull(), // 'message' | 'dm'
  note:      text('note'),           // texto opcional do user
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  uniqUserTarget:  uniqueIndex('Bookmark_userId_targetId_kind_key').on(t.userId, t.targetId, t.kind),
  byUserCreated:   index('Bookmark_userId_createdAt_idx').on(t.userId, t.createdAt.desc()),
}))

// ─── Notification ─────────────────────────────────────────────
// Feed in-app por user. type discrimina (mention/dm/reaction/reply).
// payload = JSON com dados pra renderizar (autor, preview, url, etc).
// readAt null = não lido. Após 30d, retentionWorker pode limpar lidas.
export const notifications = pgTable('Notification', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:      text('type').notNull(),  // 'mention'|'dm'|'reaction'|'reply'
  payload:   text('payload').notNull().default('{}'),
  readAt:    timestamp('readAt', { precision: 3 }),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byUserCreated: index('Notification_userId_createdAt_idx').on(t.userId, t.createdAt.desc()),
  byUserUnread:  index('Notification_userId_readAt_idx').on(t.userId, t.readAt),
}))

// ─── WishingStar ──────────────────────────────────────────────
// Sugestões públicas globais do que mudar/melhorar no site.
// Sem soft-delete: user que apaga conta perde wishes via FK cascade.
export const wishingStars = pgTable('WishingStar', {
  id:        text('id').primaryKey().$defaultFn(createId),
  userId:    text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content:   text('content').notNull(),
  createdAt: timestamp('createdAt', { precision: 3 }).notNull().defaultNow(),
}, (t) => ({
  byCreated: index('WishingStar_createdAt_idx').on(t.createdAt.desc()),
  byUser:    index('WishingStar_userId_idx').on(t.userId),
}))

// Marker so TS doesn't tree-shake `sql` if unused above:
export const _sqlMarker = sql`1`
