import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d12",
        panel: "#12151c",
        border: "#232732",
        up: "#22c55e",
        down: "#ef4444",
        accent: "#3b82f6",
      },
    },
  },
  plugins: [],
};

export default config;
