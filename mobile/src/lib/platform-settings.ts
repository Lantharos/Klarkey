import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

const ANDROID_CREDENTIAL_PROVIDER_SETTINGS = "android.settings.CREDENTIAL_PROVIDER";
const ANDROID_AUTOFILL_SETTINGS = "android.settings.REQUEST_SET_AUTOFILL_SERVICE";
const ANDROID_SECURITY_SETTINGS = "android.settings.SECURITY_SETTINGS";
const ANDROID_APPLICATION_PREFERENCES = "android.intent.action.APPLICATION_PREFERENCES";
const ANDROID_CATEGORY_APP_BROWSER = "android.intent.category.APP_BROWSER";
const CHROME_PACKAGE = "com.android.chrome";

export async function openCredentialProviderSettings() {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }

  try {
    await IntentLauncher.startActivityAsync(ANDROID_CREDENTIAL_PROVIDER_SETTINGS);
  } catch {
    try {
      await IntentLauncher.startActivityAsync(ANDROID_AUTOFILL_SETTINGS);
    } catch {
      await Linking.openSettings();
    }
  }
}

export async function openChromeAutofillSettings() {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }

  try {
    await IntentLauncher.startActivityAsync(ANDROID_APPLICATION_PREFERENCES, {
      packageName: CHROME_PACKAGE,
      category: ANDROID_CATEGORY_APP_BROWSER,
    });
  } catch {
    try {
      IntentLauncher.openApplication(CHROME_PACKAGE);
    } catch {
      await Linking.openSettings();
    }
  }
}

export async function openSecuritySettings() {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }

  try {
    await IntentLauncher.startActivityAsync(ANDROID_SECURITY_SETTINGS);
  } catch {
    await Linking.openSettings();
  }
}
