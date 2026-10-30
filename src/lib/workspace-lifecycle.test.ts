import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { listWorkspaces, renameWorkspace, removeWorkspace, createWorkspace } from "./workspace-runtime";

test("workspace lifecycle rejects unsafe targets and preserves recovery data", async () => {
  const previous = process.cwd();
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-lifecycle-"));
  const id = randomUUID();
  const target = path.join(fixture, ".local/workspaces", id);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "workspace.json"), JSON.stringify({ id, name: "Studio", createdAt: new Date().toISOString(), setupComplete: true, state: "ready", webPort: 27996, syncPort: 27997, homeUrl: "http://localhost:3000" }));
  await fs.writeFile(path.join(target, "workspace.db"), "SYNTHETIC RECOVERY DATA");
  process.chdir(fixture);
  let unrelated: ReturnType<typeof spawn> | undefined;
  try {
    await assert.rejects(removeWorkspace("default", "Main workspace"), /cannot be removed/);
    await assert.rejects(removeWorkspace("../private", "Studio"), /Unknown workspace/);
    await assert.rejects(removeWorkspace(id, "studio"), /exact workspace name/);
    await renameWorkspace("default", "Home");
    await assert.rejects(renameWorkspace(id, "HOME"), /already exists/);
    await renameWorkspace(id, "  Studio   renamed  ");
    assert.equal((await listWorkspaces()).find(row => row.id === id)?.name, "Studio renamed");
    const linkId = randomUUID();
    await fs.symlink(target, path.join(fixture, ".local/workspaces", linkId));
    await assert.rejects(removeWorkspace(linkId, "Studio renamed"), /not safe/);
    await fs.unlink(path.join(fixture, ".local/workspaces", linkId));

    const lock = path.join(target, ".workspace-runtime.lock");
    await fs.mkdir(lock);
    await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }));
    await assert.rejects(removeWorkspace(id, "Studio renamed"), /identity could not be verified/);
    unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { unrelated!.once("spawn", resolve); unrelated!.once("error", reject); });
    await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: unrelated.pid }));
    await assert.rejects(removeWorkspace(id, "Studio renamed"), /identity changed/);
    assert.doesNotThrow(() => process.kill(unrelated!.pid!, 0));
    await fs.unlink(path.join(lock, "owner.json"));
    await fs.rmdir(lock);
    const result = await removeWorkspace(id, "Studio renamed");
    assert.equal(await fs.readFile(path.join(result.backupPath, "workspace.db"), "utf8"), "SYNTHETIC RECOVERY DATA");
    assert.equal((await listWorkspaces()).length, 1);
    assert.deepEqual(await removeWorkspace(id, "Studio renamed"), result);
    await assert.rejects(createWorkspace("Studio renamed", id, "http://localhost:3000"), /was removed/);
    await assert.rejects(removeWorkspace(id, "wrong"), /exact workspace name/);
  } finally {
    unrelated?.kill("SIGTERM");
    process.chdir(previous);
  }
});
