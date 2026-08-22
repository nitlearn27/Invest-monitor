import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned so the PWA/service-worker origin and any bookmarked tab stay stable.
  // strictPort: fail loudly instead of silently drifting to another port.
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
})
