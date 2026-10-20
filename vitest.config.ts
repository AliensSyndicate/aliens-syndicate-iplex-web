import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  define: { __IPLEX_WEB_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'functions/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
})
