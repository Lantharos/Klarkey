import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { CreditCard, FileText, IdCard, Shield, Terminal } from "lucide-react-native";
import { StyleSheet } from "react-native";

import { logoSourcesForItem, markLogoMissing } from "@/lib/login-logo";
import type { MobileVaultItem } from "@/lib/vault";
import { Text, View } from "@/tw";

export function ItemIcon({ item, size = 42 }: { item: MobileVaultItem; size?: number }) {
  if (item.itemType !== "login") {
    return <TypeIcon item={item} size={size} />;
  }

  return <LoginIcon item={item} size={size} />;
}

function LoginIcon({ item, size }: { item: MobileVaultItem; size: number }) {
  const sources = useMemo(() => logoSourcesForItem(item.itemName, item.websites), [item.itemName, item.websites]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const sourceKey = sources.join("|");
  const source = sources[sourceIndex];

  useEffect(() => {
    setSourceIndex(0);
  }, [sourceKey]);

  return (
    <View style={[styles.shell, styles.loginShell, { width: size, height: size, borderRadius: Math.round(size * 0.28) }]}>
      {source ? null : <FallbackInitial title={item.itemName} size={size} />}
      {source ? (
        <Image
          source={{ uri: source }}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={120}
          recyclingKey={source}
          onError={() => {
            markLogoMissing(source);
            setSourceIndex((current) => current + 1);
          }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

function TypeIcon({ item, size }: { item: MobileVaultItem; size: number }) {
  const iconSize = Math.max(17, Math.round(size * 0.43));
  return (
    <View style={[styles.shell, styles.typeShell, { width: size, height: size, borderRadius: Math.round(size * 0.28) }]}>
      <TypeIconContent item={item} size={iconSize} />
    </View>
  );
}

function TypeIconContent({ item, size }: { item: MobileVaultItem; size: number }) {
  if (item.itemType === "identity") {
    return <IdCard size={size} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />;
  }
  if (item.itemType === "card") {
    return <CreditCard size={size} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />;
  }
  if (item.itemType === "note") {
    return <FileText size={size} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />;
  }
  if (item.itemType === "ssh-key") {
    return <Terminal size={size} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />;
  }
  return <Shield size={size} color="rgba(255,255,255,0.72)" strokeWidth={2.1} />;
}

function FallbackInitial({ title, size }: { title: string; size: number }) {
  return (
    <View style={styles.initialFill}>
      <Text style={[styles.initial, { fontSize: Math.max(12, Math.round(size * 0.375)) }]}>{itemInitials(title)}</Text>
    </View>
  );
}

function itemInitials(title: string) {
  const trimmed = title.trim();
  if (!trimmed) {
    return "Kl";
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const first = words[0].slice(0, 2);
    return `${first.slice(0, 1).toUpperCase()}${first.slice(1, 2).toLowerCase()}`;
  }

  return `${words[0][0].toUpperCase()}${words[1][0].toLowerCase()}`;
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  loginShell: {
    backgroundColor: "rgba(14,165,233,0.20)",
  },
  typeShell: {
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  initialFill: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: "#bae6fd",
    fontWeight: "600",
  },
});
