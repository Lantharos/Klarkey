const isTrustedUserAction = (event) => event?.isTrusted === true

const runTrustedUserAction = (event, action) => {
  if (!isTrustedUserAction(event)) {
    return false
  }

  void action(event)
  return true
}

export { isTrustedUserAction, runTrustedUserAction }
