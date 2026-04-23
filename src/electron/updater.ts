import { createRequire } from 'node:module'
import { app, powerMonitor } from 'electron'
import { mutateRuntimeState, readRuntimeState } from '@/electron/runtime-state'

type ElectronUpdaterModule = typeof import('electron-updater')

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater') as ElectronUpdaterModule

type ProgressInfo = {
  percent?: number
}

type UpdateInfo = {
  version?: string
}

type UpdateDownloadedEvent = UpdateInfo

const FIRST_CHECK_DELAY_MS = 120_000
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const UPDATE_CHECK_JITTER_MS = 15 * 60 * 1000
const INSTALL_POLL_INTERVAL_MS = 15_000
const RECENT_ACTIVITY_COOLDOWN_MS = 90_000
const DOWNLOAD_SETTLE_DELAY_MS = 30_000
const INSTALL_GRACE_PERIOD_MS = 15_000
const FORCE_INSTALL_AFTER_MS = 24 * 60 * 60 * 1000
const INSTALL_RETRY_AFTER_SECONDS = 60

const toTargetVersion = (info?: UpdateInfo | UpdateDownloadedEvent) =>
  typeof info?.version === 'string' && info.version.trim() ? info.version : undefined

type UpdaterOptions = {
  isPaletteVisible: () => boolean
}

export class KlarkeyUpdater {
  private readonly options: UpdaterOptions
  private checkTimer?: ReturnType<typeof setTimeout>
  private installPoll?: ReturnType<typeof setInterval>
  private installGraceTimer?: ReturnType<typeof setTimeout>
  private checkInFlight = false
  private installPending = false
  private started = false

  constructor(options: UpdaterOptions) {
    this.options = options
  }

  start() {
    if (this.started || process.platform !== 'win32' || !app.isPackaged) {
      return
    }

    this.started = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('checking-for-update', () => {
      mutateRuntimeState((state) => {
        state.update.phase = 'checking'
        state.update.availability = 'online'
        state.update.lastCheckAt = Date.now()
        state.update.lastError = undefined
        state.update.retryAfterSeconds = undefined
      })
    })

    autoUpdater.on('update-not-available', () => {
      if (this.installPending) {
        return
      }

      mutateRuntimeState((state) => {
        state.update.phase = 'idle'
        state.update.availability = 'online'
        state.update.targetVersion = undefined
        state.update.downloadedAt = undefined
        state.update.forceInstallAfter = undefined
        state.update.restartNotBefore = undefined
        state.update.retryAfterSeconds = undefined
        state.update.lastError = undefined
      })
    })

    autoUpdater.on('update-available', (info) => {
      mutateRuntimeState((state) => {
        state.update.phase = 'downloading'
        state.update.availability = 'online'
        state.update.targetVersion = toTargetVersion(info)
        state.update.retryAfterSeconds = undefined
        state.update.lastError = undefined
      })

      void autoUpdater.downloadUpdate().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Update download failed.'
        mutateRuntimeState((state) => {
          state.update.phase = 'error'
          state.update.availability = 'online'
          state.update.lastError = message
        })
      })
    })

    autoUpdater.on('download-progress', (_progress: ProgressInfo) => {
      mutateRuntimeState((state) => {
        if (state.update.phase !== 'installing') {
          state.update.phase = 'downloading'
        }
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      const downloadedAt = Date.now()
      this.installPending = true
      mutateRuntimeState((state) => {
        state.update.phase = 'downloaded'
        state.update.availability = 'online'
        state.update.targetVersion = toTargetVersion(info)
        state.update.downloadedAt = downloadedAt
        state.update.forceInstallAfter = downloadedAt + FORCE_INSTALL_AFTER_MS
        state.update.restartNotBefore = downloadedAt + DOWNLOAD_SETTLE_DELAY_MS
        state.update.retryAfterSeconds = undefined
        state.update.lastError = undefined
      })
      void this.maybeInstallUpdate()
    })

    autoUpdater.on('error', (error) => {
      const message = error?.message || 'Update check failed.'
      mutateRuntimeState((state) => {
        if (state.update.phase === 'installing') {
          state.update.phase = 'downloaded'
        } else {
          state.update.phase = 'error'
        }
        state.update.availability = 'online'
        state.update.retryAfterSeconds = undefined
        state.update.lastError = message
      })
      this.installPending = false
    })

    powerMonitor.on('resume', () => {
      this.scheduleUpdateCheck(30_000)
      void this.maybeInstallUpdate()
    })

    this.installPoll = setInterval(() => {
      void this.maybeInstallUpdate()
    }, INSTALL_POLL_INTERVAL_MS)

    this.scheduleUpdateCheck(FIRST_CHECK_DELAY_MS)
  }

  dispose() {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
      this.checkTimer = undefined
    }

    if (this.installPoll) {
      clearInterval(this.installPoll)
      this.installPoll = undefined
    }

    if (this.installGraceTimer) {
      clearTimeout(this.installGraceTimer)
      this.installGraceTimer = undefined
    }
  }

  nudgeInstallCheck() {
    if (!this.started) {
      return
    }

    void this.maybeInstallUpdate()
  }

  private scheduleUpdateCheck(delayMs: number) {
    if (!this.started) {
      return
    }

    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
    }

    this.checkTimer = setTimeout(() => {
      void this.checkForUpdates()
    }, delayMs)
  }

  private scheduleRecurringCheck() {
    const jitter = Math.round(Math.random() * UPDATE_CHECK_JITTER_MS)
    this.scheduleUpdateCheck(UPDATE_CHECK_INTERVAL_MS + jitter)
  }

  private async checkForUpdates() {
    if (!this.started || this.checkInFlight) {
      return
    }

    this.checkInFlight = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update check failed.'
      mutateRuntimeState((state) => {
        if (state.update.phase !== 'downloaded' && state.update.phase !== 'installing') {
          state.update.phase = 'error'
        }
        state.update.lastCheckAt = Date.now()
        state.update.lastError = message
      })
    } finally {
      this.checkInFlight = false
      this.scheduleRecurringCheck()
    }
  }

  private async maybeInstallUpdate() {
    if (!this.started || !this.installPending || this.installGraceTimer) {
      return
    }

    const state = readRuntimeState()
    if (state.update.phase !== 'downloaded' || !state.update.targetVersion) {
      this.installPending = false
      return
    }

    const now = Date.now()
    const forceInstall = Boolean(state.update.forceInstallAfter && now >= state.update.forceInstallAfter)
    const lastActivityAt = Math.max(
      state.activity.lastPaletteOpenAt ?? 0,
      state.activity.lastDesktopActivityAt ?? 0,
      state.activity.lastExtensionActivityAt ?? 0,
      state.activity.lastSshActivityAt ?? 0,
    )
    const busyUntil = Math.max(
      state.activity.desktopBusyUntil ?? 0,
      state.activity.extensionBusyUntil ?? 0,
      state.activity.sshBusyUntil ?? 0,
    )

    if (this.options.isPaletteVisible()) {
      return
    }

    if (busyUntil > now) {
      return
    }

    if (!forceInstall && state.update.restartNotBefore && now < state.update.restartNotBefore) {
      return
    }

    if (!forceInstall && lastActivityAt > 0 && now - lastActivityAt < RECENT_ACTIVITY_COOLDOWN_MS) {
      return
    }

    mutateRuntimeState((nextState) => {
      nextState.update.phase = 'installing'
      nextState.update.availability = 'updating'
      nextState.update.retryAfterSeconds = INSTALL_RETRY_AFTER_SECONDS
      nextState.update.lastError = undefined
    })

    this.installGraceTimer = setTimeout(() => {
      this.installGraceTimer = undefined
      void this.performInstall()
    }, INSTALL_GRACE_PERIOD_MS)
  }

  private async performInstall() {
    const state = readRuntimeState()
    const now = Date.now()
    const forceInstall = Boolean(state.update.forceInstallAfter && now >= state.update.forceInstallAfter)
    const busyUntil = Math.max(
      state.activity.desktopBusyUntil ?? 0,
      state.activity.extensionBusyUntil ?? 0,
      state.activity.sshBusyUntil ?? 0,
    )

    if (this.options.isPaletteVisible() || busyUntil > now) {
      mutateRuntimeState((nextState) => {
        nextState.update.phase = 'downloaded'
        nextState.update.availability = 'online'
        nextState.update.retryAfterSeconds = undefined
        nextState.update.restartNotBefore = forceInstall ? now : now + RECENT_ACTIVITY_COOLDOWN_MS
      })
      return
    }

    this.installPending = false
    mutateRuntimeState((nextState) => {
      nextState.update.phase = 'installing'
      nextState.update.availability = 'updating'
      nextState.update.retryAfterSeconds = INSTALL_RETRY_AFTER_SECONDS
    })

    autoUpdater.quitAndInstall(true, true)
  }
}
