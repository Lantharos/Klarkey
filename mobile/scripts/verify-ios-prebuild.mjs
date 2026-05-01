import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const appleTeamId = process.env.EXPO_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;
const supportedHost = os.platform() === "darwin" || os.platform() === "linux";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFileIncludes(file, values) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) {
    fail(`Missing expected file: ${file}`);
  }

  const contents = fs.readFileSync(fullPath, "utf8");
  for (const value of values) {
    if (!contents.includes(value)) {
      fail(`Missing "${value}" in ${file}`);
    }
  }
}

function assertCredentialProviderSourceContract() {
  assertFileIncludes("targets/credential-provider/expo-target.config.js", [
    'type: "credentials-provider"',
    'deploymentTarget: "18.0"',
    '"AuthenticationServices"',
    '"CryptoKit"',
    '"Security"',
    "com.apple.developer.authentication-services.autofill-credential-provider",
  ]);

  assertFileIncludes("targets/credential-provider/Info.plist", [
    "com.apple.authentication-services-credential-provider-ui",
    "ProvidesPasswords",
    "ProvidesPasskeys",
    "SupportsConditionalPasskeyRegistration",
    "ProvidesOneTimeCodes",
    "ProvidesTextToInsert",
  ]);

  assertFileIncludes("targets/credential-provider/CredentialProviderViewController.swift", [
    "ASPasswordCredentialRequest",
    "ASPasswordCredentialIdentity",
    "completeRequest(withSelectedCredential:",
    "ASOneTimeCodeCredentialRequest",
    "ASOneTimeCodeCredentialIdentity",
    "completeOneTimeCodeRequest(using:",
    "prepareInterface(forPasskeyRegistration",
    "completeRegistrationRequest(using:",
    "completeAssertionRequest(using:",
    "completeRequest(withTextToInsert:",
  ]);

  assertFileIncludes("targets/credential-provider/KlarkeyCredentialStore.swift", [
    "klarkey.ios.provider.credentials.v1",
    "struct KlarkeyPasswordCredential",
    "struct KlarkeyOneTimeCodeCredential",
    "passwordCredential(for identity: ASPasswordCredentialIdentity)",
    "oneTimeCodeCredential(for identity: ASOneTimeCodeCredentialIdentity)",
  ]);

  assertFileIncludes("targets/credential-provider/KlarkeyPasskeyStore.swift", [
    "ASPasskeyRegistrationCredential",
    "ASPasskeyAssertionCredential",
    "SecKeyCreateRandomKey",
    "SecKeyCreateSignature",
    "ASCredentialIdentityStore.shared.saveCredentialIdentities",
  ]);

  assertFileIncludes("modules/klarkey-credential-store/ios/KlarkeyCredentialStoreModule.swift", [
    'Name("KlarkeyCredentialStore")',
    "group.com.lantharos.klarkey",
    "ASCredentialIdentityStore.shared.saveCredentialIdentities",
    "ASPasswordCredentialIdentity",
    "ASOneTimeCodeCredentialIdentity",
    "removeCredentialIdentities(previousIdentities)",
  ]);
}

assertCredentialProviderSourceContract();

if (!appleTeamId) {
  fail("Set EXPO_APPLE_TEAM_ID or APPLE_TEAM_ID before verifying iOS prebuild.");
}

if (!supportedHost) {
  fail("iOS prebuild verification requires macOS or Linux. Expo skips iOS native generation on Windows.");
}

const result = spawnSync("bun", ["expo", "prebuild", "--platform", "ios", "--no-install", "--clean"], {
  cwd: root,
  env: {
    ...process.env,
    EXPO_APPLE_TEAM_ID: appleTeamId,
  },
  stdio: "inherit",
  shell: os.platform() === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

assertFileIncludes("ios/Klarkey.xcodeproj/project.pbxproj", [
  "KlarkeyCredentialProvider",
  "com.lantharos.klarkey.CredentialProvider",
  appleTeamId,
]);

assertFileIncludes("ios/Klarkey/Klarkey.entitlements", [
  "webcredentials:klarkey.com",
  "applinks:klarkey.com",
  "group.com.lantharos.klarkey",
]);

assertFileIncludes("ios/Klarkey/Info.plist", [
  "NSFaceIDUsageDescription",
  "Unlock Klarkey to fill credentials and approve passkey requests.",
]);

console.log("ok - iOS prebuild generated Klarkey app and Credential Provider target");
