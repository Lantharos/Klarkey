import { useEffect, useState } from 'react'
import type { ExternalWindowContext } from '@/shared/types'

export function useTargetWindow() {
  const [targetWindow, setTargetWindow] = useState<ExternalWindowContext>()

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    void window.klarkey.targetWindow.get().then((context) => {
      setTargetWindow(context)
    })

    return window.klarkey.onTargetWindowChange((context) => {
      setTargetWindow(context)
    })
  }, [])

  return targetWindow
}
