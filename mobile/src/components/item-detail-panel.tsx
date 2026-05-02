import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Modal, Platform, Pressable as RNPressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Check, Copy, Eye, EyeOff, KeyRound, Pencil, Trash2, X } from "lucide-react-native";

import { CardFields, IdentityFields, LoginFields, NoteFields, SshKeyFields } from "@/components/create-item-fields";
import { ItemIcon } from "@/components/item-icon";
import { useKeyboardViewport } from "@/lib/keyboard-viewport";
import { itemDisplayFields, itemTypeLabel } from "@/lib/vault-item-meta";
import type { DisplayField } from "@/lib/vault-item-meta";
import { vaultItemToInput, type MobileVaultItem, type NewItemInput } from "@/lib/vault";
import { Pressable, ScrollView, Text, TextInput, View } from "@/tw";

export function ItemDetailSheet({
  item,
  onClose,
  onDelete,
  onCopy,
  onUpdate,
  loading,
}: {
  item?: MobileVaultItem;
  onClose: () => void;
  onDelete: () => void;
  onCopy: (label: string, value?: string) => void;
  onUpdate: (id: string, input: NewItemInput) => Promise<MobileVaultItem | undefined>;
  loading: boolean;
}) {
  const insets = useSafeAreaInsets();
  const keyboardLayout = useKeyboardViewport(insets.bottom, 360);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NewItemInput | undefined>();
  const fields = item ? itemDisplayFields(item) : [];
  const bottomPadding = (keyboardLayout.keyboardVisible ? 18 : Math.max(insets.bottom, 18)) + keyboardLayout.contentOffset;

  useEffect(() => {
    setRevealed({});
    setEditing(false);
    setDraft(item ? vaultItemToInput(item) : undefined);
  }, [item]);

  function cancelEdit() {
    setDraft(item ? vaultItemToInput(item) : undefined);
    setEditing(false);
  }

  async function saveEdit() {
    if (!item || !draft) {
      return;
    }

    const nextItem = await onUpdate(item.id, draft);
    if (nextItem) {
      setDraft(vaultItemToInput(nextItem));
      setEditing(false);
    }
  }

  return (
    <Modal visible={Boolean(item)} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={[styles.surface, keyboardLayout.viewportStyle, { paddingTop: insets.top + 12, paddingBottom: keyboardLayout.keyboardVisible ? 10 : Math.max(insets.bottom, 12) }]}>
          <View style={styles.header}>
            <IconButton accessibilityLabel={editing ? "Back to item" : "Close item"} onPress={editing ? cancelEdit : onClose} icon={editing ? ArrowLeft : X} />
            <Text style={styles.headerTitle}>{editing ? "Edit item" : "Item"}</Text>
            {editing ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Save item" disabled={loading} onPress={() => void saveEdit()} style={({ pressed }) => [styles.saveButton, loading ? styles.disabled : undefined, pressed ? styles.pressed : undefined]}>
                <Check size={18} color="#111112" strokeWidth={2.5} />
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            ) : (
              <View style={styles.headerActions}>
                <IconButton accessibilityLabel="Edit item" onPress={() => setEditing(true)} icon={Pencil} />
                <IconButton accessibilityLabel="Delete item" onPress={onDelete} icon={Trash2} danger />
              </View>
            )}
          </View>

          {item ? (
            <ScrollView className="flex-1" contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 22 }]} showsVerticalScrollIndicator={false}>
              {editing && draft ? (
                <EditItemForm item={item} draft={draft} setDraft={setDraft as Dispatch<SetStateAction<NewItemInput>>} />
              ) : (
                <>
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
                      {fields.map((field, index) => (
                        <DetailField
                          key={field.key}
                          field={field}
                          last={index === fields.length - 1}
                          revealed={Boolean(revealed[field.key])}
                          onReveal={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}
                          onCopy={() => onCopy(field.label, field.value)}
                        />
                      ))}
                    </View>
                  )}
                </>
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
  last,
  revealed,
  onReveal,
  onCopy,
}: {
  field: DisplayField;
  last: boolean;
  revealed: boolean;
  onReveal: () => void;
  onCopy: () => void;
}) {
  const showValue = !field.secret || revealed;
  return (
    <View style={[styles.fieldRow, last ? styles.lastFieldRow : undefined]}>
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

function EditItemForm({
  item,
  draft,
  setDraft,
}: {
  item: MobileVaultItem;
  draft: NewItemInput;
  setDraft: Dispatch<SetStateAction<NewItemInput>>;
}) {
  const [titleFocused, setTitleFocused] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const previewItem = useMemo(
    () => ({
      ...item,
      itemName: draft.itemName,
      title: draft.itemName,
      websites: draft.websites ?? [],
      website: draft.websites?.[0],
    }),
    [draft.itemName, draft.websites, item],
  );

  function update(key: keyof NewItemInput, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateWebsites(websites: string[]) {
    setDraft((current) => ({ ...current, websites }));
  }

  return (
    <>
      <View style={styles.editTitleRow}>
        <ItemIcon item={previewItem} size={58} />
        <Pressable
          onHoverIn={() => setTitleHovered(true)}
          onHoverOut={() => setTitleHovered(false)}
          style={({ pressed }) => [
            styles.editTitleInputShell,
            titleFocused || titleHovered ? styles.editTitleInputShellActive : undefined,
            pressed ? styles.editTitleInputShellPressed : undefined,
          ]}>
          <TextInput
            value={draft.itemName}
            onChangeText={(value) => update("itemName", value)}
            placeholder={draft.itemType === "note" ? "Title" : "Name"}
            placeholderTextColor="rgba(255,255,255,0.32)"
            autoCapitalize="sentences"
            autoCorrect={false}
            selectionColor="#E07878"
            cursorColor="#E07878"
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            style={styles.editTitleInput}
          />
        </Pressable>
      </View>

      {draft.itemType === "login" ? <LoginFields draft={draft} update={update} updateWebsites={updateWebsites} /> : null}
      {draft.itemType === "identity" ? <IdentityFields draft={draft} update={update} /> : null}
      {draft.itemType === "card" ? <CardFields draft={draft} update={update} /> : null}
      {draft.itemType === "note" ? <NoteFields draft={draft} update={update} /> : null}
      {draft.itemType === "ssh-key" ? <SshKeyFields draft={draft} update={update} /> : null}
    </>
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  saveButton: {
    minWidth: 82,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 22,
    backgroundColor: "#E07878",
    paddingHorizontal: 14,
  },
  saveText: {
    color: "#111112",
    fontSize: 15,
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.5,
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
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.052)",
  },
  fieldRow: {
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.075)",
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  lastFieldRow: {
    borderBottomWidth: 0,
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
  editTitleRow: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  editTitleInputShell: {
    flex: 1,
    minHeight: 56,
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 18,
  },
  editTitleInputShellActive: {
    backgroundColor: "rgba(255,255,255,0.088)",
  },
  editTitleInputShellPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.9,
  },
  editTitleInput: {
    minHeight: 34,
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "400",
    padding: 0,
  },
});
