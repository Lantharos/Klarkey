import { useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react-native";

import { CompactAction, SectionTitle } from "@/components/klarkey-ui";
import { itemDisplayFields, itemTypeLabel } from "@/lib/vault-item-meta";
import type { MobileVaultItem } from "@/lib/vault";
import { Pressable, Text, View } from "@/tw";

export function ItemDetailPanel({
  item,
  onDelete,
  onCopy,
}: {
  item: MobileVaultItem;
  onDelete: () => void;
  onCopy: (label: string, value?: string) => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const fields = itemDisplayFields(item);

  return (
    <View className="gap-2">
      <SectionTitle>Selected item</SectionTitle>
      <View className="gap-3 rounded-[14px] bg-white/6 px-4 py-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[19px] font-semibold text-white">{item.itemName}</Text>
            <Text className="mt-1 text-[13px] text-white/42">{itemTypeLabel(item.itemType)}</Text>
            {item.hasPasskey ? (
              <View className="mt-2 flex-row items-center gap-2">
                <KeyRound size={14} color="rgba(134,239,172,0.82)" strokeWidth={2.2} />
                <Text className="text-[13px] text-white/58">Passkey saved for this login</Text>
              </View>
            ) : null}
          </View>
          <CompactAction icon={Trash2} tone="danger" onPress={onDelete}>
            Delete
          </CompactAction>
        </View>

        <View className="gap-2">
          {fields.length === 0 ? (
            <Text className="rounded-[10px] bg-white/5 px-3 py-2.5 text-[14px] text-white/42">
              No fields saved for this item.
            </Text>
          ) : (
            fields.map((field) => {
              const showValue = !field.secret || revealed[field.key];
              return (
                <View key={field.key} className="gap-2 rounded-[10px] bg-white/5 px-3 py-2.5">
                  <View className="flex-row items-center justify-between gap-3">
                    <Text className="text-[13px] text-white/38">{field.label}</Text>
                    <View className="flex-row items-center gap-2">
                      {field.secret ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}>
                          {showValue ? (
                            <EyeOff size={15} color="rgba(255,255,255,0.54)" />
                          ) : (
                            <Eye size={15} color="rgba(255,255,255,0.54)" />
                          )}
                        </Pressable>
                      ) : null}
                      <Pressable accessibilityRole="button" onPress={() => onCopy(field.label, field.value)}>
                        <Copy size={15} color="rgba(255,255,255,0.54)" />
                      </Pressable>
                    </View>
                  </View>
                  <Text selectable className="text-[14px] font-medium text-white/76">
                    {showValue ? field.value : "************"}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </View>
    </View>
  );
}
