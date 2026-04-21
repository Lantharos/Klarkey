import { useEffect, useState } from 'react'
import type { ItemDetails } from '@/shared/types'

export function useDetailItem(
  itemId: string | undefined,
  page:
    | 'home'
    | 'settings'
    | 'detail'
    | 'form'
    | 'locked'
    | 'passcode'
    | 'dev'
    | 'set-passcode'
    | 'set-master-password'
    | 'confirm-passcode-removal'
    | 'export'
    | 'import'
    | 'import-loading',
  executionItemId: string | undefined,
) {
  const [detailItem, setDetailItem] = useState<ItemDetails>()

  useEffect(() => {
    if ((page !== 'detail' && page !== 'form') || !itemId) {
      return
    }

    void window.klarkey?.item.get(itemId).then((item) => {
      setDetailItem(item)
    })
  }, [itemId, executionItemId, page])

  return [detailItem, setDetailItem] as const
}
