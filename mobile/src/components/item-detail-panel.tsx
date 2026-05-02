import { useEffect, useState } from "react";
import { Modal, Platform, Pressable as RNPressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Copy, Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react-native";

import { ItemIcon } from "@/components/item-icon";
import { useKeyboardViewport } from "@/lib/keyboard-viewport";
import { itemDisplayFields, itemTypeLabel } from "@/lib/vault-item-meta";
import type { DisplayField } from "@/lib/vault-item-meta";
import type { MobileVaultItem } from "@/lib/vault";
import { ScrollView, Text, View } from "@/tw";

export function ItemDetailSheet({
  item,
  onClose,
  onDelete,
  onCopy,
}: {
  item?: MobileVaultItem;
  onClose: () => void;
  onDelete: () => void;
  onCopy: (label: string, value?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const keyboardLayout = useKeyboardViewport(insets.bottom, 360);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const fields = item ? itemDisplayFields(item) : [];
  const bottomPadding = (keyboardLayout.keyboardVisible ? 18 : Math.max(insets.bottom, 18)) + keyboardLayout.contentOffset;

  useEffect(() => {
    setRevealed({});
  }, [item?.id]);

  return (
    <Modal visible={Boolean(item)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={[styles.surface, keyboardLayout.viewportStyle, { paddingTop: insets.top + 12, paddingBottom: keyboardLayout.keyboardVisible ? 10 : Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <IconButton accessibilityLabel="Close item" onPress={onClose} icon={X} />
            <Text style={styles.headerTitle}>Item</Text>
            <IconButton accessibilityLabel="Delete item" onPress={onDelete} icon={Trash2} danger />
          </View>

          {item ? (
            <ScrollView className="flex-1" contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 22 }]} showsVerticalScrollIndicator={false}>
              <View style={styles.itemHero}>
                <ItemIcon item={item} size={62} />
                <View style={styles.heroText}>
                  <Text numberOfLines={2} style={styles.title}>
                    {item.itemName}
                  </Text>
                  <Text numberOfLines={1} style={styles.subtitle}>
                    {itemTypeLabel(item.itemType)}
                  </Text>
                </View>
              </View>

              {item.hasPasskey ? (
                <View style={styles.passkeyRow}>
                  <KeyRound size={16} color="#E07878" strokeWidth={2.2} />
                  <Text style={styles.passkeyText}>Passkey saved for this login</Text>
                </View>
              ) : null}

              {fields.length === 0 ? (
                <View style={styles.emptyField}>
                  <Text style={styles.emptyText}>No fields saved for this item.</Text>
                </View>
              ) : (
                <View style={styles.fieldList}>
                  {fields.map((field) => (
                    <DetailField
                      key={field.key}
                      field={field}
                      revealed={Boolean(revealed[field.key])}
                      onReveal={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}
                      onCopy={() => onCopy(field.label, field.value)}
                    />
                  ))}
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function DetailField({
  field,
  revealed,
  onReveal,
  onCopy,
}: {
  field: DisplayField;
  revealed: boolean;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const showValue = !field.secret || revealed;
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>{field.label}</Text>
        <View style={styles.fieldActions}>
          {field.secret ? <IconButton accessibilityLabel={showValue ? "Hide value" : "Reveal value"} onPress={onReveal} icon={showValue ? EyeOff : Eye} compact /> : null}
          <IconButton accessibilityLabel={`Copy ${field.label}`} onPress={onCopy} icon={Copy} compact />
        </View>
      </View>
      <Text selectable numberOfLines={field.secret && !showValue ? 1 : undefined} style={styles.fieldValue}>
        {showValue ? field.value : "************"}
      </Text>
    </View>
  );
}

function IconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  danger,
  compact,
}: {
  icon: typeof X;
  onPress: () => void;
  accessibilityLabel: string;
  danger?: boolean;
  compact?: boolean;
}) {
  return (
    <RNPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      android_ripple={Platform.OS === "android" ? { color: "rgba(255,255,255,0.12)", borderless: true } : undefined}
      style={({ pressed }) => [compact ? styles.compactButton : styles.headerButton, pressed ? styles.pressed : undefined]}>
      <Icon size={compact ? 17 : 23} color={danger ? "rgba(252,165,165,0.92)" : "rgba(255,255,255,0.72)"} strokeWidth={2.2} />
    </RNPressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: "#111112",
  },
  surface: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#1a1a1b",
  },
  header: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
  pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.82,
  },
  headerTitle: {
    flex: 1,
    color: "rgba(255,255,255,0.62)",
    fontSize: 16,
    fontWeight: "400",
    textAlign: "center",
  },
  title: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "500",
    lineHeight: 31,
  },
  subtitle: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 14,
    fontWeight: "400",
  },
  content: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  itemHero: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 6,
  },
  heroText: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  passkeyRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 23,
    backgroundColor: "rgba(224,120,120,0.115)",
    paddingHorizontal: 14,
  },
  passkeyText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "400",
  },
  fieldList: {
    gap: 8,
  },
  fieldRow: {
    gap: 8,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.052)",
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 13,
    fontWeight: "400",
  },
  fieldActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compactButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  fieldValue: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "400",
    lineHeight: 24,
  },
  emptyField: {
    minHeight: 84,
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.052)",
    paddingHorizontal: 16,
  },
  emptyText: {
    color: "rgba(255,255,255,0.44)",
    fontSize: 14,
  },
});
