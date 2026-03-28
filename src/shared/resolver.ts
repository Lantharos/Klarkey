import type { RecentAction, ResolvedAction, ServiceRecord, VaultSnapshot } from '@/shared/types'
import { parseCommand } from '@/shared/command'

const includes = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase())

const scoreRecent = (recents: RecentAction[], identityId?: string, serviceId?: string) => {
  const hit = recents.find(
    (recent) => recent.identityId === identityId || (serviceId !== undefined && recent.serviceId === serviceId),
  )

  if (!hit) {
    return 0
  }

  const ageHours = (Date.now() - new Date(hit.usedAt).getTime()) / 3_600_000
  return Math.max(0, 40 - ageHours)
}

const matchService = (record: ServiceRecord, query: string) => {
  if (!query) {
    return record.service.pinned ? 5 : 0
  }

  if (includes(record.service.name, query)) {
    return 32
  }

  if (record.service.aliases.some((alias) => includes(alias, query))) {
    return 24
  }

  return 0
}

const identitySubtitle = (record: ServiceRecord, identity: ServiceRecord['identities'][number]) =>
  identity.username || identity.label || record.service.name

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

  if (!query.raw) {
    const recentActions = snapshot.records.flatMap((record) =>
      record.identities.slice(0, 2).map((identity) => ({
        id: `recent:${identity.id}`,
        kind: 'login' as const,
        title: record.service.name,
        subtitle: identity.username,
        serviceId: record.service.id,
        identityId: identity.id,
        primaryHint: 'Open this item.',
        modifiers: {
          control: 'Copy the password instead.',
        },
        requiresUnlock: false,
        score: scoreRecent(snapshot.recents, identity.id, record.service.id) + (record.service.pinned ? 16 : 0),
      })),
    )

    return [
      ...recentActions.sort((left, right) => right.score - left.score).slice(0, 5),
      settingsAction,
    ]
  }

  const matchingRecords = snapshot.records
    .map((record) => ({ record, score: matchService(record, query.serviceQuery ?? query.raw) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const actions: ResolvedAction[] = []

  for (const { record, score } of matchingRecords) {
    const identityMatches = record.identities.filter((identity) => {
      if (!query.identityQuery) {
        return true
      }

      return includes(identity.label, query.identityQuery) || includes(identity.username, query.identityQuery)
    })

    const identities = identityMatches.length > 0 ? identityMatches : record.identities

    for (const identity of identities) {
      const baseScore = score + scoreRecent(snapshot.recents, identity.id, record.service.id)

      if (query.intent === 'create') {
        continue
      }

      if (query.intent === 'insert' && query.credential === 'password' && identity.hasPassword) {
        actions.push({
          id: `paste-password:${identity.id}`,
          kind: 'copy-password',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Insert the password into the last selected field.',
          requiresUnlock: true,
          score: baseScore + 24,
        })
      } else if (query.intent === 'insert' && query.credential === 'username') {
        actions.push({
          id: `paste-username:${identity.id}`,
          kind: 'login',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Insert the username into the last selected field.',
          requiresUnlock: false,
          score: baseScore + 24,
        })
      } else if (query.intent === 'show' && query.credential === 'otp' && identity.hasOtp) {
        actions.push({
          id: `otp:${identity.id}`,
          kind: 'show-otp',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Reveal the one-time code.',
          modifiers: {
            control: 'Copy the one-time code to the clipboard.',
          },
          requiresUnlock: true,
          score: baseScore + 22,
        })
      } else if (query.intent === 'copy' && query.credential === 'password' && identity.hasPassword) {
        actions.push({
          id: `copy-password:${identity.id}`,
          kind: 'copy-password',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Copy the password to the clipboard.',
          requiresUnlock: true,
          score: baseScore + 21,
        })
      } else if (query.intent === 'show' && query.credential === 'password' && identity.hasPassword) {
        actions.push({
          id: `show-password:${identity.id}`,
          kind: 'show-password',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Reveal the password in place.',
          modifiers: {
            control: 'Copy the password to the clipboard.',
          },
          requiresUnlock: true,
          score: baseScore + 20,
        })
      } else if (query.intent === 'generate') {
        actions.push({
          id: `passkey:${identity.id}`,
          kind: 'generate-passkey',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Create a local placeholder for the future passkey bridge.',
          requiresUnlock: true,
          score: baseScore + 18,
        })
      } else if (query.intent === 'switch') {
        actions.push({
          id: `switch:${identity.id}`,
          kind: 'switch-identity',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
          primaryHint: 'Make this the current identity.',
          requiresUnlock: false,
          score: baseScore + 16,
        })
      } else {
        actions.push({
          id: `login:${identity.id}`,
          kind: 'login',
          title: record.service.name,
          subtitle: identitySubtitle(record, identity),
          serviceId: record.service.id,
          identityId: identity.id,
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

    if (query.intent === 'create') {
      actions.push({
        id: `create:${record.service.id}`,
        kind: 'create-login',
        title: `Create ${record.service.name}`,
        subtitle: query.entryType === 'login' ? 'Login item' : 'Item',
        serviceId: record.service.id,
        primaryHint: 'Create a new item.',
        requiresUnlock: true,
        score: score + 30,
      })
    }
  }

  if (query.intent === 'create' && actions.length === 0 && query.serviceQuery) {
    actions.push({
      id: `create:new:${query.serviceQuery}`,
      kind: 'create-login',
      title: `Create ${query.serviceQuery}`,
      subtitle: query.entryType === 'login' ? 'Login item' : 'Item',
      primaryHint: 'Create a new item.',
      requiresUnlock: true,
      score: 28,
    })
  }

  if (query.intent === 'insert' && actions.length === 0) {
    return [settingsAction]
  }

  if (actions.length === 0) {
    return [settingsAction]
  }

  return [...actions.sort((left, right) => right.score - left.score).slice(0, 8), settingsAction]
}
