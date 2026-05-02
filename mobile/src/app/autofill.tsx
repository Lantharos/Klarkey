import { Globe, KeyRound, Settings } from "lucide-react-native";

import {
  ActionButton,
  LockedVaultScreen,
  Screen,
  ScreenHeader,
  SectionTitle,
  StatusRow,
  platformName,
} from "@/components/klarkey-ui";
import { openChromeAutofillSettings, openCredentialProviderSettings, openSecuritySettings } from "@/lib/platform-settings";
import { useMobileVault } from "@/lib/vault-context";
import { Text, View } from "@/tw";

export default function AutofillScreen() {
  const { locked, loading, support, lastEvent, unlock } = useMobileVault();

  if (locked) {
    return (
      <LockedVaultScreen
        loading={loading}
        canUnlock={support.authAvailable}
        lastEvent={lastEvent}
        onUnlock={() => void unlock()}
        onOpenSecuritySettings={() => void openSecuritySettings()}
      />
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Autofill" detail={`Fill from Klarkey on ${platformName()}`} />

      <View className="gap-2">
        <SectionTitle>Set up</SectionTitle>
        <StatusRow
          title="Choose Klarkey on Android"
          detail="Make Klarkey your preferred password and passkey service."
          state="manual"
        />
        <StatusRow
          title="Turn it on in Chrome"
          detail="Chrome has a separate setting named Autofill using another service."
          state="manual"
        />
        <StatusRow
          title="Unlock before filling"
          detail={support.secureStore ? "Open Klarkey once after install so saved items are ready to fill." : "This device cannot store vault items yet."}
          state={support.secureStore ? "ready" : "blocked"}
        />
      </View>

      <View className="gap-2">
        <SectionTitle>Open settings</SectionTitle>
        <ActionButton icon={Settings} onPress={() => void openCredentialProviderSettings()}>
          Android password settings
        </ActionButton>
        <ActionButton icon={Globe} onPress={() => void openChromeAutofillSettings()}>
          Chrome autofill settings
        </ActionButton>
      </View>

      <View className="gap-3 rounded-[14px] bg-white/6 px-4 py-4">
        <KeyRound size={18} color="rgba(255,255,255,0.64)" />
        <Text className="text-[15px] font-medium text-white">Saved from websites</Text>
        <Text className="text-[14px] leading-5 text-white/48">
          When Android asks to save a login or passkey, accept it, then reopen Klarkey. New saved items appear in the vault after unlock.
        </Text>
      </View>
    </Screen>
  );
}
