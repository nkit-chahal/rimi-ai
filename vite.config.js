import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.VITE_DEV_BACKEND_URL || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: backendUrl, changeOrigin: true },
      '/uploads': { target: backendUrl, changeOrigin: true },
      '/results': { target: backendUrl, changeOrigin: true },
    },
  },
})
