const visible = (element) => {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
}

const isEditableHost = (element) => element instanceof HTMLElement && element.isContentEditable && element.getAttribute('contenteditable') !== 'false'
const isFieldElement = (element) =>
  element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement || isEditableHost(element)
const isTextLikeInput = (input) =>
  input instanceof HTMLTextAreaElement ||
  isEditableHost(input) ||
  (input instanceof HTMLInputElement && ['text', 'email', 'search', 'tel', 'url', 'number'].includes(input.type))
const normalizeLookupToken = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const readFieldValue = (field) =>
  field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement
    ? field.value || ''
    : isEditableHost(field)
      ? field.textContent || ''
      : ''

const queryAllDeep = (root, selector) => {
  const visited = new Set()
  const results = []
  const queue = [root]

  while (queue.length) {
    const current = queue.shift()
    if (!(current instanceof Document || current instanceof ShadowRoot || current instanceof Element)) {
      continue
    }

    for (const match of Array.from(current.querySelectorAll(selector))) {
      if (!visited.has(match)) {
        visited.add(match)
        results.push(match)
      }
    }

    for (const element of Array.from(current.querySelectorAll('*'))) {
      if (element.shadowRoot) {
        queue.push(element.shadowRoot)
      }
    }
  }

  return results
}

const getAssociatedForm = (element) => {
  let current = element

  while (current instanceof Element) {
    if (current instanceof HTMLInputElement || current instanceof HTMLSelectElement || current instanceof HTMLTextAreaElement) {
      if (current.form) {
        return current.form
      }
    }

    const form = current.closest('form')
    if (form) {
      return form
    }

    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : undefined
  }

  return undefined
}

const getDeepActiveElement = (root = document) => {
  let current = root.activeElement

  while (current?.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement
  }

  return current
}
const getInputSignals = (input) => {
  const autocomplete =
    input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? (input.autocomplete || '').toLowerCase() : ''
  const labels = []
  if ('labels' in input && input.labels) {
    labels.push(...Array.from(input.labels).map((label) => label.textContent || ''))
  }

  const describedBy = (input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent || '')

  const marker = [
    input.name || '',
    input.id || '',
    input.placeholder || '',
    input.getAttribute('aria-label') || '',
    input.getAttribute('aria-labelledby') || '',
    input.getAttribute('data-testid') || '',
    input.getAttribute('data-qa') || '',
    input.getAttribute('role') || '',
    ...labels,
    ...describedBy,
  ]
    .join(' ')
    .toLowerCase()

  return {
    autocomplete,
    marker,
  }
}

const markerMatches = (input, expression) => expression.test(getInputSignals(input).marker)

export { visible, isEditableHost, isFieldElement, isTextLikeInput, normalizeLookupToken, readFieldValue, queryAllDeep, getAssociatedForm, getDeepActiveElement, getInputSignals, markerMatches }
