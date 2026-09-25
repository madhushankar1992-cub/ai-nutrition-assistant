import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0D110F",
        surface: {
          DEFAULT: "#161B18",
          dim: "#0A0D0B",
          card: "#121613",
        },
        ink: {
          DEFAULT: "#EDF1EA",
          muted: "#8B958C",
          faint: "#6B756D",
        },
        accent: {
          DEFAULT: "#C8FF4D",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex)", "system-ui", "sans-serif"],
        display: ["var(--font-grotesk)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
