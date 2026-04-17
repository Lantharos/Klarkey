export type RequestedUserVerification = 'required' | 'preferred' | 'discouraged'

type BrowserCreateRequest = {
  authenticatorSelection?: {
    userVerification?: RequestedUserVerification
  }
}

type BrowserGetRequest = {
  userVerification?: RequestedUserVerification
}

const normalizeUserVerification = (value: unknown): RequestedUserVerification => {
  if (value === 'required' || value === 'discouraged') {
    return value
  }

  return 'preferred'
}

export const readCreateUserVerification = (requestDetailsJson: string) => {
  try {
    const request = JSON.parse(requestDetailsJson) as BrowserCreateRequest
    return normalizeUserVerification(request.authenticatorSelection?.userVerification)
  } catch {
    return 'preferred'
  }
}

export const readGetUserVerification = (requestDetailsJson: string) => {
  try {
    const request = JSON.parse(requestDetailsJson) as BrowserGetRequest
    return normalizeUserVerification(request.userVerification)
  } catch {
    return 'preferred'
  }
}
