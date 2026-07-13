import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // react-draggable 4.7 references this Node-only debug flag in browser code.
  // Replace only that flag; do not expose or polyfill the full `process` object.
  define: {
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
})
