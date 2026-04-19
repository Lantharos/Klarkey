import type { ExternalWindowContext, SearchResponse, VaultSnapshot } from '@/shared/types'
import { parseCommand } from '@/shared/command'
import { buildResolvedActions, defaultSearchLimit, pageActions } from '@/shared/resolver/resolve-actions'

export function resolveActions(
  snapshot: VaultSnapshot,
  query = parseCommand(''),
  targetContext?: ExternalWindowContext,
  showDevOptions = false,
) {
  return buildResolvedActions(snapshot, query, targetContext, showDevOptions)
}

export function resolveSearchResponse(
  snapshot: VaultSnapshot,
  query = parseCommand(''),
  options?: {
    offset?: number
    limit?: number
    locked?: boolean
    targetContext?: ExternalWindowContext
    showDevOptions?: boolean
  },
): SearchResponse {
  const response = pageActions(
    buildResolvedActions(snapshot, query, options?.targetContext, options?.showDevOptions ?? false),
    options?.offset ?? 0,
    options?.limit ?? defaultSearchLimit,
  )
  response.locked = options?.locked ?? false
  return response
}

export { buildResolvedActions, defaultSearchLimit, pageActions } from '@/shared/resolver/resolve-actions'
export { getLogoMeta, itemSubtitle } from '@/shared/resolver/item-display'
export { includes, itemScore, scoreForegroundMatch, scoreRecent } from '@/shared/resolver/scoring'
