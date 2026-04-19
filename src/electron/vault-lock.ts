import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { UserSettings, VaultLockInfo, VaultUnlockMethod } from '@/shared/types'
import { KeyManager } from '@/electron/crypto'
import { getWindowsHelloAvailability, verifyWithWindowsHello } from '@/electron/windows-hello-verifier'

const PASSCODE_SALT_KEY = 'passcode_salt'
const PASSCODE_HASH_KEY = 'passcode_hash'
const PASSCODE_LENGTH_KEY = 'passcode_length'
const MASTER_PASSWORD_SET_KEY = 'master_password_set'
const LOCK_STATE_KEY = 'vault_lock_state'
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEY_LENGTH = 32
const MAX_ATTEMPTS = 10
const ATTEMPT_WINDOW_MS = 60_000
const PASSCODE_CONFIRM_WINDOW_MS = 30_000
const LOCK_WARNING_SECONDS = 30

export class VaultLockManager {
  private state: 'locked' | 'passcode' | 'unlocked' = 'locked'
  private autoLockTimer: NodeJS.Timeout | null = null
  private lockWarningTimer: NodeJS.Timeout | null = null
  private lockWarningInterval: NodeJS.Timeout | null = null
  private autoLockMs: number
  private _passcodeEnabled: boolean
  private readonly keyManager: KeyManager
  private readonly db: Database.Database
  private onStateChangeCallback?: (info: VaultLockInfo) => void
  private failedAttempts = 0
  private lastAttemptTime = 0
  private passcodeConfirmedUntil = 0
  private lockWarningSeconds: number | undefined

  constructor(keyManager: KeyManager, db: Database.Database, settings: UserSettings) {
    this.keyManager = keyManager
    this.db = db
    this.autoLockMs = (settings.autoLockMinutes ?? 15) * 60 * 1000
    this._passcodeEnabled = settings.passcodeEnabled
    this.persistState(this.state)
  }

  onStateChange(callback: (info: VaultLockInfo) => void) {
    this.onStateChangeCallback = callback
  }

  private notifyStateChange() {
    this.persistState(this.state)
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.getLockInfo())
    }
  }

  private persistState(state: 'locked' | 'passcode' | 'unlocked') {
    this.db
      .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(LOCK_STATE_KEY, state)
  }

  getLockInfo(): VaultLockInfo {
    const methods: VaultUnlockMethod[] = []
    if (this.keyManager.isSafeStorageAvailable()) {
      methods.push('windowsHello')
    }
    if (this.keyManager.hasMasterPassword()) {
      methods.push('masterPassword')
    }
    if (!this.keyManager.hasKeyFile()) {
      methods.push('masterPassword')
    }

    return {
      state: this.state,
      primaryMethods: methods,
      passcodeEnabled: this._passcodeEnabled,
      passcodeSet: this.isPasscodeSet(),
      passcodeLength: this.getPasscodeLength(),
      lockWarningSeconds: this.lockWarningSeconds,
      masterPasswordSet: this.keyManager.hasMasterPassword(),
      autoLockMinutes: Math.round(this.autoLockMs / 60_000),
      safeStorageAvailable: this.keyManager.isSafeStorageAvailable(),
    }
  }

  isLocked(): boolean {
    return this.state === 'locked'
  }

  requiresPasscode(): boolean {
    return this.state === 'passcode'
  }

  isUnlocked(): boolean {
    return this.state === 'unlocked'
  }

  private isPasscodeSet(): boolean {
    const hashRow = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSCODE_HASH_KEY) as { value: string } | undefined
    return Boolean(hashRow?.value)
  }

  private getPasscodeLength(): number | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSCODE_LENGTH_KEY) as { value: string } | undefined
    const parsed = Number(row?.value)
    if (!Number.isFinite(parsed) || parsed < 4 || parsed > 6) {
      return undefined
    }
    return parsed
  }

  private checkRateLimit(): { blocked: boolean; remainingMs: number } {
    const now = Date.now()
    if (now - this.lastAttemptTime > ATTEMPT_WINDOW_MS) {
      this.failedAttempts = 0
    }
    if (this.failedAttempts >= MAX_ATTEMPTS) {
      const remainingMs = ATTEMPT_WINDOW_MS - (now - this.lastAttemptTime)
      return { blocked: true, remainingMs: Math.max(0, remainingMs) }
    }
    return { blocked: false, remainingMs: 0 }
  }

  private recordFailedAttempt() {
    this.failedAttempts++
    this.lastAttemptTime = Date.now()
  }

  private resetFailedAttempts() {
    this.failedAttempts = 0
  }

  async unlockWithWindowsHello(): Promise<{ success: boolean; message: string }> {
    const availability = await getWindowsHelloAvailability()
    if (!availability.available) {
      return {
        success: false,
        message: availability.message || 'Windows Hello is not available.',
      }
    }

    const verification = await verifyWithWindowsHello('Verify your identity to unlock Klarkey.')
    if (!verification.verified) {
      return {
        success: false,
        message: verification.canceled ? 'Verification was canceled.' : (verification.message || 'Verification failed.'),
      }
    }

    if (!this.keyManager.unlockFromSystem()) {
      return {
        success: false,
        message: 'Could not unlock the vault key. You may need to use your master password.',
      }
    }

    this.transitionAfterUnlock()
    return { success: true, message: 'Vault unlocked.' }
  }

  unlockWithPassword(password: string): { success: boolean; message: string } {
    const rateLimit = this.checkRateLimit()
    if (rateLimit.blocked) {
      const seconds = Math.ceil(rateLimit.remainingMs / 1000)
      return { success: false, message: `Too many attempts. Try again in ${seconds} seconds.` }
    }

    if (!this.keyManager.hasMasterPassword() && !this.keyManager.hasKeyFile()) {
      return { success: false, message: 'No master password is set up.' }
    }

    if (this.keyManager.hasMasterPassword()) {
      if (!this.keyManager.unlockWithPassword(password)) {
        this.recordFailedAttempt()
        return { success: false, message: 'Incorrect master password.' }
      }
    } else if (this.keyManager.isSafeStorageAvailable()) {
      if (!this.keyManager.unlockFromSystem()) {
        return { success: false, message: 'Could not unlock the vault.' }
      }
    } else if (!this.keyManager.unlockWithPassword(password)) {
      this.recordFailedAttempt()
      return { success: false, message: 'Incorrect password.' }
    }

    this.resetFailedAttempts()
    this.transitionAfterUnlock()
    return { success: true, message: 'Vault unlocked.' }
  }

  transitionAfterUnlock() {
    if (this._passcodeEnabled && this.isPasscodeSet()) {
      this.state = 'passcode'
    } else {
      this.state = 'unlocked'
    }
    this.startAutoLockTimer()
    this.notifyStateChange()
  }

  verifyPasscode(passcode: string): { success: boolean; message: string } {
    if (this.state !== 'passcode') {
      return { success: false, message: 'Vault is not in passcode state.' }
    }

    const rateLimit = this.checkRateLimit()
    if (rateLimit.blocked) {
      const seconds = Math.ceil(rateLimit.remainingMs / 1000)
      return { success: false, message: `Too many attempts. Try again in ${seconds} seconds.` }
    }

    if (!this.isPasscodeValid(passcode)) {
      this.recordFailedAttempt()
      return { success: false, message: 'Incorrect passcode.' }
    }

    this.resetFailedAttempts()
    this.passcodeConfirmedUntil = Date.now() + PASSCODE_CONFIRM_WINDOW_MS
    this.state = 'unlocked'
    this.resetAutoLockTimer()
    this.notifyStateChange()
    return { success: true, message: 'Passcode accepted.' }
  }

  confirmPasscode(passcode: string): { success: boolean; message: string } {
    const rateLimit = this.checkRateLimit()
    if (rateLimit.blocked) {
      const seconds = Math.ceil(rateLimit.remainingMs / 1000)
      return { success: false, message: `Too many attempts. Try again in ${seconds} seconds.` }
    }

    if (!this.isPasscodeSet()) {
      return { success: false, message: 'No passcode is set.' }
    }

    if (!this.isPasscodeValid(passcode)) {
      this.recordFailedAttempt()
      return { success: false, message: 'Incorrect passcode.' }
    }

    this.resetFailedAttempts()
    this.passcodeConfirmedUntil = Date.now() + PASSCODE_CONFIRM_WINDOW_MS
    return { success: true, message: 'Passcode confirmed.' }
  }

  private isPasscodeValid(passcode: string): boolean {
    const saltRow = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSCODE_SALT_KEY) as { value: string } | undefined
    const hashRow = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(PASSCODE_HASH_KEY) as { value: string } | undefined

    if (!saltRow?.value || !hashRow?.value) {
      return false
    }

    const salt = Buffer.from(saltRow.value, 'base64')
    const candidateHash = scryptSync(passcode, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('base64')
    return timingSafeEqual(Buffer.from(candidateHash), Buffer.from(hashRow.value))
  }

  setPasscode(passcode: string): { success: boolean; message: string } {
    if (passcode.length < 4 || passcode.length > 6 || !/^\d+$/.test(passcode)) {
      return { success: false, message: 'Passcode must be 4-6 digits.' }
    }

    const salt = randomBytes(32)
    const hash = scryptSync(passcode, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('base64')

    const statement = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    statement.run(PASSCODE_HASH_KEY, hash)
    statement.run(PASSCODE_SALT_KEY, salt.toString('base64'))
    statement.run(PASSCODE_LENGTH_KEY, String(passcode.length))

    return { success: true, message: 'Passcode set.' }
  }

  removePasscode(): { success: boolean; message: string } {
    if (Date.now() > this.passcodeConfirmedUntil) {
      return { success: false, message: 'Confirm your current passcode first.' }
    }

    this.db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').run(PASSCODE_HASH_KEY, PASSCODE_SALT_KEY, PASSCODE_LENGTH_KEY)
    this.passcodeConfirmedUntil = 0
    return { success: true, message: 'Passcode removed.' }
  }

  setupMasterPassword(password: string): { success: boolean; message: string } {
    if (password.length < 8) {
      return { success: false, message: 'Master password must be at least 8 characters.' }
    }

    if (!this.keyManager.isKeyInMemory()) {
      return { success: false, message: 'Vault must be unlocked to set a master password.' }
    }

    this.keyManager.setupWithMasterPassword(password)

    const statement = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    statement.run(MASTER_PASSWORD_SET_KEY, 'true')

    return { success: true, message: 'Master password set up.' }
  }

  changeMasterPassword(currentPassword: string, newPassword: string): { success: boolean; message: string } {
    if (newPassword.length < 8) {
      return { success: false, message: 'New master password must be at least 8 characters.' }
    }

    if (!this.keyManager.changeMasterPassword(currentPassword, newPassword)) {
      return { success: false, message: 'Current password is incorrect.' }
    }

    return { success: true, message: 'Master password changed.' }
  }

  removeMasterPassword(currentPassword: string): { success: boolean; message: string } {
    if (!this.keyManager.isSafeStorageAvailable()) {
      return { success: false, message: 'Cannot remove master password when secure storage is unavailable.' }
    }

    if (!this.keyManager.removeMasterPassword(currentPassword)) {
      return { success: false, message: 'Current password is incorrect.' }
    }

    this.db.prepare("UPDATE settings SET value = 'false' WHERE key = ?").run(MASTER_PASSWORD_SET_KEY)
    return { success: true, message: 'Master password removed. Windows Hello will be the primary unlock method.' }
  }

  lock() {
    this.keyManager.evictKey()
    this.state = 'locked'
    this.passcodeConfirmedUntil = 0
    this.stopAutoLockTimer()
    this.notifyStateChange()
  }

  ensureKeyForNewVault(): Buffer {
    if (this.keyManager.isKeyInMemory()) {
      this.state = 'unlocked'
      this.startAutoLockTimer()
      return this.keyManager.getKey()
    }

    if (this.keyManager.hasKeyFile()) {
      if (this.keyManager.isSafeStorageAvailable()) {
        this.keyManager.unlockFromSystem()
      }
      if (!this.keyManager.isKeyInMemory() && this.keyManager.hasMasterPassword()) {
        throw new Error('Vault is locked. Unlock with your master password or Windows Hello.')
      }
      if (!this.keyManager.isKeyInMemory() && !this.keyManager.isSafeStorageAvailable()) {
        throw new Error('Vault is locked. Unlock with your master password.')
      }
    }

    if (!this.keyManager.isKeyInMemory()) {
      if (!this.keyManager.isSafeStorageAvailable()) {
        throw new Error('Secure storage is not available. A master password must be set up first.')
      }
      return this.keyManager.setupNewVault()
    }

    this.state = 'unlocked'
    this.startAutoLockTimer()
    return this.keyManager.getKey()
  }

  updateSettings(settings: UserSettings) {
    this.autoLockMs = (settings.autoLockMinutes ?? 15) * 60_000
    this._passcodeEnabled = settings.passcodeEnabled
    if (this.state === 'unlocked' || this.state === 'passcode') {
      this.resetAutoLockTimer()
    }
  }

  private startAutoLockTimer() {
    this.stopAutoLockTimer()
    this.lockWarningSeconds = undefined

    if (this.autoLockMs > LOCK_WARNING_SECONDS * 1000) {
      this.lockWarningTimer = setTimeout(() => {
        this.lockWarningSeconds = LOCK_WARNING_SECONDS
        this.notifyStateChange()
        this.lockWarningInterval = setInterval(() => {
          if (this.lockWarningSeconds === undefined) {
            return
          }
          this.lockWarningSeconds = Math.max(0, this.lockWarningSeconds - 1)
          this.notifyStateChange()
        }, 1000)
      }, this.autoLockMs - LOCK_WARNING_SECONDS * 1000)
    }

    this.autoLockTimer = setTimeout(() => {
      this.lock()
    }, this.autoLockMs)
  }

  private resetAutoLockTimer() {
    if (this.state === 'unlocked' || this.state === 'passcode') {
      this.startAutoLockTimer()
    }
  }

  private stopAutoLockTimer() {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer)
      this.autoLockTimer = null
    }
    if (this.lockWarningTimer) {
      clearTimeout(this.lockWarningTimer)
      this.lockWarningTimer = null
    }
    if (this.lockWarningInterval) {
      clearInterval(this.lockWarningInterval)
      this.lockWarningInterval = null
    }
    this.lockWarningSeconds = undefined
  }

  forcePasscodeState() {
    this.state = 'passcode'
    this.passcodeConfirmedUntil = 0
    this.notifyStateChange()
  }
}
