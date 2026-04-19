import { scoreWebsiteMatch } from '@/shared/browser-extension'
import { hasText } from '@/electron/repository/helpers'
import type {
  BrowserAuthFlow,
  BrowserFieldSuggestion,
  BrowserSiteMatch,
  BrowserSuggestionField,
  VaultSnapshot,
} from '@/shared/types'

export function buildBrowserFieldSuggestions(
  ctx: {
    getSnapshot: () => VaultSnapshot
    listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[]
  },
  field: BrowserSuggestionField,
  flow: BrowserAuthFlow,
  url: string,
  title?: string,
): BrowserFieldSuggestion[] {
  const suggestions = new Map<
    string,
    BrowserFieldSuggestion & {
      score: number
      priority: number
    }
  >()
  const siteMatches = flow === 'login' ? ctx.listBrowserSiteMatches(url, title) : []

  const pushSuggestion = ({
    itemId,
    itemName,
    value,
    source,
    lastUsedAt,
    fromSiteMatch,
    score,
    priority,
  }: {
    itemId: string
    itemName: string
    value?: string
    source: BrowserFieldSuggestion['source']
    lastUsedAt?: string
    fromSiteMatch: boolean
    score: number
    priority: number
  }) => {
    const nextValue = value?.trim()
    if (!nextValue) {
      return
    }

    if (field === 'email' && !nextValue.includes('@')) {
      return
    }

    const key = nextValue.toLowerCase()
    const current = suggestions.get(key)
    if (current && (current.score > score || (current.score === score && current.priority <= priority))) {
      return
    }

    suggestions.set(key, {
      id: `${itemId}:${source}:${key}`,
      itemId,
      itemName,
      value: nextValue,
      field,
      source,
      lastUsedAt,
      fromSiteMatch,
      score,
      priority,
    })
  }

  for (const item of ctx.getSnapshot().items) {
    if (flow === 'login' && item.itemType === 'login' && hasText(item.username)) {
      const score = siteMatches.find((match) => match.itemId === item.id)
        ? scoreWebsiteMatch(item.websites ?? [], url) || 24
        : 0

      if (score > 0) {
        pushSuggestion({
          itemId: item.id,
          itemName: item.itemName,
          value: item.username,
          source: 'login-username',
          lastUsedAt: item.lastUsedAt,
          fromSiteMatch: score >= 80,
          score,
          priority: 0,
        })
      }
    }

    if (flow === 'register' && item.itemType === 'identity') {
      const identityValue = (() => {
        switch (field) {
          case 'username':
            return item.username
          case 'email':
            return item.email
          case 'fullName':
            return item.fullName
          case 'firstName':
            return item.firstName
          case 'middleName':
            return item.middleName
          case 'lastName':
            return item.lastName
          case 'company':
            return item.company
          case 'jobTitle':
            return item.jobTitle
          case 'birthDate':
            return item.birthDate
          case 'phone':
            return item.phone
          case 'address':
            return item.address
          case 'addressLine1':
            return item.addressLine1 || item.address
          case 'addressLine2':
            return item.addressLine2
          case 'city':
            return item.city
          case 'state':
            return item.state
          case 'postalCode':
            return item.postalCode
          case 'country':
            return item.country
          default:
            return undefined
        }
      })()

      if (hasText(identityValue)) {
        pushSuggestion({
          itemId: item.id,
          itemName: item.itemName,
          value: identityValue,
          source: 'identity',
          lastUsedAt: item.lastUsedAt,
          fromSiteMatch: false,
          score: field === 'email' || field === 'username' ? 40 : 34,
          priority: 1,
        })
      }
    }

    if (flow === 'payment' && item.itemType === 'card') {
      const cardValue = (() => {
        switch (field) {
          case 'cardholderName':
            return item.cardholderName
          case 'cardNumber':
            return item.cardNumber
          case 'cardExpiry':
            return item.cardExpiry
          case 'cardExpiryMonth':
            return item.cardExpiryMonth
          case 'cardExpiryYear':
            return item.cardExpiryYear
          case 'cardCvc':
            return item.cardCvc
          case 'cardBrand':
            return item.cardBrand
          case 'postalCode':
            return item.billingPostalCode
          default:
            return undefined
        }
      })()

      if (hasText(cardValue)) {
        pushSuggestion({
          itemId: item.id,
          itemName: item.itemName,
          value: cardValue,
          source: 'card',
          lastUsedAt: item.lastUsedAt,
          fromSiteMatch: false,
          score: field === 'cardNumber' || field === 'cardholderName' ? 44 : 36,
          priority: 1,
        })
      }
    }
  }

  return Array.from(suggestions.values())
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftTime = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0
      const rightTime = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0
      if (rightTime !== leftTime) {
        return rightTime - leftTime
      }

      if (left.priority !== right.priority) {
        return left.priority - right.priority
      }

      return left.value.localeCompare(right.value)
    })
    .map((suggestion) => ({
      id: suggestion.id,
      itemId: suggestion.itemId,
      itemName: suggestion.itemName,
      value: suggestion.value,
      field: suggestion.field,
      source: suggestion.source,
      lastUsedAt: suggestion.lastUsedAt,
      fromSiteMatch: suggestion.fromSiteMatch,
    })) satisfies BrowserFieldSuggestion[]
}
