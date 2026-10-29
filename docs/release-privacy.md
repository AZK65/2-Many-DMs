# Release privacy

The public product previews are fictional. They are rendered from the static marketing
demo, not from a connected inbox. Never replace them with screenshots of a live account.
Keep the public repository URL and license attribution; do not include a maintainer's
personal messaging handle, private email address, or workstation path.

Before publishing:

1. Run `npm run privacy:test` and `npm run privacy:check`.
2. Run `node scripts/check-release-privacy.mjs --history` against all release branches and tags.
3. Review images visually. Automated text scanning cannot prove that an image is safe.
4. Check staged files and release assets. Never upload databases, exports, media caches,
   browser profiles, local backups, `.env` files, or session directories.
5. Use a GitHub no-reply address for Git authorship. Avoid personal details in commit messages.

The checks report only file locations and rule names, never matching credential values.
They are a preventive check, not a guarantee that every possible secret format is detected.
Ignoring a path does not purge earlier commits. History cleanup requires coordination with
collaborators and affects existing clones, tags, and commit links. Keep any pre-cleanup backup
private and outside the repository; never push it as a backup branch or tag.

If a credential was ever shared, revoke it at the provider even after removing it from Git.
Deleting history cannot invalidate a session or erase another person's existing clone.

## Recreate the fictional previews

Run a separate local test server from a clean checkout, without a worker or connected accounts:

```sh
OMNI_NEXT_DIST_DIR=.next-preview npm run dev -- --hostname 127.0.0.1 --port 3003
```

Then run `npm run docs:preview`. The capture script only allows `/landing` and
static assets on that local origin; account APIs and external requests are blocked. Review
the generated `docs/*.png` files before committing. No account credentials are needed.
