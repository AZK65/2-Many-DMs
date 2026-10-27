/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        slate: require("tailwindcss/colors").zinc,
        neutral: { 700: "#313131", 800: "#272727", 900: "#181818", 950: "#000000" },
        // Themeable accent — driven by --accent-rgb (set per light/dark in
        // globals.css, overridable from Settings). <alpha-value> lets /opacity
        // modifiers (bg-accent/15 etc.) work.
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg-rgb) / <alpha-value>)",
        platform: {
          x: "#0f1419",
          whatsapp: "#25d366",
          telegram: "#229ed9",
          discord: "#5865f2",
        },
      },
    },
  },
  plugins: [],
};
