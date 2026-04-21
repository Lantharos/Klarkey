import { writeFileSync } from 'node:fs'
import type { VaultRepository } from '@/electron/repository'
import type { ExportResult } from '@/shared/import-export'

function escapeCsv(value: string | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function exportCsv(repository: VaultRepository, filePath: string): Promise<ExportResult> {
  const snapshot = repository.getSnapshot()
  const rows: string[] = []

  // Header
  rows.push('type,name,username,password,url,notes,cardholder,card_number,card_expiry,card_cvc,email,phone,address,ssh_public_key')

  for (const profile of snapshot.items) {
    const details = repository.getItemDetails(profile.id)
    if (!details) continue

    const type = details.itemType
    const name = escapeCsv(details.itemName)
    const username = escapeCsv(details.username)
    const password = escapeCsv(details.password)
    const url = escapeCsv(details.websites?.[0])
    const notes = escapeCsv(details.notes)
    const cardholder = escapeCsv(details.cardholderName)
    const cardNumber = escapeCsv(details.cardNumber)
    const cardExpiry = escapeCsv(details.cardExpiry)
    const cardCvc = escapeCsv(details.cardCvc)
    const email = escapeCsv(details.email)
    const phone = escapeCsv(details.phone)
    const address = escapeCsv(details.address)
    const sshPublicKey = escapeCsv(details.sshPublicKey)

    rows.push([type, name, username, password, url, notes, cardholder, cardNumber, cardExpiry, cardCvc, email, phone, address, sshPublicKey].join(','))
  }

  writeFileSync(filePath, rows.join('\n'), 'utf-8')

  return {
    success: true,
    exportedCount: snapshot.items.length,
    message: `Exported ${snapshot.items.length} items to CSV.`,
  }
}
