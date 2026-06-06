# Astra

Plataforma de mensagens em tempo real — editorial-dark, anti-Discord. Servidores, canais, DMs, voz, threads, reações, bookmarks, mentions, push notifications.

---

## Stack

**Frontend** (`apps/web`)
- React 19 · Vite 8 · TypeScript 5.4
- Tailwind v4 · shadcn/ui (Radix) · motion/react
- Zustand · React Query 5 · React Router 6

**Backend** (`apps/api`)
- Express 4 · TypeScript · Drizzle ORM 0.45
- PostgreSQL · Redis (ioredis) · Socket.io · LiveKit

**Monorepo:** npm workspaces · `packages/types` (Zod compartilhado)

---

## Setup local

Requer Node 20+, PostgreSQL e Redis rodando.

```bash
# 1. Instalar deps
npm install

# 2. Configurar envs (copia .example, preenche)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. Migrar DB
npm run db:migrate

# 4. Dev (front + api juntos)
npm run dev
```

Front em `http://localhost:5173` · API em `http://localhost:3001`.

---

## Deploy

### Frontend → Vercel

1. New Project → Import repo
2. Root Directory: deixe na raiz (vercel.json no root cuida)
3. Environment Variables:
   - `VITE_API_URL` = URL pública da API Railway (sem barra final)
   - `VITE_SENTRY_DSN` (opcional)
4. Deploy

`vercel.json` já configura: `npm run build:web` → `apps/web/dist` + SPA rewrites + cache headers pra assets.

### Backend → Railway

1. New Project → Deploy from GitHub
2. Add Plugins: **PostgreSQL** + **Redis**
3. Environment Variables (ver `apps/api/.env.example` pra lista completa):
   - `DATABASE_URL` (Railway preenche se PostgreSQL plugin)
   - `REDIS_URL` (Railway preenche se Redis plugin)
   - `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` (gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
   - `CLIENT_URL` = URL do front Vercel (sem barra final)
   - `API_URL` = URL pública desta API (sem barra final)
4. Deploy

`railway.json` já configura: NIXPACKS + `npm run build:api` → `npm run db:migrate && npm run start:api` + restart on failure (3x).

### Pós-deploy

1. Atualizar `CLIENT_URL` na API com URL Vercel
2. Atualizar `VITE_API_URL` no Vercel com URL Railway
3. Em Google Console: adicionar `https://<vercel-url>/auth/callback` em "Authorized redirect URIs"

---

## Scripts úteis

```bash
npm run dev          # front + api juntos (com predev hook)
npm run dev:fast     # mesmo, sem predev (skip migrate + port check)
npm run build        # build types + api + web
npm run build:api    # só API
npm run build:web    # só front
npm run test:e2e     # playwright smoke + mobile
npm run db:migrate   # rodar migrations Drizzle

# API workspace
npm test -w apps/api          # vitest
npm run db:studio -w apps/api # Drizzle Studio
```

---

## Stack opcionais

API roda com qualquer um destes vazio (feature fica off em fallback):

- `LIVEKIT_*` — sem isso, voz/vídeo off
- `ANTHROPIC_API_KEY` — sem isso, bot/AI off
- `GIPHY_API_KEY` — sem isso, picker GIF escondido
- `VAPID_*` — sem isso, push notifications off
- `SENTRY_DSN` — sem isso, sem error tracking
- `METRICS_TOKEN` — sem isso, `/metrics` retorna 404 em prod

---

## Design

Editorial-dark "obsidiana" · accent customizável (18 cores) · dark-only por design · ShadCN como camada primitiva apenas · DM Serif Display + DM Sans + DM Mono + Great Vibes.

Veja `apps/web/src/index.css` pra paleta completa de tokens.
