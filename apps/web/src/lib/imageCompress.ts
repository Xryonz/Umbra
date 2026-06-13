/**
 * Compressão de imagem no cliente, ANTES do upload.
 *
 * Por quê: o servidor já recomprime com sharp, mas o usuário ainda PAGA
 * o upload do arquivo cru. Uma foto de celular (4–12MB) vira ~200KB WebP
 * aqui — upload instantâneo no 4G, menos espera, menos dado gasto.
 *
 * Regras:
 *  - Só toca em imagem raster que NÃO seja GIF (canvas mata a animação).
 *  - Redimensiona pro maior lado <= MAX_EDGE (preserva proporção).
 *  - Exporta WebP q=0.82 (sweet spot qualidade/peso).
 *  - Se o resultado não ficou menor, devolve o ORIGINAL (nunca piora).
 *  - Qualquer falha → original (upload nunca quebra por causa disso).
 */

const MAX_EDGE = 1600          // maior lado em px — cobre retina sem exagero
const QUALITY  = 0.82
const SKIP     = new Set(['image/gif', 'image/svg+xml']) // animação / vetor

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP.has(file.type)) return file

  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.webp'
    return new File([blob], name, { type: 'image/webp', lastModified: Date.now() })
  } catch {
    return file
  }
}

/** Comprime um array de arquivos em paralelo. Não-imagens passam intactas. */
export function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImage))
}
