import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";

import { LockedVaultScreen } from "@/components/klarkey-ui";
import { CreateItemSheet } from "@/components/create-item-sheet";
import { ItemDetailSheet } from "@/components/item-detail-panel";
import { VaultHomeSurface } from "@/components/vault-home-surface";
import { openSecuritySettings } from "@/lib/platform-settings";
import { itemSearchText } from "@/lib/vault-item-meta";
import { useMobileVault } from "@/lib/vault-context";
import type { MobileVaultItem, NewItemInput } from "@/lib/vault";
import { View } from "@/tw";

export default function HomeScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<MobileVaultItem>();
  const [createOpen, setCreateOpen] = useState(false);
  const { locked, loading, support, vault, lastEvent, unlock, createItem, updateItem, deleteItem, copyValue } = useMobileVault();

  const filteredItems = useMemo(
    () => vault.items.filter((item) => itemSearchText(item).includes(query.toLowerCase())),
    [query, vault.items],
  );

  useEffect(() => {
    if (!locked) {
      return;
    }

    setSelectedItem(undefined);
    setCreateOpen(false);
    setQuery("");
  }, [locked]);

  if (locked) {
    return (
      <LockedVaultScreen
        loading={loading}
        canUnlock={support.authAvailable}
        lastEvent={lastEvent}
        onUnlock={() => void unlock()}
        onOpenSecuritySettings={() => void openSecuritySettings()}
      />
    );
  }

  async function handleUpdateItem(id: string, input: NewItemInput) {
    const nextItem = await updateItem(id, input);
    if (nextItem) {
      setSelectedItem(nextItem);
    }
    return nextItem;
  }

  return (
    <View className="flex-1 bg-[#1a1a1b]">
      <VaultHomeSurface
        items={filteredItems}
        query={query}
        onQueryChange={setQuery}
        onOpenItem={setSelectedItem}
        onCreate={() => setCreateOpen(true)}
        onOpenSettings={() => router.push("/settings")}
      />
      <ItemDetailSheet
        item={selectedItem}
        onClose={() => setSelectedItem(undefined)}
        onCopy={(label, value) => void copyValue(label, value)}
        onUpdate={handleUpdateItem}
        loading={loading}
        onDelete={() => {
          if (!selectedItem) {
            return;
          }
          void deleteItem(selectedItem.id);
          setSelectedItem(undefined);
        }}
      />
      <CreateItemSheet visible={createOpen} onClose={() => setCreateOpen(false)} onSave={createItem} loading={loading} />
    </View>
  );
}
