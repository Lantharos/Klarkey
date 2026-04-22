import { overlayRoot } from '../overlay.js'
import { runtime } from '../runtime.js'
import { readFieldValue, visible } from '../dom.js'
import {
  extractAccountIdentifierFromElement,
  findSsoButtons,
  getGoogleAccountClickTarget,
  getGoogleAccountRows,
  getStoredSsoTracking,
  getTrackedOriginMatches,
  isSameSiteHost,
  providersCompatible,
} from './common.js'

let ssoHighlightFrame = 0
const ssoHighlightOverlays = new Map()
let lastSsoHighlightUrl = ''
let rememberedSsoMatches = []

function clearSsoHighlights() {
  for (const overlay of ssoHighlightOverlays.values()) {
    if (overlay.isConnected) {
      overlay.remove()
    }
  }
  ssoHighlightOverlays.clear()
  if (ssoHighlightFrame) {
    cancelAnimationFrame(ssoHighlightFrame)
    ssoHighlightFrame = 0
  }
}

function updateSsoHighlightPositions() {
  let hasAny = false
  for (const [element, overlay] of ssoHighlightOverlays) {
    if (!element.isConnected || !visible(element)) {
      if (overlay.isConnected) {
        overlay.remove()
      }
      ssoHighlightOverlays.delete(element)
      continue
    }

    hasAny = true
    const rect = element.getBoundingClientRect()
    const padding = 6
    overlay.style.top = `${rect.top - padding}px`
    overlay.style.left = `${rect.left - padding}px`
    overlay.style.width = `${rect.width + padding * 2}px`
    overlay.style.height = `${rect.height + padding * 2}px`
  }

  if (hasAny) {
    ssoHighlightFrame = window.requestAnimationFrame(updateSsoHighlightPositions)
  } else {
    ssoHighlightFrame = 0
  }
}

function reconcileSsoHighlights(entries) {
  const nextElements = new Set()

  for (const entry of entries) {
    nextElements.add(entry.element)

    const existingOverlay = ssoHighlightOverlays.get(entry.element)
    if (existingOverlay) {
      const computed = window.getComputedStyle(entry.element)
      const buttonRadius = parseFloat(computed.borderRadius) || 0
      const padding = 6
      existingOverlay.style.borderRadius = `${buttonRadius + padding}px`
      const label = existingOverlay.querySelector('.klarkey-sso-label')
      if (label instanceof HTMLDivElement) {
        if (entry.label) {
          label.textContent = entry.label
        } else {
          label.remove()
        }
      } else if (entry.label) {
        const nextLabel = document.createElement('div')
        nextLabel.className = 'klarkey-sso-label'
        nextLabel.textContent = entry.label
        existingOverlay.appendChild(nextLabel)
      }
      continue
    }

    const overlay = document.createElement('div')
    overlay.className = 'klarkey-sso-highlight'
    const computed = window.getComputedStyle(entry.element)
    const buttonRadius = parseFloat(computed.borderRadius) || 0
    const padding = 6
    overlay.style.borderRadius = `${buttonRadius + padding}px`

    if (entry.label) {
      const label = document.createElement('div')
      label.className = 'klarkey-sso-label'
      label.textContent = entry.label
      overlay.appendChild(label)
    }

    const badge = document.createElement('div')
    badge.className = 'klarkey-sso-badge'
    badge.innerHTML = `<img src="${runtime.getURL('icons/klarkey-128.png')}" alt="Klarkey" />`
    overlay.appendChild(badge)
    overlayRoot.appendChild(overlay)
    ssoHighlightOverlays.set(entry.element, overlay)
  }

  for (const [element, overlay] of ssoHighlightOverlays) {
    if (nextElements.has(element)) {
      continue
    }
    if (overlay.isConnected) {
      overlay.remove()
    }
    ssoHighlightOverlays.delete(element)
  }

  if (ssoHighlightOverlays.size && !ssoHighlightFrame) {
    updateSsoHighlightPositions()
  } else if (!ssoHighlightOverlays.size && ssoHighlightFrame) {
    cancelAnimationFrame(ssoHighlightFrame)
    ssoHighlightFrame = 0
  }
}

function findAccountChoiceElements(accountIdentifier) {
  const lowerAccount = accountIdentifier.toLowerCase()
  const candidates = document.querySelectorAll('a, button, [role="button"], [role="option"], [data-email], [data-identifier], [aria-label], [title], div[tabindex], li[tabindex], input[type="email"]')
  const results = []
  const seen = new Set()

  for (const element of candidates) {
    if (!(element instanceof Element) || seen.has(element) || !visible(element) || element.closest('.klarkey-inline-root')) {
      continue
    }

    const signal = [
      element.textContent || '',
      element instanceof HTMLElement ? element.innerText || '' : '',
      readFieldValue(element),
      element.getAttribute('data-email') || '',
      element.getAttribute('data-identifier') || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
    ].join(' ').toLowerCase()

    if (!signal.includes(lowerAccount)) {
      continue
    }

    seen.add(element)
    results.push(element)
  }

  return results
}

function findProviderSpecificAccountChoiceElements(accountIdentifier, tracking) {
  if (tracking?.provider === 'Google' && window.location.hostname.includes('google.com')) {
    const lowerAccount = accountIdentifier.toLowerCase()
    const results = []
    for (const row of getGoogleAccountRows()) {
      const signal = [(row.textContent || ''), (row instanceof HTMLElement ? row.innerText || '' : '')].join(' ').toLowerCase()
      const extracted = extractAccountIdentifierFromElement(row)?.toLowerCase()
      if (!signal.includes(lowerAccount) && extracted !== lowerAccount) {
        continue
      }

      const target = getGoogleAccountClickTarget(row)
      if (target) {
        results.push(target)
      }
    }

    if (results.length) {
      return results
    }
  }

  return findAccountChoiceElements(accountIdentifier)
}

async function highlightTrackedProviderChoices() {
  const tracking = await getStoredSsoTracking()
  if (!tracking || isSameSiteHost(window.location.hostname, tracking.originHostname)) {
    return false
  }

  const matches = await getTrackedOriginMatches(tracking)
  const entries = []
  for (const match of matches) {
    if (!providersCompatible(match.ssoProvider, tracking.provider) || !match.username) {
      continue
    }

    for (const element of findProviderSpecificAccountChoiceElements(match.username, tracking)) {
      entries.push({ element, label: match.username })
    }
  }

  reconcileSsoHighlights(entries)
  return entries.length > 0
}

function highlightSavedSsoButtons(matches) {
  const currentUrl = window.location.href
  if (currentUrl !== lastSsoHighlightUrl) {
    lastSsoHighlightUrl = currentUrl
    rememberedSsoMatches = []
    clearSsoHighlights()
  }

  void highlightTrackedProviderChoices()

  const nextMatches = Array.isArray(matches) && matches.length ? matches.filter((match) => match.ssoProvider) : rememberedSsoMatches
  if (!nextMatches.length) {
    return
  }

  rememberedSsoMatches = nextMatches
  const entries = []
  for (const { element, provider } of findSsoButtons()) {
    const providerMatches = nextMatches.filter((match) => providersCompatible(match.ssoProvider, provider))
    if (!providerMatches[0]) {
      continue
    }

    entries.push({
      element,
      label: providerMatches.length > 1 ? `${providerMatches.length} accounts saved` : providerMatches[0]?.username || '',
    })
  }

  reconcileSsoHighlights(entries)
}

export { highlightSavedSsoButtons }
