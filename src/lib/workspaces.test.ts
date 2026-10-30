import test from "node:test";
import assert from "node:assert/strict";
import { workspaceName, workspaceIdValid } from "./workspace-types";
import { cleanWorkspaceEnvironment } from "./workspace-runtime";

test("workspace names are meaningful, bounded and normalized", () => {
  assert.equal(workspaceName("  Studio   inbox  "), "Studio inbox");
  for (const name of ["", "   ", "x".repeat(49), "a\u0000b", null, {}]) assert.throws(() => workspaceName(name));
});
test("workspace paths accept only generated UUIDs", () => {
  assert.equal(workspaceIdValid("3b30be8b-0444-40e0-827a-6f6a86b95e24"), true);
  for (const id of ["default", "../private", "/etc", "a/b", "abc", null]) assert.equal(workspaceIdValid(id), false);
});
test("fresh runtime does not inherit parent credentials, session variables or module hooks", () => {
  const clean = cleanWorkspaceEnvironment({ NODE_ENV: "development", PATH: "/usr/bin", HOME: "/tmp/home", TELEGRAM_SESSION: "private", APP_ENCRYPTION_KEY: "private", X_AUTH_TOKEN: "private", OPENROUTER_API_KEY: "private", DATABASE_URL: "parent.db", SYNC_CONTROL_URL: "parent-worker", NODE_OPTIONS: "--import parent-env", NODE_PATH: "/parent/node_modules", DOTENV_CONFIG_PATH: "/parent/.env" });
  assert.deepEqual(clean, { NODE_ENV: "production", PATH: "/usr/bin", HOME: "/tmp/home" });
});
