import { Stack } from "expo-router";

export default function AppTabs() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#1a1a1b" },
      }}
    />
  );
}
