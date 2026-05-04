import { randomBytes } from 'node:crypto'

export const EXTERNAL_UNLOCK_FLAG = '--external-unlock'
export const EXTERNAL_UNLOCK_TOKEN_FLAG = '--external-unlock-token'
export const EXTERNAL_UNLOCK_TOKEN_ENV = 'KLARKEY_EXTERNAL_UNLOCK_TOKEN'

export const createExternalUnlockToken = () => randomBytes(32).toString('base64url')

export const externalUnlockArgs = (token: string | undefined) =>
  token ? [EXTERNAL_UNLOCK_FLAG, EXTERNAL_UNLOCK_TOKEN_FLAG, token] : [EXTERNAL_UNLOCK_FLAG]

const readFlagValue = (argv: string[], flag: string) => {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : undefined
}

export const hasTrustedExternalUnlockArgs = (argv: string[], expectedToken: string) =>
  argv.includes(EXTERNAL_UNLOCK_FLAG) && readFlagValue(argv, EXTERNAL_UNLOCK_TOKEN_FLAG) === expectedToken
