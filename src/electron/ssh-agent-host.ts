import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { app } from 'electron'
import koffi from 'koffi'
import { createDatabase } from '@/electron/database'
import { KeyManager } from '@/electron/crypto'
import { readTrustedDesktopLockState } from '@/electron/desktop-lock-lease'
import { markRuntimeBusy, noteSshActivity, readRuntimeState } from '@/electron/runtime-state'
import { VaultRepository } from '@/electron/repository'
import { EXTERNAL_UNLOCK_TOKEN_ENV, externalUnlockArgs } from '@/electron/external-unlock'
import {
  parseSshPublicKey,
  signSshPayload,
  type SshIdentityRecord,
} from '@/electron/ssh'
import { getWindowsHelloAvailability, verifyWithWindowsHello } from '@/electron/windows-hello-verifier'

type SshClientContext = { processId?: number; processPath?: string }

const SSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'
const PIPE_ACCESS_DUPLEX = 0x00000003
const FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000
const PIPE_TYPE_BYTE = 0x00000000
const PIPE_READMODE_BYTE = 0x00000000
const PIPE_WAIT = 0x00000000
const ERROR_PIPE_CONNECTED = 535
const ERROR_BROKEN_PIPE = 109
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const BUFFER_SIZE = 64 * 1024
const MAX_PACKET_LENGTH = 1024 * 1024
const UNLOCK_WAIT_TIMEOUT_MS = 120_000
const UNLOCK_WAIT_INTERVAL_MS = 350
const SSH_APPROVAL_TTL_MS = 5 * 60 * 1000

const SSH_AGENT_FAILURE = 5
const SSH_AGENTC_REQUEST_IDENTITIES = 11
const SSH_AGENT_IDENTITIES_ANSWER = 12
const SSH_AGENTC_SIGN_REQUEST = 13
const SSH_AGENT_SIGN_RESPONSE = 14
const SSH_AGENT_KNOWN_SIGN_FLAGS = 0x00000002 | 0x00000004

const kernel32 = process.platform === 'win32' ? koffi.load('kernel32.dll') : undefined
const CreateNamedPipeW = kernel32?.func('void* __stdcall CreateNamedPipeW(const char16_t* lpName, uint32 dwOpenMode, uint32 dwPipeMode, uint32 nMaxInstances, uint32 nOutBufferSize, uint32 nInBufferSize, uint32 nDefaultTimeOut, void* lpSecurityAttributes)')
const ConnectNamedPipe = kernel32?.func('int __stdcall ConnectNamedPipe(void* hNamedPipe, void* lpOverlapped)')
const DisconnectNamedPipe = kernel32?.func('int __stdcall DisconnectNamedPipe(void* hNamedPipe)')
const CloseHandle = kernel32?.func('int __stdcall CloseHandle(void* hObject)')
const ReadFile = kernel32?.func('int __stdcall ReadFile(void* hFile, void* lpBuffer, uint32 nNumberOfBytesToRead, _Out_ uint32* lpNumberOfBytesRead, void* lpOverlapped)')
const WriteFile = kernel32?.func('int __stdcall WriteFile(void* hFile, void* lpBuffer, uint32 nNumberOfBytesToWrite, _Out_ uint32* lpNumberOfBytesWritten, void* lpOverlapped)')
const GetLastError = kernel32?.func('uint32 __stdcall GetLastError()')
const GetNamedPipeClientProcessId = kernel32?.func('int __stdcall GetNamedPipeClientProcessId(void* Pipe, _Out_ uint32* ClientProcessId)')
const OpenProcess = kernel32?.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)')
const QueryFullProcessImageNameW = kernel32?.func('bool __stdcall QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ char16_t* lpExeName, _Inout_ uint32* lpdwSize)')

const encodeUint32 = (value: number) => {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

const encodePacket = (payload: Buffer) => Buffer.concat([encodeUint32(payload.length), payload])
const encodeString = (value: Buffer | string) => {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return Buffer.concat([encodeUint32(bytes.length), bytes])
}

const readUint32 = (buffer: Buffer, offset: number) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > buffer.length) {
    throw new Error('Malformed SSH agent message.')
  }

  return {
    value: buffer.readUInt32BE(offset),
    nextOffset: offset + 4,
  }
}

const readString = (buffer: Buffer, offset: number) => {
  const { value: length, nextOffset } = readUint32(buffer, offset)
  const endOffset = nextOffset + length
  if (endOffset > buffer.length) {
    throw new Error('Malformed SSH agent message.')
  }

  return {
    value: buffer.subarray(nextOffset, endOffset),
    nextOffset: endOffset,
  }
}

const writeFailure = () => encodePacket(Buffer.from([SSH_AGENT_FAILURE]))

const readWideString = (buffer: Buffer, characterLength: number) =>
  buffer.toString('utf16le', 0, Math.max(0, characterLength) * 2).replace(/\0+$/g, '').trim()

const resolveClientProcessPath = (processId: number) => {
  if (!OpenProcess || !QueryFullProcessImageNameW || !CloseHandle || processId <= 0) {
    return undefined
  }

  const processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId)
  if (!processHandle) {
    return undefined
  }

  try {
    const pathBuffer = Buffer.alloc(4096 * 2)
    const sizeBuffer = Buffer.alloc(4)
    sizeBuffer.writeUInt32LE(4096, 0)
    const ok = QueryFullProcessImageNameW(processHandle, 0, pathBuffer, sizeBuffer)
    if (!ok) {
      return undefined
    }

    return readWideString(pathBuffer, sizeBuffer.readUInt32LE(0))
  } finally {
    CloseHandle(processHandle)
  }
}

class SshAgentController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository: VaultRepository
  private readonly approvals = new Map<string, number>()
  private lastUnlockPromptAt = 0

  constructor() {
    const lockState = this.readDesktopLockState()
    if (lockState === 'unlocked' && this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    const key = lockState === 'unlocked' && this.keyManager.isKeyInMemory() ? this.keyManager.getKey() : Buffer.alloc(0)
    this.repository = new VaultRepository(this.database.db, key)
  }

  private promptDesktopUnlock() {
    const now = Date.now()
    if (now - this.lastUnlockPromptAt < 15000) {
      return
    }

    this.lastUnlockPromptAt = now

    const appPath = app.getAppPath()
    const unlockArgs = externalUnlockArgs(process.env[EXTERNAL_UNLOCK_TOKEN_ENV])
    const args = appPath && appPath !== process.execPath
      ? [appPath, ...unlockArgs]
      : unlockArgs

    try {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    } catch {
      // ignore unlock prompt failures and let the request fail closed
    }
  }

  dispose() {
    this.database.close()
  }

  private readSetting(key: string) {
    const row = this.database.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
    return row?.value
  }

  private readDesktopLockState(): 'locked' | 'passcode' | 'unlocked' {
    return readTrustedDesktopLockState(this.database.db)
  }

  isEnabled() {
    return this.readSetting('sshAgentEnabled') === 'true'
  }

  private isVaultUnlocked() {
    return this.readDesktopLockState() === 'unlocked'
  }

  private isVaultReady() {
    return this.ensureVaultReady()
  }

  private async waitForVaultReady() {
    const deadline = Date.now() + UNLOCK_WAIT_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (this.isVaultReady()) {
        return true
      }

      await new Promise((resolve) => setTimeout(resolve, UNLOCK_WAIT_INTERVAL_MS))
    }

    return false
  }

  private ensureVaultReady() {
    if (!this.isVaultUnlocked()) {
      this.approvals.clear()
      this.repository.clearKey()
      this.keyManager.evictKey()
      return false
    }

    if (!this.keyManager.isKeyInMemory() && this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    if (!this.keyManager.isKeyInMemory()) {
      return false
    }

    this.repository.setKey(this.keyManager.getKey())
    return true
  }

  listIdentities() {
    if (!this.isVaultReady()) {
      return []
    }

    return this.repository.listSshPublicIdentities()
  }

  private hasClientContext(context: SshClientContext) {
    return Boolean(context.processPath)
  }

  private identityAnswer(identities: SshIdentityRecord[]) {
    const identityParts: Buffer[] = []
    for (const identity of identities) {
      try {
        const { blob } = parseSshPublicKey(identity.publicKey)
        identityParts.push(encodeString(blob))
        identityParts.push(encodeString(identity.comment || identity.itemName))
      } catch {
        continue
      }
    }

    return encodePacket(Buffer.concat([
      Buffer.from([SSH_AGENT_IDENTITIES_ANSWER]),
      encodeUint32(identityParts.length / 2),
      ...identityParts,
    ]))
  }

  private approvalKey(identity: SshIdentityRecord, processPath?: string, processId?: number) {
    return `${identity.itemId}::${processPath ?? 'unknown'}::pid:${processId ?? 0}`
  }

  private formatFingerprint(fingerprint: string) {
    const withoutPrefix = fingerprint.replace(/^SHA256:/, '')
    return withoutPrefix.length > 16 ? `${withoutPrefix.slice(0, 16)}…` : withoutPrefix
  }

  private pruneApprovals(now = Date.now()) {
    for (const [key, expiresAt] of this.approvals) {
      if (expiresAt <= now) {
        this.approvals.delete(key)
      }
    }
  }

  private async authorize(identity: SshIdentityRecord, processPath?: string, processId?: number) {
    if (!processPath) {
      return false
    }

    const cacheKey = this.approvalKey(identity, processPath, processId)
    const now = Date.now()
    this.pruneApprovals(now)
    if ((this.approvals.get(cacheKey) ?? 0) > now) {
      return true
    }

    const availability = await getWindowsHelloAvailability()
    if (!availability.available) {
      return false
    }

    const appLabel = processPath ? basename(processPath) : `PID ${processId ?? 'unknown'}`
    const shortFingerprint = this.formatFingerprint(identity.fingerprint)
    const verification = await verifyWithWindowsHello(
      `Allow ${appLabel} to use the SSH key "${identity.itemName}" (${shortFingerprint}) in Klarkey.`,
    )

    if (!verification.verified) {
      return false
    }

    this.approvals.set(cacheKey, Date.now() + SSH_APPROVAL_TTL_MS)
    return true
  }

  private findIdentityByKeyBlob(keyBlob: Buffer) {
    for (const identity of this.repository.listSshIdentities()) {
      try {
        if (parseSshPublicKey(identity.publicKey).blob.equals(keyBlob)) {
          return identity
        }
      } catch {
        continue
      }
    }

    return undefined
  }

  async handlePacket(packet: Buffer, context: SshClientContext) {
    const messageType = packet[0]
    const payload = packet.subarray(1)

    noteSshActivity()
    markRuntimeBusy('ssh', 30_000)

    if (readRuntimeState().update.availability === 'updating') {
      return writeFailure()
    }

    if (messageType === SSH_AGENTC_REQUEST_IDENTITIES) {
      if (!this.hasClientContext(context)) {
        return this.identityAnswer([])
      }

      return this.identityAnswer(this.listIdentities())
    }

    if (messageType === SSH_AGENTC_SIGN_REQUEST) {
      let keyBlob: ReturnType<typeof readString>
      let signPayload: ReturnType<typeof readString>
      let flags: ReturnType<typeof readUint32>
      try {
        keyBlob = readString(payload, 0)
        signPayload = readString(payload, keyBlob.nextOffset)
        flags = readUint32(payload, signPayload.nextOffset)
      } catch {
        return writeFailure()
      }
      if (flags.nextOffset !== payload.length || (flags.value & ~SSH_AGENT_KNOWN_SIGN_FLAGS) !== 0) {
        return writeFailure()
      }

      const needsUnlock = !this.isVaultReady()
      if (needsUnlock) {
        this.promptDesktopUnlock()
        const unlocked = await this.waitForVaultReady()
        if (!unlocked) {
          return writeFailure()
        }
      }

      const identity = this.findIdentityByKeyBlob(keyBlob.value)
      if (!identity) {
        return writeFailure()
      }

      const authorized = await this.authorize(identity, context.processPath, context.processId)
      if (!authorized) {
        return writeFailure()
      }

      const signature = signSshPayload(identity, signPayload.value, flags.value)
      return encodePacket(Buffer.concat([
        Buffer.from([SSH_AGENT_SIGN_RESPONSE]),
        encodeString(signature),
      ]))
    }

    return writeFailure()
  }
}

const createPipe = () => {
  if (!CreateNamedPipeW) {
    throw new Error('SSH agent hosting is only available on Windows.')
  }

  const handle = CreateNamedPipeW(
    SSH_AGENT_PIPE,
    PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
    1,
    BUFFER_SIZE,
    BUFFER_SIZE,
    0,
    null,
  )

  const address = handle ? koffi.address(handle) : 0n
  if (address === 0n || address === 18446744073709551615n) {
    throw new Error('Could not create the OpenSSH agent pipe.')
  }

  return handle
}

const readClientProcessId = (handle: unknown) => {
  if (!GetNamedPipeClientProcessId) {
    return undefined
  }

  const buffer = Buffer.alloc(4)
  const ok = GetNamedPipeClientProcessId(handle, buffer)
  return ok ? buffer.readUInt32LE(0) : undefined
}

const writeToPipe = (handle: unknown, payload: Buffer) => {
  if (!WriteFile) {
    return false
  }

  const written = Buffer.alloc(4)
  const ok = WriteFile(handle, payload, payload.length, written, null)
  return Boolean(ok && written.readUInt32LE(0) === payload.length)
}

const readFromPipe = (handle: unknown) => {
  if (!ReadFile || !GetLastError) {
    return undefined
  }

  const buffer = Buffer.alloc(BUFFER_SIZE)
  const bytesRead = Buffer.alloc(4)
  const ok = ReadFile(handle, buffer, buffer.length, bytesRead, null)
  if (ok) {
    const length = bytesRead.readUInt32LE(0)
    return length > 0 ? buffer.subarray(0, length) : undefined
  }

  const error = GetLastError()
  if (error === ERROR_BROKEN_PIPE) {
    return undefined
  }

  throw new Error(`Pipe read failed with ${error}.`)
}

const handleClient = async (controller: SshAgentController, handle: unknown) => {
  const processId = readClientProcessId(handle)
  const processPath = processId ? resolveClientProcessPath(processId) : undefined
  let pending = Buffer.alloc(0)

  while (true) {
    const chunk = readFromPipe(handle)
    if (!chunk || chunk.length === 0) {
      return
    }

    pending = Buffer.concat([pending, chunk])
    while (pending.length >= 4) {
      const packetLength = pending.readUInt32BE(0)
      if (packetLength <= 0 || packetLength > MAX_PACKET_LENGTH) {
        writeToPipe(handle, writeFailure())
        return
      }

      if (pending.length < packetLength + 4) {
        break
      }

      const packet = pending.subarray(4, packetLength + 4)
      pending = pending.subarray(packetLength + 4)
      const response = await controller.handlePacket(packet, { processId, processPath })
      if (!writeToPipe(handle, response)) {
        return
      }
    }
  }
}

export async function runSshAgentHost() {
  if (process.platform !== 'win32') {
    return
  }

  const controller = new SshAgentController()
  if (!controller.isEnabled()) {
    controller.dispose()
    return
  }

  try {
    while (controller.isEnabled()) {
      const handle = createPipe()
      try {
        const connected = ConnectNamedPipe?.(handle, null)
        const error = GetLastError?.()
        if (!connected && error !== ERROR_PIPE_CONNECTED) {
          throw new Error(`Could not accept SSH agent client: ${error ?? 'unknown error'}.`)
        }

        await handleClient(controller, handle)
      } finally {
        DisconnectNamedPipe?.(handle)
        CloseHandle?.(handle)
      }
    }
  } finally {
    controller.dispose()
  }
}
