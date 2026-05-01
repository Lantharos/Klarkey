import { Settings as SettingsIcon } from "lucide-react-native";

import { ActionButton, LockedVaultScreen, Screen, ScreenHeader, SectionTitle, StatusRow } from "@/components/klarkey-ui";
import { openChromeAutofillSettings, openCredentialProviderSettings } from "@/lib/platform-settings";
import { useMobileVault } from "@/lib/vault-context";
import type { AutoLockMinutes } from "@/lib/vault";
import { Text, View } from "@/tw";

const lockIntervals: Array<{ value: AutoLockMinutes; label: string }> = [
  { value: 1, label: "1 min" },
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

export default function SettingsScreen() {
  const { locked, support, unlock, loading, settings, updateAutoLockMinutes } = useMobileVault();

  if (locked) {
    return <LockedVaultScreen loading={loading} onUnlock={() => void unlock()} />;
  }

  return (
    <Screen>
      <ScreenHeader title="Settings" detail="Security and autofill" />

      <View className="gap-2">
        <SectionTitle>Vault</SectionTitle>
        <StatusRow
          title="Unlock"
          detail={
            support.biometricHardware && support.biometricEnrolled
              ? "Use your phone unlock when opening Klarkey."
              : "Set up face, fingerprint, PIN, or pattern in Android settings."
          }
          state={support.biometricHardware && support.biometricEnrolled ? "ready" : "manual"}
        />
        <StatusRow
          title="Saved items"
          detail={support.secureStore ? "Items are stored on this device." : "This device cannot store vault items yet."}
          state={support.secureStore ? "ready" : "blocked"}
        />
      </View>

      <View className="gap-2">
        <SectionTitle>Auto-lock</SectionTitle>
        <View className="flex-row flex-wrap gap-2">
          {lockIntervals.map((interval) => {
            const selected = settings.autoLockMinutes === interval.value;
            return (
              <Text
                key={interval.value}
                onPress={() => void updateAutoLockMinutes(interval.value)}
                className={`rounded-[10px] px-3 py-2 text-[13px] font-medium ${selected ? "bg-white/11 text-white" : "bg-white/6 text-white/58"}`}>
                {interval.label}
              </Text>
            );
          })}
        </View>
      </View>

      <View className="gap-2">
        <SectionTitle>Autofill</SectionTitle>
        <ActionButton icon={SettingsIcon} onPress={() => void openCredentialProviderSettings()}>
          Android password settings
        </ActionButton>
        <ActionButton icon={SettingsIcon} onPress={() => void openChromeAutofillSettings()}>
          Chrome autofill settings
        </ActionButton>
      </View>

      <View className="gap-2 rounded-[14px] bg-white/6 px-4 py-4">
        <Text className="text-[15px] font-medium text-white">Websites and apps</Text>
        <Text className="text-[14px] leading-5 text-white/46">
          Logins and passkeys stay with the website or app that created them.
        </Text>
      </View>
    </Screen>
  );
}
