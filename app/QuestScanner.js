// A Pokémon-GO-ish "scanning your area…" loading animation, shown while a quest
// is being generated. Pure Animated API (no reanimated / gesture-handler), so
// it's rock-solid in Expo Go SDK 54. Three concentric rings pulse outward from a
// central radar dot while a sweeping status line rotates through "scanning"
// copy. Everything cleans up on unmount (loops stopped, interval cleared) so it
// never leaks if the screen changes mid-generation.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

// Warm palette, matched to App.js (CREAM / INK / ACCENT / GREEN).
const CREAM = "#f4f1ea";
const INK = "#2b2622";
const ACCENT = "#b5562e";
const GREEN = "#4a7c59";

const STATUS_LINES = [
  "Scanning your neighborhood…",
  "Finding hidden gems…",
  "Reading local lore…",
  "Plotting your route…",
  "Almost ready…",
];

// One expanding/fading ring. `delay` staggers the three rings so they ripple
// outward like radar. The loop is started on mount and stopped on unmount.
function Ring({ delay, size }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const opacity = anim.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] });

  return (
    <Animated.View
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, opacity, transform: [{ scale }] },
      ]}
    />
  );
}

export default function QuestScanner() {
  // Central radar dot: a gentle continuous pulse.
  const pulse = useRef(new Animated.Value(0)).current;
  // Status line cross-fade as the copy rotates.
  const lineFade = useRef(new Animated.Value(1)).current;
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulse]);

  // Rotate the status line every ~2.2s with a quick fade-out/in.
  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(lineFade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setLineIndex((i) => (i + 1) % STATUS_LINES.length);
        Animated.timing(lineFade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, 2200);
    return () => clearInterval(id);
  }, [lineFade]);

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });

  return (
    <View style={styles.wrap}>
      <View style={styles.radar}>
        <Ring delay={0} size={220} />
        <Ring delay={600} size={220} />
        <Ring delay={1200} size={220} />
        <Animated.View style={[styles.dot, { transform: [{ scale: dotScale }] }]}>
          <Text style={styles.dotMark}>📍</Text>
        </Animated.View>
      </View>
      <Text style={styles.title}>Building your quest</Text>
      <Animated.Text style={[styles.status, { opacity: lineFade }]}>
        {STATUS_LINES[lineIndex]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: CREAM, alignItems: "center", justifyContent: "center", padding: 28 },
  radar: { width: 240, height: 240, alignItems: "center", justifyContent: "center", marginBottom: 36 },
  ring: {
    position: "absolute",
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: "rgba(181,86,46,0.06)",
  },
  dot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: GREEN,
    shadowColor: INK,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  dotMark: { fontSize: 28 },
  title: { fontSize: 22, fontWeight: "800", color: INK, letterSpacing: -0.3 },
  status: { fontSize: 15, color: ACCENT, fontWeight: "700", marginTop: 10, textAlign: "center" },
});
