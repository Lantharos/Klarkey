import { isFieldElement, readFieldValue, visible } from './dom.js'
import { getInputs, getPendingOtp, setPendingOtp } from './forms/forms.js'
import { fieldKindFor } from './field-meta.js'
import { suppressInlineMenu } from './menu-suppress.js'
import { writeSplitOtp, writeValue } from './autofill/write-submit.js'
import { removeInlineUi } from './ui/inline-ui.js'

const otpDigits = (value) => String(value || '').replace(/\s+/g, '').split('')

const writeDirectOtp = (target, value) => {
  writeValue(target, value)
  return readFieldValue(target).trim() === value
}

const splitOtpStillAccepted = (targets, value) => {
  const digits = otpDigits(value)
  return targets.every((field, index) => readFieldValue(field).trim() === digits[index])
}

const consumePendingOtp = (preferredInput) => {
  const pendingOtp = getPendingOtp()
  if (!pendingOtp) {
    return false
  }

  const inputs = getInputs(preferredInput)
  const directTarget =
    isFieldElement(preferredInput) && fieldKindFor(preferredInput) === 'otp' && visible(preferredInput) ? preferredInput : undefined
  const target = directTarget || (inputs.otp && visible(inputs.otp) ? inputs.otp : undefined)

  if (!target && !inputs.splitOtpTargets?.length) {
    return false
  }

  const accepted = inputs.splitOtpTargets?.length
    ? writeSplitOtp(inputs.splitOtpTargets, pendingOtp)
    : writeDirectOtp(target, pendingOtp)

  if (!accepted) {
    return false
  }

  suppressInlineMenu(target || inputs.splitOtpTargets[0], { untilUserInteraction: true })
  window.setTimeout(() => {
    const stillAccepted = inputs.splitOtpTargets?.length
      ? splitOtpStillAccepted(inputs.splitOtpTargets, pendingOtp)
      : readFieldValue(target).trim() === pendingOtp
    if (stillAccepted) {
      setPendingOtp('')
    }
  }, 50)
  removeInlineUi()
  return true
}

export { consumePendingOtp }
