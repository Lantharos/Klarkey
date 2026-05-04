import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

describe('runtime state sanitization', () => {
  beforeEach(() => {
    vi.resetModules()
    userDataPath = mkdtempSync(join(tmpdir(), 'klarkey-runtime-state-'))
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => userDataPath),
      },
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    if (userDataPath) {
      rmSync(userDataPath, { recursive: true, force: true })
      userDataPath = ''
    }
  })

  it('redacts update errors and rejects malformed target versions from persisted runtime state', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(
      join(userDataPath, 'runtime-state.json'),
      JSON.stringify({
        update: {
          availability: 'updating',
          phase: 'downloaded',
          targetVersion: 'https://updates.example.test/release?token=abc',
          lastError: 'download failed with refresh_token=abc',
        },
        activity: {},
      }),
      'utf8',
    )

    const { readRuntimeState } = await import('@/electron/runtime-state')
    const state = readRuntimeState()

    expect(state.update.targetVersion).toBeUndefined()
    expect(state.update.lastError).toBe('Update status unavailable.')
  })

  it('keeps normal update status values', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(
      join(userDataPath, 'runtime-state.json'),
      JSON.stringify({
        update: {
          availability: 'online',
          phase: 'error',
          targetVersion: '1.2.3-beta.1',
          lastError: 'Network unavailable',
        },
        activity: {},
      }),
      'utf8',
    )

    const { readRuntimeState } = await import('@/electron/runtime-state')
    const state = readRuntimeState()

    expect(state.update.targetVersion).toBe('1.2.3-beta.1')
    expect(state.update.lastError).toBe('Network unavailable')
  })

  it('ignores oversized persisted runtime state before JSON parsing', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'runtime-state.json'), 'x'.repeat(64 * 1024 + 1), 'utf8')

    const { readRuntimeState } = await import('@/electron/runtime-state')
    const state = readRuntimeState()

    expect(state.update.availability).toBe('online')
    expect(state.update.phase).toBe('idle')
  })

  it('ignores symlinked persisted runtime state', async () => {
    mkdirSync(userDataPath, { recursive: true })
    const target = join(userDataPath, 'target-runtime-state.json')
    const link = join(userDataPath, 'runtime-state.json')
    writeFileSync(target, JSON.stringify({
      update: {
        availability: 'updating',
        phase: 'installing',
      },
      activity: {},
    }), 'utf8')

    try {
      symlinkSync(target, link)
    } catch {
      return
    }

    const { readRuntimeState } = await import('@/electron/runtime-state')
    const state = readRuntimeState()

    expect(state.update.availability).toBe('online')
    expect(state.update.phase).toBe('idle')
  })
})
