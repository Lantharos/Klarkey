# Klarkey Windows Passkey Provider

This folder is the start of the Windows-specific passkey-provider layer for Klarkey.

## Goal

Expose Klarkey as a Windows 11 third-party passkey manager/provider using Microsoft's plugin passkey manager model, so browsers and apps that use the OS passkey surface can discover and use Klarkey-managed passkeys without depending on the browser extension path.

This is the Microsoft feature documented in:

- [Plugin passkey manager support - Windows apps](https://learn.microsoft.com/en-us/windows/apps/develop/security/third-party)

## Current state

The provider itself is not implemented yet, but the desktop-side bridge it will need now exists in the Electron app:

- `electron . --passkey-provider-bridge`
- shared protocol: [src/shared/passkey-provider-bridge.ts](C:/Users/arden/Documents/Projects/Klarkey/src/shared/passkey-provider-bridge.ts)

That bridge already supports:

- finding saved credentials for a WebAuthn request
- storing newly created passkeys into Klarkey
- touching usage metadata after assertions

## Proposed architecture

1. Build a packaged Windows app/plugin using the Microsoft passkey-provider model.
2. In the provider process, translate Windows/WebAuthn plugin callbacks into Klarkey bridge requests.
3. Use the existing encrypted Klarkey vault as the source of truth for credential metadata.
4. Keep the browser extension for autofill/save UX and Chromium-specific interception where that is still useful.
5. Let Firefox/Edge/Chrome on Windows benefit from the OS provider path once Windows is using Klarkey as an enabled passkey manager.

## Why this matters

- Chromium extension interception is browser-specific.
- Firefox does support WebAuthn, but it does not expose the same Chromium extension interception API.
- A real Windows provider is the cleaner long-term path for Firefox on Windows and for any app that goes through the OS passkey picker.

## Next implementation steps

1. Create a packaged WinUI 3 / Windows App SDK sample app based on the Microsoft provider sample.
2. Add a thin native bridge client that launches `Klarkey --passkey-provider-bridge` and exchanges framed JSON over stdio.
3. Map provider callbacks to:
   - `find-credentials`
   - `store-credential`
   - `touch-credential`
4. Add vault-unlock policy so the provider can require local user verification before returning a credential.
5. Add installer support to register the provider and document Windows Settings enablement.

## Caveat

This folder is currently a scaffold and design anchor, not a buildable Windows provider project yet.
