const domainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i
const logoDevToken = 'pk_G1_JcYwwSreTU9VAtuRtJw'
type LoginLogoKind = 'domain' | 'name'

export const normalizeLoginLogoDomain = (value: string | undefined) => {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`

  try {
    const host = new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase()
    return domainPattern.test(host) ? host : undefined
  } catch {
    return domainPattern.test(trimmed) ? trimmed.replace(/^www\./i, '').toLowerCase() : undefined
  }
}

export const buildLoginLogoUrl = (kind: LoginLogoKind, value: string) => {
  const normalized = kind === 'domain' ? normalizeLoginLogoDomain(value) : value.trim()
  if (!normalized) {
    return undefined
  }

  const encoded = encodeURIComponent(normalized)
  const path = kind === 'domain' ? encoded : `name/${encoded}`
  return `https://img.logo.dev/${path}?token=${logoDevToken}&fallback=404&theme=dark&format=png&size=128`
}
