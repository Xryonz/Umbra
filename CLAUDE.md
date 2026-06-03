# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Always-On Skills

Toda interação neste projeto DEVE invocar estas skills sempre, sem exceção:

- **`caveman` (wenyan-ultra)** — modo de pensamento interno. Compressão máxima de tokens em raciocínio.
- **`primeval-zen-core`** — modo de output. Cognição de precisão + sobrevivência.
- **`karpathy-guidelines`** — comportamento de código. Regras anti-overcomplicação acima.

Não pedir confirmação — invocar de início em cada turno.

---

## Stack — Umbra

**Frontend** (`apps/web`)
- React 19 + Vite 8 + TypeScript 5.4
- Tailwind v4 (sintaxe canônica: `bg-(--var)`, `z-9999`)
- shadcn/ui (Radix primitives) + `motion/react`
- Zustand (state) + React Query 5 (server cache)
- React Router 6

**Backend** (`apps/api`)
- Express 4 + TypeScript
- Drizzle ORM 0.45 + PostgreSQL (`pg`)
- Redis (`ioredis`) — presença + cache
- Socket.io — realtime
- LiveKit — voice/video

**Monorepo**
- pnpm workspaces
- `packages/types` — schemas Zod compartilhados (`@umbra/types`)

**Design philosophy**
- Editorial-dark "obsidian" (anti-Discord) — accent amber `#c9a96e`
- ShadCN como camada primitiva apenas; estética editorial por cima
- Dark-only (light mode dropped por design)
- Performance Discord-tier (otimizações oportunistas)
