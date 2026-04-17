import { readCreateUserVerification, readGetUserVerification } from '@/electron/passkey-user-verification'

describe('passkey user verification parsing', () => {
  it('defaults create requests to preferred verification', () => {
    expect(readCreateUserVerification('{}')).toBe('preferred')
  })

  it('reads create request verification from authenticator selection', () => {
    expect(
      readCreateUserVerification(
        JSON.stringify({
          authenticatorSelection: {
            userVerification: 'required',
          },
        }),
      ),
    ).toBe('required')
  })

  it('reads get request verification directly from the request payload', () => {
    expect(
      readGetUserVerification(
        JSON.stringify({
          userVerification: 'discouraged',
        }),
      ),
    ).toBe('discouraged')
  })
})
