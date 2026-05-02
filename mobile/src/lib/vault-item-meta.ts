import type { MobileItemKind, MobileVaultItem } from "@/lib/vault";

export const itemTypeOptions: Array<{ itemType: MobileItemKind; label: string; detail: string }> = [
  { itemType: "login", label: "Login", detail: "Website or app" },
  { itemType: "note", label: "Secure note", detail: "Private text" },
  { itemType: "card", label: "Credit card", detail: "Payment details" },
  { itemType: "identity", label: "Identity", detail: "Name, email, address" },
  { itemType: "ssh-key", label: "SSH key", detail: "Private key" },
];

export type DisplayField = {
  key: string;
  label: string;
  value?: string;
  secret?: boolean;
};

export function itemTypeLabel(itemType: MobileItemKind) {
  return itemTypeOptions.find((option) => option.itemType === itemType)?.label ?? "Item";
}

export function itemSubtitle(item: MobileVaultItem) {
  if (item.itemType === "login") {
    return item.username || item.website || "Login";
  }

  if (item.itemType === "identity") {
    return item.email || item.phone || item.fullName || "Identity";
  }

  if (item.itemType === "card") {
    return [item.cardBrand, item.cardLastFour ? `ending in ${item.cardLastFour}` : undefined].filter(Boolean).join(" ") || "Card";
  }

  if (item.itemType === "ssh-key") {
    return item.sshComment || "SSH key";
  }

  return item.content || "Secure note";
}

export function itemSearchText(item: MobileVaultItem) {
  return [
    item.itemName,
    item.title,
    item.username,
    item.website,
    ...(item.websites ?? []),
    item.fullName,
    item.email,
    item.phone,
    item.cardholderName,
    item.cardBrand,
    item.cardLastFour,
    item.sshComment,
    item.content,
    item.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function itemDisplayFields(item: MobileVaultItem): DisplayField[] {
  if (item.itemType === "login") {
    return presentFields([
      { key: "username", label: "Username", value: item.username },
      { key: "password", label: "Password", value: item.password, secret: true },
      { key: "otp", label: "One-time code", value: item.otpCode ?? item.otp, secret: true },
      ...item.websites.map((website, index) => ({
        key: `website-${index}`,
        label: index === 0 ? "Website" : `Website ${index + 1}`,
        value: website,
      })),
      { key: "ssoProvider", label: "Sign in with", value: item.ssoProvider },
      { key: "notes", label: "Notes", value: item.notes },
      ...customFieldDisplays(item),
    ]);
  }

  if (item.itemType === "identity") {
    return presentFields([
      { key: "fullName", label: "Full name", value: item.fullName },
      { key: "username", label: "Username", value: item.username },
      { key: "email", label: "Email", value: item.email },
      { key: "phone", label: "Phone", value: item.phone },
      { key: "company", label: "Company", value: item.company },
      { key: "jobTitle", label: "Job title", value: item.jobTitle },
      { key: "birthDate", label: "Birth date", value: item.birthDate },
      { key: "address", label: "Address", value: item.address },
      { key: "notes", label: "Notes", value: item.notes },
      ...customFieldDisplays(item),
    ]);
  }

  if (item.itemType === "card") {
    return presentFields([
      { key: "cardholderName", label: "Name on card", value: item.cardholderName },
      { key: "cardNumber", label: "Card number", value: item.cardNumber, secret: true },
      { key: "cardExpiry", label: "Expiry", value: item.cardExpiry },
      { key: "cardCvc", label: "Security code", value: item.cardCvc, secret: true },
      { key: "cardBrand", label: "Network", value: item.cardBrand },
      { key: "billingPostalCode", label: "Billing postal code", value: item.billingPostalCode },
      { key: "notes", label: "Notes", value: item.notes },
      ...customFieldDisplays(item),
    ]);
  }

  if (item.itemType === "ssh-key") {
    return presentFields([
      { key: "sshPrivateKey", label: "Private key", value: item.sshPrivateKey, secret: true },
      { key: "sshPublicKey", label: "Public key", value: item.sshPublicKey },
      { key: "sshComment", label: "Comment", value: item.sshComment },
      { key: "notes", label: "Notes", value: item.notes },
      ...customFieldDisplays(item),
    ]);
  }

  return presentFields([{ key: "content", label: "Note", value: item.content }, ...customFieldDisplays(item)]);
}

function presentFields(fields: DisplayField[]) {
  return fields.filter((field) => Boolean(field.value));
}

function customFieldDisplays(item: MobileVaultItem): DisplayField[] {
  return item.customFields.map((field, index) => ({
    key: `custom-${field.id || index}`,
    label: field.label || "Custom field",
    value: field.value,
  }));
}
