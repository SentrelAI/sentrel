import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

const CYAN = "#22D3EE";

function Ring({ delay, color }: { delay: number; color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 2000, delay, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 128,
        height: 128,
        borderRadius: 64,
        borderWidth: 2,
        borderColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.6] }) }],
      }}
    />
  );
}

// Mirrors the web onboarding "analyzing" orb: a glowing indigo→cyan core with
// expanding halo rings. Used as the onboarding hero / loading state.
export function PulsingOrb({ size = 128 }: { size?: number }) {
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const core = 64;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Ring delay={0} color={CYAN} />
      <Ring delay={400} color={colors.primary} />
      <Animated.View
        style={{
          shadowColor: colors.primary,
          shadowOpacity: 0.8,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: 0 },
          transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] }) }],
        }}
      >
        <Svg width={core} height={core}>
          <Defs>
            <LinearGradient id="orb" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={colors.primary} />
              <Stop offset="100%" stopColor={CYAN} />
            </LinearGradient>
          </Defs>
          <Circle cx={core / 2} cy={core / 2} r={core / 2} fill="url(#orb)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
