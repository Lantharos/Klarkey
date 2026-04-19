export type BrowserCredentialDescriptor = {
  id?: string
  type?: 'public-key'
  transports?: string[]
}

export type BrowserCreationOptions = {
  challenge?: string
  attestation?: 'none' | 'direct' | 'indirect' | 'enterprise'
  rp?: {
    id?: string
    name?: string
  }
  user?: {
    id?: string
    name?: string
    displayName?: string
  }
  pubKeyCredParams?: Array<{
    type?: string
    alg?: number
  }>
  authenticatorSelection?: {
    residentKey?: 'discouraged' | 'preferred' | 'required'
    requireResidentKey?: boolean
    userVerification?: 'discouraged' | 'preferred' | 'required'
  }
  extensions?: {
    credProps?: boolean
  }
  excludeCredentials?: BrowserCredentialDescriptor[]
}

export type BrowserRequestOptions = {
  challenge?: string
  rpId?: string
  allowCredentials?: BrowserCredentialDescriptor[]
  userVerification?: 'discouraged' | 'preferred' | 'required'
}

export type StoredSitePasskey = {
  credentialId: string
  rpId: string
  userHandle?: string
  signCount: number
  privateKeyJwk: JsonWebKey
}

export type WebAuthnCredentialResponse = {
  id: string
  rawId: string
  type: 'public-key'
  authenticatorAttachment: 'platform'
  clientExtensionResults: Record<string, unknown>
  response: Record<string, unknown>
}

export type CreateSitePasskeyInput = {
  origin: string
  requestDetailsJson: string
  existingCredentialIds?: string[]
  userVerified?: boolean
}

export type GetSitePasskeyInput = {
  origin: string
  requestDetailsJson: string
  passkey: StoredSitePasskey
  userVerified?: boolean
}
