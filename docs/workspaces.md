# Local workspaces

Open the product menu in the top left to create or switch workspaces. Each new workspace has its own database, accounts, encryption key, files and settings. Sign in to the platforms again during setup. Workspaces are local storage separation, not separate OS users or a multi-user security boundary.

## Rename

Choose the three dots next to a workspace, enter its new name, then **Save name**. Names must be unique and no longer than 48 characters. Renaming does not change its files, sessions, accounts or chat history.

## Remove

Switch to the main workspace first if you are using the workspace you want to remove. Open its three-dot menu, choose **Remove workspace**, and type its exact name. The main workspace cannot be removed.

Removal stops only that workspace's services and moves its complete directory to `.local/removed-workspaces/<workspace-id>` inside the installation. The success message shows the exact backup location. The directory is not erased; it retains chats, media, encryption keys and sign-ins for manual recovery. Keep it private. Native platform accounts and messages are not deleted or logged out.

If the runtime cannot be safely identified or stopped, removal fails without moving data. Retry once the service has stopped. Repeating a successful removal is safe. A removed workspace ID cannot be reused by a stale create request.

## Manual recovery

With this installation and all of its workspace services stopped, move the specific backup directory back to its original `.local/workspaces/<workspace-id>` location. Do not overwrite an existing directory. Check `workspace.json` for web/sync ports and a duplicate name before starting; ports may have been reused by a newer workspace. If ports change, update the corresponding values in both `workspace.json` and `.env`. Keep the original database path, encryption key, and workspace ID together. Start the main installation, then open the workspace from its menu. Do not run services directly from the backup directory.

## Verification

Run `node --import tsx --test src/lib/workspaces.test.ts src/lib/workspace-lifecycle.test.ts` for validation and removal safety checks. After a production build, run `node --import tsx scripts/verify-workspaces.mjs` for disposable runtime and browser checks. Set `OMNI_NEXT_DIST_DIR` to the build directory if it is not `.next`. The integration check uses local port 3012 and creates only synthetic accounts and data.
