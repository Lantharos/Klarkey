import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";

import { useMobileVault } from "@/lib/vault-context";
import { Text, View } from "@/tw";

const returnDelayMs = 700;

export default function OAuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useURL();
  const handled = useRef(false);
  const { completeSyncCallback } = useMobileVault();
  const [label, setLabel] = useState("Connecting sync");

  useEffect(() => {
    if (handled.current) {
      return;
    }

    handled.current = true;
    setTimeout(() => {
      router.replace("/");
    }, returnDelayMs);

    void (async () => {
      const callbackUrl = url ?? await Linking.getInitialURL();
      if (callbackUrl) {
        setLabel("Finishing Ave sign-in");
        void completeSyncCallback(callbackUrl);
      }
    })();
  }, [completeSyncCallback, router, url]);

  return (
    <View style={styles.root}>
      <View style={styles.icon}>
        <Check size={26} color="#111112" strokeWidth={2.4} />
      </View>
      <Text style={styles.title}>{label}</Text>
      <Text style={styles.detail}>Returning to Klarkey.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#1a1a1b",
    paddingHorizontal: 26,
  },
  icon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "#E07878",
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "500",
    textAlign: "center",
  },
  detail: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 15,
    textAlign: "center",
  },
});
