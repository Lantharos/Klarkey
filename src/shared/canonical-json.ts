type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined }

const sortValue = (value: unknown): JsonValue | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!value || typeof value !== 'object') {
    return value as JsonValue
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item) as JsonValue)
  }

  const objectValue = value as Record<string, unknown>

  return Object.keys(objectValue)
    .sort()
    .reduce<Record<string, JsonValue>>((result, key) => {
      const next = sortValue(objectValue[key])
      if (next !== undefined) {
        result[key] = next
      }
      return result
    }, {})
}

export const canonicalJson = (value: unknown) => JSON.stringify(sortValue(value))
