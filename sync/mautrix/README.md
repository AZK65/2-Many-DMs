# X Chat connector (beta)

This optional connector uses the `twittermeow` and `juiceboxgo` libraries from
mautrix-twitter at commit `0528b9d44f96e1a0fe1561dbc7666ce3898f5397`.
It does not require a Matrix homeserver. The existing browser connector remains
the default until the connector is explicitly enabled.

The Go bridge and modifications to it are licensed under AGPL-3.0-or-later,
consistent with the upstream dependency. See `LICENSE` and the upstream project:
https://github.com/mautrix/twitter. The rest of the app retains its existing license;
this optional Go bridge is distributed with its source and separate license.

The child process communicates through private stdin/stdout pipes, not a network
port. Cookies and a user-entered PIN are passed through those pipes. Decryption
keys remain memory-only. Users can opt into Remember PIN on this Mac in the X
connection dialog; the worker then stores only a verified PIN in the local macOS
login Keychain, scoped to this workspace, account and signed-in session. It is
not written to the database, browser storage, logs or app files, and does not sync
through iCloud. Other platforms have no plaintext storage fallback.

The Keychain helper reads/writes through private pipes. It disarms automatic
unlock before releasing a PIN and rearms it only after the inbox opens; rejected,
uncertain or interrupted attempts stay paused across worker restarts. Forget PIN
removes the Keychain item without closing the currently unlocked connection.
The helper builds once with the installed macOS Swift compiler into ignored
`.local/bin/`. Missing compiler or inaccessible Keychain leaves manual unlock
available. No automatic PIN guessing or repeated failed attempts are performed.

## Enable the connector

Install Go 1.26 or newer (the pinned module uses the Go 1.27.4 toolchain), then run `node scripts/build-x-mautrix.mjs` from the repository
root (`GO_BINARY` can point to a particular Go installation). The module and
checksums pin the upstream version. The generated binary stays in ignored
`.local/bin/`; no user data or executable is included in a source release.

For all saved X browser accounts, set `X_CONNECTOR=mautrix` in your local `.env`.
API accounts are unaffected. Use `X_CONNECTOR=browser` to force the existing
browser connector. Restart the sync worker after changing this environment setting.

Alternatively, enable only a chosen existing X account by creating the ignored file
`.local/x-mautrix-pilot.json` with `{"accounts":["existing-account-id"]}`.
Reload the sync worker and enter the PIN in Connections → X. This uses the
same account and cookies; it does not create another connected account.
Remove that account from the file and reload to return to the browser.

The connector supports encrypted text receiving/sending and encrypted attachment
downloads. History has its own resumable cursor and bounded worker. Recent
windows take priority, and neither sends nor live socket events wait for an
older-history request. Opening a chat does not reset its deep-history cursor.

Unsupported outbound attachments, mentions, replies and explicit edit/delete
operations switch to the saved browser **before** attempting the operation.
Only one connector runs at a time. An unconfirmed send is never replayed:
the CRM retains its existing “delivery unknown” review flow. Browser fallback
can still require its own Chat PIN if that saved browser is locked.

This beta does not yet provide complete feature parity: incoming reactions,
remote edits/deletions, multi-attachment messages beyond the first attachment,
and legacy non-encrypted media need follow-up before a general release.
Text sending/receiving during restoration and browser fallback have been tested.
Keep the browser default when you need the features listed above. Older history
is paced more slowly than recent messages. Rate limits increase the cooldown
and persist across restarts; retry times are estimates, not reset times promised
by X. Unofficial connectors remain subject to X's service changes and limits.

Checks: `node --import tsx --test sync/x-mautrix.test.ts`,
`go test -race ./...` in this directory, and the repository TypeScript check.
