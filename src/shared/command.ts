import type { CommandIntent, CommandQuery, CommandToken, CredentialKind } from '@/shared/types'
import { parseItemType } from '@/shared/item-types'
import { randomId } from '@/shared/random-id'

const INTENT_SYNONYMS: Record<string, CommandIntent> = {
  create: 'create',
  new: 'create',
  insert: 'insert',
  show: 'show',
  copy: 'copy',
  generate: 'generate',
  login: 'login',
  share: 'share',
  switch: 'switch',
  settings: 'settings',
}

const CREDENTIAL_SYNONYMS: Record<string, CredentialKind> = {
  username: 'username',
  user: 'username',
  password: 'password',
  pass: 'password',
  otp: 'otp',
  '2fa': 'otp',
  totp: 'otp',
  passkey: 'passkey',
}

const STOP_WORDS = new Set(['for', 'with', 'to'])
const IDENTITY_CONNECTORS = new Set(['as', 'using'])

const slug = (value: string) => value.toLowerCase().trim()

const createToken = (kind: CommandToken['kind'], value: string): CommandToken => ({
  id: `${kind}:${value}:${randomId('token')}`,
  kind,
  label: value,
  value,
})

export const composeCommandRaw = (query: Pick<CommandQuery, 'tokens' | 'trailingText'>) =>
  [...query.tokens.map((token) => token.value), query.trailingText].filter(Boolean).join(' ').trim()

export function parseCommand(rawInput: string): CommandQuery {
  const normalizedInput = rawInput.replace(/\s+/g, ' ')
  const raw = normalizedInput.trim()

  if (!raw) {
    return {
      raw: '',
      intent: 'search',
      tokens: [],
      trailingText: normalizedInput,
    }
  }

  const words = raw.split(' ')
  const tokens: CommandToken[] = []
  let intent: CommandIntent = 'search'
  let credential: CredentialKind | undefined
  let entryType: CommandQuery['entryType']
  let index = 0

  const maybeIntent = INTENT_SYNONYMS[slug(words[0])]
  if (maybeIntent) {
    intent = maybeIntent
    tokens.push(createToken('intent', words[0]))
    index += 1

    if (maybeIntent === 'create') {
      const itemTypeMatch = parseItemType(words, index)

      if (itemTypeMatch) {
        entryType = itemTypeMatch.itemType
        tokens.push(createToken('item-type', words.slice(index, index + itemTypeMatch.consumed).join(' ')))
        index += itemTypeMatch.consumed
      }
    }
  }

  const maybeCredential = CREDENTIAL_SYNONYMS[slug(words[index] ?? '')]
  if (maybeCredential) {
    credential = maybeCredential
    tokens.push(createToken('credential', words[index]))
    index += 1
  }

  const remaining = words.slice(index)
  const pivot = remaining.findIndex((word) => IDENTITY_CONNECTORS.has(slug(word)))
  const shouldSplitImplicitIdentity =
    pivot === -1 &&
    (intent === 'insert' || intent === 'copy' || intent === 'show') &&
    remaining.length > 1

  const rawItemWords = shouldSplitImplicitIdentity
    ? remaining.slice(0, 1)
    : pivot === -1
      ? remaining
      : remaining.slice(0, pivot)
  const rawIdentityWords = shouldSplitImplicitIdentity
    ? remaining.slice(1)
    : pivot === -1
      ? []
      : remaining.slice(pivot + 1)

  const itemWords = rawItemWords.filter((word) => !STOP_WORDS.has(slug(word)))
  const identityWords = rawIdentityWords.filter((word) => !STOP_WORDS.has(slug(word)))
  const itemQuery = itemWords.join(' ').trim()
  const identityQuery = identityWords.join(' ').trim()
  const trailingText = `${remaining.join(' ')}${/\s$/.test(normalizedInput) ? ' ' : ''}`

  return {
    raw,
    intent,
    tokens,
    trailingText,
    entryType,
    itemQuery: itemQuery || undefined,
    identityQuery: identityQuery || undefined,
    credential,
  }
}
