import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: ['es2020', 'safari14'],
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VSTART2_API_URL || 'http://127.0.0.1:3110',
        changeOrigin: true,
      },
      '/stt': {
        target: process.env.VSTART2_STT_URL || 'http://127.0.0.1:8091',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stt/, ''),
      },
    },
  },
})
