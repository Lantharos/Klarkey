# Klarkey Mobile

Expo SDK 55 mobile app for Klarkey.

## Development

```bash
bun install
bun run start
```

Native credential-provider and autofill flows require a development build:

```bash
bun expo prebuild
bun expo run:android
bun expo run:ios
```

From Windows, use EAS to produce the iOS native build on macOS build infrastructure:

```bash
bunx eas-cli build --platform ios --profile ios-simulator
bunx eas-cli build --platform ios --profile development
```

For iOS builds, set your Apple development team before prebuild:

```bash
EXPO_APPLE_TEAM_ID=YOUR_TEAM_ID bun expo prebuild --platform ios
```

On macOS or Linux, verify the generated iOS app and Credential Provider target:

```bash
EXPO_APPLE_TEAM_ID=YOUR_TEAM_ID bun run verify:ios-prebuild
```

On macOS with Xcode, compile the generated iOS app and extension for Simulator:

```bash
EXPO_APPLE_TEAM_ID=YOUR_TEAM_ID bun run verify:ios-build
```

Check the local native registration surfaces:

```bash
bun run verify:native
```

## Cloud Sync

Mobile sync is optional. The app works as a local offline vault without Ave or Convex configuration, and sync controls only become useful after the user connects Ave. Mobile sync uses Ave AuthSession, the Ave Expo session helpers, Convex, and encrypted local SQLite vault records. SecureStore keeps the Ave session and the local database encryption key; vault items and passkey metadata live as AES-GCM records in SQLite.

Set these values before starting a development build:

```bash
EXPO_PUBLIC_AVE_CLIENT_ID=ave_app_client_id
EXPO_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

The Ave app must have E2EE enabled and include the mobile `klarkey://oauth/callback` redirect. Convex must use the same Ave client id in its auth config and have the sync functions deployed from the root `convex` folder.

Sync is offline-first. Klarkey pulls remote encrypted records after unlock, pushes changed local records, and keeps conflict copies rather than replacing local secrets silently. Ave sessions hydrate from SecureStore and refresh before Convex receives an `id_token`. New Klarkey-created passkeys use exportable software ES256 keys stored only inside encrypted vault records, then hydrate into the native provider cache on each unlocked device. Older device-bound provider passkeys stay local until they are recreated or migrated.

When the user is signed in and the vault is unlocked, mobile keeps a Convex realtime subscription to the small sync-status query. That subscription only watches the remote sequence; encrypted records are fetched through `pullSince` after the sequence changes. Local item changes are debounced into background sync, so the app feels live without polling the full vault.

Generate the website association files for `https://klarkey.com/.well-known/` after you know the signing values:

```bash
EXPO_APPLE_TEAM_ID=YOUR_TEAM_ID ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:... bun run write:well-known
```

## Native Credential Setup

- iOS uses a Credential Provider Extension target in `targets/credential-provider` with password, one-time code, text insertion, and synced software passkey registration/assertion source. The app syncs unlocked vault rows, passkeys, and AutoFill identity metadata to the extension through an app-group local Expo module in `modules/klarkey-credential-store`.
- The iOS app and extension target iOS 18+ because OTP and arbitrary text insertion are part of the newer credential-manager APIs.
- The iOS target uses `ios.appleTeamId` from `EXPO_APPLE_TEAM_ID` or `APPLE_TEAM_ID`.
- EAS profiles in `eas.json` cover development builds, an iOS Simulator build, internal preview builds, and production app-store builds. Store `EXPO_APPLE_TEAM_ID` in the EAS environment before running cloud iOS builds.
- Android registers `KlarkeyCredentialProviderService` for Credential Manager and `KlarkeyAutofillService` for classic app-field autofill through `plugins/with-klarkey-credential-provider.js`, syncs unlocked vault entries and passkeys into an encrypted native provider store, returns password picker results through `PendingIntentHandler`, saves classic username/password forms through `SaveInfo`, and can create synced ES256 passkeys for the website or app that requested them.
- The vault starts empty, opens to a bottom search/add dock after unlock, lets users add logins, identities, cards, notes, and SSH keys from the create flow, and supports copy/reveal/delete from the item detail sheet.
- Android logins saved from website prompts are read back from the native provider store on unlock. Changes to this bridge require a new native Android install before the installed app can use it.
- Provider-created synced passkeys are read back from the native provider store on unlock, encrypted into cloud sync when Ave sync is connected, and linked to matching login items by stable item id, website, and username.
- Chrome on Android has its own Autofill using another service setting. The mobile app links to Android password settings and Chrome autofill settings from Settings.
- The Klarkey app association domain is `klarkey.com`; website passkeys use the relying-party ID from the website or app that creates them.
- Production builds need `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` hosted for the shipping domain.
- `bun run write:well-known -- --dry-run` previews both files without writing them.
- Android asset links must include the app package `com.lantharos.klarkey` and the release signing SHA-256 fingerprint.
