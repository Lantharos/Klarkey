import { resolveExactBrowserLoginMatch } from '@/electron/repository/browser-passkey-helpers'
import type {
  ActionExecutionResult,
  BrowserSaveLoginInput,
  BrowserSiteMatch,
  CreateItemInput,
  ItemDetails,
  UpdateItemInput,
} from '@/shared/types'

export type BrowserSaveLoginBridge = {
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[]
  getItemDetails: (itemId: string) => ItemDetails | undefined
  createItem: (input: CreateItemInput) => ActionExecutionResult
  updateItem: (input: UpdateItemInput) => ActionExecutionResult
}

export function saveBrowserLoginWithBridge(bridge: BrowserSaveLoginBridge, input: BrowserSaveLoginInput): ActionExecutionResult {
  const url = input.url.trim()
  const username = input.username?.trim() || undefined
  const password = input.password?.trim() || undefined
  const existing = resolveExactBrowserLoginMatch(
    bridge.listBrowserSiteMatches,
    bridge.getItemDetails,
    url,
    input.title,
    username,
    password,
  )

  if (existing) {
    const nextUsername = username ?? existing.username
    const nextPassword = password ?? existing.password

    if (!nextUsername && !nextPassword) {
      return {
        status: 'info',
        title: 'Nothing changed',
        message: 'Klarkey did not detect a complete account to update.',
        itemId: existing.itemId,
      } satisfies ActionExecutionResult
    }

    const nextWebsites = Array.from(new Set([...existing.websites, url].filter(Boolean)))
    return bridge.updateItem({
      itemId: existing.itemId,
      itemType: 'login',
      itemName: existing.itemName,
      username: nextUsername,
      password: nextPassword,
      otp: undefined,
      notes: existing.notes,
      websites: nextWebsites,
      customFields: existing.customFields,
    })
  }

  const title = input.title?.trim()
  const fallbackName = title || username || url.replace(/^https?:\/\//i, '')
  return bridge.createItem({
    itemType: 'login',
    itemName: fallbackName,
    username,
    password,
    preserveEmptyPassword: !password,
    websites: [url],
  })
}
