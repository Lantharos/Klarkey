import { describe, expect, it } from 'vitest'
import { resolveRuntimeMode } from '@/electron/app-mode'

describe('Electron runtime mode', () => {
  it('ignores dev flags and dev server environment in packaged builds', () => {
    expect(resolveRuntimeMode({
      isPackaged: true,
      argv: ['klarkey.exe', '--dev'],
      env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
    })).toEqual({ isDevMode: false })
  })

  it('allows dev server trust only for unpackaged development runs', () => {
    expect(resolveRuntimeMode({
      isPackaged: false,
      argv: ['electron', '.', '--dev'],
      env: {},
    })).toEqual({
      isDevMode: true,
      devServerUrl: 'http://127.0.0.1:5173',
    })

    expect(resolveRuntimeMode({
      isPackaged: false,
      argv: ['electron', '.'],
      env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5174' },
    })).toEqual({
      isDevMode: true,
      devServerUrl: 'http://127.0.0.1:5174',
    })

    expect(resolveRuntimeMode({
      isPackaged: false,
      argv: ['electron', '.'],
      env: { VITE_DEV_SERVER_URL: 'http://localhost:5173/app' },
    })).toEqual({
      isDevMode: true,
      devServerUrl: 'http://127.0.0.1:5173',
    })
  })

  it('does not trust remote or non-http dev server URLs', () => {
    expect(resolveRuntimeMode({
      isPackaged: false,
      argv: ['electron', '.'],
      env: { VITE_DEV_SERVER_URL: 'https://example.com' },
    })).toEqual({ isDevMode: false })

    expect(resolveRuntimeMode({
      isPackaged: false,
      argv: ['electron', '.'],
      env: { VITE_DEV_SERVER_URL: 'file:///C:/tmp/renderer.html' },
    })).toEqual({ isDevMode: false })
  })
})
