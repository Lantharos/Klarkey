import type { ComponentType } from "react";
import { Platform } from "react-native";
import { Check, ChevronRight, CircleAlert, CreditCard, FileText, IdCard, KeyRound, Lock, Plus, ShieldCheck, Terminal } from "lucide-react-native";

import { Pressable, ScrollView, Text, TextInput, View, type PressableProps } from "@/tw";
import type { MobileVaultItem } from "@/lib/vault";
import { itemSubtitle } from "@/lib/vault-item-meta";

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
  onUnlock,
}: {
  loading: boolean;
  onUnlock: () => void;
}) {
  return (
    <View className="flex-1 bg-[#1a1a1b]" style={{ justifyContent: "center", paddingHorizontal: 24, paddingBottom: 96 }}>
      <View className="gap-5">
        <View className="h-11 w-11 items-center justify-center rounded-[12px] bg-white/8">
          <Lock size={20} color="rgba(255,255,255,0.74)" strokeWidth={2.2} />
        </View>
        <View className="gap-2">
          <Text className="text-[30px] font-semibold text-white">Vault locked</Text>
          <Text className="text-[15px] leading-5 text-white/48">
            Unlock Klarkey to search, fill, and save your items.
          </Text>
        </View>
        <ActionButton icon={Lock} tone="success" onPress={onUnlock} disabled={loading}>
          Unlock vault
        </ActionButton>
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

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search logins, cards, notes...",
  autoFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.34)"
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      returnKeyType="search"
      className="h-12 rounded-[12px] bg-white/7 px-4 text-[16px] text-white"
    />
  );
}

export function FieldInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "url" | "number-pad";
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="rgba(255,255,255,0.28)"
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      className="h-12 rounded-[12px] bg-white/7 px-4 text-[16px] text-white"
    />
  );
}

export function ItemRow({
  item,
  selected,
  onPress,
}: {
  item: MobileVaultItem;
  selected?: boolean;
  onPress?: () => void;
}) {
  const initial = item.itemName.slice(0, 1).toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`min-h-16 flex-row items-center gap-3 rounded-[12px] px-3 py-3 ${selected ? "bg-white/11" : "bg-white/6"}`}>
      <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-white/8">
        {item.itemType === "login" ? (
          <Text className="text-[13px] font-semibold text-white/78">{initial}</Text>
        ) : (
          <ItemTypeGlyph itemType={item.itemType} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="text-[16px] font-medium text-white">{item.itemName}</Text>
          {item.website ? <Text className="text-[13px] text-white/36">{item.website}</Text> : null}
        </View>
        <Text className="text-[13px] text-white/42">{itemSubtitle(item)}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        {item.hasPasskey ? <KeyRound size={15} color="rgba(134,239,172,0.82)" /> : null}
        {item.hasOtp ? <ShieldCheck size={15} color="rgba(255,255,255,0.48)" /> : null}
        <ChevronRight size={17} color="rgba(255,255,255,0.28)" />
      </View>
    </Pressable>
  );
}

export function FloatingCreateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New item"
      onPress={onPress}
      style={{
        position: "absolute",
        right: 20,
        bottom: 20,
        zIndex: 20,
        elevation: 8,
        height: 56,
        width: 56,
        borderRadius: 18,
        backgroundColor: "#ffffff",
        alignItems: "center",
        justifyContent: "center",
      }}>
      <Plus size={24} color="#111111" strokeWidth={2.4} />
    </Pressable>
  );
}

export function CompactAction({
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
  const color = disabled
    ? "rgba(255,255,255,0.28)"
    : tone === "danger"
      ? "rgba(252,165,165,0.9)"
      : tone === "success"
        ? "rgba(134,239,172,0.9)"
        : "rgba(255,255,255,0.68)";

  return (
    <Pressable
      accessibilityRole="button"
      className={`min-h-10 flex-row items-center justify-center gap-2 rounded-[10px] px-3 ${disabled ? "bg-white/4" : "bg-white/7"}`}
      {...props}>
      <Icon size={15} color={color} strokeWidth={2.2} />
      <Text className={`text-[13px] font-medium ${disabled ? "text-white/28" : "text-white/72"}`}>{children}</Text>
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

export function EventText({ children }: { children?: string }) {
  if (!children) {
    return null;
  }

  return <Text className="rounded-[10px] bg-white/7 px-3 py-2 text-[13px] text-white/58">{children}</Text>;
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

function ItemTypeGlyph({ itemType }: { itemType: MobileVaultItem["itemType"] }) {
  if (itemType === "identity") {
    return <IdCard size={16} color="rgba(255,255,255,0.68)" strokeWidth={2.1} />;
  }
  if (itemType === "card") {
    return <CreditCard size={16} color="rgba(255,255,255,0.68)" strokeWidth={2.1} />;
  }
  if (itemType === "note") {
    return <FileText size={16} color="rgba(255,255,255,0.68)" strokeWidth={2.1} />;
  }
  if (itemType === "ssh-key") {
    return <Terminal size={16} color="rgba(255,255,255,0.68)" strokeWidth={2.1} />;
  }
  return <KeyRound size={16} color="rgba(255,255,255,0.68)" strokeWidth={2.1} />;
}
