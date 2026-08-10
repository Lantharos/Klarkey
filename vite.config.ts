import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  define: {
    'import.meta.env.KLARKEY_DEV_MODE': JSON.stringify(true),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'tests/app/**/*.test.ts',
      'tests/app/**/*.test.tsx',
      'tests/extension/**/*.test.ts',
      'tests/mobile/**/*.test.ts',
      'tests/shared/**/*.test.ts',
    ],
  },
})
