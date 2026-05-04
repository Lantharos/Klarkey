const domainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
const logoDevToken = "pk_G1_JcYwwSreTU9VAtuRtJw";
type LoginLogoKind = "domain" | "name";

const missingLogoCache = new Set<string>();

export function normalizeLoginLogoDomain(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(candidate).hostname.replace(/^www\./i, "").toLowerCase();
    return domainPattern.test(host) ? host : undefined;
  } catch {
    return domainPattern.test(trimmed) ? trimmed.replace(/^www\./i, "").toLowerCase() : undefined;
  }
}

export function buildLoginLogoUrl(kind: LoginLogoKind, value: string) {
  const normalized = kind === "domain" ? normalizeLoginLogoDomain(value) : value.trim();
  if (!normalized) {
    return undefined;
  }

  const encoded = encodeURIComponent(normalized);
  return kind === "domain"
    ? `https://img.logo.dev/${encoded}?token=${logoDevToken}&fallback=404&theme=dark&format=png&size=128`
    : `https://img.logo.dev/name/${encoded}?token=${logoDevToken}&fallback=404&theme=dark&format=png&size=128`;
}

export function logoSourcesForItem(title: string, websites: string[] = []) {
  const domain = websites.map(normalizeLoginLogoDomain).find(Boolean) ?? normalizeLoginLogoDomain(title);
  const name = title.trim();
  const sources: Array<string | undefined> = [
    ...(domain ? [buildLoginLogoUrl("domain", domain)] : []),
    ...(name ? [buildLoginLogoUrl("name", name)] : []),
  ];
  return sources.filter((source): source is string => {
    if (!source) {
      return false;
    }
    return !missingLogoCache.has(source);
  });
}

export function markLogoMissing(source: string) {
  missingLogoCache.add(source);
}
