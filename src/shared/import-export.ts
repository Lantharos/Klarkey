export type ExportFormat = 'klarkey-json' | 'csv'
export type ImportFormat = 'auto' | 'klarkey-json' | 'csv' | '1pux' | 'bitwarden-json' | 'lastpass-csv' | 'dashlane-csv' | 'dashlane-json' | 'chrome-csv'

export interface ExportOptions {
  format: ExportFormat
  filePath: string
}

export interface ImportOptions {
  format: ImportFormat
  filePath: string
}

export interface ImportResult {
  success: boolean
  importedCount: number
  skippedCount: number
  errorCount: number
  message: string
}

export interface ExportResult {
  success: boolean
  exportedCount: number
  message: string
}

export interface KlarkeyExportItem {
  id: string
  itemType: string
  itemName: string
  username?: string
  email?: string
  websites?: string[]
  notes?: string
  customFields?: Array<{ id: string; label: string; value: string }>
  recoveryCodes?: string[]
  password?: string
  otpUri?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  phone?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshComment?: string
  ssoProvider?: string
  content?: string
  createdAt: string
  updatedAt: string
}

export interface KlarkeyExportVault {
  version: 1
  exportedAt: string
  app: 'klarkey'
  items: KlarkeyExportItem[]
}
