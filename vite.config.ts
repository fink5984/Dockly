import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  build: isSsrBuild
    // `vite build --ssr src/marketing/entry-server.tsx`: renders the marketing pages at build time.
    ? { outDir: 'dist-ssr', emptyOutDir: true }
    : {
      rollupOptions: {
        input: {
          // The app (dashboard, auth, client portal, signing)
          main: path.resolve(__dirname, 'index.html'),
          // Template for the prerendered marketing pages (scripts/prerender.mjs)
          marketing: path.resolve(__dirname, 'marketing.html'),
        },
      },
    },
  server: {
    proxy: {
      '/api': {
        target: process.env.DOCKLY_API_URL || 'http://127.0.0.1:3101',
        changeOrigin: true,
        secure: false,
      },
    },
  },
}))
