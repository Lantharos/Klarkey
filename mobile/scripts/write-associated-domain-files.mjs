import fs from "node:fs";
import path from "node:path";

const packageName = "com.lantharos.klarkey";
const bundleIdentifier = "com.lantharos.klarkey";
const credentialProviderBundleIdentifier = "com.lantharos.klarkey.CredentialProvider";
const domain = "klarkey.com";
const outDir = path.join(process.cwd(), "public", ".well-known");
const dryRun = process.argv.includes("--dry-run");

const appleTeamId = process.env.EXPO_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;
const androidFingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!appleTeamId) {
  fail("Set EXPO_APPLE_TEAM_ID or APPLE_TEAM_ID before writing associated-domain files.");
}

if (androidFingerprints.length === 0) {
  fail("Set ANDROID_SHA256_CERT_FINGERPRINTS to one or more comma-separated SHA-256 signing fingerprints.");
}

const fingerprintPattern = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;
const invalidFingerprint = androidFingerprints.find((fingerprint) => !fingerprintPattern.test(fingerprint));

if (invalidFingerprint) {
  fail(`Invalid Android SHA-256 fingerprint: ${invalidFingerprint}`);
}

const appIds = [
  `${appleTeamId}.${bundleIdentifier}`,
  `${appleTeamId}.${credentialProviderBundleIdentifier}`,
];

const aasa = {
  webcredentials: {
    apps: appIds,
  },
  applinks: {
    apps: [],
    details: [
      {
        appIDs: appIds,
        components: [
          {
            "/": "*",
          },
        ],
      },
    ],
  },
};

const assetlinks = [
  {
    relation: [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds",
    ],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: androidFingerprints,
    },
  },
];

const files = [
  ["apple-app-site-association", `${JSON.stringify(aasa, null, 2)}\n`],
  ["assetlinks.json", `${JSON.stringify(assetlinks, null, 2)}\n`],
];

if (dryRun) {
  for (const [name, contents] of files) {
    console.log(`--- ${domain}/.well-known/${name}`);
    console.log(contents.trimEnd());
  }
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

for (const [name, contents] of files) {
  fs.writeFileSync(path.join(outDir, name), contents);
  console.log(`wrote public/.well-known/${name}`);
}
