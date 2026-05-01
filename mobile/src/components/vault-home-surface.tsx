import { useRef, useState } from "react";
import { Platform, Pressable as RNPressable, StyleSheet, TextInput as RNTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CreditCard, FileText, IdCard, KeyRound, Plus, Search, ShieldCheck, Terminal, X } from "lucide-react-native";

import { useKeyboardViewport } from "@/lib/keyboard-viewport";
import type { MobileVaultItem } from "@/lib/vault";
import { itemSubtitle } from "@/lib/vault-item-meta";
import { ScrollView, Text, View } from "@/tw";

export function VaultHomeSurface({
  items,
  query,
  onQueryChange,
  onOpenItem,
  onCreate,
  onOpenSettings,
}: {
  items: MobileVaultItem[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenItem: (item: MobileVaultItem) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
}) {
  const insets = useSafeAreaInsets();
  const keyboardLayout = useKeyboardViewport(insets.bottom);

  return (
    <View style={[styles.root, keyboardLayout.viewportStyle]}>
      <View style={[styles.topRail, { paddingTop: insets.top + 8 }]}>
        <AvatarButton onPress={onOpenSettings} />
      </View>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top + 70,
          paddingHorizontal: 18,
          paddingBottom: insets.bottom + keyboardLayout.contentOffset + 114,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.list}>
          {items.length === 0 ? (
            <EmptyVault query={query} />
          ) : (
            items.map((item) => <VaultItemButton key={item.id} item={item} onPress={() => onOpenItem(item)} />)
          )}
        </View>
      </ScrollView>

      <BottomSearchDock value={query} onChangeText={onQueryChange} onCreate={onCreate} bottomInset={insets.bottom} keyboardOffset={keyboardLayout.dockOffset} />
    </View>
  );
}

function AvatarButton({ onPress }: { onPress: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <RNPressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      android_ripple={ripple("rgba(224,120,120,0.2)", true)}
      style={({ pressed }) => [styles.avatar, hovered ? styles.avatarHovered : undefined, pressed ? styles.pressed : undefined]}>
      <Text style={styles.avatarText}>K</Text>
    </RNPressable>
  );
}

function BottomSearchDock({
  value,
  onChangeText,
  onCreate,
  bottomInset,
  keyboardOffset,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onCreate: () => void;
  bottomInset: number;
  keyboardOffset: number;
}) {
  const inputRef = useRef<RNTextInput>(null);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = focused || hovered || value.length > 0;
  const keyboardVisible = keyboardOffset > 0;

  return (
    <View style={[styles.dock, { bottom: keyboardOffset, paddingBottom: keyboardVisible ? 10 : Math.max(bottomInset, 12) }]}>
      <RNPressable
        accessibilityRole="search"
        onPress={() => inputRef.current?.focus()}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        android_ripple={ripple("rgba(255,255,255,0.08)", false)}
        style={({ pressed }) => [styles.searchPill, active ? styles.searchPillActive : undefined, pressed ? styles.searchPillPressed : undefined]}>
        <Search size={22} color={active ? "#ffffff" : "rgba(255,255,255,0.58)"} strokeWidth={2.2} />
        <RNTextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder="Search in Klarkey"
          placeholderTextColor="rgba(255,255,255,0.42)"
          selectionColor="#E07878"
          cursorColor="#E07878"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.searchInput}
        />
        {value ? (
          <RNPressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText("")} hitSlop={10} style={styles.clearButton}>
            <X size={16} color="rgba(255,255,255,0.62)" strokeWidth={2.4} />
          </RNPressable>
        ) : null}
      </RNPressable>

      <RNPressable
        accessibilityRole="button"
        accessibilityLabel="New item"
        onPress={onCreate}
        android_ripple={ripple("rgba(255,255,255,0.16)", true)}
        style={({ pressed }) => [styles.createButton, pressed ? styles.createButtonPressed : undefined]}>
        <Plus size={25} color="#111112" strokeWidth={2.5} />
      </RNPressable>
    </View>
  );
}

function VaultItemButton({ item, onPress }: { item: MobileVaultItem; onPress: () => void }) {
  return (
    <RNPressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={ripple("rgba(255,255,255,0.08)", false)}
      style={({ pressed }) => [styles.itemRow, pressed ? styles.itemPressed : undefined]}>
      <ItemGlyph item={item} />
      <View style={styles.itemText}>
        <Text numberOfLines={1} style={styles.itemTitle}>
          {item.itemName}
        </Text>
        <Text numberOfLines={1} style={styles.itemSubtitle}>
          {itemSubtitle(item)}
        </Text>
      </View>
      <View style={styles.itemMeta}>
        {item.hasPasskey ? <KeyRound size={15} color="rgba(224,120,120,0.86)" strokeWidth={2.2} /> : null}
        {item.hasOtp ? <ShieldCheck size={15} color="rgba(255,255,255,0.48)" strokeWidth={2.2} /> : null}
      </View>
    </RNPressable>
  );
}

function EmptyVault({ query }: { query: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{query ? "No results" : "No items yet"}</Text>
      <Text style={styles.emptyDetail}>{query ? "Try another search." : "Use the plus button to add your first item."}</Text>
    </View>
  );
}

function ItemGlyph({ item }: { item: MobileVaultItem }) {
  const initial = item.itemName.slice(0, 1).toUpperCase();

  return (
    <View style={styles.itemGlyph}>
      <GlyphContent item={item} initial={initial} />
    </View>
  );
}

function GlyphContent({ item, initial }: { item: MobileVaultItem; initial: string }) {
  if (item.itemType === "identity") {
    return <IdCard size={18} color="rgba(255,255,255,0.7)" strokeWidth={2.1} />;
  }
  if (item.itemType === "card") {
    return <CreditCard size={18} color="rgba(255,255,255,0.7)" strokeWidth={2.1} />;
  }
  if (item.itemType === "note") {
    return <FileText size={18} color="rgba(255,255,255,0.7)" strokeWidth={2.1} />;
  }
  if (item.itemType === "ssh-key") {
    return <Terminal size={18} color="rgba(255,255,255,0.7)" strokeWidth={2.1} />;
  }
  return <Text style={styles.itemInitial}>{initial}</Text>;
}

function ripple(color: string, borderless: boolean) {
  return Platform.OS === "android" ? { color, borderless } : undefined;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#1a1a1b",
  },
  topRail: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: "flex-end",
    paddingHorizontal: 18,
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(224,120,120,0.18)",
  },
  avatarHovered: {
    backgroundColor: "rgba(224,120,120,0.26)",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  list: {
    gap: 2,
  },
  itemRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  itemPressed: {
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  itemGlyph: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  itemInitial: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  itemText: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  itemTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
  itemSubtitle: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 14,
  },
  itemMeta: {
    minWidth: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 7,
  },
  emptyState: {
    minHeight: 220,
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  emptyDetail: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 14,
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: "rgba(26,26,27,0.96)",
  },
  searchPill: {
    minHeight: 58,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 29,
    backgroundColor: "rgba(255,255,255,0.075)",
    paddingHorizontal: 17,
  },
  searchPillActive: {
    borderColor: "rgba(224,120,120,0.62)",
    backgroundColor: "rgba(255,255,255,0.105)",
  },
  searchPillPressed: {
    transform: [{ scale: 0.992 }],
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "400",
    padding: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  createButton: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 29,
    backgroundColor: "#E07878",
  },
  createButtonPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.86,
  },
  pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.86,
  },
});
