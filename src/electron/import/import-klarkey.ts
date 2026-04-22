import { readFileSync } from 'node:fs'
import type { ItemType } from '@/shared/item-types'
import type { CreateItemInput } from '@/shared/types'
import type { ImportResult, KlarkeyExportVault } from '@/shared/import-export'
import type { VaultRepository } from '@/electron/repository'
import { importItems } from '@/electron/import/import-utils'

export async function importKlarkeyJson(repository: VaultRepository, filePath: string): Promise<ImportResult> {
  const content = readFileSync(filePath, 'utf-8')
  const vault = JSON.parse(content) as KlarkeyExportVault

  if (!vault.items || !Array.isArray(vault.items)) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      message: 'Invalid Klarkey export file: missing items array.',
    }
  }

  const inputs: CreateItemInput[] = vault.items.map((item) => {
    const input: CreateItemInput = {
      itemType: (item.itemType as ItemType) || 'login',
      itemName: item.itemName || 'Untitled',
      username: item.username,
      password: item.password,
      otp: item.otpUri,
      email: item.email,
      websites: item.websites,
      notes: item.notes,
      customFields: item.customFields,
      recoveryCodes: item.recoveryCodes,
      fullName: item.fullName,
      firstName: item.firstName,
      middleName: item.middleName,
      lastName: item.lastName,
      company: item.company,
      jobTitle: item.jobTitle,
      birthDate: item.birthDate,
      phone: item.phone,
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      city: item.city,
      state: item.state,
      postalCode: item.postalCode,
      country: item.country,
      cardholderName: item.cardholderName,
      cardNumber: item.cardNumber,
      cardExpiryMonth: item.cardExpiryMonth,
      cardExpiryYear: item.cardExpiryYear,
      cardCvc: item.cardCvc,
      cardBrand: item.cardBrand,
      billingPostalCode: item.billingPostalCode,
      sshAlgorithm: item.sshAlgorithm,
      sshFingerprint: item.sshFingerprint,
      sshPublicKey: item.sshPublicKey,
      sshComment: item.sshComment,
      ssoProvider: item.ssoProvider,
      content: item.content,
    }
    return input
  })

  return importItems(repository, inputs)
}
