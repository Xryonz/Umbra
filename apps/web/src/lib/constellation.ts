/**
 * Gerador procedural de constelações — a assinatura visual do Astra.
 *
 * DETERMINÍSTICO: o mesmo nome gera SEMPRE a mesma constelação (hash do
 * nome → semente → PRNG). É isso que a torna uma identidade, não um enfeite
 * aleatório. Sem IA, sem servidor: ~todas as regras de uma carta celeste
 * em TS puro.
 *
 * Regras estéticas:
 *  - 5–9 estrelas em viewBox 100×100, com distância mínima entre elas
 *    (rejection sampling) — nada de aglomerados feios
 *  - traçado = árvore geradora mínima (Prim): conectada, sem cruzamentos,
 *    o formato clássico de constelação
 *  - 1 estrela "alfa" (a mais brilhante, raio maior + halo)
 *  - poeira de fundo (pontos minúsculos soltos) pra dar profundidade
 */

export interface Star  { x: number; y: number; r: number; alpha: boolean }
export interface Edge  { a: number; b: number }
export interface Dust  { x: number; y: number; r: number }
export interface Constellation { stars: Star[]; edges: Edge[]; dust: Dust[] }

/** Hash xmur3 — espalha bem strings curtas (nomes de servidor). */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** PRNG mulberry32 — rápido e determinístico a partir da semente. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MARGIN    = 14  // borda do viewBox sem estrelas
const MIN_DIST  = 14  // distância mínima entre estrelas (FIXA — ver abaixo)
const MAX_STARS = 28  // teto visual: além disso o céu satura no 100×100

/**
 * @param starCount 1 estrela POR MEMBRO da constelação (clamp 1–28).
 *   Crescimento ESTÁVEL: semente e MIN_DIST fixos ⇒ a sequência de
 *   candidatos é idêntica ⇒ +1 membro só ADICIONA uma estrela — as
 *   existentes não se movem (quem entra É a estrela nova).
 *   Sem starCount: 5–9 estrelas derivadas do hash (fallback).
 */
export function generateConstellation(name: string, starCount?: number): Constellation {
  const seed = hashSeed(name.trim().toLowerCase() || 'astra')
  const rnd  = mulberry32(seed)

  // ── Estrelas ────────────────────────────────────────────────
  // Modo membro NÃO consome rnd() pro count — preserva a sequência.
  const count = starCount !== undefined
    ? Math.max(1, Math.min(MAX_STARS, Math.floor(starCount)))
    : 5 + Math.floor(rnd() * 5)
  const stars: Star[] = []
  let attempts = 0
  while (stars.length < count && attempts < 600) {
    attempts++
    const x = MARGIN + rnd() * (100 - MARGIN * 2)
    const y = MARGIN + rnd() * (100 - MARGIN * 2)
    if (stars.every((s) => Math.hypot(s.x - x, s.y - y) >= MIN_DIST)) {
      stars.push({ x, y, r: 1.1 + rnd() * 0.9, alpha: false })
    }
  }
  // Alfa: a estrela mais central vira a mais brilhante
  const alphaIdx = stars
    .map((s, i) => ({ i, d: Math.hypot(s.x - 50, s.y - 50) }))
    .sort((a, b) => a.d - b.d)[0].i
  stars[alphaIdx] = { ...stars[alphaIdx], r: 2.4, alpha: true }

  // ── Traçado: árvore geradora mínima (Prim O(n²)) ────────────
  const edges: Edge[] = []
  const inTree = new Set<number>([0])
  while (inTree.size < stars.length) {
    let best: Edge | null = null
    let bestD = Infinity
    for (const a of inTree) {
      for (let b = 0; b < stars.length; b++) {
        if (inTree.has(b)) continue
        const d = Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y)
        if (d < bestD) { bestD = d; best = { a, b } }
      }
    }
    edges.push(best!)
    inTree.add(best!.b)
  }

  // ── Poeira de fundo ─────────────────────────────────────────
  // PRNG PRÓPRIO (seed derivada): a poeira não muda quando o número de
  // estrelas cresce — só a estrela nova aparece, o resto do céu é o mesmo.
  const dustRnd = mulberry32(seed ^ 0x9e3779b9)
  const dust: Dust[] = []
  const dustCount = 6 + Math.floor(dustRnd() * 5)
  for (let i = 0; i < dustCount; i++) {
    dust.push({ x: dustRnd() * 100, y: dustRnd() * 100, r: 0.3 + dustRnd() * 0.3 })
  }

  return { stars, edges, dust }
}
