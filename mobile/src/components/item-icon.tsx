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
    <View style={[styles.shell, { width: size, height: size, borderRadius: Math.round(size * 0.32) }]}>
      <FallbackInitial item={item} size={size} />
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
    <View style={[styles.shell, styles.typeShell, { width: size, height: size, borderRadius: Math.round(size * 0.32) }]}>
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

function FallbackInitial({ item, size }: { item: MobileVaultItem; size: number }) {
  const initial = item.itemName.slice(0, 1).toUpperCase();
  return (
    <View style={styles.initialFill}>
      <Text style={[styles.initial, { fontSize: Math.max(13, Math.round(size * 0.36)) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(224,120,120,0.16)",
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
    color: "#ffffff",
    fontWeight: "500",
  },
});
