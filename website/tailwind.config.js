const shared = require("../tailwind.config.js");
module.exports = { ...shared, content: ["./app/**/*.{ts,tsx}", "../src/components/**/*.{ts,tsx}"] };
