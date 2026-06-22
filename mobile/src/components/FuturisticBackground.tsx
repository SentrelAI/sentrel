import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect, RadialGradient, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

// Echoes the web landing hero: drifting indigo + cyan gradient blobs over a
// faint breathing dot grid on a near-black field. Pure RN Animated (native
// driver) so it stays smooth.
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CYAN = "#22D3EE";

function useDrift(durationMs: number, range: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: durationMs, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: durationMs, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, durationMs]);
  return {
    translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-range, range] }),
    translateY: v.interpolate({ inputRange: [0, 1], outputRange: [range, -range] }),
    scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.12] }),
    opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 0.8, 0.55] }),
  };
}

function Blob({ color, gradId, drift, style }: { color: string; gradId: string; drift: ReturnType<typeof useDrift>; style: any }) {
  const D = 460;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", width: D, height: D },
        style,
        { opacity: drift.opacity, transform: [{ translateX: drift.translateX }, { translateY: drift.translateY }, { scale: drift.scale }] },
      ]}
    >
      <Svg width={D} height={D}>
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={0.55} />
            <Stop offset="60%" stopColor={color} stopOpacity={0.12} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={D / 2} cy={D / 2} r={D / 2} fill={`url(#${gradId})`} />
      </Svg>
    </Animated.View>
  );
}

export function FuturisticBackground() {
  const a = useDrift(9000, 40);
  const b = useDrift(12000, 50);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} pointerEvents="none">
      {/* dot grid */}
      <Svg style={StyleSheet.absoluteFill} width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <Pattern id="dots" width={26} height={26} patternUnits="userSpaceOnUse">
            <Circle cx={1.2} cy={1.2} r={1.2} fill={colors.text} fillOpacity={0.05} />
          </Pattern>
        </Defs>
        <Rect width={SCREEN_W} height={SCREEN_H} fill="url(#dots)" />
      </Svg>
      <Blob color={colors.primary} gradId="g-indigo" drift={a} style={{ top: -120, left: -120 }} />
      <Blob color={CYAN} gradId="g-cyan" drift={b} style={{ bottom: -140, right: -120 }} />
    </View>
  );
}
