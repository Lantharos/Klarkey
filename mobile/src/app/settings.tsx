import { useRouter } from "expo-router";
import { ArrowLeft, Check, ChevronRight, CircleAlert, Clock3, Fingerprint, Globe, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react-native";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LockedVaultScreen } from "@/components/klarkey-ui";
import { openChromeAutofillSettings, openCredentialProviderSettings, openSecuritySettings } from "@/lib/platform-settings";
import { useMobileVault } from "@/lib/vault-context";
import type { AutoLockMinutes } from "@/lib/vault";
import { Pressable, ScrollView, Text, View } from "@/tw";

const lockIntervals: Array<{ value: AutoLockMinutes; label: string }> = [
  { value: 1, label: "1 min" },
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

type RowState = "ready" | "attention" | "neutral";
type RowIcon = typeof ShieldCheck;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locked, support, unlock, loading, lastEvent, settings, updateAutoLockMinutes } = useMobileVault();

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
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={({ pressed }) => [styles.headerButton, pressed ? styles.pressed : undefined]}>
          <ArrowLeft size={24} color="rgba(255,255,255,0.82)" strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 32 }]}
        showsVerticalScrollIndicator={false}>
        <SettingsGroup title="Security">
          <SettingsRow
            icon={support.authAvailable ? Fingerprint : LockKeyhole}
            title={support.authAvailable ? "Phone unlock" : "Set up phone unlock"}
            detail={support.authAvailable ? "Klarkey opens with your device unlock." : "Add a PIN, password, pattern, fingerprint, or face unlock."}
            state={support.authAvailable ? "ready" : "attention"}
            onPress={support.authAvailable ? undefined : () => void openSecuritySettings()}
          />
          <SettingsRow
            icon={ShieldCheck}
            title="Device vault"
            detail={support.secureStore ? "Items are saved on this phone." : "This phone cannot store vault data yet."}
            state={support.secureStore ? "ready" : "attention"}
          />
        </SettingsGroup>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Auto-lock</Text>
          <View style={styles.lockPanel}>
            <View style={styles.lockHeader}>
              <View style={styles.rowIcon}>
                <Clock3 size={18} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />
              </View>
              <View style={styles.lockCopy}>
                <Text style={styles.rowTitle}>Lock after inactivity</Text>
                <Text style={styles.rowDetail}>Klarkey locks when left idle or sent to the background.</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.intervalScroll} contentContainerStyle={styles.intervalContent}>
              {lockIntervals.map((interval) => (
                <IntervalButton
                  key={interval.value}
                  label={interval.label}
                  selected={settings.autoLockMinutes === interval.value}
                  onPress={() => void updateAutoLockMinutes(interval.value)}
                />
              ))}
            </ScrollView>
          </View>
        </View>

        <SettingsGroup title="Autofill">
          <SettingsRow
            icon={KeyRound}
            title={Platform.OS === "android" ? "Passwords and passkeys" : "Password Autofill"}
            detail={Platform.OS === "android" ? "Choose Klarkey as your password and passkey service." : "Open system Autofill settings."}
            state="neutral"
            onPress={() => void openCredentialProviderSettings()}
          />
          <SettingsRow
            icon={Globe}
            title="Chrome"
            detail="Turn on Autofill using another service in Chrome."
            state="neutral"
            onPress={() => void openChromeAutofillSettings()}
          />
        </SettingsGroup>

      </ScrollView>
    </View>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  detail,
  state,
  onPress,
}: {
  icon: RowIcon;
  title: string;
  detail: string;
  state: RowState;
  onPress?: () => void;
}) {
  const interactive = Boolean(onPress);
  const StateIcon = state === "ready" ? Check : state === "attention" ? CircleAlert : undefined;
  const stateColor = state === "ready" ? "rgba(134,239,172,0.88)" : "rgba(224,120,120,0.92)";
  const content = (
    <>
      <View style={styles.rowIcon}>
        <Icon size={18} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {StateIcon ? <StateIcon size={18} color={stateColor} strokeWidth={2.2} /> : null}
      {interactive ? <ChevronRight size={19} color="rgba(255,255,255,0.35)" strokeWidth={2.2} /> : null}
    </>
  );

  if (!interactive) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : undefined]}>
      {content}
    </Pressable>
  );
}

function IntervalButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.intervalButton, selected ? styles.intervalSelected : undefined, pressed ? styles.intervalPressed : undefined]}>
      <Text style={[styles.intervalText, selected ? styles.intervalTextSelected : undefined]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1a1a1b",
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.055)",
  },
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "500",
    textAlign: "center",
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    gap: 20,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    paddingHorizontal: 3,
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    fontWeight: "400",
  },
  group: {
    overflow: "hidden",
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.052)",
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  rowPressed: {
    backgroundColor: "rgba(255,255,255,0.055)",
  },
  rowIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.065)",
  },
  rowCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "400",
  },
  rowDetail: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 13,
    lineHeight: 18,
  },
  lockPanel: {
    gap: 14,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.052)",
    padding: 13,
  },
  lockHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  lockCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  intervalScroll: {
    marginHorizontal: -13,
  },
  intervalContent: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 13,
  },
  intervalButton: {
    minHeight: 42,
    minWidth: 70,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.065)",
    paddingHorizontal: 14,
  },
  intervalSelected: {
    backgroundColor: "#E07878",
  },
  intervalPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.86,
  },
  intervalText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "400",
  },
  intervalTextSelected: {
    color: "#111112",
    fontWeight: "500",
  },
  pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.86,
  },
});
