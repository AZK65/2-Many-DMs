import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { XAvatarSources } from "./x-avatar-sources";

test("X retains exact observed photo URLs across restarts without adding arbitrary URLs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-x-avatars-"));
  try {
    const file = path.join(dir, "sources.json");
    const sources = new XAvatarSources(file);
    sources.remember([{ id: "123", avatar: "https://pbs.twimg.com/profile_images/one.jpg" },
      { id: "456", avatar: "http://127.0.0.1/private" }]);
    const resumed = new XAvatarSources(file);
    assert.equal(resumed.get("123"), "https://pbs.twimg.com/profile_images/one.jpg");
    assert.equal(resumed.get("456"), undefined);
    resumed.remember([{ id: "789", avatar: "https://pbs.twimg.com/profile_images/two.jpg" }]);
    assert.equal(new XAvatarSources(file).get("123"), sources.get("123"));
    assert.equal(new XAvatarSources(path.join(dir, "other-account.json")).get("123"), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
