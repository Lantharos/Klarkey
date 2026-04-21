export const AVAILABLE_ITEM_TYPES = ['login', 'identity', 'card', 'note', 'ssh-key'] as const
export const FUTURE_ITEM_TYPES = [] as const
export const ALL_ITEM_TYPES = [...AVAILABLE_ITEM_TYPES, ...FUTURE_ITEM_TYPES] as const

export type CreatableItemType = (typeof AVAILABLE_ITEM_TYPES)[number]
export type ItemType = (typeof ALL_ITEM_TYPES)[number]

export type ItemTypeDefinition = {
  type: ItemType
  label: string
  noun: string
  aliases: string[]
  createLabel: string
  placeholderName: string
  supportsSecrets: boolean
  available: boolean
}

export const ITEM_TYPE_DEFINITIONS: Record<ItemType, ItemTypeDefinition> = {
  login: {
    type: 'login',
    label: 'Login',
    noun: 'login',
    aliases: ['login', 'logins'],
    createLabel: 'New login',
    placeholderName: 'New login',
    supportsSecrets: true,
    available: true,
  },
  identity: {
    type: 'identity',
    label: 'Identity',
    noun: 'identity',
    aliases: ['identity', 'identities', 'profile'],
    createLabel: 'New identity',
    placeholderName: 'Personal identity',
    supportsSecrets: false,
    available: true,
  },
  card: {
    type: 'card',
    label: 'Card',
    noun: 'card',
    aliases: ['card', 'cards', 'credit card', 'debit card', 'payment card'],
    createLabel: 'New card',
    placeholderName: 'Visa ending in 4242',
    supportsSecrets: true,
    available: true,
  },
  note: {
    type: 'note',
    label: 'Note',
    noun: 'note',
    aliases: ['note', 'notes'],
    createLabel: 'New note',
    placeholderName: 'Quick note',
    supportsSecrets: false,
    available: true,
  },
  'ssh-key': {
    type: 'ssh-key',
    label: 'SSH key',
    noun: 'ssh key',
    aliases: ['ssh key', 'ssh-key', 'ssh', 'key'],
    createLabel: 'New SSH key',
    placeholderName: 'SSH key',
    supportsSecrets: true,
    available: true,
  },
}

export function getItemTypeDefinition(itemType: ItemType) {
  return ITEM_TYPE_DEFINITIONS[itemType]
}

export function isCreatableItemType(itemType: ItemType): itemType is CreatableItemType {
  return AVAILABLE_ITEM_TYPES.includes(itemType as CreatableItemType)
}

export function parseItemType(words: string[], startIndex: number) {
  const pair = `${words[startIndex] ?? ''} ${words[startIndex + 1] ?? ''}`.trim().toLowerCase()
  const single = (words[startIndex] ?? '').trim().toLowerCase()

  const matchedEntry = Object.values(ITEM_TYPE_DEFINITIONS).find((definition) =>
    definition.aliases.some((alias) => alias === pair || alias === single),
  )

  if (!matchedEntry) {
    return undefined
  }

  const matchedWordCount = matchedEntry.aliases.some((alias) => alias === pair) ? 2 : 1

  return {
    itemType: matchedEntry.type,
    consumed: matchedWordCount,
  }
}
