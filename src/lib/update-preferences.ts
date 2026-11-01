import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireWorkerLock } from "../../sync/worker-lock";

export type UpdatePreferences = { autoUpdate: boolean; skippedRevision: string | null; attemptedRevision: string | null };
export const validUpdateRevision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
const defaults = (): UpdatePreferences => ({ autoUpdate: false, skippedRevision: null, attemptedRevision: null });

// Installation-local, never tracked or copied into a new workspace. Atomic
// replacement plus a cross-process lock keeps tabs/processes from losing edits.
export function updatePreferenceStore(root = process.cwd()) {
  const directory = path.join(root, ".local", "updates", "preferences");
  const file = path.join(directory, "settings.json");
  function read(): UpdatePreferences {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof data.autoUpdate !== "boolean" ||
          !(data.skippedRevision === null || validUpdateRevision(data.skippedRevision)) ||
          !(data.attemptedRevision === null || validUpdateRevision(data.attemptedRevision))) throw new Error("Invalid update preferences");
      return { autoUpdate: data.autoUpdate, skippedRevision: data.skippedRevision, attemptedRevision: data.attemptedRevision };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaults();
      throw new Error("Could not read update preferences. Automatic updates are paused.");
    }
  }
  function change(transform: (value: UpdatePreferences) => UpdatePreferences) {
    const lock = acquireWorkerLock(directory);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const value = transform(read());
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, file);
      return value;
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      finally { lock.release(); }
    }
  }
  return {
    read,
    patch(input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid update preference");
      const patch = input as Record<string, unknown>;
      if (!Object.keys(patch).length || Object.keys(patch).some(key => !["autoUpdate", "skippedRevision"].includes(key)) ||
          ("autoUpdate" in patch && typeof patch.autoUpdate !== "boolean") ||
          ("skippedRevision" in patch && patch.skippedRevision !== null && !validUpdateRevision(patch.skippedRevision))) throw new Error("Invalid update preference");
      return change(value => ({ ...value, ...patch } as UpdatePreferences));
    },
    claimAutomatic(revision: string) {
      if (!validUpdateRevision(revision)) throw new Error("Invalid update revision");
      return change(value => {
        if (!value.autoUpdate) throw new Error("Automatic updates were turned off. Nothing was installed.");
        if (value.skippedRevision === revision) throw new Error("This version was skipped. Nothing was installed.");
        if (value.attemptedRevision === revision) throw new Error("This version was already attempted automatically. Review it and use Update now to retry.");
        return { ...value, attemptedRevision: revision };
      });
    },
  };
}
