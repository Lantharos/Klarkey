import { runtimeApi, safeExtensionErrorMessage } from './native-messaging.js'

const disabledValue = { value: false }
const controllableLevels = new Set(['controllable_by_this_extension', 'controlled_by_this_extension'])
const browserAutofillControls = [
  { id: 'passwordSavingEnabled' },
  { id: 'autofillAddressEnabled' },
  { id: 'autofillCreditCardEnabled' },
  { id: 'autofillEnabled' },
]

let initialized = false
let pendingEnforcement

const services = () => runtimeApi?.privacy?.services
const settingFor = (id) => services()?.[id]

const isPromiseBrowserApi = () => Boolean(globalThis.browser && runtimeApi === globalThis.browser)

const callSetting = (setting, method, details) => {
  const fn = setting?.[method]
  if (typeof fn !== 'function') {
    return Promise.resolve(undefined)
  }

  if (isPromiseBrowserApi()) {
    return Promise.resolve(fn.call(setting, details))
  }

  return new Promise((resolve, reject) => {
    fn.call(setting, details, (result) => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(safeExtensionErrorMessage(error.message, 'Browser autofill setting update failed.')))
        return
      }

      resolve(result)
    })
  })
}

async function disableBrowserSetting(control) {
  const setting = settingFor(control.id)
  if (!setting) {
    return { id: control.id, status: 'unsupported' }
  }

  const current = await callSetting(setting, 'get', {})
  if (!controllableLevels.has(current?.levelOfControl)) {
    return { id: control.id, status: 'not-controllable', levelOfControl: current?.levelOfControl }
  }

  if (current.value === false) {
    return { id: control.id, status: 'already-disabled' }
  }

  await callSetting(setting, 'set', disabledValue)
  return { id: control.id, status: 'disabled' }
}

export async function enforceBrowserAutofillControl() {
  const results = []
  for (const control of browserAutofillControls) {
    try {
      results.push(await disableBrowserSetting(control))
    } catch (error) {
      results.push({
        id: control.id,
        status: 'error',
        message: safeExtensionErrorMessage(error, 'Browser autofill setting update failed.'),
      })
    }
  }
  return results
}

export function scheduleBrowserAutofillControl() {
  pendingEnforcement ??= enforceBrowserAutofillControl().finally(() => {
    pendingEnforcement = undefined
  })
  return pendingEnforcement
}

export function initializeBrowserAutofillControl() {
  if (initialized) {
    return
  }

  initialized = true
  void scheduleBrowserAutofillControl()

  runtimeApi?.runtime?.onInstalled?.addListener?.(() => {
    void scheduleBrowserAutofillControl()
  })
  runtimeApi?.runtime?.onStartup?.addListener?.(() => {
    void scheduleBrowserAutofillControl()
  })

  for (const control of browserAutofillControls) {
    settingFor(control.id)?.onChange?.addListener?.((details) => {
      if (details?.value !== false) {
        void scheduleBrowserAutofillControl()
      }
    })
  }
}
