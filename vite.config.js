import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.VITE_DEV_BACKEND_URL || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true, timeout: 600000, proxyTimeout: 600000 },
      '/uploads': { target: backendUrl, changeOrigin: true },
      '/results': { target: backendUrl, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Only split libraries that the entry really does load on every page.
        // Do NOT add three/@react-three here: forcing them into a named chunk makes the
        // chunk a static dependency of the entry, so every visitor (login page included)
        // downloaded ~895 KB of Three.js for a single Pro tool. Left alone, the bundler
        // splits it at the lazy GarmentPreview3D import and loads it only on demand.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('fabric')) return 'fabric-vendor'
          if (id.includes('@sentry')) return 'sentry-vendor'
          if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('/react/')) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
})
