import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

let loaded = false
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export type KlarkeyEnvRootInput = {
  isPackaged: boolean
  cwd: string
  appPath?: string
  resourcesPath?: string
  execPath?: string
}

function addRoot(roots: Set<string>, root?: string) {
  if (root) {
    roots.add(root)
  }
}

export function resolveKlarkeyEnvRoots(input: KlarkeyEnvRootInput) {
  if (input.isPackaged) {
    return []
  }

  const roots = new Set<string>()
  addRoot(roots, input.cwd)
  addRoot(roots, input.appPath)
  if (input.appPath) {
    addRoot(roots, dirname(input.appPath))
  }
  addRoot(roots, input.resourcesPath)
  if (input.execPath) {
    addRoot(roots, dirname(input.execPath))
  }
  return Array.from(roots)
}

function envRoots() {
  let appPath: string | undefined

  try {
    appPath = app.getAppPath()
  } catch {
    appPath = undefined
  }

  return resolveKlarkeyEnvRoots({
    isPackaged: app?.isPackaged ?? true,
    cwd: process.cwd(),
    appPath,
    resourcesPath: process.resourcesPath,
    execPath: process.execPath,
  })
}

function trimEnvValue(value: string) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }

  const commentIndex = trimmed.search(/\s#/)
  return commentIndex >= 0 ? trimmed.slice(0, commentIndex).trimEnd() : trimmed
}

function loadEnvFile(path: string) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const assignment = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed
    const separator = assignment.indexOf('=')
    if (separator <= 0) {
      continue
    }

    const name = assignment.slice(0, separator).trim()
    if (!envNamePattern.test(name) || process.env[name] !== undefined) {
      continue
    }

    process.env[name] = trimEnvValue(assignment.slice(separator + 1))
  }
}

export function loadKlarkeyEnv() {
  if (loaded) {
    return
  }
  loaded = true

  for (const root of envRoots()) {
    for (const file of ['.env.local', '.env']) {
      const path = join(root, file)
      if (existsSync(path)) {
        loadEnvFile(path)
      }
    }
  }
}

export function getEnvValue(...names: string[]) {
  loadKlarkeyEnv()
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}
