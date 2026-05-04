import type { VaultRepository } from '@/electron/repository'
import { writePrivateExportFile } from '@/electron/export/write-export-file'
import type { ExportResult } from '@/shared/import-export'

const spreadsheetFormulaStart = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/
const leadingSpreadsheetControl = /^[\t\r\n]/
const leadingFormulaWhitespace = /^[ \f\v]*/

function escapeCsv(value: string | undefined): string {
  if (value == null) {
    return '""'
  }

  const raw = String(value)
  const formulaCandidate = raw.slice(raw.match(leadingFormulaWhitespace)?.[0].length ?? 0)
  const safeValue = spreadsheetFormulaStart.test(formulaCandidate)
    ? `\t${raw}`
    : leadingSpreadsheetControl.test(raw)
      ? `'${raw}`
      : raw

  return `"${safeValue.replace(/"/g, '""')}"`
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

  writePrivateExportFile(filePath, rows.join('\n'))

  return {
    success: true,
    exportedCount: snapshot.items.length,
    message: `Exported ${snapshot.items.length} items to CSV.`,
  }
}
