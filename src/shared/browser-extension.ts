export {
  isHostnameMatch,
  normalizeBrowserHostname,
  primarySiteLabelFromHostname,
  scoreWebsiteMatch,
  toBrowserSiteUrl,
  validateBrowserPasskeyOrigin,
} from "@/shared/browser-url";
export {
  validateBrowserExtensionRequest,
} from "@/shared/browser-extension-validation";
export type {
  BrowserExtensionRequest,
  BrowserExtensionResponse,
} from "@/shared/browser-extension-validation";

export const KLARKEY_NATIVE_HOST_NAME = "app.klarkey.desktop";
export const KLARKEY_EXTENSION_PROTOCOL_VERSION = 1;
export const KLARKEY_FIREFOX_EXTENSION_ID = "klarkey@example.local";
export const KLARKEY_CHROMIUM_EXTENSION_ID = "gbdmdcmboinmeckelhacpljieaphedgn";
export const KLARKEY_CHROMIUM_EXTENSION_ORIGIN = `chrome-extension://${KLARKEY_CHROMIUM_EXTENSION_ID}/`;
export const KLARKEY_CHROMIUM_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyvLORYis20sYdXDCvS0Ees8nitiUUzX5ZfJCRLnyQL0reiw91dvJz65eUiP9cT97n5mslCKHrPCr/FtuNV5RlojQUuBKPRSQdVB3QTZ7DIazKEAsIbYbEMKec6T1sm+VoafC8TMEmINOUtGNBtufdytUj50v5Cz60XjQRQyC6MlLa+4Fs6g6rI0ftuAa/vzh1dVHf1JHWJSQz9zXtVorEUSUQRux8T33Qd8lxHtJ7PJtJN8aJoRU0T9CqB3lwM28ClTruUJAsCV4E4YtNxHBCVY7+IA/mQEOuzNhxsm1mat/VIFjC8qSUY5ls1vqPBrBmgm+0I4pga26hhc3m2J5lQIDAQAB";

export const isAllowedNativeMessagingCaller = (value: string) =>
  value === KLARKEY_CHROMIUM_EXTENSION_ORIGIN ||
  value === KLARKEY_FIREFOX_EXTENSION_ID;

export const hasAllowedNativeMessagingCaller = (args: readonly string[]) =>
  args.some(isAllowedNativeMessagingCaller);

export const toDomExceptionDetails = (name: string, message: string) => ({
  name,
  message,
});
