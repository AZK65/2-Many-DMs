import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export const ASSISTANT_MODEL = "openai/gpt-4.1-mini";

/** Separate from channel credentials. Never use the application's public dev key. */
export function assistantConfigStore(directory = path.join(process.cwd(), ".local", "assistant")) {
  const filename = (userId: string) => path.join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
  async function encryptionKey() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "encryption.key");
    try { await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const key = await readFile(file);
    if (key.length !== 32) throw new Error("AI storage key is invalid");
    return key;
  }
  return {
    async read(userId: string): Promise<string | null> {
      let contents: string;
      try { contents = await readFile(filename(userId), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
      const { iv, tag, ciphertext } = JSON.parse(contents);
      const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
    },
    async save(userId: string, apiKey: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
      const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
      const temp = `${filename(userId)}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), { flag: "wx", mode: 0o600 });
      await rename(temp, filename(userId));
    },
    async remove(userId: string) {
      try { await unlink(filename(userId)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}

export const assistantConfig = assistantConfigStore();
