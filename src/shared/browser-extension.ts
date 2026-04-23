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

export const KLARKEY_NATIVE_HOST_NAME = "app.klarkey.desktop";
export const KLARKEY_EXTENSION_PROTOCOL_VERSION = 1;
export const KLARKEY_FIREFOX_EXTENSION_ID = "klarkey@example.local";
export const KLARKEY_CHROMIUM_EXTENSION_ID = "gbdmdcmboinmeckelhacpljieaphedgn";
export const KLARKEY_CHROMIUM_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyvLORYis20sYdXDCvS0Ees8nitiUUzX5ZfJCRLnyQL0reiw91dvJz65eUiP9cT97n5mslCKHrPCr/FtuNV5RlojQUuBKPRSQdVB3QTZ7DIazKEAsIbYbEMKec6T1sm+VoafC8TMEmINOUtGNBtufdytUj50v5Cz60XjQRQyC6MlLa+4Fs6g6rI0ftuAa/vzh1dVHf1JHWJSQz9zXtVorEUSUQRux8T33Qd8lxHtJ7PJtJN8aJoRU0T9CqB3lwM28ClTruUJAsCV4E4YtNxHBCVY7+IA/mQEOuzNhxsm1mat/VIFjC8qSUY5ls1vqPBrBmgm+0I4pga26hhc3m2J5lQIDAQAB";

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
    }
  | {
      id: string;
      type: "get-identity";
      itemId: string;
    }
  | {
      id: string;
      type: "get-card";
      itemId: string;
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
          }
        | {
            settings: UserSettings;
          }
        | {
            plan: BrowserPasskeySavePlan;
          }
        | {
            choices: BrowserPasskeyChoice[];
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

export const normalizeBrowserHostname = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
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

export const isHostnameMatch = (candidate: string, target: string) =>
  candidate === target ||
  candidate.endsWith(`.${target}`) ||
  target.endsWith(`.${candidate}`);

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

export const toDomExceptionDetails = (name: string, message: string) => ({
  name,
  message,
});
