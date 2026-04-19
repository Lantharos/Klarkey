import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'src/electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3', 'koffi'],
              output: {
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      preload: {
        input: 'src/electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: {
                entryFileNames: 'preload.mjs',
              },
            },
          },
        },
      },
    }),
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
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
