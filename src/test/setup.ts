import '@testing-library/jest-dom/vitest'

const createLocalStorage = () => {
  const map = new Map<string, string>()

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index: number) => {
      return Array.from(map.keys())[index] ?? null
    },
    get length() {
      return map.size
    },
  } satisfies Storage
}

const localStorage = createLocalStorage()

if ((globalThis as { localStorage?: Storage }).localStorage === undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
}

if (typeof window !== 'undefined' && (window as { localStorage?: Storage }).localStorage === undefined) {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
}
