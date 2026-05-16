export type BrowserAutofillControlStatus =
  | 'unsupported'
  | 'not-controllable'
  | 'already-disabled'
  | 'disabled'
  | 'error'

export type BrowserAutofillControlResult = {
  id: string
  status: BrowserAutofillControlStatus
  levelOfControl?: string
  message?: string
}

export function enforceBrowserAutofillControl(): Promise<BrowserAutofillControlResult[]>
export function scheduleBrowserAutofillControl(): Promise<BrowserAutofillControlResult[]>
export function initializeBrowserAutofillControl(): void
