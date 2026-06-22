// Sentrel dark palette. The control plane UI is dark with an indigo accent;
// the mobile app mirrors it so the two feel like one product.
export const colors = {
  bg: "#0B0B0F",
  surface: "#15151C",
  surfaceAlt: "#1C1C26",
  border: "#2A2A36",
  text: "#F5F5F7",
  textMuted: "#9A9AA8",
  textFaint: "#6B6B78",
  primary: "#6366F1",
  primaryText: "#FFFFFF",
  success: "#34D399",
  warning: "#FBBF24",
  danger: "#F87171",
  // status dot colors per agent.status
  status: {
    running: "#34D399",
    starting: "#FBBF24",
    pending: "#9A9AA8",
    paused: "#FBBF24",
    stopped: "#F87171",
  } as Record<string, string>,
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const space = (n: number) => n * 4;
