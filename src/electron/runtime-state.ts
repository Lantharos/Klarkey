import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export type RuntimeUpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type RuntimeAvailability = 'online' | 'updating'
export type RuntimeBusyScope = 'desktop' | 'extension' | 'ssh'

export interface KlarkeyRuntimeState {
  update: {
    availability: RuntimeAvailability
    phase: RuntimeUpdatePhase
    targetVersion?: string
    downloadedAt?: number
    forceInstallAfter?: number
    restartNotBefore?: number
    retryAfterSeconds?: number
    lastCheckAt?: number
    lastError?: string
  }
  activity: {
    lastPaletteOpenAt?: number
    lastDesktopActivityAt?: number
    lastExtensionActivityAt?: number
    lastSshActivityAt?: number
    desktopBusyUntil?: number
    extensionBusyUntil?: number
    sshBusyUntil?: number
  }
}

const DEFAULT_RUNTIME_STATE: KlarkeyRuntimeState = {
  update: {
    availability: 'online',
    phase: 'idle',
  },
  activity: {},
}

const runtimeStatePath = () => join(app.getPath('userData'), 'runtime-state.json')

const sanitizeTimestamp = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

const normalizeRuntimeState = (value: unknown): KlarkeyRuntimeState => {
  if (!value || typeof value !== 'object') {
    return structuredClone(DEFAULT_RUNTIME_STATE)
  }

  const input = value as Partial<KlarkeyRuntimeState>
  const update = (input.update ?? {}) as Partial<KlarkeyRuntimeState['update']>
  const activity = (input.activity ?? {}) as Partial<KlarkeyRuntimeState['activity']>

  return {
    update: {
      availability: update.availability === 'updating' ? 'updating' : 'online',
      phase:
        update.phase === 'checking' ||
        update.phase === 'downloading' ||
        update.phase === 'downloaded' ||
        update.phase === 'installing' ||
        update.phase === 'error'
          ? update.phase
          : 'idle',
      targetVersion: typeof update.targetVersion === 'string' && update.targetVersion.trim() ? update.targetVersion : undefined,
      downloadedAt: sanitizeTimestamp(update.downloadedAt),
      forceInstallAfter: sanitizeTimestamp(update.forceInstallAfter),
      restartNotBefore: sanitizeTimestamp(update.restartNotBefore),
      retryAfterSeconds:
        typeof update.retryAfterSeconds === 'number' && Number.isFinite(update.retryAfterSeconds) && update.retryAfterSeconds > 0
          ? Math.round(update.retryAfterSeconds)
          : undefined,
      lastCheckAt: sanitizeTimestamp(update.lastCheckAt),
      lastError: typeof update.lastError === 'string' && update.lastError.trim() ? update.lastError : undefined,
    },
    activity: {
      lastPaletteOpenAt: sanitizeTimestamp(activity.lastPaletteOpenAt),
      lastDesktopActivityAt: sanitizeTimestamp(activity.lastDesktopActivityAt),
      lastExtensionActivityAt: sanitizeTimestamp(activity.lastExtensionActivityAt),
      lastSshActivityAt: sanitizeTimestamp(activity.lastSshActivityAt),
      desktopBusyUntil: sanitizeTimestamp(activity.desktopBusyUntil),
      extensionBusyUntil: sanitizeTimestamp(activity.extensionBusyUntil),
      sshBusyUntil: sanitizeTimestamp(activity.sshBusyUntil),
    },
  }
}

const writeRuntimeState = (state: KlarkeyRuntimeState) => {
  const filePath = runtimeStatePath()
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

export const readRuntimeState = (): KlarkeyRuntimeState => {
  try {
    return normalizeRuntimeState(JSON.parse(readFileSync(runtimeStatePath(), 'utf8')))
  } catch {
    return structuredClone(DEFAULT_RUNTIME_STATE)
  }
}

export const mutateRuntimeState = <T>(mutator: (state: KlarkeyRuntimeState) => T) => {
  const state = readRuntimeState()
  const result = mutator(state)
  writeRuntimeState(state)
  return result
}

export const resetRuntimeStateForAppStart = () =>
  mutateRuntimeState((state) => {
    state.update.availability = 'online'
    state.update.phase = 'idle'
    state.update.targetVersion = undefined
    state.update.downloadedAt = undefined
    state.update.forceInstallAfter = undefined
    state.update.restartNotBefore = undefined
    state.update.retryAfterSeconds = undefined
    state.update.lastError = undefined
  })

export const notePaletteOpen = () =>
  mutateRuntimeState((state) => {
    state.activity.lastPaletteOpenAt = Date.now()
  })

export const noteDesktopActivity = () =>
  mutateRuntimeState((state) => {
    state.activity.lastDesktopActivityAt = Date.now()
  })

export const noteExtensionActivity = () =>
  mutateRuntimeState((state) => {
    state.activity.lastExtensionActivityAt = Date.now()
  })

export const noteSshActivity = () =>
  mutateRuntimeState((state) => {
    state.activity.lastSshActivityAt = Date.now()
  })

export const markRuntimeBusy = (scope: RuntimeBusyScope, durationMs: number) => {
  const busyUntil = Date.now() + Math.max(1_000, durationMs)

  mutateRuntimeState((state) => {
    if (scope === 'desktop') {
      state.activity.desktopBusyUntil = Math.max(state.activity.desktopBusyUntil ?? 0, busyUntil)
      return
    }

    if (scope === 'extension') {
      state.activity.extensionBusyUntil = Math.max(state.activity.extensionBusyUntil ?? 0, busyUntil)
      return
    }

    state.activity.sshBusyUntil = Math.max(state.activity.sshBusyUntil ?? 0, busyUntil)
  })
}
