import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

export type MobileItemKind = "login" | "identity" | "card" | "note" | "ssh-key";
export type AutoLockMinutes = 1 | 5 | 15 | 30 | 60;

export interface MobilePasskey {
  id: string;
  rpId: string;
  username: string;
  createdAt: string;
  lastUsedAt?: string;
  providerBacked?: boolean;
}

export interface MobileVaultItem {
  id: string;
  itemType: MobileItemKind;
  kind: MobileItemKind;
  itemName: string;
  title: string;
  username?: string;
  password?: string;
  website?: string;
  websites: string[];
  otp?: string;
  otpCode?: string;
  fullName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  cardholderName?: string;
  cardNumber?: string;
  cardLastFour?: string;
  cardExpiry?: string;
  cardExpiryMonth?: string;
  cardExpiryYear?: string;
  cardCvc?: string;
  cardBrand?: string;
  billingPostalCode?: string;
  sshPrivateKey?: string;
  sshComment?: string;
  content?: string;
  notes?: string;
  ssoProvider?: string;
  customFields: Array<{ id: string; label: string; value: string }>;
  hasPassword: boolean;
  hasOtp: boolean;
  hasPasskey: boolean;
  lastUsedAt?: string;
}

export interface NewItemInput {
  itemType: MobileItemKind;
  itemName: string;
  username?: string;
  password?: string;
  otp?: string;
  websites?: string[];
  fullName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  cardholderName?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardExpiryMonth?: string;
  cardExpiryYear?: string;
  cardCvc?: string;
  cardBrand?: string;
  billingPostalCode?: string;
  sshPrivateKey?: string;
  sshComment?: string;
  content?: string;
  notes?: string;
  ssoProvider?: string;
  customFields?: Array<{ id: string; label: string; value: string }>;
}

export interface MobileVaultSettings {
  autoLockMinutes: AutoLockMinutes;
}

export interface MobileVaultState {
  items: MobileVaultItem[];
  passkeys: MobilePasskey[];
}

const VAULT_KEY = "klarkey.mobile.vault.v1";
const SETTINGS_KEY = "klarkey.mobile.settings.v1";

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const defaultVault: MobileVaultState = {
  items: [],
  passkeys: [],
};

export const defaultVaultSettings: MobileVaultSettings = {
  autoLockMinutes: 15,
};

export async function loadVaultState(): Promise<MobileVaultState> {
  if (!(await SecureStore.isAvailableAsync())) {
    return defaultVault;
  }

  const stored = await SecureStore.getItemAsync(VAULT_KEY, secureOptions);
  if (!stored) {
    await saveVaultState(defaultVault);
    return defaultVault;
  }

  return normalizeVaultState(JSON.parse(stored) as Partial<MobileVaultState>);
}

export async function saveVaultState(state: MobileVaultState) {
  if (!(await SecureStore.isAvailableAsync())) {
    return;
  }

  await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(state), secureOptions);
}

export async function loadVaultSettings(): Promise<MobileVaultSettings> {
  if (!(await SecureStore.isAvailableAsync())) {
    return defaultVaultSettings;
  }

  const stored = await SecureStore.getItemAsync(SETTINGS_KEY, secureOptions);
  if (!stored) {
    await saveVaultSettings(defaultVaultSettings);
    return defaultVaultSettings;
  }

  return normalizeVaultSettings(JSON.parse(stored) as Partial<MobileVaultSettings>);
}

export async function saveVaultSettings(settings: MobileVaultSettings) {
  if (!(await SecureStore.isAvailableAsync())) {
    return;
  }

  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings), secureOptions);
}

export function createVaultItem(input: NewItemInput): MobileVaultItem {
  const itemType = input.itemType;
  const websites = itemType === "login" ? cleanWebsites(input.websites) : [];
  const website = websites[0];
  const otp = itemType === "login" ? input.otp?.trim() : undefined;
  const password = itemType === "login" ? input.password?.trim() : undefined;
  const cardNumber = itemType === "card" ? input.cardNumber?.replace(/\s+/g, "").trim() : undefined;
  const sshPrivateKey = itemType === "ssh-key" ? input.sshPrivateKey?.trim() : undefined;
  const customFields = (input.customFields ?? [])
    .map((field) => ({
      id: field.id || Crypto.randomUUID(),
      label: field.label.trim(),
      value: field.value.trim(),
    }))
    .filter((field) => field.label || field.value);

  return {
    id: Crypto.randomUUID(),
    itemType,
    kind: itemType,
    itemName: input.itemName.trim(),
    title: input.itemName.trim(),
    username: itemType === "login" || itemType === "identity" ? clean(input.username) : undefined,
    password,
    website,
    websites,
    otp,
    otpCode: otp,
    fullName: itemType === "identity" ? clean(input.fullName) || identityFullName(input) : undefined,
    firstName: itemType === "identity" ? clean(input.firstName) : undefined,
    middleName: itemType === "identity" ? clean(input.middleName) : undefined,
    lastName: itemType === "identity" ? clean(input.lastName) : undefined,
    company: itemType === "identity" ? clean(input.company) : undefined,
    jobTitle: itemType === "identity" ? clean(input.jobTitle) : undefined,
    birthDate: itemType === "identity" ? clean(input.birthDate) : undefined,
    email: itemType === "identity" ? clean(input.email) : undefined,
    phone: itemType === "identity" ? clean(input.phone) : undefined,
    address: itemType === "identity" ? identityAddress(input) : undefined,
    addressLine1: itemType === "identity" ? clean(input.addressLine1) : undefined,
    addressLine2: itemType === "identity" ? clean(input.addressLine2) : undefined,
    city: itemType === "identity" ? clean(input.city) : undefined,
    state: itemType === "identity" ? clean(input.state) : undefined,
    postalCode: itemType === "identity" ? clean(input.postalCode) : undefined,
    country: itemType === "identity" ? clean(input.country) : undefined,
    cardholderName: itemType === "card" ? clean(input.cardholderName) : undefined,
    cardNumber,
    cardLastFour: cardNumber ? cardNumber.slice(-4) : undefined,
    cardExpiry: itemType === "card" ? clean(input.cardExpiry) || cardExpiry(input) : undefined,
    cardExpiryMonth: itemType === "card" ? clean(input.cardExpiryMonth) : undefined,
    cardExpiryYear: itemType === "card" ? clean(input.cardExpiryYear) : undefined,
    cardCvc: itemType === "card" ? clean(input.cardCvc) : undefined,
    cardBrand: itemType === "card" ? clean(input.cardBrand) : undefined,
    billingPostalCode: itemType === "card" ? clean(input.billingPostalCode) : undefined,
    sshPrivateKey,
    sshComment: itemType === "ssh-key" ? clean(input.sshComment) : undefined,
    content: itemType === "note" ? clean(input.content) : undefined,
    notes: itemType !== "note" ? clean(input.notes) : undefined,
    ssoProvider: itemType === "login" ? clean(input.ssoProvider) : undefined,
    customFields,
    hasPassword: Boolean(password || sshPrivateKey || input.cardCvc),
    hasOtp: Boolean(otp),
    hasPasskey: false,
    lastUsedAt: "Just now",
  };
}

export function createProviderSavedLogin(input: {
  id: string;
  title: string;
  username: string;
  domain?: string;
  domains?: string[];
  password?: string;
  lastUsedAt?: string;
}): MobileVaultItem {
  const websites = input.domains?.length ? input.domains : input.domain ? [input.domain] : [];

  return normalizeVaultItem({
    id: input.id,
    kind: "login",
    itemType: "login",
    itemName: input.title,
    title: input.title,
    username: input.username,
    password: input.password,
    website: websites[0],
    websites,
    hasPassword: Boolean(input.password),
    hasOtp: false,
    hasPasskey: false,
    customFields: [],
    lastUsedAt: input.lastUsedAt ?? "Saved from autofill",
  });
}

function normalizeVaultState(state: Partial<MobileVaultState>): MobileVaultState {
  return {
    items: (state.items ?? []).map(normalizeVaultItem),
    passkeys: state.passkeys ?? [],
  };
}

function normalizeVaultItem(item: Partial<MobileVaultItem>): MobileVaultItem {
  const kind = item.itemType ?? item.kind ?? "login";
  const itemName = item.itemName ?? item.title ?? "New item";
  const websites = cleanWebsites(item.websites ?? [item.website ?? ""]);
  const otp = item.otp ?? item.otpCode;
  const password = item.password;
  const cardNumber = item.cardNumber?.replace(/\s+/g, "").trim();

  return {
    ...item,
    id: item.id ?? Crypto.randomUUID(),
    itemType: kind,
    kind,
    itemName,
    title: itemName,
    website: websites[0],
    websites,
    otp,
    otpCode: otp,
    cardNumber,
    cardLastFour: item.cardLastFour ?? (cardNumber ? cardNumber.slice(-4) : undefined),
    customFields: item.customFields ?? [],
    hasPassword: Boolean(item.hasPassword || password || item.sshPrivateKey || item.cardCvc),
    hasOtp: Boolean(item.hasOtp || otp),
    hasPasskey: Boolean(item.hasPasskey),
  };
}

function normalizeVaultSettings(settings: Partial<MobileVaultSettings>): MobileVaultSettings {
  const allowed: AutoLockMinutes[] = [1, 5, 15, 30, 60];
  return {
    autoLockMinutes: allowed.includes(settings.autoLockMinutes as AutoLockMinutes)
      ? (settings.autoLockMinutes as AutoLockMinutes)
      : defaultVaultSettings.autoLockMinutes,
  };
}

function clean(value?: string) {
  const next = value?.trim();
  return next || undefined;
}

function cleanWebsites(websites?: string[]) {
  return (websites ?? [])
    .map((website) => website.replace(/^https?:\/\//, "").replace(/\/$/, "").trim().toLowerCase())
    .filter(Boolean);
}

function identityFullName(input: NewItemInput) {
  return [input.firstName, input.middleName, input.lastName].map((part) => part?.trim()).filter(Boolean).join(" ") || undefined;
}

function identityAddress(input: NewItemInput) {
  return [
    [input.addressLine1, input.addressLine2].map((part) => part?.trim()).filter(Boolean).join(", "),
    [input.city, input.state, input.postalCode].map((part) => part?.trim()).filter(Boolean).join(", "),
    input.country?.trim(),
  ]
    .filter(Boolean)
    .join(", ") || undefined;
}

function cardExpiry(input: NewItemInput) {
  const month = input.cardExpiryMonth?.trim();
  const year = input.cardExpiryYear?.trim();
  return month && year ? `${month}/${year}` : undefined;
}
