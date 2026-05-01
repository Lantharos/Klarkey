import { StyleSheet } from "react-native";
import type { ReactNode } from "react";

import type { NewItemInput } from "@/lib/vault";
import { Text, TextInput, View } from "@/tw";

type SheetFieldsProps = {
  draft: NewItemInput;
  update: (key: keyof NewItemInput, value: string) => void;
  updateWebsites?: (value: string[]) => void;
};

export function LoginFields({ draft, update, updateWebsites }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="username" value={draft.username ?? ""} onChangeText={(value) => update("username", value)} placeholder="name@example.com" keyboardType="email-address" />
        <FieldDivider />
        <SheetField label="password" value={draft.password ?? ""} onChangeText={(value) => update("password", value)} placeholder="Password" secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="website" value={draft.websites?.[0] ?? ""} onChangeText={(value) => updateWebsites?.([value])} placeholder="https://example.com" keyboardType="url" />
        <FieldDivider />
        <SheetField label="one-time code" value={draft.otp ?? ""} onChangeText={(value) => update("otp", value)} placeholder="Secret or code" keyboardType="number-pad" />
        <FieldDivider />
        <SheetField label="sign in with" value={draft.ssoProvider ?? ""} onChangeText={(value) => update("ssoProvider", value)} placeholder="Google, Apple, SSO" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add any notes about this item" multiline />
      </FieldGroup>
    </>
  );
}

export function IdentityFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="full name" value={draft.fullName ?? ""} onChangeText={(value) => update("fullName", value)} placeholder="Full name" />
        <FieldDivider />
        <SheetField label="username" value={draft.username ?? ""} onChangeText={(value) => update("username", value)} placeholder="Username" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="email" value={draft.email ?? ""} onChangeText={(value) => update("email", value)} placeholder="Email" keyboardType="email-address" />
        <FieldDivider />
        <SheetField label="phone" value={draft.phone ?? ""} onChangeText={(value) => update("phone", value)} placeholder="Phone" keyboardType="phone-pad" />
        <FieldDivider />
        <SheetField label="company" value={draft.company ?? ""} onChangeText={(value) => update("company", value)} placeholder="Company" />
        <FieldDivider />
        <SheetField label="job title" value={draft.jobTitle ?? ""} onChangeText={(value) => update("jobTitle", value)} placeholder="Job title" />
        <FieldDivider />
        <SheetField label="birth date" value={draft.birthDate ?? ""} onChangeText={(value) => update("birthDate", value)} placeholder="Birth date" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="address" value={draft.addressLine1 ?? ""} onChangeText={(value) => update("addressLine1", value)} placeholder="Address line 1" />
        <FieldDivider />
        <SheetField label="address 2" value={draft.addressLine2 ?? ""} onChangeText={(value) => update("addressLine2", value)} placeholder="Address line 2" />
        <FieldDivider />
        <SheetField label="city" value={draft.city ?? ""} onChangeText={(value) => update("city", value)} placeholder="City" />
        <FieldDivider />
        <SheetField label="state" value={draft.state ?? ""} onChangeText={(value) => update("state", value)} placeholder="State" />
        <FieldDivider />
        <SheetField label="postal code" value={draft.postalCode ?? ""} onChangeText={(value) => update("postalCode", value)} placeholder="Postal code" />
        <FieldDivider />
        <SheetField label="country" value={draft.country ?? ""} onChangeText={(value) => update("country", value)} placeholder="Country" />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add any notes about this identity" multiline />
      </FieldGroup>
    </>
  );
}

export function CardFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="name on card" value={draft.cardholderName ?? ""} onChangeText={(value) => update("cardholderName", value)} placeholder="Name on card" />
        <FieldDivider />
        <SheetField label="number" value={draft.cardNumber ?? ""} onChangeText={(value) => update("cardNumber", value)} placeholder="Card number" keyboardType="number-pad" />
        <FieldDivider />
        <SheetField label="expiry" value={draft.cardExpiry ?? ""} onChangeText={(value) => update("cardExpiry", value)} placeholder="MM/YY" />
        <FieldDivider />
        <SheetField label="security code" value={draft.cardCvc ?? ""} onChangeText={(value) => update("cardCvc", value)} placeholder="CVC" keyboardType="number-pad" secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="network" value={draft.cardBrand ?? ""} onChangeText={(value) => update("cardBrand", value)} placeholder="Visa, Mastercard, Amex" />
        <FieldDivider />
        <SheetField label="billing ZIP" value={draft.billingPostalCode ?? ""} onChangeText={(value) => update("billingPostalCode", value)} placeholder="Billing postal code" />
        <FieldDivider />
        <SheetField label="notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add any notes about this card" multiline />
      </FieldGroup>
    </>
  );
}

export function NoteFields({ draft, update }: SheetFieldsProps) {
  return (
    <FieldGroup>
      <SheetField label="note" value={draft.content ?? ""} onChangeText={(value) => update("content", value)} placeholder="Write a secure note" multiline large />
    </FieldGroup>
  );
}

export function SshKeyFields({ draft, update }: SheetFieldsProps) {
  return (
    <>
      <FieldGroup>
        <SheetField label="comment" value={draft.sshComment ?? ""} onChangeText={(value) => update("sshComment", value)} placeholder="Key comment" />
        <FieldDivider />
        <SheetField label="private key" value={draft.sshPrivateKey ?? ""} onChangeText={(value) => update("sshPrivateKey", value)} placeholder="Paste private key" multiline large secureTextEntry />
      </FieldGroup>
      <FieldGroup>
        <SheetField label="notes" value={draft.notes ?? ""} onChangeText={(value) => update("notes", value)} placeholder="Add any notes about this key" multiline />
      </FieldGroup>
    </>
  );
}

function FieldGroup({ children }: { children: ReactNode }) {
  return <View style={styles.fieldGroup}>{children}</View>;
}

function FieldDivider() {
  return <View style={styles.fieldDivider} />;
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
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "url" | "number-pad" | "phone-pad";
  multiline?: boolean;
  large?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, large ? styles.largeRow : multiline ? styles.multilineRow : undefined]}>
      <Text style={styles.fieldLabel}>{label}</Text>
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
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.fieldInput, multiline ? styles.multilineInput : undefined]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  fieldRow: {
    minHeight: 68,
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
    color: "rgba(224,120,120,0.9)",
    fontSize: 13,
    fontWeight: "500",
  },
  fieldInput: {
    minHeight: 30,
    color: "#ffffff",
    fontSize: 18,
    padding: 0,
  },
  multilineInput: {
    flex: 1,
    paddingTop: 6,
  },
  fieldDivider: {
    height: 1,
    marginLeft: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
});
