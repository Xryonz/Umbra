import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

const ANALYZE = process.env.ANALYZE === '1'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Só liga quando ANALYZE=1 npm run build — gera dist/stats.html
    ANALYZE && visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['@astra/types'],
  },
  // Strip console.* + debugger em build de prod. dev mantém pra debug.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  build: {
    // Chunks grandes não-essenciais devem ficar fora do main bundle.
    // manualChunks identifica vendors gordos e isola — main fica magro pro initial load.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Vendors pesados em chunks isolados. Shiki/emoji-mart NÃO entram aqui
          // pra cada lang/data ficar seu próprio chunk (lazy granular).
          // Engine do shiki é tão pequeno que cai no chunk do dynamic-import caller.
          if (id.includes('livekit-client') || id.includes('@livekit'))      return 'vendor-livekit'
          if (id.includes('motion'))                                          return 'vendor-motion'
          if (id.includes('@sentry'))                                         return 'vendor-sentry'
          if (id.includes('react-colorful'))                                  return 'vendor-colorful'
          if (id.includes('date-fns'))                                        return 'vendor-datefns'
          if (id.includes('@radix-ui'))                                       return 'vendor-radix'
          if (id.includes('lucide-react'))                                    return 'vendor-icons'
          if (id.includes('socket.io-client'))                                return 'vendor-socket'
          if (id.includes('react-router'))                                    return 'vendor-router'
          if (id.includes('@tanstack/react-query'))                           return 'vendor-query'
          if (id.includes('zod'))                                             return 'vendor-zod'
          // react + react-dom ficam no main (necessários sempre)
        },
      },
    },
    // Avisar quando chunk > 600KB (default é 500, mas livekit/shiki ainda passam)
    chunkSizeWarningLimit: 600,
  },
})