import type { VaultRepository } from '@/electron/repository'
import { writePrivateExportFile } from '@/electron/export/write-export-file'
import type { ExportResult, KlarkeyExportItem, KlarkeyExportVault } from '@/shared/import-export'

export async function exportKlarkeyJson(repository: VaultRepository, filePath: string): Promise<ExportResult> {
  const snapshot = repository.getSnapshot()
  const items: KlarkeyExportItem[] = []

  for (const profile of snapshot.items) {
    const details = repository.getItemDetails(profile.id)
    if (!details) continue

    // For logins, the DB auto-generates `${username}@klarkey.local` as a placeholder.
    // Don't leak that internal fallback into exports.
    const isPlaceholderEmail =
      details.itemType === 'login' &&
      details.email === `${details.username}@klarkey.local`

    const item: KlarkeyExportItem = {
      id: details.itemId,
      itemType: details.itemType,
      itemName: details.itemName,
      username: details.username || undefined,
      email: isPlaceholderEmail ? undefined : details.email || undefined,
      websites: details.websites.length > 0 ? details.websites : undefined,
      notes: details.notes || undefined,
      customFields: details.customFields.length > 0 ? details.customFields : undefined,
      recoveryCodes: details.recoveryCodes.length > 0 ? details.recoveryCodes : undefined,
      password: details.password || undefined,
      otpUri: details.otp?.uri,
      fullName: details.fullName || undefined,
      firstName: details.firstName || undefined,
      middleName: details.middleName || undefined,
      lastName: details.lastName || undefined,
      company: details.company || undefined,
      jobTitle: details.jobTitle || undefined,
      birthDate: details.birthDate || undefined,
      phone: details.phone || undefined,
      addressLine1: details.addressLine1 || undefined,
      addressLine2: details.addressLine2 || undefined,
      city: details.city || undefined,
      state: details.state || undefined,
      postalCode: details.postalCode || undefined,
      country: details.country || undefined,
      cardholderName: details.cardholderName || undefined,
      cardNumber: details.cardNumber || undefined,
      cardExpiryMonth: details.cardExpiryMonth || undefined,
      cardExpiryYear: details.cardExpiryYear || undefined,
      cardCvc: details.cardCvc || undefined,
      cardBrand: details.cardBrand || undefined,
      billingPostalCode: details.billingPostalCode || undefined,
      sshAlgorithm: details.sshAlgorithm || undefined,
      sshFingerprint: details.sshFingerprint || undefined,
      sshPublicKey: details.sshPublicKey || undefined,
      sshPrivateKey: details.sshPrivateKey || undefined,
      sshComment: details.sshComment || undefined,
      ssoProvider: details.ssoProvider,
      content: details.content || undefined,
      createdAt: profile.lastUsedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    items.push(item)
  }

  const vault: KlarkeyExportVault = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'klarkey',
    items,
  }

  writePrivateExportFile(filePath, JSON.stringify(vault, null, 2))

  return {
    success: true,
    exportedCount: items.length,
    message: `Exported ${items.length} items to Klarkey format.`,
  }
}
