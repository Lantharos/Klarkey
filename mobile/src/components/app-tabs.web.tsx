import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import React from 'react';

import { Pressable, Text, View } from '@/tw';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="vault" href="/" asChild>
            <TabButton>Vault</TabButton>
          </TabTrigger>
          <TabTrigger name="autofill" href="/autofill" asChild>
            <TabButton>Autofill</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Settings</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable
      {...props}
      className={`rounded-[9px] px-3 py-2 ${isFocused ? 'bg-white/10' : 'bg-transparent'}`}>
      <Text className={`text-[13px] font-medium ${isFocused ? 'text-white' : 'text-white/46'}`}>{children}</Text>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} className="absolute w-full flex-row items-center justify-center px-3 py-3">
      <View className="w-full max-w-[760px] flex-row items-center gap-2 rounded-[13px] bg-[#202021] px-3 py-2">
        <Text className="mr-auto text-[14px] font-semibold text-white">Klarkey</Text>
        {props.children}
      </View>
    </View>
  );
}
