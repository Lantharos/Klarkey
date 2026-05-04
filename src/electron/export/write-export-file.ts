import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, writeFileSync } from 'node:fs'

const privateFileMode = 0o600

const windowsNamespacePrefix = /^\\\\[?.]\\/

export function isWindowsAlternateDataStreamPath(filePath: string) {
  if (process.platform !== 'win32') {
    return false
  }

  const path = filePath.replace(windowsNamespacePrefix, '')
  const drivePrefixLength = /^[a-zA-Z]:/.test(path) ? 2 : 0
  return path.slice(drivePrefixLength).includes(':')
}

export function writePrivateExportFile(filePath: string, value: string) {
  if (isWindowsAlternateDataStreamPath(filePath)) {
    throw new Error('Choose a normal export file path.')
  }

  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error('Choose a normal export file path.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const fd = openSync(
    filePath,
    constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW,
    privateFileMode,
  )

  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error('Choose a normal export file path.')
    }

    writeFileSync(fd, value, { encoding: 'utf-8' })
    try {
      fchmodSync(fd, privateFileMode)
    } catch {
      void 0
    }
  } finally {
    closeSync(fd)
  }

  try {
    chmodSync(filePath, privateFileMode)
  } catch {
    void 0
  }
}
