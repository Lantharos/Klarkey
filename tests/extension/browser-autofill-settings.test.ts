import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SettingDetails = {
  value: boolean
  levelOfControl: string
}

function createPromiseSetting(initialValue = true, levelOfControl = 'controllable_by_this_extension') {
  let value = initialValue
  return {
    get: vi.fn(async () => ({ value, levelOfControl })),
    set: vi.fn(async (details: { value: boolean }) => {
      value = details.value
      return true
    }),
    onChange: {
      addListener: vi.fn(),
    },
  }
}

function createCallbackSetting(initialValue = true, levelOfControl = 'controllable_by_this_extension') {
  let value = initialValue
  return {
    get: vi.fn((_details: unknown, callback: (details: SettingDetails) => void) => {
      callback({ value, levelOfControl })
    }),
    set: vi.fn((details: { value: boolean }, callback: (result: boolean) => void) => {
      value = details.value
      callback(true)
    }),
    onChange: {
      addListener: vi.fn(),
    },
  }
}

const runtimeEvents = () => ({
  onInstalled: {
    addListener: vi.fn(),
  },
  onStartup: {
    addListener: vi.fn(),
  },
  lastError: undefined,
})

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as unknown as { browser?: unknown }).browser
  delete (globalThis as unknown as { chrome?: unknown }).chrome
  vi.restoreAllMocks()
})

describe('extension browser autofill settings control', () => {
  it('disables native password, address, and card autofill through the promise API', async () => {
    const services = {
      passwordSavingEnabled: createPromiseSetting(),
      autofillAddressEnabled: createPromiseSetting(),
      autofillCreditCardEnabled: createPromiseSetting(),
      autofillEnabled: createPromiseSetting(),
    }
    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: runtimeEvents(),
      privacy: { services },
    }

    const mod = await import('../../extension/shared/background/browser-autofill.js')
    const results = await mod.enforceBrowserAutofillControl()

    expect(results.every((result: { status: string }) => result.status === 'disabled')).toBe(true)
    expect(services.passwordSavingEnabled.set).toHaveBeenCalledWith({ value: false })
    expect(services.autofillAddressEnabled.set).toHaveBeenCalledWith({ value: false })
    expect(services.autofillCreditCardEnabled.set).toHaveBeenCalledWith({ value: false })
    expect(services.autofillEnabled.set).toHaveBeenCalledWith({ value: false })
  })

  it('skips browser autofill settings that Firefox does not expose', async () => {
    const services = {
      passwordSavingEnabled: createPromiseSetting(),
    }
    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: runtimeEvents(),
      privacy: { services },
    }

    const mod = await import('../../extension/shared/background/browser-autofill.js')
    const results = await mod.enforceBrowserAutofillControl()

    expect(results).toContainEqual({ id: 'passwordSavingEnabled', status: 'disabled' })
    expect(results).toContainEqual({ id: 'autofillAddressEnabled', status: 'unsupported' })
    expect(results).toContainEqual({ id: 'autofillCreditCardEnabled', status: 'unsupported' })
  })

  it('does not fight enterprise policy or another extension', async () => {
    const services = {
      passwordSavingEnabled: createPromiseSetting(true, 'not_controllable'),
    }
    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: runtimeEvents(),
      privacy: { services },
    }

    const mod = await import('../../extension/shared/background/browser-autofill.js')
    const results = await mod.enforceBrowserAutofillControl()

    expect(results).toContainEqual({
      id: 'passwordSavingEnabled',
      status: 'not-controllable',
      levelOfControl: 'not_controllable',
    })
    expect(services.passwordSavingEnabled.set).not.toHaveBeenCalled()
  })

  it('supports Chromium callback-style privacy settings', async () => {
    const services = {
      passwordSavingEnabled: createCallbackSetting(),
      autofillAddressEnabled: createCallbackSetting(),
      autofillCreditCardEnabled: createCallbackSetting(),
    }
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: runtimeEvents(),
      privacy: { services },
    }

    const mod = await import('../../extension/shared/background/browser-autofill.js')
    const results = await mod.enforceBrowserAutofillControl()

    expect(results).toContainEqual({ id: 'passwordSavingEnabled', status: 'disabled' })
    expect(services.passwordSavingEnabled.set).toHaveBeenCalledWith({ value: false }, expect.any(Function))
    expect(services.autofillAddressEnabled.set).toHaveBeenCalledWith({ value: false }, expect.any(Function))
    expect(services.autofillCreditCardEnabled.set).toHaveBeenCalledWith({ value: false }, expect.any(Function))
  })
})
