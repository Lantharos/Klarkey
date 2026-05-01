import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor="#1a1a1b"
      iconColor="rgba(255,255,255,0.44)"
      tintColor="#ffffff"
      indicatorColor="rgba(255,255,255,0.1)"
      labelStyle={{ selected: { color: '#ffffff' }, default: { color: 'rgba(255,255,255,0.46)' } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Vault</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="lock.shield" md="encrypted" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="autofill">
        <NativeTabs.Trigger.Label>Autofill</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="rectangle.and.pencil.and.ellipsis" md="password" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
