// CameraCatch — the "catch the collectible with your camera" moment (a
// Pokémon-GO-lite AR step). It is the COLLECT step of a find: after a target is
// found and its name is revealed, the user opens this view to "catch" the
// virtual item that lives "in that place."
//
// Geo-gating is STRUCTURAL, enforced by the caller: this component is only ever
// mounted from inside App.js's find-reveal overlay, which only renders once a
// find has triggered (GPS within the find radius, "I found it!", or the manual
// reveal escape). There is no other entry point, so the catch is reachable ONLY
// at the solved place.
//
// Flow:
//   • Live camera preview (expo-camera CameraView) fills the screen.
//   • The virtual item (emoji) floats over the feed as a large sprite that bobs
//     up/down and pulses a glow — a pure Animated loop (no reanimated /
//     gesture-handler), so it's Expo-Go / SDK 54 safe.
//   • Tapping the floating sprite "catches" it: it scales up then shrinks into
//     nothing (toward the collection), a success haptic fires, a little confetti
//     bursts, then onCatch() runs (the caller collects + advances).
//
// Graceful fallbacks — NEVER trap the user:
//   • If expo-camera is unavailable (e.g. the native module isn't in the build,
//     or a simulator with no camera), CameraView is undefined → we show a
//     no-camera fallback that just collects.
//   • If camera permission is denied, we show a denied fallback that just
//     collects.
//   • A persistent "Skip camera — just collect" affordance is always present, on
//     every screen, so nobody is forced through the camera.
//   • Every path calls onCatch() (collect + advance) or onCancel() — there is no
//     dead end.
import { Component, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";

// expo-camera is a NEW native dependency (added to package.json). It will not be
// present in the JS-only Expo Go runtime or in an old native build until a FRESH
// NATIVE BUILD is made. We therefore import it defensively: if the module or its
// CameraView export is missing, `CameraView`/`useCameraPermissions` stay
// null/undefined and we degrade to the plain-collect fallback instead of
// crashing the whole find flow.
let CameraView = null;
let useCameraPermissions = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cam = require("expo-camera");
  CameraView = cam.CameraView || null;
  useCameraPermissions = cam.useCameraPermissions || null;
} catch {
  CameraView = null;
  useCameraPermissions = null;
}

// Error boundary for the LIVE camera render. The import guard above only catches
// the case where expo-camera's JS is missing. But the failure the spec names —
// "expo-camera unavailable (e.g. simulator)" / needs a fresh native build — is a
// RENDER-TIME one: after `npx expo install`, the JS is in node_modules (so
// require succeeds and CameraView is defined), yet the NATIVE module isn't in the
// app binary until a fresh native build. Mounting <CameraView> then throws at
// render, which a try/catch around require can't catch. This boundary converts
// that crash into the graceful plain-collect fallback so the user is never
// trapped (and never crashes). State resets naturally because CameraCatch
// unmounts when the catch overlay closes and remounts on the next find.
class CameraErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Pokémon-GO palette, mirrored from App.js (its palette constants are
// module-local). Keep these in sync with App.js.
const CREAM = "#EAF4FB";
const INK = "#10243B";
const ACCENT = "#1F6FB2";
const AMBER = "#F5B400";

const CONFETTI_COLORS = ["#1F6FB2", "#3FAE4E", "#F5B400", "#3B82C4", "#7BD389"];

// A small confetti burst, self-contained so this component carries no new dep
// and no coupling to App.js's (module-local) Confetti. Particles fly outward
// from the catch point, spin, and fade. Plays once when `go` flips true.
function CatchConfetti({ go }) {
  const pieces = useRef(
    Array.from({ length: 18 }).map((_, i) => ({
      key: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      angle: (i / 18) * Math.PI * 2,
      dist: 90 + Math.random() * 120,
      size: 8 + Math.random() * 8,
      spins: 1 + Math.random() * 2,
      duration: 700 + Math.random() * 500,
      anim: new Animated.Value(0),
    }))
  ).current;
  useEffect(() => {
    if (!go) return;
    Animated.parallel(
      pieces.map((p) =>
        Animated.timing(p.anim, { toValue: 1, duration: p.duration, useNativeDriver: true })
      )
    ).start();
  }, [go, pieces]);
  if (!go) return null;
  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {pieces.map((p) => {
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.dist] });
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.angle) * p.dist] });
        const rotate = p.anim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spins * 360}deg`] });
        const opacity = p.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={p.key}
            style={{
              position: "absolute",
              width: p.size,
              height: p.size,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateX }, { translateY }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}

// The floating, bobbing, glowing item sprite + tap-to-catch. On tap it plays a
// scale-up-then-shrink "catch" and then fires onCaught() once the animation ends.
function FloatingItem({ item, onCaught }) {
  const bob = useRef(new Animated.Value(0)).current; // continuous up/down float
  const glow = useRef(new Animated.Value(0)).current; // pulsing glow ring
  const catchAnim = useRef(new Animated.Value(0)).current; // 0 idle → 1 caught (shrink)
  const [caught, setCaught] = useState(false);

  useEffect(() => {
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    bobLoop.start();
    glowLoop.start();
    return () => {
      bobLoop.stop();
      glowLoop.stop();
    };
  }, [bob, glow]);

  function handleCatch() {
    if (caught) return;
    setCaught(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Catch animation: pop bigger, then shrink/fade "into the collection."
    Animated.timing(catchAnim, { toValue: 1, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) onCaught();
      }
    );
  }

  const bobY = bob.interpolate({ inputRange: [0, 1], outputRange: [10, -10] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  // Caught: scale 1 → 1.5 → 0 (pop then shrink into the collection), fade at end.
  const catchScale = catchAnim.interpolate({ inputRange: [0, 0.35, 1], outputRange: [1, 1.5, 0] });
  const catchOpacity = catchAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });

  return (
    <View style={styles.spriteWrap} pointerEvents="box-none">
      <CatchConfetti go={caught} />
      <Animated.View style={{ transform: [{ translateY: caught ? 0 : bobY }] }}>
        <TouchableOpacity activeOpacity={0.85} onPress={handleCatch} disabled={caught}>
          <Animated.View style={[styles.glowRing, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
          <Animated.Text style={[styles.sprite, { opacity: catchOpacity, transform: [{ scale: catchScale }] }]}>
            {item}
          </Animated.Text>
        </TouchableOpacity>
      </Animated.View>
      {!caught ? <Text style={styles.tapHint}>Tap to catch!</Text> : null}
    </View>
  );
}

// Shared chrome for any fallback (no-camera / denied): an explanatory line plus
// the two never-trap actions (collect now, or skip). Both end the step.
function Fallback({ item, message, onCatch, onCancel }) {
  return (
    <View style={styles.fallbackScreen}>
      <Text style={styles.fallbackEmoji}>{item}</Text>
      <Text style={styles.fallbackMsg}>{message}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onCatch} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Collect {item}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.skipBtnDark} onPress={onCancel} activeOpacity={0.7}>
        <Text style={styles.skipTextDark}>Skip camera, just collect</Text>
      </TouchableOpacity>
    </View>
  );
}

// Props:
//   item     — the emoji/string to render as the collectible sprite
//   itemName — the place/item label for copy (optional)
//   onCatch  — called when the item is caught (camera) OR the user picks "collect"
//              in a fallback. The CALLER does the durable collect + advance.
//   onCancel — called when the user chooses "skip camera, just collect." The
//              caller treats this identically (collect + advance) — it exists so
//              the user is never forced through the camera. Either way the find
//              completes; there is no dead end.
export default function CameraCatch({ item, itemName, onCatch, onCancel }) {
  // The permission hook is only callable when expo-camera is present. We must not
  // conditionally call hooks, so when the module is missing we render the
  // no-camera fallback in a child that calls NO hooks (this component returns
  // before the hook path). Pattern: branch on module availability FIRST.
  if (!CameraView || !useCameraPermissions) {
    return (
      <View style={styles.root}>
        <Fallback
          item={item}
          message="Camera isn't available here — but your collectible is still yours."
          onCatch={onCatch}
          onCancel={onCancel}
        />
      </View>
    );
  }
  return <CameraCatchLive item={item} itemName={itemName} onCatch={onCatch} onCancel={onCancel} />;
}

// The live path — only mounted when expo-camera is present, so calling the
// permission hook here is safe (no conditional-hook violation).
function CameraCatchLive({ item, itemName, onCatch, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);

  // Ask once on mount if we haven't been granted/denied yet.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !asked) {
      setAsked(true);
      requestPermission().catch(() => {});
    }
  }, [permission, asked, requestPermission]);

  // Still resolving permission status — brief neutral screen with the skip escape
  // always available so we never trap even during the request.
  if (!permission) {
    return (
      <View style={styles.root}>
        <View style={styles.fallbackScreen}>
          <Text style={styles.fallbackMsg}>Opening camera…</Text>
          <TouchableOpacity style={styles.skipBtnDark} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.skipTextDark}>Skip camera, just collect</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Permission denied — fall back to plain collect (no trap).
  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <Fallback
          item={item}
          message="No camera access — no problem. Your collectible is waiting."
          onCatch={onCatch}
          onCancel={onCancel}
        />
      </View>
    );
  }

  // Granted: live camera + floating catchable sprite. Wrapped in an error
  // boundary so a missing native camera module (no fresh build yet) degrades to
  // the plain-collect fallback instead of crashing.
  return (
    <CameraErrorBoundary
      fallback={
        <View style={styles.root}>
          <Fallback
            item={item}
            message="Camera couldn't start here — but your collectible is still yours."
            onCatch={onCatch}
            onCancel={onCancel}
          />
        </View>
      }
    >
      <View style={styles.root}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
        {/* Dim scrim so the white catch copy reads over any camera feed. */}
        <View style={styles.scrim} pointerEvents="none" />

        <View style={styles.header} pointerEvents="box-none">
          <Text style={styles.headerTitle}>Catch your {itemName || "collectible"}!</Text>
          <Text style={styles.headerSub}>It's right here — tap it to catch it.</Text>
        </View>

        <FloatingItem item={item} onCaught={onCatch} />

        {/* Always-present skip — never force the user through the camera. */}
        <View style={styles.footer} pointerEvents="box-none">
          <TouchableOpacity style={styles.skipBtn} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.skipText}>Skip camera, just collect</Text>
          </TouchableOpacity>
        </View>
      </View>
    </CameraErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === "ios" ? 64 : 40,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 24, fontWeight: "800", textAlign: "center", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  headerSub: { color: "#fff", fontSize: 14, fontWeight: "600", marginTop: 6, opacity: 0.92, textAlign: "center", textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 },
  // The sprite sits in the middle of the screen; box-none lets camera show through.
  spriteWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  sprite: { fontSize: 96, textAlign: "center" },
  glowRing: {
    position: "absolute",
    alignSelf: "center",
    top: -10,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: AMBER,
  },
  tapHint: {
    marginTop: 16,
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 6,
  },
  confettiLayer: { position: "absolute", alignSelf: "center", top: "50%", width: 1, height: 1 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: 40, alignItems: "center" },
  // Fallback (no-camera / denied) screen chrome — PoGo palette.
  fallbackScreen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: CREAM, paddingHorizontal: 32 },
  fallbackEmoji: { fontSize: 88, marginBottom: 18 },
  fallbackMsg: { color: INK, fontSize: 17, fontWeight: "700", textAlign: "center", marginBottom: 28 },
  primaryBtn: { backgroundColor: ACCENT, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 28, marginBottom: 16 },
  primaryBtnText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  skipBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.16)" },
  skipText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  // Dark-text skip variant for the cream fallback screens.
  skipBtnDark: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 22 },
  skipTextDark: { color: INK, fontSize: 14, fontWeight: "700", opacity: 0.75 },
});
