import { useMemo, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import { Modal, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, ChevronRight, CreditCard, FileText, IdCard, Search, Shield, Terminal, X } from "lucide-react-native";

import { CardFields, IdentityFields, LoginFields, NoteFields, SshKeyFields } from "@/components/create-item-fields";
import { useKeyboardViewport } from "@/lib/keyboard-viewport";
import { itemTypeOptions } from "@/lib/vault-item-meta";
import type { MobileItemKind, NewItemInput } from "@/lib/vault";
import { Pressable, ScrollView, Text, TextInput, View } from "@/tw";

type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
type Step = "picker" | "form";

const emptyDraft: NewItemInput = {
  itemType: "login",
  itemName: "",
  username: "",
  password: "",
  otp: "",
  websites: [""],
  fullName: "",
  firstName: "",
  middleName: "",
  lastName: "",
  company: "",
  jobTitle: "",
  birthDate: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  cardholderName: "",
  cardNumber: "",
  cardExpiry: "",
  cardExpiryMonth: "",
  cardExpiryYear: "",
  cardCvc: "",
  cardBrand: "",
  billingPostalCode: "",
  sshPrivateKey: "",
  sshComment: "",
  content: "",
  notes: "",
  ssoProvider: "",
};

const itemTypeVisuals: Record<MobileItemKind, { icon: IconComponent; color: string; backgroundColor: string }> = {
  login: { icon: Shield, color: "#E07878", backgroundColor: "rgba(224,120,120,0.14)" },
  note: { icon: FileText, color: "#E07878", backgroundColor: "rgba(224,120,120,0.14)" },
  card: { icon: CreditCard, color: "#E07878", backgroundColor: "rgba(224,120,120,0.14)" },
  identity: { icon: IdCard, color: "#E07878", backgroundColor: "rgba(224,120,120,0.14)" },
  "ssh-key": { icon: Terminal, color: "#E07878", backgroundColor: "rgba(224,120,120,0.14)" },
};

export function CreateItemSheet({
  visible,
  onClose,
  onSave,
  loading,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (input: NewItemInput) => Promise<boolean>;
  loading: boolean;
}) {
  const [draft, setDraft] = useState<NewItemInput>(emptyDraft);
  const [step, setStep] = useState<Step>("picker");
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const keyboardLayout = useKeyboardViewport(insets.bottom, 360);
  const sheetBottomPadding = keyboardLayout.keyboardVisible ? 12 : Math.max(insets.bottom, 12);
  const contentBottomPadding = 42 + keyboardLayout.contentOffset + sheetBottomPadding;

  function resetAndClose() {
    setDraft(emptyDraft);
    setStep("picker");
    setQuery("");
    onClose();
  }

  function update(key: keyof NewItemInput, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseType(itemType: MobileItemKind) {
    const label = itemTypeOptions.find((option) => option.itemType === itemType)?.label ?? "New item";
    setDraft({ ...emptyDraft, itemType, itemName: label });
    setStep("form");
  }

  async function save() {
    const saved = await onSave(draft);
    if (saved) {
      resetAndClose();
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={resetAndClose}>
      <View style={styles.modalRoot}>
        <View style={[styles.modalSurface, keyboardLayout.viewportStyle, { paddingTop: insets.top + 12, paddingBottom: sheetBottomPadding }]}>
          <CreateHeader step={step} loading={loading} itemType={draft.itemType} onBack={() => setStep("picker")} onClose={resetAndClose} onSave={() => void save()} />
          {step === "picker" ? (
            <ItemTypePicker query={query} onQueryChange={setQuery} onChoose={chooseType} bottomPadding={contentBottomPadding} />
          ) : (
            <ItemForm draft={draft} update={update} setDraft={setDraft} bottomPadding={contentBottomPadding} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function CreateHeader({
  step,
  loading,
  itemType,
  onBack,
  onClose,
  onSave,
}: {
  step: Step;
  loading: boolean;
  itemType: MobileItemKind;
  onBack: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const showSave = step === "form";
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={showSave ? "Back" : "Close"} onPress={showSave ? onBack : onClose} style={styles.headerButton}>
        {showSave ? <ArrowLeft size={27} color="rgba(255,255,255,0.82)" strokeWidth={2.2} /> : <X size={28} color="rgba(255,255,255,0.82)" strokeWidth={2.1} />}
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.headerTitle}>{showSave ? itemTypeOptions.find((option) => option.itemType === itemType)?.label ?? "New item" : "New item"}</Text>
      </View>
      {showSave ? (
        <Pressable accessibilityRole="button" disabled={loading} onPress={onSave} style={[styles.saveButton, loading ? styles.disabled : undefined]}>
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );
}

function ItemTypePicker({
  query,
  onQueryChange,
  onChoose,
  bottomPadding,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onChoose: (itemType: MobileItemKind) => void;
  bottomPadding: number;
}) {
  const { width } = useWindowDimensions();
  const listWidth = Math.max(0, width - 40);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return itemTypeOptions;
    }
    return itemTypeOptions.filter((option) => `${option.label} ${option.detail}`.toLowerCase().includes(needle));
  }, [query]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={[styles.pickerContent, { paddingBottom: bottomPadding }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.searchBox}>
        <Search size={22} color="rgba(255,255,255,0.54)" strokeWidth={2.2} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="What would you like to add?"
          placeholderTextColor="rgba(255,255,255,0.36)"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          selectionColor="#E07878"
          cursorColor="#E07878"
          style={styles.searchInput}
        />
      </View>
      <View style={[styles.typeList, { width: listWidth }]}>
        {filtered.map((option) => (
          <TypeCard key={option.itemType} itemType={option.itemType} label={option.label} detail={option.detail} onPress={() => onChoose(option.itemType)} />
        ))}
      </View>
    </ScrollView>
  );
}

function TypeCard({
  itemType,
  label,
  detail,
  onPress,
}: {
  itemType: MobileItemKind;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.typeCard, pressed ? styles.pressed : undefined]}>
      <TypeGlyph itemType={itemType} size={24} />
      <View style={styles.typeCopy}>
        <Text style={styles.typeLabel}>{label}</Text>
        <Text style={styles.typeDetail}>{detail}</Text>
      </View>
      <ChevronRight size={20} color="rgba(255,255,255,0.34)" strokeWidth={2.2} />
    </Pressable>
  );
}

function ItemForm({
  draft,
  update,
  setDraft,
  bottomPadding,
}: {
  draft: NewItemInput;
  update: (key: keyof NewItemInput, value: string) => void;
  setDraft: Dispatch<SetStateAction<NewItemInput>>;
  bottomPadding: number;
}) {
  const [titleFocused, setTitleFocused] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const titleActive = titleFocused || titleHovered;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={[styles.formContent, { paddingBottom: bottomPadding }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        <TypeGlyph itemType={draft.itemType} size={32} large />
        <Pressable
          onHoverIn={() => setTitleHovered(true)}
          onHoverOut={() => setTitleHovered(false)}
          style={({ pressed }) => [styles.titleInputShell, titleActive ? styles.titleInputShellActive : undefined, pressed ? styles.titleInputShellPressed : undefined]}>
          <TextInput
            value={draft.itemName}
            onChangeText={(value) => update("itemName", value)}
            placeholder={draft.itemType === "note" ? "Title" : "Name"}
            placeholderTextColor="rgba(255,255,255,0.32)"
            autoCapitalize="sentences"
            autoCorrect={false}
            autoFocus
            selectionColor="#E07878"
            cursorColor="#E07878"
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            style={styles.nameInput}
          />
        </Pressable>
      </View>

      {draft.itemType === "login" ? (
        <LoginFields draft={draft} update={update} updateWebsites={(websites) => setDraft((current) => ({ ...current, websites }))} />
      ) : null}
      {draft.itemType === "identity" ? <IdentityFields draft={draft} update={update} /> : null}
      {draft.itemType === "card" ? <CardFields draft={draft} update={update} /> : null}
      {draft.itemType === "note" ? <NoteFields draft={draft} update={update} /> : null}
      {draft.itemType === "ssh-key" ? <SshKeyFields draft={draft} update={update} /> : null}
    </ScrollView>
  );
}

function TypeGlyph({ itemType, size, large }: { itemType: MobileItemKind; size: number; large?: boolean }) {
  const visual = itemTypeVisuals[itemType];
  const Icon = visual.icon;
  return (
    <View style={[styles.typeIcon, large ? styles.largeTypeIcon : undefined, { backgroundColor: visual.backgroundColor }]}>
      <Icon size={size} color={visual.color} strokeWidth={2.2} />
    </View>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: "#111112",
  },
  modalSurface: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#1a1a1b",
  },
  header: {
    minHeight: 70,
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
  headerCopy: {
    minWidth: 0,
    flex: 1,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "500",
  },
  headerSpacer: {
    width: 44,
  },
  saveButton: {
    minWidth: 70,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "#E07878",
  },
  disabled: {
    opacity: 0.5,
  },
  saveText: {
    color: "#111112",
    fontSize: 16,
    fontWeight: "500",
  },
  pickerContent: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  searchBox: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "400",
  },
  typeList: {
    gap: 8,
    alignSelf: "center",
  },
  typeCard: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.052)",
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  pressed: {
    transform: [{ scale: 0.988 }],
    opacity: 0.82,
  },
  typeIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
  },
  largeTypeIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  typeCopy: {
    flex: 1,
    gap: 5,
  },
  typeLabel: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "500",
  },
  typeDetail: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 13,
  },
  formContent: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  nameInput: {
    flex: 1,
    minHeight: 54,
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "400",
    padding: 0,
  },
  titleInputShell: {
    flex: 1,
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  titleInputShellActive: {
    backgroundColor: "rgba(255,255,255,0.088)",
  },
  titleInputShellPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.9,
  },
});
