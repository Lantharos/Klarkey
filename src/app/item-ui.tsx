import { CreditCard, IdCard, NotebookPen } from 'lucide-react'
import type { ItemType } from '@/shared/item-types'

export function StaticItemTypeIcon({ itemType }: { itemType: ItemType }) {
  if (itemType === 'identity') {
    return <IdCard size={15} />
  }

  if (itemType === 'note') {
    return <NotebookPen size={15} />
  }

  if (itemType === 'card') {
    return <CreditCard size={15} />
  }

  return null
}
