import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

export default function App() {
  const [count, setCount] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [bgIdx, setBgIdx] = useState(0);

  const palettes = ["#0b0b0f", "#1e1b4b", "#831843", "#064e3b", "#7c2d12"];
  const isLight = theme === "light";
  const bg = isLight ? "#f3f4f6" : palettes[bgIdx % palettes.length];
  const fg = isLight ? "#111827" : "#ffffff";
  const muted = isLight ? "#6b7280" : "#9ca3af";
  const accent = "#a78bfa";

  return (
    <View style={[styles.container, { backgroundColor: bg }]} data-oid="root">
      <Image
        source={{ uri: "https://onlook.com/favicon.ico" }}
        style={styles.logo}
        accessibilityLabel="Onlook logo"
        data-oid="logo"
      />
      <Text style={[styles.title, { color: fg }]} data-oid="title">
        Onlook Sample App
      </Text>
      <Text style={[styles.body, { color: muted }]} data-oid="subtitle">
        Edit App.tsx and save — the preview should hot-reload.
      </Text>

      <View style={styles.counterRow} data-oid="counter-row">
        <Text style={[styles.counter, { color: accent }]} data-oid="count">
          {count}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setCount((c) => c + 1)}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: accent, opacity: pressed ? 0.7 : 1 },
        ]}
        data-oid="btn-inc"
      >
        <Text style={styles.btnText}>Increment</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => setCount(0)}
        style={({ pressed }) => [
          styles.buttonOutline,
          { borderColor: accent, opacity: pressed ? 0.7 : 1 },
        ]}
        data-oid="btn-reset"
      >
        <Text style={[styles.btnText, { color: accent }]}>Reset</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => setTheme(isLight ? "dark" : "light")}
        style={({ pressed }) => [
          styles.buttonOutline,
          { borderColor: muted, opacity: pressed ? 0.7 : 1 },
        ]}
        data-oid="btn-theme"
      >
        <Text style={[styles.btnText, { color: muted }]}>
          {isLight ? "Dark mode" : "Light mode"}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => setBgIdx((i) => i + 1)}
        style={({ pressed }) => [
          styles.buttonOutline,
          { borderColor: muted, opacity: pressed ? 0.7 : 1 },
        ]}
        data-oid="btn-cycle"
      >
        <Text style={[styles.btnText, { color: muted }]}>Cycle background</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logo: { width: 48, height: 48, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 8 },
  body: { fontSize: 14, marginBottom: 24, textAlign: "center" },
  counterRow: { marginBottom: 16 },
  counter: { fontSize: 56, fontWeight: "800" },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  buttonOutline: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  btnText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
});
