import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decrypt } from "../src/lib/crypto";

const PREFIX = "discord-search:v1:";
const directory = () => path.join(process.env.DATA_DIR || process.cwd(), ".local", "discord-search");
function key(root: string, create: boolean) {
  const file = path.join(root, "session-key");
  if (create) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const value = fs.readFileSync(file);
  if (value.length !== 32) throw new Error("Discord search encryption key is invalid. Reconnect after restoring the local key.");
  return value;
}
export function encryptDiscordSearchSession(value: string, root = directory()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(root, true), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
}
export function decryptDiscordSearchSession(value: string, root = directory()) {
  if (!value.startsWith(PREFIX)) return decrypt(value);
  const [iv, tag, ciphertext] = value.slice(PREFIX.length).split(".").map(part => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(root, false), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
