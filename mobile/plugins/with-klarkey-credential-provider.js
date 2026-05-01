const { withAndroidManifest, withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
const providerSources = require("./android-provider-sources");
const CREDENTIALS_VERSION = "1.6.0";

function ensureService(application) {
  application.service = application.service ?? [];
  application.activity = application.activity ?? [];

  const credentialProviderName = ".credentialprovider.KlarkeyCredentialProviderService";
  const credentialProviderService = {
    $: {
      "android:name": credentialProviderName,
      "android:exported": "true",
      "android:permission": "android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE",
      "tools:targetApi": "upside_down_cake",
    },
    "intent-filter": [
      {
        action: [{ $: { "android:name": "android.service.credentials.CredentialProviderService" } }],
      },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.credentials.provider",
          "android:resource": "@xml/klarkey_credential_provider",
        },
      },
    ],
  };

  const autofillName = ".credentialprovider.KlarkeyAutofillService";
  const autofillService = {
    $: {
      "android:name": autofillName,
      "android:exported": "true",
      "android:permission": "android.permission.BIND_AUTOFILL_SERVICE",
      "tools:targetApi": "o",
    },
    "intent-filter": [
      {
        action: [{ $: { "android:name": "android.service.autofill.AutofillService" } }],
      },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.autofill",
          "android:resource": "@xml/klarkey_autofill_service",
        },
      },
    ],
  };

  upsertManifestNode(application.service, credentialProviderName, credentialProviderService);
  upsertManifestNode(application.service, autofillName, autofillService);

  const activityName = ".credentialprovider.KlarkeyCredentialProviderActivity";
  const nextActivity = { $: {
    "android:name": activityName,
    "android:exported": "false",
    "android:theme": "@style/AppTheme",
    "tools:targetApi": "upside_down_cake",
  } };
  const activityIndex = application.activity.findIndex((activity) => activity.$?.["android:name"] === activityName);
  if (activityIndex >= 0) {
    application.activity[activityIndex] = nextActivity;
  } else {
    application.activity.push(nextActivity);
  }
}

function upsertManifestNode(nodes, name, nextNode) {
  const index = nodes.findIndex((node) => node.$?.["android:name"] === name);
  if (index >= 0) {
    nodes[index] = nextNode;
  } else {
    nodes.push(nextNode);
  }
}

function addManualPackage(mainApplication, packageName) {
  const packageCall = `add(${packageName}.credentialprovider.KlarkeyCredentialStorePackage())`;
  if (mainApplication.includes(packageCall)) {
    return mainApplication;
  }

  return mainApplication.replace(
    "PackageList(this).packages.apply {",
    `PackageList(this).packages.apply {\n          ${packageCall}`,
  );
}

function withKlarkeyCredentialProvider(config) {
  config = withAndroidManifest(config, (nextConfig) => {
    const manifest = nextConfig.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";

    const application = manifest.application?.[0];
    if (!application) {
      throw new Error("AndroidManifest.xml is missing an application node.");
    }

    ensureService(application);
    return nextConfig;
  });

  config = withAppBuildGradle(config, (nextConfig) => {
    const dependencies = [`implementation("androidx.credentials:credentials:${CREDENTIALS_VERSION}")`, `implementation("androidx.credentials:credentials-play-services-auth:${CREDENTIALS_VERSION}")`];

    for (const dependency of dependencies) {
      if (!nextConfig.modResults.contents.includes(dependency)) {
        nextConfig.modResults.contents = nextConfig.modResults.contents.replace(
          /dependencies\s*\{/,
          `dependencies {\n    ${dependency}`,
        );
      }
    }

    return nextConfig;
  });

  config = withDangerousMod(config, [
    "android",
    async (nextConfig) => {
      const packageName = nextConfig.android?.package ?? "com.lantharos.klarkey";
      const androidRoot = nextConfig.modRequest.platformProjectRoot;
      const providerXml = path.join(androidRoot, "app", "src", "main", "res", "xml", "klarkey_credential_provider.xml");
      const autofillXml = path.join(androidRoot, "app", "src", "main", "res", "xml", "klarkey_autofill_service.xml");
      const packageRoot = path.join(androidRoot, "app", "src", "main", "java", ...packageName.split("."), "credentialprovider");
      const mainApplicationPath = path.join(
        androidRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split("."),
        "MainApplication.kt",
      );

      fs.mkdirSync(path.dirname(providerXml), { recursive: true });
      fs.writeFileSync(
        providerXml,
        `<credential-provider xmlns:android="http://schemas.android.com/apk/res/android">
  <capabilities>
    <capability name="android.credentials.TYPE_PASSWORD_CREDENTIAL" />
    <capability name="androidx.credentials.TYPE_PUBLIC_KEY_CREDENTIAL" />
  </capabilities>
</credential-provider>
`,
      );
      fs.writeFileSync(
        autofillXml,
        `<autofill-service xmlns:android="http://schemas.android.com/apk/res/android"
  android:settingsActivity="${packageName}.MainActivity" />
`,
      );

      fs.mkdirSync(packageRoot, { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "KlarkeyCredentialProviderService.kt"), providerSources.buildServiceSource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyAutofillService.kt"), providerSources.buildAutofillSource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyCredentialStore.kt"), providerSources.buildStoreSource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyPasskeys.kt"), providerSources.buildPasskeySource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyCredentialProviderActivity.kt"), providerSources.buildActivitySource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyCredentialStoreModule.kt"), providerSources.buildModuleSource(packageName));
      fs.writeFileSync(path.join(packageRoot, "KlarkeyCredentialStorePackage.kt"), providerSources.buildPackageSource(packageName));

      if (fs.existsSync(mainApplicationPath)) {
        const mainApplication = fs.readFileSync(mainApplicationPath, "utf8");
        fs.writeFileSync(mainApplicationPath, addManualPackage(mainApplication, packageName));
      }

      return nextConfig;
    },
  ]);

  return config;
}

module.exports = withKlarkeyCredentialProvider;
