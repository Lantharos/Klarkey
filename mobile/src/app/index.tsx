import { useMemo, useState } from "react";
import { Search } from "lucide-react-native";

import {
  FloatingCreateButton,
  ItemRow,
  LockedVaultScreen,
  Screen,
  ScreenHeader,
  SearchField,
  SectionTitle,
} from "@/components/klarkey-ui";
import { CreateItemSheet } from "@/components/create-item-sheet";
import { ItemDetailPanel } from "@/components/item-detail-panel";
import { itemSearchText } from "@/lib/vault-item-meta";
import { useMobileVault } from "@/lib/vault-context";
import { Text, View } from "@/tw";

export default function HomeScreen() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const { locked, loading, vault, unlock, createItem, deleteItem, copyValue } = useMobileVault();

  const filteredItems = useMemo(
    () => vault.items.filter((item) => itemSearchText(item).includes(query.toLowerCase())),
    [query, vault.items],
  );
  const selectedItem = vault.items.find((item) => item.id === selectedId) ?? filteredItems[0];

  if (locked) {
    return <LockedVaultScreen loading={loading} onUnlock={() => void unlock()} />;
  }

  return (
    <View className="flex-1 bg-[#1a1a1b]">
      <Screen>
        <ScreenHeader title="Klarkey" detail="Search your vault" />

        <View className="gap-3">
          <View className="flex-row items-center gap-2 px-1">
            <Search size={15} color="rgba(255,255,255,0.42)" />
            <SectionTitle>Search</SectionTitle>
          </View>
          <SearchField value={query} onChangeText={setQuery} autoFocus />
        </View>

        <View className="gap-2">
          <SectionTitle>{query ? "Results" : "Items"}</SectionTitle>
          {filteredItems.length === 0 ? (
            <View className="gap-2 rounded-[12px] bg-white/6 px-3 py-3">
              <Text className="text-[15px] font-medium text-white">{query ? "No matching items." : "No items yet."}</Text>
              <Text className="text-[13px] leading-5 text-white/42">
                {query ? "Try another search or add a new item." : "Tap the plus button to save your first item."}
              </Text>
            </View>
          ) : (
            filteredItems.map((item) => (
              <ItemRow key={item.id} item={item} selected={item.id === selectedItem?.id} onPress={() => setSelectedId(item.id)} />
            ))
          )}
        </View>

        {selectedItem ? (
          <ItemDetailPanel
            item={selectedItem}
            onCopy={(label, value) => void copyValue(label, value)}
            onDelete={() => {
              void deleteItem(selectedItem.id);
              setSelectedId(undefined);
            }}
          />
        ) : null}
      </Screen>

      <FloatingCreateButton onPress={() => setCreateOpen(true)} />
      <CreateItemSheet visible={createOpen} onClose={() => setCreateOpen(false)} onSave={createItem} loading={loading} />
    </View>
  );
}
