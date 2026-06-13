/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        platform: {
          x: "#0f1419",
          whatsapp: "#25d366",
          telegram: "#229ed9",
        },
      },
    },
  },
  plugins: [],
};
