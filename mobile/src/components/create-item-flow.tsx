import { useMemo, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, CreditCard, FileText, IdCard, Search, Shield, Terminal, X } from "lucide-react-native";

import { CardFields, IdentityFields, LoginFields, NoteFields, SshKeyFields } from "@/components/create-item-fields";
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
  login: { icon: Shield, color: "#8ee8dd", backgroundColor: "rgba(142,232,221,0.14)" },
  note: { icon: FileText, color: "#f6c95c", backgroundColor: "rgba(246,201,92,0.14)" },
  card: { icon: CreditCard, color: "#72c9ff", backgroundColor: "rgba(114,201,255,0.14)" },
  identity: { icon: IdCard, color: "#77df9f", backgroundColor: "rgba(119,223,159,0.14)" },
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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
        <View style={[styles.modalSurface, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 12) }]}>
          <CreateHeader step={step} loading={loading} onBack={() => setStep("picker")} onClose={resetAndClose} onSave={() => void save()} />
          {step === "picker" ? (
            <ItemTypePicker query={query} onQueryChange={setQuery} onChoose={chooseType} />
          ) : (
            <ItemForm draft={draft} update={update} setDraft={setDraft} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateHeader({
  step,
  loading,
  onBack,
  onClose,
  onSave,
}: {
  step: Step;
  loading: boolean;
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
      <Text style={styles.headerTitle}>New item</Text>
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
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onChoose: (itemType: MobileItemKind) => void;
}) {
  const { width } = useWindowDimensions();
  const tileWidth = Math.max(142, Math.floor((width - 52) / 2));
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
      contentContainerStyle={styles.pickerContent}
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
          style={styles.searchInput}
        />
      </View>
      <View style={styles.typeGrid}>
        {filtered.map((option) => (
          <TypeCard key={option.itemType} itemType={option.itemType} label={option.label} detail={option.detail} width={tileWidth} onPress={() => onChoose(option.itemType)} />
        ))}
      </View>
    </ScrollView>
  );
}

function TypeCard({
  itemType,
  label,
  detail,
  width,
  onPress,
}: {
  itemType: MobileItemKind;
  label: string;
  detail: string;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.typeCard, { width }, pressed ? styles.pressed : undefined]}>
      <TypeGlyph itemType={itemType} size={24} />
      <View style={styles.typeCopy}>
        <Text style={styles.typeLabel}>{label}</Text>
        <Text style={styles.typeDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function ItemForm({
  draft,
  update,
  setDraft,
}: {
  draft: NewItemInput;
  update: (key: keyof NewItemInput, value: string) => void;
  setDraft: Dispatch<SetStateAction<NewItemInput>>;
}) {
  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={styles.formContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.titleRow}>
        <TypeGlyph itemType={draft.itemType} size={32} large />
        <TextInput
          value={draft.itemName}
          onChangeText={(value) => update("itemName", value)}
          placeholder={draft.itemType === "note" ? "Title" : "Name"}
          placeholderTextColor="rgba(255,255,255,0.32)"
          autoCapitalize="sentences"
          autoCorrect={false}
          autoFocus
          style={styles.nameInput}
        />
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
    backgroundColor: "#1a1a1b",
  },
  header: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "600",
  },
  headerSpacer: {
    width: 44,
  },
  saveButton: {
    minWidth: 84,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#E07878",
  },
  disabled: {
    opacity: 0.5,
  },
  saveText: {
    color: "#111112",
    fontSize: 16,
    fontWeight: "600",
  },
  pickerContent: {
    gap: 18,
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  searchBox: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "500",
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  typeCard: {
    minHeight: 150,
    justifyContent: "space-between",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.055)",
    padding: 16,
  },
  pressed: {
    opacity: 0.72,
  },
  typeIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  largeTypeIcon: {
    width: 70,
    height: 70,
    borderRadius: 20,
  },
  typeCopy: {
    gap: 5,
  },
  typeLabel: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "600",
  },
  typeDetail: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 13,
  },
  formContent: {
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 42,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
  },
  nameInput: {
    flex: 1,
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 16,
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "600",
  },
});
