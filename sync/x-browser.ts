import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Stealth patches the automation fingerprints X looks for (navigator.webdriver,
// headless markers, plugin/WebGL inconsistencies, etc.).
puppeteerExtra.use(StealthPlugin());

export const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export default puppeteerExtra;
