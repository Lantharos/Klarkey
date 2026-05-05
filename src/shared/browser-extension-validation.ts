import { isSecureBrowserOrigin, toBrowserSiteUrl, validateBrowserPasskeyOrigin } from "@/shared/browser-url";
import type {
  ActionExecutionResult,
  BrowserAuthFlow,
  BrowserFillCard,
  BrowserFieldSuggestion,
  BrowserFillIdentity,
  BrowserFillLogin,
  BrowserPasskeyChoice,
  BrowserPasskeyStatus,
  BrowserPasskeySavePlan,
  BrowserSaveLoginInput,
  BrowserSiteMatch,
  BrowserSuggestionField,
  UserSettings,
} from "@/shared/types";

export type BrowserExtensionRequest =
  | {
      id: string;
      type: "ping";
    }
  | {
      id: string;
      type: "list-logins";
      url: string;
      title?: string;
    }
  | {
      id: string;
      type: "get-login";
      itemId: string;
      url: string;
      title?: string;
    }
  | {
      id: string;
      type: "get-identity";
      itemId: string;
      url: string;
      title?: string;
    }
  | {
      id: string;
      type: "get-card";
      itemId: string;
      url: string;
      title?: string;
    }
  | {
      id: string;
      type: "list-field-suggestions";
      field: BrowserSuggestionField;
      flow: BrowserAuthFlow;
      url: string;
      title?: string;
    }
  | {
      id: string;
      type: "get-settings";
    }
  | {
      id: string;
      type: "save-login";
      payload: BrowserSaveLoginInput;
    }
  | {
      id: string;
      type: "passkeys-status";
      url: string;
    }
  | {
      id: string;
      type: "passkey-create-plan";
      url: string;
      title?: string;
      requestDetailsJson: string;
    }
  | {
      id: string;
      type: "passkey-create-credential";
      origin: string;
      url: string;
      title?: string;
      requestDetailsJson: string;
    }
  | {
      id: string;
      type: "passkey-save-credential";
      url: string;
      title?: string;
      requestDetailsJson: string;
      pendingPasskeyId: string;
      itemId?: string;
      createNew?: boolean;
    }
  | {
      id: string;
      type: "passkey-discard-credential";
      pendingPasskeyId: string;
      url?: string;
      title?: string;
    }
  | {
      id: string;
      type: "passkey-get-plan";
      url: string;
      title?: string;
      requestDetailsJson: string;
    }
  | {
      id: string;
      type: "passkey-get-credential";
      origin: string;
      url: string;
      title?: string;
      requestDetailsJson: string;
      credentialId: string;
    };

export type BrowserExtensionResponse =
  | {
      id: string;
      ok: true;
      result:
        | {
            protocolVersion: number;
            desktopRequired: true;
            passkeyProviderReady: boolean;
            nativeUserVerificationReady: boolean;
            vaultUnlocked: boolean;
            availability: "online" | "updating";
            retryAfterSeconds?: number;
            targetVersion?: string;
          }
        | {
            matches: BrowserSiteMatch[];
            locked?: boolean;
          }
        | {
            login?: BrowserFillLogin;
          }
        | {
            identity?: BrowserFillIdentity;
          }
        | {
            card?: BrowserFillCard;
          }
        | {
            suggestions: BrowserFieldSuggestion[];
            locked?: boolean;
          }
        | {
            settings: UserSettings;
          }
        | {
            plan: BrowserPasskeySavePlan;
            locked?: boolean;
          }
        | {
            choices: BrowserPasskeyChoice[];
            locked?: boolean;
          }
        | ActionExecutionResult
        | {
            supported: false;
            reason: string;
          }
        | BrowserPasskeyStatus
        | {
            responseJson: string;
            credentialId: string;
            pendingPasskeyId?: string;
          };
    }
  | {
      id: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

type BrowserExtensionValidationResult =
  | {
      ok: true;
      request: BrowserExtensionRequest;
    }
  | {
      ok: false;
      id: string;
      error: {
        code: string;
        message: string;
      };
    };

const maxExtensionIdLength = 128;
const maxExtensionUrlLength = 4096;
const maxExtensionTitleLength = 4096;
const maxExtensionTextLength = 100_000;
const maxExtensionRequestJsonLength = 262_144;
const maxExtensionCredentialIdLength = 8192;
const browserSuggestionFields = new Set<BrowserSuggestionField>([
  "username",
  "email",
  "fullName",
  "firstName",
  "middleName",
  "lastName",
  "company",
  "jobTitle",
  "birthDate",
  "phone",
  "address",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "cardholderName",
  "cardNumber",
  "cardExpiry",
  "cardExpiryMonth",
  "cardExpiryYear",
  "cardCvc",
  "cardBrand",
]);
const browserAuthFlows = new Set<BrowserAuthFlow>([
  "login",
  "register",
  "payment",
]);

const invalidBrowserExtensionRequest = (
  id: string,
  code: string,
  message: string,
): BrowserExtensionValidationResult => ({
  ok: false,
  id,
  error: {
    code,
    message,
  },
});

const validBrowserExtensionRequest = (
  request: BrowserExtensionRequest,
): BrowserExtensionValidationResult => ({
  ok: true,
  request,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0);

const isOptionalBoundedString = (value: unknown, maxLength: number) =>
  value === undefined || isBoundedString(value, maxLength, true);

const readSecureBrowserPageUrl = (value: unknown) => {
  if (!isBoundedString(value, maxExtensionUrlLength)) {
    return undefined;
  }

  try {
    const parsed = new URL(value.trim());
    return isSecureBrowserOrigin(parsed) ? toBrowserSiteUrl(parsed.href) : undefined;
  } catch {
    return undefined;
  }
};

const readBrowserExtensionRequestId = (request: unknown) =>
  isRecord(request) && isBoundedString(request.id, maxExtensionIdLength)
    ? request.id
    : "unknown";

const hasValidTitle = (request: Record<string, unknown>) =>
  isOptionalBoundedString(request.title, maxExtensionTitleLength);

const hasValidRequestDetailsJson = (request: Record<string, unknown>) => {
  if (!isBoundedString(request.requestDetailsJson, maxExtensionRequestJsonLength)) {
    return false;
  }

  try {
    const parsed = JSON.parse(request.requestDetailsJson);
    return isRecord(parsed);
  } catch {
    return false;
  }
};

const hasValidItemId = (request: Record<string, unknown>, key = "itemId") =>
  isBoundedString(request[key], maxExtensionIdLength);

const hasValidPendingPasskeyId = (request: Record<string, unknown>) =>
  isBoundedString(request.pendingPasskeyId, maxExtensionIdLength);

const readValidPasskeyOrigin = (origin: unknown, url: string) => {
  const value = readSecureBrowserPageUrl(origin);
  return value && validateBrowserPasskeyOrigin(value, url) ? value : undefined;
};

const readValidSaveLoginPayload = (value: unknown): BrowserSaveLoginInput | undefined => {
  if (
    !isRecord(value) ||
    !isOptionalBoundedString(value.title, maxExtensionTitleLength) ||
    !isOptionalBoundedString(value.username, maxExtensionTextLength) ||
    !isOptionalBoundedString(value.password, maxExtensionTextLength) ||
    !isOptionalBoundedString(value.ssoProvider, maxExtensionTextLength)
  ) {
    return undefined;
  }

  const url = readSecureBrowserPageUrl(value.url);
  if (!url) {
    return undefined;
  }

  return {
    url,
    title: value.title,
    username: value.username,
    password: value.password,
    ssoProvider: value.ssoProvider,
  };
};

export const validateBrowserExtensionRequest = (
  input: unknown,
): BrowserExtensionValidationResult => {
  const id = readBrowserExtensionRequestId(input);
  if (!isRecord(input) || !isBoundedString(input.id, maxExtensionIdLength)) {
    return invalidBrowserExtensionRequest(
      id,
      "invalid_request",
      "The browser extension request is malformed.",
    );
  }
  if (!isBoundedString(input.type, 80)) {
    return invalidBrowserExtensionRequest(
      id,
      "invalid_request_type",
      "The browser extension request type is invalid.",
    );
  }

  const request = input as BrowserExtensionRequest;
  switch (input.type) {
    case "ping":
    case "get-settings":
      return validBrowserExtensionRequest(request);

    case "list-logins": {
      const url = readSecureBrowserPageUrl(input.url);
      return url && hasValidTitle(input)
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_request", "The browser extension request URL is invalid.");
    }

    case "passkeys-status": {
      const url = readSecureBrowserPageUrl(input.url);
      return url && hasValidTitle(input)
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_request", "The browser extension request URL is invalid.");
    }

    case "get-login":
    case "get-identity":
    case "get-card": {
      const url = readSecureBrowserPageUrl(input.url);
      return hasValidItemId(input) &&
        url &&
        hasValidTitle(input)
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_item", "The requested vault item is invalid.");
    }

    case "list-field-suggestions": {
      const url = readSecureBrowserPageUrl(input.url);
      return browserSuggestionFields.has(input.field as BrowserSuggestionField) &&
        browserAuthFlows.has(input.flow as BrowserAuthFlow) &&
        url &&
        hasValidTitle(input)
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_request", "The field suggestion request is invalid.");
    }

    case "save-login": {
      const payload = readValidSaveLoginPayload(input.payload);
      return payload
        ? validBrowserExtensionRequest({ ...request, payload } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_payload", "The login save payload is invalid.");
    }

    case "passkey-create-plan":
    case "passkey-get-plan": {
      const url = readSecureBrowserPageUrl(input.url);
      return url &&
        hasValidTitle(input) &&
        hasValidRequestDetailsJson(input)
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_passkey_request", "The passkey request is invalid.");
    }

    case "passkey-create-credential": {
      const url = readSecureBrowserPageUrl(input.url);
      const origin = url ? readValidPasskeyOrigin(input.origin, url) : undefined;
      return url &&
        hasValidTitle(input) &&
        origin &&
        hasValidRequestDetailsJson(input)
        ? validBrowserExtensionRequest({ ...request, url, origin } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_passkey_request", "The passkey creation request is invalid.");
    }

    case "passkey-save-credential": {
      const url = readSecureBrowserPageUrl(input.url);
      return url &&
        hasValidTitle(input) &&
        hasValidRequestDetailsJson(input) &&
        hasValidPendingPasskeyId(input) &&
        (input.itemId === undefined || hasValidItemId(input)) &&
        (input.createNew === undefined || typeof input.createNew === "boolean")
        ? validBrowserExtensionRequest({ ...request, url } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_passkey_request", "The passkey save request is invalid.");
    }

    case "passkey-discard-credential": {
      const url = input.url === undefined ? undefined : readSecureBrowserPageUrl(input.url);
      return hasValidPendingPasskeyId(input) &&
        (input.url === undefined || url) &&
        hasValidTitle(input)
        ? validBrowserExtensionRequest(url ? { ...request, url } as BrowserExtensionRequest : request)
        : invalidBrowserExtensionRequest(id, "invalid_passkey_request", "The passkey discard request is invalid.");
    }

    case "passkey-get-credential": {
      const url = readSecureBrowserPageUrl(input.url);
      const origin = url ? readValidPasskeyOrigin(input.origin, url) : undefined;
      return url &&
        hasValidTitle(input) &&
        origin &&
        hasValidRequestDetailsJson(input) &&
        isBoundedString(input.credentialId, maxExtensionCredentialIdLength)
        ? validBrowserExtensionRequest({ ...request, url, origin } as BrowserExtensionRequest)
        : invalidBrowserExtensionRequest(id, "invalid_passkey_request", "The passkey authentication request is invalid.");
    }

    default:
      return invalidBrowserExtensionRequest(
        id,
        "unsupported_request",
        "The requested browser extension action is not supported.",
      );
  }
};
