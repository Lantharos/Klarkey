import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file) => JSON.parse(read(file));

const checks = [];

function check(name, predicate) {
  checks.push({ name, predicate });
}

function includes(file, value) {
  return read(file).includes(value);
}

function scanFiles(dir) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) {
    return [];
  }

  return fs.readdirSync(fullDir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return scanFiles(relative);
    }
    return relative;
  });
}

const app = readJson("app.json").expo;
const pkg = readJson("package.json");
const eas = readJson("eas.json");
const oldDomain = ["klarkey", "app"].join(".");
const sourceFiles = [
  "app.json",
  "app.config.js",
  "eas.json",
  "README.md",
  ...scanFiles("src"),
  ...scanFiles("plugins"),
  ...scanFiles("targets"),
];

check("Expo app is Klarkey mobile", () => app.name === "Klarkey" && app.slug === "klarkey-mobile");
check("Android package stays com.lantharos.klarkey", () => app.android.package === "com.lantharos.klarkey");
check("Android keyboard resizes instead of panning the vault", () =>
  app.android.softwareKeyboardLayoutMode === "resize" &&
  includes("android/app/src/main/AndroidManifest.xml", 'android:windowSoftInputMode="adjustResize"'),
);
check("iOS bundle stays com.lantharos.klarkey", () => app.ios.bundleIdentifier === "com.lantharos.klarkey");
check("Associated domain is klarkey.com", () =>
  app.ios.associatedDomains.includes("webcredentials:klarkey.com") &&
  app.ios.associatedDomains.includes("applinks:klarkey.com") &&
  app.android.intentFilters.some((filter) => filter.data?.some((entry) => entry.host === "klarkey.com")) &&
  app.extra.klarkey.associatedDomain === "klarkey.com" &&
  !("relyingPartyId" in app.extra.klarkey),
);
check("No source file references the old domain", () => sourceFiles.every((file) => !includes(file, oldDomain)));
check("Apple Team ID can be injected from env", () =>
  includes("app.config.js", "EXPO_APPLE_TEAM_ID") && includes("app.config.js", "APPLE_TEAM_ID"),
);
check("iOS prebuild verifier requires supported host and Apple Team ID", () =>
  pkg.scripts["verify:ios-prebuild"] === "node ./scripts/verify-ios-prebuild.mjs" &&
  includes("scripts/verify-ios-prebuild.mjs", "EXPO_APPLE_TEAM_ID") &&
  includes("scripts/verify-ios-prebuild.mjs", "iOS prebuild verification requires macOS or Linux") &&
  includes("scripts/verify-ios-prebuild.mjs", "KlarkeyCredentialProvider") &&
  includes("scripts/verify-ios-prebuild.mjs", "ProvidesOneTimeCodes") &&
  includes("scripts/verify-ios-prebuild.mjs", "CredentialProviderViewController.swift") &&
  includes("scripts/verify-ios-prebuild.mjs", "KlarkeyCredentialStore.swift") &&
  includes("scripts/verify-ios-prebuild.mjs", "ASCredentialIdentityStore.shared.saveCredentialIdentities"),
);
check("iOS native build verifier requires macOS and Xcode", () =>
  pkg.scripts["verify:ios-build"] === "node ./scripts/verify-ios-build.mjs" &&
  includes("scripts/verify-ios-build.mjs", "iOS native build verification requires macOS with Xcode") &&
  includes("scripts/verify-ios-build.mjs", "xcode-select") &&
  includes("scripts/verify-ios-build.mjs", "xcodebuild") &&
  includes("scripts/verify-ios-build.mjs", "iphonesimulator") &&
  includes("scripts/verify-ios-build.mjs", "CODE_SIGNING_ALLOWED=NO") &&
  includes("scripts/verify-ios-build.mjs", "verify:ios-prebuild"),
);
check("Associated-domain file generator requires real signing values", () =>
  includes("scripts/write-associated-domain-files.mjs", "ANDROID_SHA256_CERT_FINGERPRINTS") &&
  includes("scripts/write-associated-domain-files.mjs", "apple-app-site-association") &&
  includes("scripts/write-associated-domain-files.mjs", "assetlinks.json") &&
  includes("scripts/write-associated-domain-files.mjs", "delegate_permission/common.get_login_creds"),
);
check("EAS profiles cover development, iOS simulator, preview, and production builds", () =>
  eas.cli.version === ">= 16.18.0" &&
  eas.cli.appVersionSource === "remote" &&
  eas.build.development.developmentClient === true &&
  eas.build.development.distribution === "internal" &&
  eas.build["ios-simulator"].extends === "development" &&
  eas.build["ios-simulator"].ios.simulator === true &&
  eas.build.preview.distribution === "internal" &&
  eas.build.preview.android.buildType === "apk" &&
  eas.build.production.autoIncrement === true &&
  eas.build.production.android.buildType === "app-bundle",
);
check("EAS app extension declaration is present before iOS cloud builds", () =>
  app.extra.eas.build.experimental.ios.appExtensions.some((extension) =>
    extension.targetName === "KlarkeyCredentialProvider" &&
    extension.bundleIdentifier === "com.lantharos.klarkey.CredentialProvider" &&
    extension.entitlements["com.apple.developer.authentication-services.autofill-credential-provider"] === true &&
    extension.entitlements["com.apple.security.application-groups"].includes("group.com.lantharos.klarkey") &&
    extension.entitlements["com.apple.developer.associated-domains"].includes("webcredentials:klarkey.com") &&
    extension.entitlements["com.apple.developer.associated-domains"].includes("applinks:klarkey.com"),
  ),
);
check("Native credential dependencies are installed", () =>
  [
    "expo-secure-store",
    "expo-local-authentication",
    "expo-clipboard",
    "expo-intent-launcher",
    "expo-dev-client",
    "@bacons/apple-targets",
  ].every((dependency) => dependency in pkg.dependencies),
);
check("App icon uses the Klarkey public icon with the requested Android background", () =>
  app.icon === "./assets/klarkey.png" &&
  app.ios.icon === "./assets/klarkey.png" &&
  ["./assets/klarkey.png", "./assets/klarkey_adaptive.png"].includes(app.android.adaptiveIcon.foregroundImage) &&
  app.android.adaptiveIcon.backgroundColor === "#E07878" &&
  app.web.favicon === "./assets/klarkey.png",
);
check("Template assets and unused styling packages are removed", () =>
  fs.existsSync(path.join(root, "assets/klarkey.png")) &&
  fs.existsSync(path.join(root, "assets/klarkey_adaptive.png")) &&
  !fs.existsSync(path.join(root, "assets/images")) &&
  !fs.existsSync(path.join(root, "assets/expo.icon")) &&
  ![
    "@tailwindcss/postcss",
    "clsx",
    "nativewind",
    "react-native-css",
    "tailwind-merge",
    "tailwindcss",
    "expo-glass-effect",
    "expo-symbols",
    "expo-web-browser",
    "@react-navigation/bottom-tabs",
  ].some((dependency) => dependency in pkg.dependencies),
);
check("Android Metro bundling avoids the react-native-css watcher patch", () =>
  !includes("metro.config.js", "withNativewind") &&
  !includes("metro.config.js", "react-native-css") &&
  includes("src/tw/index.tsx", "resolveClassName") &&
  includes("src/tw/classnames.ts", "resolveClassName") &&
  !fs.existsSync(path.join(root, "src/global.css")) &&
  !fs.existsSync(path.join(root, "postcss.config.mjs")) &&
    !fs.existsSync(path.join(root, "nativewind-env.d.ts")),
);
check("In-app Klarkey-domain passkey probe is removed", () =>
  !("react-native-passkeys" in pkg.dependencies) &&
  !fs.existsSync(path.join(root, "src/lib/passkey-requests.ts")) &&
  !fs.existsSync(path.join(root, "src/app/passkeys.tsx")) &&
  !fs.existsSync(path.join(root, "src/app/explore.tsx")) &&
  !includes("src/components/app-tabs.tsx", 'name="passkeys"') &&
  !includes("src/components/app-tabs.web.tsx", 'href="/passkeys"') &&
  !includes("src/app/settings.tsx", "tied to klarkey.com")
);
check("Android provider plugin emits CredentialProviderService", () =>
  includes("plugins/with-klarkey-credential-provider.js", "CredentialProviderService") &&
  includes("plugins/with-klarkey-credential-provider.js", 'AUTOFILL_VERSION = "1.3.0"') &&
  includes("plugins/with-klarkey-credential-provider.js", "androidx.autofill:autofill:") &&
  includes("plugins/with-klarkey-credential-provider.js", "BIND_CREDENTIAL_PROVIDER_SERVICE") &&
  includes("plugins/with-klarkey-credential-provider.js", "KlarkeyAutofillService") &&
  includes("plugins/with-klarkey-credential-provider.js", "klarkey_autofill_suggestion.xml") &&
  includes("plugins/with-klarkey-credential-provider.js", "klarkey_autofill_suggestion_background.xml") &&
  includes("plugins/with-klarkey-credential-provider.js", "BIND_AUTOFILL_SERVICE") &&
  includes("plugins/with-klarkey-credential-provider.js", "android.service.autofill.AutofillService") &&
  includes("plugins/with-klarkey-credential-provider.js", "KlarkeyCredentialProviderActivity") &&
  includes("plugins/with-klarkey-credential-provider.js", "KlarkeyCredentialStoreModule") &&
  includes("plugins/with-klarkey-credential-provider.js", "providerSources.buildAutofillSource") &&
  includes("plugins/with-klarkey-credential-provider.js", "providerSources.buildServiceSource") &&
  includes("plugins/with-klarkey-credential-provider.js", "providerSources.buildPasskeySource") &&
  includes("plugins/with-klarkey-credential-provider.js", "KlarkeyPasskeys.kt") &&
  includes("plugins/android-provider-sources/autofill-source.js", "AutofillService") &&
  includes("plugins/android-provider-sources/autofill-source.js", "FillResponse.Builder") &&
  includes("plugins/android-provider-sources/autofill-source.js", "Dataset.Builder") &&
  includes("plugins/android-provider-sources/autofill-source.js", "Field.Builder") &&
  includes("plugins/android-provider-sources/autofill-source.js", "R.layout.klarkey_autofill_suggestion") &&
  includes("plugins/android-provider-sources/autofill-source.js", "R.id.klarkey_autofill_title") &&
  includes("plugins/android-provider-sources/autofill-source.js", "R.id.klarkey_autofill_icon") &&
  includes("plugins/android-provider-sources/autofill-source.js", "InlinePresentation") &&
  includes("plugins/android-provider-sources/autofill-source.js", "InlineSuggestionUi.newContentBuilder") &&
  includes("plugins/android-provider-sources/autofill-source.js", "inlineSuggestionsRequest") &&
  includes("plugins/android-provider-sources/autofill-source.js", "setAuthentication") &&
    includes("plugins/android-provider-sources/autofill-source.js", "setLockedValue") &&
    includes("plugins/android-provider-sources/autofill-source.js", "Presentations.Builder") &&
  includes("plugins/android-provider-sources/autofill-source.js", "credential.domains.mapNotNull") &&
  includes("plugins/android-provider-sources/store-source.js", "AndroidKeyStore") &&
  includes("plugins/android-provider-sources/store-source.js", "fun unlock(context: Context") &&
  includes("plugins/android-provider-sources/store-source.js", "val domains: List<String>") &&
  includes("plugins/android-provider-sources/store-source.js", "credentialDomains(item)") &&
  includes("plugins/android-provider-sources/store-source.js", "JSONArray(credential.domains)") &&
  includes("plugins/android-provider-sources/activity-source.js", "PendingIntentHandler.setGetCredentialResponse") &&
  includes("plugins/android-provider-sources/activity-source.js", "BiometricPrompt.Builder") &&
  includes("plugins/android-provider-sources/activity-source.js", "EXTRA_AUTHENTICATION_RESULT") &&
  includes("plugins/android-provider-sources/activity-source.js", "Dataset.Builder") &&
  includes("plugins/android-provider-sources/service-source.js", "PasswordCredentialEntry") &&
  includes("plugins/android-provider-sources/service-source.js", "PublicKeyCredentialEntry") &&
  includes("plugins/android-provider-sources/service-source.js", "addCredentialEntry") &&
  includes("plugins/android-provider-sources/service-source.js", "OutcomeReceiver<Void?, ClearCredentialException>"),
);
check("Generated Android manifest has credential provider and App Link", () =>
  includes("android/app/src/main/AndroidManifest.xml", "android.service.credentials.CredentialProviderService") &&
  includes("android/app/src/main/AndroidManifest.xml", "android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE") &&
  includes("android/app/src/main/AndroidManifest.xml", ".credentialprovider.KlarkeyAutofillService") &&
  includes("android/app/src/main/AndroidManifest.xml", "android.service.autofill.AutofillService") &&
  includes("android/app/src/main/AndroidManifest.xml", "android.permission.BIND_AUTOFILL_SERVICE") &&
  includes("android/app/src/main/AndroidManifest.xml", ".credentialprovider.KlarkeyCredentialProviderActivity") &&
  includes("android/app/src/main/AndroidManifest.xml", 'android:host="klarkey.com"'),
);
check("Generated Android autofill XML registers settings surface", () =>
  includes("android/app/src/main/res/xml/klarkey_autofill_service.xml", "autofill-service") &&
  includes("android/app/src/main/res/xml/klarkey_autofill_service.xml", 'supportsInlineSuggestions="true"') &&
  includes("android/app/src/main/res/xml/klarkey_autofill_service.xml", "com.lantharos.klarkey.MainActivity"),
);
check("Generated Android autofill suggestion uses Klarkey styling", () =>
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", "@+id/klarkey_autofill_title") &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", "@+id/klarkey_autofill_icon") &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", 'android:paddingTop="7dp"') &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", 'android:paddingBottom="7dp"') &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", 'android:layout_width="30dp"') &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", "#FFFFFFFF") &&
  includes("android/app/src/main/res/layout/klarkey_autofill_suggestion.xml", "@drawable/klarkey_autofill_suggestion_background") &&
  includes("android/app/src/main/res/drawable/klarkey_autofill_suggestion_background.xml", "#202021") &&
  !includes("android/app/src/main/res/drawable/klarkey_autofill_suggestion_background.xml", "corners") &&
  !fs.existsSync(path.join(root, "android/app/src/main/res/drawable/klarkey_autofill_mark_background.xml")),
);
check("Generated Android capability XML supports passwords and passkeys", () =>
  includes("android/app/src/main/res/xml/klarkey_credential_provider.xml", "android.credentials.TYPE_PASSWORD_CREDENTIAL") &&
  includes("android/app/src/main/res/xml/klarkey_credential_provider.xml", "androidx.credentials.TYPE_PUBLIC_KEY_CREDENTIAL"),
);
check("Generated Android AutofillService returns and saves password datasets", () =>
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "AutofillService") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "onFillRequest") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "onSaveRequest") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "FillResponse.Builder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "SaveInfo.Builder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "setSaveInfo") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "Dataset.Builder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "Field.Builder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "R.layout.klarkey_autofill_suggestion") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "R.id.klarkey_autofill_title") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "setImageViewResource") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "InlinePresentation") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "InlineSuggestionUi.newContentBuilder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "inlineSuggestionsRequest") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "credentialMatchesTarget") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "credential.domains.mapNotNull") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "node.webDomain") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "setAuthentication") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "setLockedValue") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "Presentations.Builder") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "AutofillValue.forText") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "KlarkeyCredentialStore.loadCredentials") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "KlarkeyCredentialStore.savePasswordCredential"),
);
check("Generated Android provider returns password entries and supports public-key entries", () =>
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderService.kt", "PasswordCredentialEntry") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderService.kt", "PublicKeyCredentialEntry") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderService.kt", "addCredentialEntry") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "PendingIntentHandler.setGetCredentialResponse") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "BiometricPrompt.Builder") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "EXTRA_AUTHENTICATION_RESULT") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "Dataset.Builder") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "KlarkeyCredentialStore.unlock") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "PendingIntentHandler.retrieveProviderCreateCredentialRequest") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "PendingIntentHandler.retrieveProviderGetCredentialRequest") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStore.kt", "AndroidKeyStore") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStore.kt", "fun unlock(context: Context") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStore.kt", "credentialsPayload") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStoreModule.kt", "getProviderCredentials") &&
    includes("android/app/src/main/java/com/lantharos/klarkey/MainApplication.kt", "KlarkeyCredentialStorePackage"),
);
check("Generated Android provider can create provider-owned passkeys", () =>
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "CreatePublicKeyCredentialResponse") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "PublicKeyCredential(") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "SHA256withECDSA") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "AndroidKeyStore") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStore.kt", "savePasskey") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialStore.kt", "savePasskeyCredential") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "privilegedAllowlist") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "getOrigin(privilegedAllowlist)") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "option.clientDataHash") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderActivity.kt", "providerRequest.callingAppInfo") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyPasskeys.kt", "Base64.NO_PADDING"),
);
check("Passkeys stay provider-backed and linked to matching website items", () =>
  includes("src/lib/vault.ts", "providerBacked?: boolean") &&
  includes("src/lib/vault.ts", "itemId?: string") &&
  includes("src/lib/native-credential-store.ts", "export function isProviderBackedPasskeyForItem") &&
  includes("src/lib/native-credential-store.ts", "passkey.providerBacked !== true") &&
  includes("src/lib/native-credential-store.ts", "passkey.itemId && passkey.itemId === item.id") &&
  includes("src/lib/native-credential-store.ts", "passkey.rpId === host") &&
  includes("src/lib/vault-context.tsx", "linkPasskeysToItems") &&
  includes("src/components/item-detail-panel.tsx", "Passkey saved for this login") &&
  includes("plugins/android-provider-sources/passkey-source.js", "val rpId = rp.optString") &&
  includes("plugins/android-provider-sources/passkey-source.js", "savePasskeyCredential") &&
  includes("plugins/android-provider-sources/store-source.js", "val itemId: String?") &&
  includes("plugins/android-provider-sources/store-source.js", "mergeProviderOwnedCredentials") &&
  includes("plugins/android-provider-sources/service-source.js", "val rpId = KlarkeyPasskeys.rpIdFromRequestJson"),
);
check("Expo vault syncs unlocked credentials to Android provider store", () =>
  includes("src/lib/native-credential-store.ts", "requireOptionalNativeModule") &&
    includes("src/lib/native-credential-store.ts", "KlarkeyCredentialStore") &&
  includes("src/lib/native-credential-store.ts", "credentialDomainsForItem") &&
  includes("src/lib/native-credential-store.ts", "domains,") &&
  includes("src/lib/native-credential-store.ts", "replaceCredentials") &&
  includes("src/lib/native-credential-store.ts", "getProviderCredentials") &&
  includes("src/lib/native-credential-store.ts", "getProviderPasskeys") &&
  includes("src/lib/vault-context.tsx", "loadNativeProviderCredentials") &&
  includes("src/lib/vault-context.tsx", "loadNativeProviderPasskeys") &&
  includes("src/lib/vault-context.tsx", "refreshProviderVault") &&
  includes("src/lib/vault-context.tsx", "refreshLockedProviderVault") &&
  includes("src/lib/vault-context.tsx", "setVault(redactVaultState(nextVault))") &&
  includes("src/lib/native-credential-store.ts", "lockNativeCredentialStore") &&
  includes("src/lib/vault-context.tsx", "syncNativeCredentialStore(nextVault)") &&
  includes("src/lib/vault-context.tsx", "lockNativeCredentialStore"),
);
check("iOS Credential Provider target is configured", () =>
  includes("targets/credential-provider/expo-target.config.js", 'type: "credentials-provider"') &&
  includes("targets/credential-provider/expo-target.config.js", 'deploymentTarget: "18.0"') &&
  includes("app.json", '"deploymentTarget": "18.0"') &&
  includes("targets/credential-provider/expo-target.config.js", '"AuthenticationServices"') &&
  includes("targets/credential-provider/expo-target.config.js", '"CryptoKit"') &&
  includes("targets/credential-provider/expo-target.config.js", '"Security"') &&
  includes("targets/credential-provider/expo-target.config.js", "com.apple.developer.authentication-services.autofill-credential-provider") &&
  includes("targets/credential-provider/Info.plist", "com.apple.authentication-services-credential-provider-ui"),
);
check("iOS extension advertises 1Password-like fill capabilities", () =>
  includes("targets/credential-provider/Info.plist", "ProvidesPasswords") &&
  includes("targets/credential-provider/Info.plist", "ProvidesPasskeys") &&
  includes("targets/credential-provider/Info.plist", "SupportsConditionalPasskeyRegistration") &&
  includes("targets/credential-provider/Info.plist", "ProvidesOneTimeCodes") &&
  includes("targets/credential-provider/Info.plist", "ProvidesTextToInsert") &&
  !includes("targets/credential-provider/Info.plist", "SupportsCredentialExchange") &&
  !includes("targets/credential-provider/Info.plist", "SupportedCredentialExchangeVersions"),
);
check("iOS extension implements passkey entry points", () =>
  includes("targets/credential-provider/CredentialProviderViewController.swift", "prepareInterface(forPasskeyRegistration") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASPasskeyCredentialRequestParameters") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "completePasskeyRegistration") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "completePasskeyAssertion"),
);
check("iOS extension can create provider-owned passkeys", () =>
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "ASPasskeyRegistrationCredential") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "ASPasskeyAssertionCredential") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "SecKeyCreateRandomKey") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "secureEnclave: true") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "secureEnclave: false") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "SecKeyCreateSignature") &&
  includes("targets/credential-provider/KlarkeyPasskeyStore.swift", "ASCredentialIdentityStore.shared.saveCredentialIdentities") &&
  includes("targets/credential-provider/KlarkeyCbor.swift", "final class KlarkeyCbor"),
);
check("iOS app syncs unlocked vault rows through app group", () =>
  includes("modules/klarkey-credential-store/expo-module.config.json", '"platforms": ["apple"]') &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", 'Name("KlarkeyCredentialStore")') &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", "group.com.lantharos.klarkey") &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", "ASCredentialIdentityStore.shared.saveCredentialIdentities") &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", "ASPasswordCredentialIdentity") &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", "ASOneTimeCodeCredentialIdentity") &&
  includes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", "removeCredentialIdentities(previousIdentities)") &&
  includes("targets/credential-provider/KlarkeyCredentialStore.swift", "klarkey.ios.provider.credentials.v1") &&
  includes("targets/credential-provider/KlarkeyCredentialStore.swift", "struct KlarkeyPasswordCredential") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "KlarkeyCredentialStore.passwordCredential") &&
  includes("src/lib/native-credential-store.ts", "otpCode: item.otpCode"),
);
check("iOS extension can complete password, OTP, and text autofill requests", () =>
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASPasswordCredentialRequest") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASPasswordCredentialIdentity") &&
  includes("targets/credential-provider/KlarkeyCredentialStore.swift", "passwordCredential(for identity: ASPasswordCredentialIdentity)") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASPasswordCredential(user:") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "completeRequest(withSelectedCredential:") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASOneTimeCodeCredentialRequest") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "ASOneTimeCodeCredentialIdentity") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "completeOneTimeCodeRequest(using:") &&
  includes("targets/credential-provider/KlarkeyCredentialStore.swift", "oneTimeCodeCredential") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "prepareInterfaceForUserChoosingTextToInsert") &&
  includes("targets/credential-provider/CredentialProviderViewController.swift", "completeRequest(withTextToInsert:"),
);
check("Klarkey mobile UI and vault screens exist", () =>
  [
    "src/app/index.tsx",
    "src/app/autofill.tsx",
    "src/app/settings.tsx",
    "src/components/klarkey-ui.tsx",
    "src/components/create-item-sheet.tsx",
    "src/components/create-item-flow.tsx",
    "src/components/create-item-fields.tsx",
    "src/components/vault-home-surface.tsx",
    "src/components/item-icon.tsx",
    "src/components/item-detail-panel.tsx",
    "src/lib/keyboard-viewport.ts",
    "src/lib/login-logo.ts",
  ].every((file) => fs.existsSync(path.join(root, file))),
);
check("Klarkey mobile vault has usable add, edit, copy, reveal, and delete flows", () =>
  includes("src/app/index.tsx", "VaultHomeSurface") &&
  includes("src/app/index.tsx", "CreateItemSheet") &&
  includes("src/app/index.tsx", "ItemDetailSheet") &&
  includes("src/components/vault-home-surface.tsx", "BottomSearchDock") &&
  includes("src/components/vault-home-surface.tsx", "FlatList") &&
  includes("src/components/vault-home-surface.tsx", "onEndReached") &&
  includes("src/components/vault-home-surface.tsx", "visibleItems") &&
  includes("src/components/vault-home-surface.tsx", "itemPageSize") &&
  includes("src/components/vault-home-surface.tsx", "SettingsButton") &&
  !includes("src/components/vault-home-surface.tsx", "AvatarButton") &&
  !includes("src/components/vault-home-surface.tsx", "avatarText") &&
  !includes("src/components/vault-home-surface.tsx", 'backgroundColor: "rgba(255,255,255,0.07)"') &&
  includes("src/components/vault-home-surface.tsx", "autoFocus") &&
  includes("src/components/vault-home-surface.tsx", "Search in Klarkey") &&
  includes("src/components/vault-home-surface.tsx", 'selectionColor="#E07878"') &&
  includes("src/components/vault-home-surface.tsx", "useKeyboardViewport") &&
  includes("src/lib/keyboard-viewport.ts", "Keyboard.addListener") &&
  includes("src/lib/keyboard-viewport.ts", "Keyboard.scheduleLayoutAnimation") &&
  includes("src/lib/keyboard-viewport.ts", "useWindowDimensions") &&
  includes("src/lib/keyboard-viewport.ts", "androidNeedsViewportFallback") &&
  includes("src/lib/keyboard-viewport.ts", "largestWindowHeight - keyboardHeight") &&
  includes("src/components/vault-home-surface.tsx", 'fontWeight: "400"') &&
  !includes("src/components/vault-home-surface.tsx", 'router.push("/settings")') &&
  includes("src/app/index.tsx", 'router.push("/settings")') &&
  includes("src/components/app-tabs.tsx", "Stack") &&
  !includes("src/components/app-tabs.tsx", "NativeTabs") &&
  includes("src/components/create-item-flow.tsx", "chooseType") &&
  includes("src/components/create-item-flow.tsx", "ItemTypePicker") &&
  includes("src/components/create-item-flow.tsx", "Save") &&
  includes("src/components/create-item-flow.tsx", "useKeyboardViewport") &&
  includes("src/components/create-item-flow.tsx", "contentBottomPadding") &&
  includes("src/components/create-item-flow.tsx", "titleInputShellActive") &&
  includes("src/components/create-item-fields.tsx", "LoginFields") &&
  includes("src/components/create-item-fields.tsx", "focusedRow") &&
  includes("src/components/create-item-fields.tsx", "Add website") &&
  includes("src/components/create-item-fields.tsx", 'selectionColor="#E07878"') &&
  includes("src/components/create-item-flow.tsx", 'itemType: "login"') &&
  includes("src/components/create-item-flow.tsx", 'draft.itemType === "identity"') &&
  includes("src/components/create-item-flow.tsx", 'draft.itemType === "card"') &&
  includes("src/components/create-item-flow.tsx", 'draft.itemType === "note"') &&
  includes("src/components/create-item-flow.tsx", 'draft.itemType === "ssh-key"') &&
  includes("src/components/item-detail-panel.tsx", "Modal") &&
  includes("src/components/item-detail-panel.tsx", "ItemIcon") &&
  includes("src/components/item-detail-panel.tsx", "useKeyboardViewport") &&
  includes("src/components/item-detail-panel.tsx", "itemHero") &&
  includes("src/components/item-detail-panel.tsx", "fieldList") &&
  includes("src/components/item-detail-panel.tsx", "EditItemForm") &&
  includes("src/components/item-detail-panel.tsx", "onUpdate") &&
  includes("src/components/item-detail-panel.tsx", "Copy") &&
  includes("src/components/item-detail-panel.tsx", "Eye") &&
  includes("src/components/item-detail-panel.tsx", "Delete") &&
  includes("src/lib/vault-context.tsx", 'import * as Clipboard from "expo-clipboard"') &&
  includes("src/lib/vault-context.tsx", "createItem") &&
  includes("src/lib/vault-context.tsx", "updateItem") &&
  includes("src/lib/vault-context.tsx", "deleteItem") &&
  includes("src/lib/vault-context.tsx", "copyValue") &&
  includes("src/lib/vault.ts", "createVaultItem") &&
  includes("src/lib/vault.ts", "updateVaultItem") &&
  includes("src/lib/vault.ts", "vaultItemToInput") &&
  includes("src/lib/vault.ts", "sshPublicKey") &&
  includes("src/lib/vault.ts", "items: []") &&
  includes("src/lib/vault.ts", "passkeys: []"),
);
check("Klarkey mobile uses cached desktop-style item icons", () =>
  "expo-image" in pkg.dependencies &&
  app.plugins.includes("expo-image") &&
  includes("src/components/item-icon.tsx", 'import { Image } from "expo-image"') &&
  includes("src/components/item-icon.tsx", 'cachePolicy="memory-disk"') &&
  includes("src/components/item-icon.tsx", "source ? null : <FallbackInitial") &&
  includes("src/components/item-icon.tsx", "recyclingKey") &&
  includes("src/components/item-icon.tsx", "markLogoMissing") &&
  includes("src/components/item-icon.tsx", "itemInitials") &&
  includes("src/components/item-icon.tsx", "#bae6fd") &&
  includes("src/lib/login-logo.ts", "img.logo.dev") &&
  includes("src/lib/login-logo.ts", "logoDevToken") &&
  includes("src/lib/login-logo.ts", "normalizeLoginLogoDomain")
);
check("Klarkey mobile has lock screen, auto-lock, and Chrome setup paths", () =>
  includes("src/components/klarkey-ui.tsx", "Vault locked") &&
  includes("src/components/klarkey-ui.tsx", "Set a device lock") &&
  includes("src/components/klarkey-ui.tsx", "setTimeout(onUnlock") &&
  !includes("src/components/klarkey-ui.tsx", "klarkeyIcon") &&
  includes("src/lib/vault.ts", "autoLockMinutes") &&
  includes("src/lib/vault-context.tsx", "AppState.addEventListener") &&
  includes("src/lib/vault-context.tsx", "getEnrolledLevelAsync") &&
  includes("src/lib/vault-context.tsx", "authAvailable") &&
  includes("src/lib/vault-context.tsx", "disableDeviceFallback: false") &&
  includes("src/lib/vault-context.tsx", "redactVaultState") &&
  includes("src/app/settings.tsx", "Auto-lock") &&
  includes("src/app/settings.tsx", "intervalContent") &&
  !includes("src/app/settings.tsx", "SettingsIcon") &&
  !includes("src/app/settings.tsx", "identityIcon") &&
  includes("src/lib/platform-settings.ts", "openSecuritySettings") &&
  includes("src/lib/platform-settings.ts", "android.settings.REQUEST_SET_AUTOFILL_SERVICE") &&
  includes("src/lib/platform-settings.ts", "data: klarkeyPackageUri") &&
  includes("src/lib/platform-settings.ts", "package:") &&
  includes("src/lib/platform-settings.ts", "openChromeAutofillSettings") &&
  includes("src/lib/platform-settings.ts", "com.android.chrome") &&
  includes("src/app/autofill.tsx", "Chrome autofill settings"),
);
check("Android fill surfaces can suggest locked items before unlock", () =>
  includes("plugins/android-provider-sources/service-source.js", "val addedEntries = request.beginGetCredentialOptions") &&
  !includes("plugins/android-provider-sources/service-source.js", "val addedEntries = if (unlocked)") &&
  includes("plugins/android-provider-sources/service-source.js", 'AuthenticationAction.Builder("Unlock Klarkey"') &&
  includes("plugins/android-provider-sources/autofill-source.js", "val isUnlocked = KlarkeyCredentialStore.isUnlocked(this)") &&
  includes("plugins/android-provider-sources/autofill-source.js", "credentialMatchesTarget") &&
  includes("plugins/android-provider-sources/autofill-source.js", "node.webDomain") &&
  includes("plugins/android-provider-sources/autofill-source.js", "setImageViewResource") &&
  includes("plugins/android-provider-sources/autofill-source.js", 'dataset.setAuthentication(providerIntent("fill-password"') &&
  includes("plugins/android-provider-sources/autofill-source.js", "setLockedValue(dataset") &&
  !includes("plugins/android-provider-sources/autofill-source.js", "Unlock to fill") &&
  !includes("plugins/android-provider-sources/autofill-source.js", "Password for ") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyCredentialProviderService.kt", "val addedEntries = request.beginGetCredentialOptions") &&
  includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", 'dataset.setAuthentication(providerIntent("fill-password"') &&
  !includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "Unlock to fill") &&
  !includes("android/app/src/main/java/com/lantharos/klarkey/credentialprovider/KlarkeyAutofillService.kt", "Password for ")
);
check("Klarkey mobile source does not expose template or demo vault content", () =>
  [
    "Expo Starter",
    "docs.expo",
    "starter app",
    "react-logo",
    "tutorial-web",
    "Try editing",
    "app/index.tsx",
    "expo-badge",
    "local-demo",
    "GitHub",
    "Visa ending",
    "Personal identity",
    "team@klarkey.com",
  ].every((value) => sourceFiles.every((file) => !includes(file, value))),
);

let failed = false;
for (const { name, predicate } of checks) {
  let ok = false;
  try {
    ok = Boolean(predicate());
  } catch {
    ok = false;
  }

  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failed = true;
    console.error(`fail - ${name}`);
  }
}

if (failed) {
  process.exit(1);
}
