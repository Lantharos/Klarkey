import { AVAILABLE_ITEM_TYPES, getItemTypeDefinition } from '@/shared/item-types'
import { includes, itemScore, scoreForegroundMatch, scoreRecent } from '@/shared/resolver/scoring'
import { getLogoMeta, itemSubtitle } from '@/shared/resolver/item-display'
import type { ExternalWindowContext, ResolvedAction, SearchResponse, VaultSnapshot } from '@/shared/types'
import { parseCommand } from '@/shared/command'

export const defaultSearchLimit = 20

function createTypeActions(literalName: string) {
  return AVAILABLE_ITEM_TYPES.map((itemType, index) => {
    const definition = getItemTypeDefinition(itemType)

    return {
      id: `create:${itemType}:${literalName || 'blank'}`,
      kind: 'create-item' as const,
      title: literalName ? `Create ${definition.noun}` : definition.createLabel,
      subtitle: literalName || definition.placeholderName,
      itemType,
      primaryHint: literalName
        ? `Create a ${definition.noun} named ${literalName}.`
        : `Start a new ${definition.noun}.`,
      requiresUnlock: itemType === 'login',
      score: 100 - index,
    }
  })
}

export function pageActions(actions: ResolvedAction[], offset = 0, limit = defaultSearchLimit): SearchResponse {
  const nextOffset = Math.max(0, offset) + Math.max(1, limit)
  const pagedActions = actions.slice(Math.max(0, offset), nextOffset)

  return {
    actions: pagedActions,
    locked: false,
    hasMore: nextOffset < actions.length,
    nextOffset: nextOffset < actions.length ? nextOffset : actions.length,
  }
}

export function buildResolvedActions(
  snapshot: VaultSnapshot,
  query = parseCommand(''),
  targetContext?: ExternalWindowContext,
  showDevOptions = false,
): ResolvedAction[] {
  const settingsAction: ResolvedAction = {
    id: 'settings',
    kind: 'open-settings',
    title: 'Open settings',
    subtitle: 'Preferences',
    primaryHint: 'Open preferences.',
    requiresUnlock: false,
    score: 1,
  }

  const devAction: ResolvedAction = {
    id: 'dev',
    kind: 'open-settings' as const,
    title: 'Developer Options',
    subtitle: 'Dev tools',
    primaryHint: 'Open developer options panel.',
    requiresUnlock: false,
    score: 0,
  }

  const utilityActions = showDevOptions ? [settingsAction, devAction] : [settingsAction]

  if (query.intent === 'settings') {
    return utilityActions
  }

  if (query.intent === 'create') {
    const literalName = query.itemQuery?.trim() || ''

    if (!query.entryType) {
      return [...createTypeActions(literalName), ...utilityActions]
    }

    const definition = getItemTypeDefinition(query.entryType)

    if (!definition.available) {
      return [
        {
          id: `coming-soon:${query.entryType}`,
          kind: 'coming-soon',
          title: definition.label,
          subtitle: 'Coming soon',
          itemType: query.entryType,
          primaryHint: `${definition.label} is reserved for a future item type.`,
          requiresUnlock: false,
          score: 100,
        },
          ...utilityActions,
        ]
    }

    return [
      {
        id: `create:${query.entryType}:${literalName || 'blank'}`,
        kind: 'create-item',
        title: literalName ? `Create ${literalName}` : definition.createLabel,
        subtitle: literalName || definition.placeholderName,
        itemType: query.entryType,
        primaryHint: literalName ? `Create a new ${definition.noun}.` : `Start a new ${definition.noun}.`,
        requiresUnlock: query.entryType === 'login',
        score: 100,
      },
      ...utilityActions,
    ]
  }

  if (!query.raw) {
    const ranked = snapshot.items
      .map((item) => ({
        item,
        foreground: scoreForegroundMatch(item, targetContext),
        recent: scoreRecent(snapshot.recents, item.id),
      }))
      .sort((a, b) => {
        if (b.foreground !== a.foreground) {
          return b.foreground - a.foreground
        }
        if (b.recent !== a.recent) {
          return b.recent - a.recent
        }
        return a.item.itemName.localeCompare(b.item.itemName)
      })

    const recentActions = ranked.map(({ item, foreground, recent }) => ({
      id: `open:${item.id}`,
      kind: 'open-item' as const,
      title: item.itemName,
      subtitle: itemSubtitle(item),
      itemId: item.id,
      itemType: item.itemType,
      ...getLogoMeta(item),
      primaryHint: `Open this ${getItemTypeDefinition(item.itemType).noun}.`,
      modifiers:
        item.itemType === 'login'
          ? {
              control: 'Copy the password instead.',
            }
          : undefined,
      requiresUnlock: false,
      score: foreground + recent,
    }))

    return [...recentActions, ...utilityActions]
  }

  const matchingItems = snapshot.items
    .filter((item) => !query.entryType || item.itemType === query.entryType)
    .map((item) => ({ item, score: itemScore(item, query.itemQuery ?? query.raw) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const actions: ResolvedAction[] = []

  for (const { item, score } of matchingItems) {
    if (
      query.identityQuery &&
      !includes(item.itemName, query.identityQuery) &&
      !includes(item.username, query.identityQuery) &&
      !includes(item.fullName, query.identityQuery) &&
      !includes(item.email, query.identityQuery) &&
      !includes(item.firstName, query.identityQuery) &&
      !includes(item.lastName, query.identityQuery)
    ) {
      continue
    }

    const baseScore = score + scoreRecent(snapshot.recents, item.id)

    if (query.intent === 'insert' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `paste:${item.id}:password`,
        kind: 'copy-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Insert the password into the last selected field.',
        requiresUnlock: true,
        score: baseScore + 24,
      })
    } else if (query.intent === 'insert' && query.credential === 'otp' && item.hasOtp) {
      actions.push({
        id: `paste:${item.id}:otp`,
        kind: 'copy-otp',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Insert the current one-time code into the last selected field.',
        requiresUnlock: true,
        score: baseScore + 23,
      })
    } else if (query.intent === 'insert' && query.credential === 'username' && item.username) {
      actions.push({
        id: `paste:${item.id}:username`,
        kind: 'copy-value',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Insert the primary text into the last selected field.',
        requiresUnlock: false,
        score: baseScore + 24,
      })
    } else if (query.intent === 'show' && query.credential === 'otp' && item.hasOtp) {
      actions.push({
        id: `show:${item.id}:otp`,
        kind: 'show-otp',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Reveal the one-time code.',
        modifiers: {
          control: 'Copy the one-time code to the clipboard.',
        },
        requiresUnlock: true,
        score: baseScore + 22,
      })
    } else if (query.intent === 'copy' && query.credential === 'otp' && item.hasOtp) {
      actions.push({
        id: `copy:${item.id}:otp`,
        kind: 'copy-otp',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Copy the current one-time code to the clipboard.',
        requiresUnlock: true,
        score: baseScore + 21.5,
      })
    } else if (query.intent === 'copy' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `copy:${item.id}:password`,
        kind: 'copy-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Copy the password to the clipboard.',
        requiresUnlock: true,
        score: baseScore + 21,
      })
    } else if (query.intent === 'show' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `show:${item.id}:password`,
        kind: 'show-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: 'Reveal the password in place.',
        modifiers: {
          control: 'Copy the password to the clipboard.',
        },
        requiresUnlock: true,
        score: baseScore + 20,
      })
    } else if (query.intent === 'switch') {
      actions.push({
        id: `switch:${item.id}`,
        kind: 'switch-item',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: `Make this ${getItemTypeDefinition(item.itemType).noun} the current item.`,
        requiresUnlock: false,
        score: baseScore + 16,
      })
    } else {
      actions.push({
        id: `open:${item.id}`,
        kind: 'open-item',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        itemId: item.id,
        itemType: item.itemType,
        ...getLogoMeta(item),
        primaryHint: `Open this ${getItemTypeDefinition(item.itemType).noun}.`,
        modifiers:
          item.itemType === 'login'
            ? {
                control: 'Copy the password instead.',
                alt: 'Show the password in the palette.',
              }
            : item.itemType === 'note'
              ? {
                  control: 'Copy the note body instead.',
                }
              : undefined,
        requiresUnlock: false,
        score: baseScore + 14,
      })
    }
  }

  if (actions.length === 0) {
    return utilityActions
  }

  return [
    ...actions.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.title.localeCompare(right.title)
    }),
    ...utilityActions,
  ]
}
