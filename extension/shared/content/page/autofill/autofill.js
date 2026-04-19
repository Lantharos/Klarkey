import { pageState } from '../state.js'
import { getAssociatedForm } from '../dom.js'

const readAttributeSnapshot = (element, names) =>
  Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]))

const restoreAttributeSnapshot = (element, snapshot) => {
  if (!element || !snapshot) {
    return
  }

  for (const [name, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined) {
      element.removeAttribute(name)
    } else {
      element.setAttribute(name, value)
    }
  }
}

const clearBrowserAutofillSuppression = () => {
  restoreAttributeSnapshot(pageState.suppressedAutofillField, pageState.suppressedFieldAttributes)
  restoreAttributeSnapshot(pageState.suppressedAutofillForm, pageState.suppressedFormAttributes)
  pageState.suppressedAutofillField = undefined
  pageState.suppressedAutofillForm = undefined
  pageState.suppressedFieldAttributes = undefined
  pageState.suppressedFormAttributes = undefined
}

const suppressBrowserAutofill = (input) => {
  clearBrowserAutofillSuppression()

  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
    return
  }

  pageState.suppressedAutofillField = input
  pageState.suppressedFieldAttributes = readAttributeSnapshot(input, [
    'autocomplete',
    'autocapitalize',
    'autocorrect',
    'spellcheck',
    'data-lpignore',
    'data-1p-ignore',
  ])

  input.setAttribute('autocomplete', 'off')
  input.setAttribute('autocapitalize', 'off')
  input.setAttribute('autocorrect', 'off')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('data-lpignore', 'true')
  input.setAttribute('data-1p-ignore', 'true')

  const form = getAssociatedForm(input)
  if (!form) {
    return
  }

  pageState.suppressedAutofillForm = form
  pageState.suppressedFormAttributes = readAttributeSnapshot(form, ['autocomplete'])
  form.setAttribute('autocomplete', 'off')
}

export { readAttributeSnapshot, restoreAttributeSnapshot, clearBrowserAutofillSuppression, suppressBrowserAutofill }
