import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative so the built app works from any subpath, including GitHub Pages.
  base: './',
  plugins: [react()],
})
