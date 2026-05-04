const runtimeApi = globalThis.browser ?? globalThis.chrome
export const runtime = runtimeApi?.runtime
export const extensionApi = runtimeApi

const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

const safeRuntimeErrorMessage = (value, fallback = 'Klarkey extension messaging failed.') => {
  const message = (typeof value === 'string' ? value : '').trim()
  if (!message || message.length > 180 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback
  }

  return message
}

export const sendMessage = (message) =>
  !runtime
    ? Promise.reject(new Error('Klarkey extension runtime is unavailable in this context.'))
    : runtime.sendMessage.length === 1
      ? runtime.sendMessage(message)
      : new Promise((resolve, reject) => {
          runtime.sendMessage(message, (result) => {
            const error = globalThis.chrome?.runtime?.lastError
            if (error) {
              reject(new Error(safeRuntimeErrorMessage(error.message)))
              return
            }

            resolve(result)
          })
        })
