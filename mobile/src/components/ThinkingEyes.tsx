import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Ellipse, Line, Rect } from "react-native-svg";
import { colors } from "../theme/colors";

// Faithful RN port of the web's <ThinkingEyes/> (assistant-ui/thread.tsx):
// a line-art computer whose eyes look left/right and blink, with a pulsing
// loading line beneath. Same 160×120 viewBox + coordinates as the web SVG.
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedLine = Animated.createAnimatedComponent(Line);

export function ThinkingEyes({ size = 56, color = colors.textMuted }: { size?: number; color?: string }) {
  const look = useRef(new Animated.Value(0)).current; // eyes left/right (2s)
  const blink = useRef(new Animated.Value(0)).current; // eyelids (4s)
  const pulse = useRef(new Animated.Value(0)).current; // loading line (1.2s)

  useEffect(() => {
    const loops = [
      Animated.loop(Animated.timing(look, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false })),
      Animated.loop(Animated.timing(blink, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver: false })),
      Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: false })),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [look, blink, pulse]);

  // @keyframes aui-thinking-look: 0/100 → 0px, 25 → -3px, 75 → +3px
  const cxLeft = look.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [72, 69, 72, 75, 72] });
  const cxRight = look.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [88, 85, 88, 91, 88] });
  // @keyframes aui-thinking-blink: open until 92%, snap closed at 95%, reopen
  const ry = blink.interpolate({ inputRange: [0, 0.92, 0.95, 0.98, 1], outputRange: [3, 3, 0.3, 3, 3] });
  // @keyframes aui-thinking-pulse: opacity 0.4 → 1 → 0.4
  const lineOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.4] });

  const w = size;
  const h = (size * 120) / 160;

  return (
    <View accessibilityLabel="Agent is thinking">
      <Svg width={w} height={h} viewBox="0 0 160 120">
        <Rect x={50} y={25} width={60} height={45} rx={10} fill="none" stroke={color} strokeWidth={4} strokeLinejoin="round" />
        <AnimatedEllipse cx={cxLeft} cy={48} rx={3} ry={ry} fill={color} />
        <AnimatedEllipse cx={cxRight} cy={48} rx={3} ry={ry} fill={color} />
        <AnimatedLine x1={45} y1={85} x2={115} y2={85} stroke={color} strokeWidth={4} strokeLinecap="round" opacity={lineOpacity} />
      </Svg>
    </View>
  );
}
