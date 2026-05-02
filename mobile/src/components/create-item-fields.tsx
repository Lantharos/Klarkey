import { StyleSheet } from "react-native";
import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react-native";

import type { NewItemInput } from "@/lib/vault";
import { Pressable, Text, TextInput, View } from "@/tw";

type SheetFieldsProps = {
  draft: NewItemInput;
  update: (key: keyof NewItemInput, value: string) => void;
  updateWebsites?: (value: string[]) => void;
};

export function LoginFields({ draft, update, updateWebsites }: SheetFieldsProps) {
  const websites = draft.websites?.length ? draft.websites : [""];

  function updateWebsiteAt(index: number, value: string) {
    updateWebsites?.(websites.map((website, currentIndex) => (currentIndex === index ? value : website)));
  }

  function addWebsite() {
    updateWebsites?.([...websites, ""]);
  }

  function removeWebsite(index: number) {
    const nextWebsites = websites.filter((_, currentIndex) => currentIndex !== index);
    updateWebsites?.(nextWebsites.length ? nextWebsites : [""]);
  }

  return (
    <>
      <FieldGroup>
        <SheetField label="Username" value={draft.username ?? ""} onChangeText={(value) => update("username", value)} placeholder="name@example.com" keyboardType="email-address" />
        <FieldDivider />
        <SheetField label="Password" value={draft.password ?? ""} onChangeText={(value) => update("password", value)} placeholder="Password" secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        {websites.map((website, index) => (
          <SheetField
            key={index}
            label={index === 0 ? "Website" : `Website ${index + 1}`}
            value={website}
            onChangeText={(value) => updateWebsiteAt(index, value)}
            placeholder="example.com"
            keyboardType="url"
            rightAccessory={
              index > 0 ? (
                <FieldIconButton accessibilityLabel={`Remove website ${index + 1}`} onPress={() => removeWebsite(index)}>
                  <Minus size={17} color="rgba(255,255,255,0.64)" strokeWidth={2.2} />
                </FieldIconButton>
              ) : undefined
            }
          />
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Add website" onPress={addWebsite} style={({ pressed }) => [styles.addWebsiteButton, pressed ? styles.pressed : undefined]}>
          <Plus size={17} color="#E07878" strokeWidth={2.2} />
          <Text style={styles.addWebsiteText}>Add website</Text>
        </Pressable>
        <FieldDivider />
        <SheetField label="One-time code" value={draft.otp ?? ""} onChangeText={(value) => update("otp", value)} placeholder="Secret or code" keyboardType="number-pad" />
        <FieldDivider />
        <SheetField label="Sign in with" value={draft.ssoProvider ?? ""} onChangeText={(value) => update("ssoProvider", value)} placeholder="Google, Apple, SSO" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add notes" multiline />
      </FieldGroup>
    </>
  );
}

export function IdentityFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="Full name" value={draft.fullName ?? ""} onChangeText={(value) => update("fullName", value)} placeholder="Full name" />
        <FieldDivider />
        <SheetField label="Username" value={draft.username ?? ""} onChangeText={(value) => update("username", value)} placeholder="Username" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Email" value={draft.email ?? ""} onChangeText={(value) => update("email", value)} placeholder="Email" keyboardType="email-address" />
        <FieldDivider />
        <SheetField label="Phone" value={draft.phone ?? ""} onChangeText={(value) => update("phone", value)} placeholder="Phone" keyboardType="phone-pad" />
        <FieldDivider />
        <SheetField label="Company" value={draft.company ?? ""} onChangeText={(value) => update("company", value)} placeholder="Company" />
        <FieldDivider />
        <SheetField label="Job title" value={draft.jobTitle ?? ""} onChangeText={(value) => update("jobTitle", value)} placeholder="Job title" />
        <FieldDivider />
        <SheetField label="Birth date" value={draft.birthDate ?? ""} onChangeText={(value) => update("birthDate", value)} placeholder="Birth date" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Address" value={draft.addressLine1 ?? ""} onChangeText={(value) => update("addressLine1", value)} placeholder="Address line 1" />
        <FieldDivider />
        <SheetField label="Address 2" value={draft.addressLine2 ?? ""} onChangeText={(value) => update("addressLine2", value)} placeholder="Address line 2" />
        <FieldDivider />
        <SheetField label="City" value={draft.city ?? ""} onChangeText={(value) => update("city", value)} placeholder="City" />
        <FieldDivider />
        <SheetField label="State" value={draft.state ?? ""} onChangeText={(value) => update("state", value)} placeholder="State" />
        <FieldDivider />
        <SheetField label="Postal code" value={draft.postalCode ?? ""} onChangeText={(value) => update("postalCode", value)} placeholder="Postal code" />
        <FieldDivider />
        <SheetField label="Country" value={draft.country ?? ""} onChangeText={(value) => update("country", value)} placeholder="Country" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add notes" multiline />
      </FieldGroup>
    </>
  );
}

export function CardFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="Name on card" value={draft.cardholderName ?? ""} onChangeText={(value) => update("cardholderName", value)} placeholder="Name on card" />
        <FieldDivider />
        <SheetField label="Number" value={draft.cardNumber ?? ""} onChangeText={(value) => update("cardNumber", value)} placeholder="Card number" keyboardType="number-pad" />
        <FieldDivider />
        <SheetField label="Expiry" value={draft.cardExpiry ?? ""} onChangeText={(value) => update("cardExpiry", value)} placeholder="MM/YY" />
        <FieldDivider />
        <SheetField label="Security code" value={draft.cardCvc ?? ""} onChangeText={(value) => update("cardCvc", value)} placeholder="CVC" keyboardType="number-pad" secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Network" value={draft.cardBrand ?? ""} onChangeText={(value) => update("cardBrand", value)} placeholder="Visa, Mastercard, Amex" />
        <FieldDivider />
        <SheetField label="Billing postal code" value={draft.billingPostalCode ?? ""} onChangeText={(value) => update("billingPostalCode", value)} placeholder="Billing postal code" />
        <FieldDivider />
        <SheetField label="Notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add notes" multiline />
      </FieldGroup>
    </>
  );
}

export function NoteFields({ draft, update }: SheetFieldsProps) {
  return (
    <FieldGroup>
      <SheetField label="Note" value={draft.content ?? ""} onChangeText={(value) => update("content", value)} placeholder="Write a secure note" multiline large />
    </FieldGroup>
  );
}

export function SshKeyFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="Comment" value={draft.sshComment ?? ""} onChangeText={(value) => update("sshComment", value)} placeholder="Key comment" />
        <FieldDivider />
        <SheetField label="Private key" value={draft.sshPrivateKey ?? ""} onChangeText={(value) => update("sshPrivateKey", value)} placeholder="Paste private key" multiline large secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="Notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add notes" multiline />
      </FieldGroup>
    </>
  );
}

function FieldGroup({ children }: { children: ReactNode }) {
  return <View style={styles.fieldGroup}>{children}</View>;
}

function FieldDivider() {
  return null;
}

function SheetField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  large,
  rightAccessory,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "url" | "number-pad" | "phone-pad";
  multiline?: boolean;
  large?: boolean;
  rightAccessory?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.fieldRow, focused ? styles.focusedRow : undefined, large ? styles.largeRow : multiline ? styles.multilineRow : undefined]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputLine}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.34)"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          multiline={multiline}
          selectionColor="#E07878"
          cursorColor="#E07878"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textAlignVertical={multiline ? "top" : "center"}
          style={[styles.fieldInput, multiline ? styles.multilineInput : undefined]}
        />
        {rightAccessory}
      </View>
    </View>
  );
}

function FieldIconButton({ accessibilityLabel, onPress, children }: { accessibilityLabel: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.fieldIconButton, pressed ? styles.pressed : undefined]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: 8,
  },
  fieldRow: {
    minHeight: 66,
    justifyContent: "center",
    gap: 4,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.052)",
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  focusedRow: {
    backgroundColor: "rgba(255,255,255,0.082)",
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  multilineRow: {
    minHeight: 118,
    justifyContent: "flex-start",
  },
  largeRow: {
    minHeight: 190,
    justifyContent: "flex-start",
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 13,
    fontWeight: "400",
  },
  fieldInput: {
    flex: 1,
    minHeight: 30,
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "400",
    padding: 0,
  },
  inputLine: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  multilineInput: {
    flex: 1,
    paddingTop: 6,
  },
  fieldIconButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.065)",
  },
  addWebsiteButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    alignSelf: "flex-start",
    borderRadius: 22,
    backgroundColor: "rgba(224,120,120,0.11)",
    paddingHorizontal: 14,
  },
  addWebsiteText: {
    color: "#f0a0a0",
    fontSize: 15,
    fontWeight: "400",
  },
});
