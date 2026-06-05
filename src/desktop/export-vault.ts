import type { ItemDetails } from '@/shared/types'

export function exportJson(items: ItemDetails[], exportedAt: string) {
  return JSON.stringify({
    version: 1,
    exportedAt,
    app: 'klarkey',
    items: items.map((item) => ({
      id: item.itemId,
      ...item,
      otpUri: item.otp?.uri,
      createdAt: item.updatedAt ?? exportedAt,
      updatedAt: item.updatedAt ?? exportedAt,
    })),
  }, null, 2)
}

function csvValue(value: unknown) {
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

export function exportCsv(items: ItemDetails[]) {
  const rows = items.map((item) => [
    item.itemName,
    item.username,
    item.password,
    item.email,
    item.websites.join(' '),
    item.notes,
  ].map(csvValue).join(','))
  return ['name,username,password,email,websites,notes', ...rows].join('\n')
}
