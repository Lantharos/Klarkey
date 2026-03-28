const domainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i
const logoDevToken = 'pk_G1_JcYwwSreTU9VAtuRtJw'

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

export const buildLoginLogoUrl = (kind: 'domain' | 'name', value: string) =>
  kind === 'domain'
    ? `https://img.logo.dev/${encodeURIComponent(value)}?token=${logoDevToken}&fallback=404&theme=dark&format=png&size=128`
    : `https://img.logo.dev/name/${encodeURIComponent(value)}?token=${logoDevToken}&fallback=404&theme=dark&format=png&size=128`
