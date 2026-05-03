import type { ComponentType } from "react";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Check, CircleAlert, KeyRound, Lock, LockKeyhole, Settings, ShieldCheck } from "lucide-react-native";

import { Pressable, ScrollView, Text, View, type PressableProps } from "@/tw";

type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const iconColor = "rgba(255,255,255,0.72)";

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      className="flex-1 bg-[#1a1a1b]"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-5 px-5 pb-28 pt-12">
      {children}
    </ScrollView>
  );
}

export function LockedVaultScreen({
  loading,
  canUnlock = true,
  lastEvent,
  onUnlock,
  onOpenSecuritySettings,
  autoPrompt = true,
}: {
  loading: boolean;
  canUnlock?: boolean;
  lastEvent?: string;
  onUnlock: () => void;
  onOpenSecuritySettings?: () => void;
  autoPrompt?: boolean;
}) {
  const prompted = useRef(false);
  const probingUnlock = loading && !canUnlock;
  const unlockVisible = canUnlock || probingUnlock;
  const title = unlockVisible ? "Vault locked" : "Set a device lock";
  const detail = unlockVisible
    ? "Unlock with your phone to search, fill, and save in Klarkey."
    : "Klarkey needs a phone password, PIN, pattern, or biometric before it can open your vault.";
  const ButtonIcon = unlockVisible ? LockKeyhole : Settings;

  useEffect(() => {
    if (!autoPrompt || !canUnlock || loading || prompted.current) {
      return undefined;
    }

    prompted.current = true;
    const timer = setTimeout(onUnlock, 320);
    return () => clearTimeout(timer);
  }, [autoPrompt, canUnlock, loading, onUnlock]);

  return (
    <View className="flex-1 bg-[#1a1a1b] px-6" style={{ paddingBottom: 42, paddingTop: 54 }}>
      <View className="flex-1 justify-center gap-7">
        <View className="h-[82px] w-[82px] items-center justify-center rounded-[28px] bg-[#E07878]/16">
          {unlockVisible ? <ShieldCheck size={34} color="#E07878" strokeWidth={1.9} /> : <Lock size={34} color="#E07878" strokeWidth={1.9} />}
        </View>
        <View className="gap-3">
          <Text className="text-[34px] font-medium leading-[39px] text-white">{title}</Text>
          <Text className="max-w-[310px] text-[16px] leading-[23px] text-white/50">{detail}</Text>
        </View>
      </View>

      <View className="gap-3">
        {lastEvent ? <Text className="text-[14px] leading-5 text-[#E07878]">{lastEvent}</Text> : null}
        <Pressable
          accessibilityRole="button"
          className={`min-h-[56px] flex-row items-center justify-center gap-2 rounded-[18px] px-5 ${unlockVisible ? "bg-[#E07878]" : "bg-white/9"}`}
          onPress={canUnlock ? onUnlock : (onOpenSecuritySettings ?? onUnlock)}
          disabled={loading}>
          <ButtonIcon size={20} color={unlockVisible ? "#111112" : "rgba(255,255,255,0.76)"} strokeWidth={2.2} />
          <Text className={`text-[16px] font-medium ${unlockVisible ? "text-[#111112]" : "text-white"}`}>
            {loading ? "Checking unlock" : canUnlock ? "Unlock Klarkey" : "Open security settings"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ScreenHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4">
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-[30px] font-semibold text-white">{title}</Text>
        {detail ? <Text className="text-[14px] text-white/46">{detail}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text className="px-1 text-[13px] font-medium text-white/38">{children}</Text>;
}

export function ActionButton({
  children,
  icon: Icon = KeyRound,
  tone = "default",
  ...props
}: PressableProps & {
  children: string;
  icon?: IconComponent;
  tone?: "default" | "danger" | "success";
}) {
  const disabled = Boolean(props.disabled);
  const toneClass = disabled
    ? "bg-white/5 text-white/28"
    : tone === "danger"
      ? "bg-red-500/14 text-red-100"
      : tone === "success"
        ? "bg-emerald-500/16 text-emerald-100"
        : "bg-white/9 text-white";

  return (
    <Pressable
      accessibilityRole="button"
      className={`min-h-12 flex-row items-center justify-center gap-2 rounded-[11px] px-4 ${toneClass}`}
      {...props}>
      <Icon size={17} color={disabled ? "rgba(255,255,255,0.28)" : iconColor} strokeWidth={2.2} />
      <Text className={`text-[15px] font-medium ${disabled ? "text-white/28" : "text-white"}`}>{children}</Text>
    </Pressable>
  );
}

export function StatusRow({
  title,
  detail,
  state,
}: {
  title: string;
  detail: string;
  state: "ready" | "manual" | "blocked";
}) {
  const Icon = state === "ready" ? Check : state === "blocked" ? CircleAlert : Lock;
  const color =
    state === "ready"
      ? "rgba(134,239,172,0.9)"
      : state === "blocked"
        ? "rgba(252,165,165,0.9)"
        : "rgba(255,255,255,0.6)";

  return (
    <View className="flex-row items-center gap-3 rounded-[12px] bg-white/6 px-3 py-3">
      <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-white/7">
        <Icon size={16} color={color} strokeWidth={2.2} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-[15px] font-medium text-white">{title}</Text>
        <Text className="text-[13px] text-white/42">{detail}</Text>
      </View>
    </View>
  );
}

export function platformName() {
  if (Platform.OS === "ios") {
    return "iOS";
  }
  if (Platform.OS === "android") {
    return "Android";
  }
  return "Web";
}
