import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0B0E11",
        surface: "#151A21",
        "surface-elevated": "#1C222B",
        primary: "#F5F96A",
        secondary: "#3DDC97",
        "text-primary": "#FFFFFF",
        "text-secondary": "#9AA4B2",
        border: "#242B36",
        muted: "#6B7280",
      },
      fontFamily: {
        sans: ["var(--font-plus-jakarta-sans)", "Inter", "sans-serif"],
      },
      borderRadius: {
        card: "20px",
        panel: "16px",
      },
      backgroundImage: {
        "glass-gradient": "linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
