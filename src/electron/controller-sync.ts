import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@/electron/constants'
import type { VaultRepository } from '@/electron/repository'
import type { SyncManager } from '@/electron/sync/manager'
import type { VaultLockManager } from '@/electron/vault-lock'

export class ControllerSyncCoordinator {
  private syncTimer?: ReturnType<typeof setTimeout>
  private readonly window: BrowserWindow
  private readonly lockManager: VaultLockManager
  private readonly syncManager: SyncManager
  private readonly repository: VaultRepository

  constructor(
    window: BrowserWindow,
    lockManager: VaultLockManager,
    syncManager: SyncManager,
    repository: VaultRepository,
  ) {
    this.window = window
    this.lockManager = lockManager
    this.syncManager = syncManager
    this.repository = repository
  }

  dispose() {
    this.cancelSchedule()
    this.stopRealtime()
  }

  cancelSchedule() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = undefined
    }
  }

  emitUpdate(vaultChanged: boolean, returnHome = false) {
    this.window.webContents.send(IPC_CHANNELS.syncChanged, {
      status: this.syncManager.getStatus(),
      vaultChanged,
      returnHome,
    })
  }

  startRealtime() {
    if (!this.lockManager.isUnlocked()) {
      return
    }

    this.syncManager.startRealtime(
      () => this.schedule(150),
      () => this.emitUpdate(false),
    )
  }

  stopRealtime() {
    this.syncManager.stopRealtime()
  }

  schedule(delay = 900) {
    const status = this.syncManager.getStatus()
    if (!this.lockManager.isUnlocked() || !status.configured || !status.signedIn) {
      return
    }

    this.cancelSchedule()
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      void this.syncInBackground()
    }, delay)
  }

  async runNowFull() {
    const pending = this.syncManager.syncNow(this.repository, { fullPull: true })
    this.emitUpdate(false)
    const status = await pending
    this.startRealtime()
    this.emitUpdate(this.syncManager.didLastRunChangeVault())
    return status
  }

  private async syncInBackground() {
    if (!this.lockManager.isUnlocked()) {
      return
    }

    try {
      const pending = this.syncManager.syncNow(this.repository)
      this.emitUpdate(false)
      await pending
      this.startRealtime()
      this.emitUpdate(this.syncManager.didLastRunChangeVault())
    } catch {
      this.emitUpdate(false)
    }
  }
}
