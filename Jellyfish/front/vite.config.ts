import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    host: '0.0.0.0',
    port: 7788,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
