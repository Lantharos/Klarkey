import { getPublicSuffix, parse } from "tldts";

const localSecureContextHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const tldOptions = { allowPrivateDomains: true, extractHostname: false } as const;

export const isSecureBrowserOrigin = (url: URL) =>
  url.protocol === "https:" ||
  (url.protocol === "http:" &&
    localSecureContextHostnames.has(url.hostname.toLowerCase()));

export const toBrowserSiteUrl = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin === "null" ? undefined : parsed.origin;
  } catch {
    return undefined;
  }
};

export const validateBrowserPasskeyOrigin = (
  origin: string,
  url: string,
): string | undefined => {
  try {
    const originUrl = new URL(origin);
    const pageUrl = new URL(url);
    if (!isSecureBrowserOrigin(originUrl) || !isSecureBrowserOrigin(pageUrl)) {
      return undefined;
    }
    if (originUrl.origin !== pageUrl.origin) {
      return undefined;
    }
    return originUrl.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
};

export const normalizeBrowserHostname = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
};

export const primarySiteLabelFromHostname = (
  hostname: string,
): string | undefined => {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }
  const sld = parts[parts.length - 2];
  if (sld.length < 3) {
    return undefined;
  }
  return sld;
};

const isSubdomainMatchAllowed = (candidate: string) => {
  if (!candidate.includes(".") || candidate.startsWith("[") || parse(candidate, tldOptions).isIp) {
    return false;
  }

  const publicSuffix = getPublicSuffix(candidate, tldOptions);
  return Boolean(publicSuffix && publicSuffix !== candidate);
};

export const isHostnameMatch = (candidate: string, target: string) =>
  candidate === target ||
  (isSubdomainMatchAllowed(candidate) && target.endsWith(`.${candidate}`));

export const scoreWebsiteMatch = (websites: string[], url: string) => {
  const targetHostname = normalizeBrowserHostname(url);
  if (!targetHostname) {
    return 0;
  }

  let score = 0;
  for (const website of websites) {
    const candidateHostname = normalizeBrowserHostname(website);
    if (
      !candidateHostname ||
      !isHostnameMatch(candidateHostname, targetHostname)
    ) {
      continue;
    }

    score = Math.max(score, candidateHostname === targetHostname ? 100 : 80);
  }

  return score;
};
