import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { MobileVaultProvider } from '@/lib/vault-context';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <MobileVaultProvider>
        <StatusBar style="light" />
        <AppTabs />
      </MobileVaultProvider>
    </ThemeProvider>
  );
}
