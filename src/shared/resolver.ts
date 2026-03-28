import type { IdentityProfile, RecentAction, ResolvedAction, VaultSnapshot } from '@/shared/types'
import { parseCommand } from '@/shared/command'

const includes = (haystack: string | undefined, needle: string) =>
  (haystack ?? '').toLowerCase().includes(needle.toLowerCase())

const scoreRecent = (recents: RecentAction[], identityId?: string) => {
  const hit = recents.find((recent) => recent.identityId === identityId)

  if (!hit) {
    return 0
  }

  const ageHours = (Date.now() - new Date(hit.usedAt).getTime()) / 3_600_000
  return Math.max(0, 40 - ageHours)
}

const itemScore = (item: IdentityProfile, query: string) => {
  if (!query) {
    return 0
  }

  if (includes(item.itemName, query)) {
    return 32
  }

  if (includes(item.username, query)) {
    return 24
  }

  if (item.websites?.some((website) => includes(website, query))) {
    return 18
  }

  if (includes(item.notes, query)) {
    return 12
  }

  return 0
}

const itemSubtitle = (item: IdentityProfile) => item.username || item.itemName

export function resolveActions(snapshot: VaultSnapshot, query = parseCommand('')): ResolvedAction[] {
  const settingsAction: ResolvedAction = {
    id: 'settings',
    kind: 'open-settings',
    title: 'Open settings',
    subtitle: 'Preferences',
    primaryHint: 'Open preferences.',
    requiresUnlock: false,
    score: 1,
  }

  if (query.intent === 'settings') {
    return [settingsAction]
  }

  if (query.intent === 'create') {
    const literalName = query.itemQuery?.trim() || query.trailingText.trim()

    if (!literalName) {
      return [settingsAction]
    }

    return [
      {
        id: `create:new:${literalName}`,
        kind: 'create-login',
        title: `Create ${literalName}`,
        subtitle: '',
        primaryHint: 'Create a new item.',
        requiresUnlock: true,
        score: 100,
      },
      settingsAction,
    ]
  }

  if (!query.raw) {
    const recentActions = snapshot.items.map((item) => ({
      id: `recent:${item.id}`,
      kind: 'login' as const,
      title: item.itemName,
      subtitle: itemSubtitle(item),
      identityId: item.id,
      primaryHint: 'Open this item.',
      modifiers: {
        control: 'Copy the password instead.',
      },
      requiresUnlock: false,
      score: scoreRecent(snapshot.recents, item.id),
    }))

    return [
      ...recentActions.sort((left, right) => right.score - left.score).slice(0, 5),
      settingsAction,
    ]
  }

  const matchingItems = snapshot.items
    .map((item) => ({ item, score: itemScore(item, query.itemQuery ?? query.raw) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const actions: ResolvedAction[] = []

  for (const { item, score } of matchingItems) {
    if (
      query.identityQuery &&
      !includes(item.itemName, query.identityQuery) &&
      !includes(item.username, query.identityQuery)
    ) {
      continue
    }

    const baseScore = score + scoreRecent(snapshot.recents, item.id)

    if (query.intent === 'insert' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `paste-password:${item.id}`,
        kind: 'copy-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Insert the password into the last selected field.',
        requiresUnlock: true,
        score: baseScore + 24,
      })
    } else if (query.intent === 'insert' && query.credential === 'username') {
      actions.push({
        id: `paste-username:${item.id}`,
        kind: 'login',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Insert the username into the last selected field.',
        requiresUnlock: false,
        score: baseScore + 24,
      })
    } else if (query.intent === 'show' && query.credential === 'otp' && item.hasOtp) {
      actions.push({
        id: `otp:${item.id}`,
        kind: 'show-otp',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Reveal the one-time code.',
        modifiers: {
          control: 'Copy the one-time code to the clipboard.',
        },
        requiresUnlock: true,
        score: baseScore + 22,
      })
    } else if (query.intent === 'copy' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `copy-password:${item.id}`,
        kind: 'copy-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Copy the password to the clipboard.',
        requiresUnlock: true,
        score: baseScore + 21,
      })
    } else if (query.intent === 'show' && query.credential === 'password' && item.hasPassword) {
      actions.push({
        id: `show-password:${item.id}`,
        kind: 'show-password',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Reveal the password in place.',
        modifiers: {
          control: 'Copy the password to the clipboard.',
        },
        requiresUnlock: true,
        score: baseScore + 20,
      })
    } else if (query.intent === 'generate') {
      actions.push({
        id: `passkey:${item.id}`,
        kind: 'generate-passkey',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Create a local placeholder for the future passkey bridge.',
        requiresUnlock: true,
        score: baseScore + 18,
      })
    } else if (query.intent === 'switch') {
      actions.push({
        id: `switch:${item.id}`,
        kind: 'switch-identity',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Make this the current item.',
        requiresUnlock: false,
        score: baseScore + 16,
      })
    } else {
      actions.push({
        id: `login:${item.id}`,
        kind: 'login',
        title: item.itemName,
        subtitle: itemSubtitle(item),
        identityId: item.id,
        primaryHint: 'Open this item.',
        modifiers: {
          control: 'Copy the password instead.',
          alt: 'Show the password in the palette.',
        },
        requiresUnlock: false,
        score: baseScore + 14,
      })
    }
  }

  if (query.intent === 'insert' && actions.length === 0) {
    return [settingsAction]
  }

  if (actions.length === 0) {
    return [settingsAction]
  }

  return [...actions.sort((left, right) => right.score - left.score).slice(0, 8), settingsAction]
}
