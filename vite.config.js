import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // important for electron
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  }
})
