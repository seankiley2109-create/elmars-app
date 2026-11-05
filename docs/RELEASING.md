# Releasing a fix to Elmar

Once Elmar's App is installed on his Mac ([INSTALL-DAY.md](INSTALL-DAY.md)), every fix reaches him inside the app.
You never touch his Mac again.

## First release (once, before install day)

The repo starts at version 0.1.0 with no release yet. Publish that version as it is:

```
npm run release -- --current
git push --atomic origin main --follow-tags
```

`--current` tags the version already in the files (`v0.1.0`) without changing or committing anything. It runs the
same checks as a normal release (below). By hand it is `git tag -a v0.1.0 -m "Elmar's App v0.1.0"` then the same push.
When the workflow finishes, the release page has the `.dmg` for install day. From then on, use the steps below.

## The steps

1. **Make the fix** on `main` and commit it. `npm test` passes.
2. **Release it:**

   ```
   npm run release -- 0.1.1
   ```

   First it checks that it's safe. You're on `main` with nothing uncommitted. It fetches from GitHub, and `main` isn't
   behind GitHub's. The new version is newer than the current one. `v0.1.1` doesn't exist yet, here or on GitHub. If any
   of that fails, it stops and says why.

   Then it sets the version in `apps/web/src-tauri/tauri.conf.json`, `apps/web/package.json`, `package-lock.json`,
   `Cargo.toml` and `Cargo.lock`, commits `release: v0.1.1` and tags `v0.1.1`. It pushes nothing. It prints the next
   command.

3. **Push it:**

   ```
   git push --atomic origin main --follow-tags
   ```

   `--atomic` sends `main` and the tag together, or neither, so GitHub never gets a tag without its commit.

4. **GitHub builds and publishes it** (about 15 minutes; watch the Actions tab). The "Build Mac app" workflow stops at
   once if the tag and the version files disagree, runs the tests, builds the universal app, and publishes the release
   **Elmar's App v0.1.1** with the `.dmg`, the signed update and `latest.json`.
5. **Elmar's app offers it** within 6 hours: *"A new version of Elmar's App is ready."* with **Update and restart**. He
   can also open **Settings → Check for updates** to get it straight away. The app saves his work before it installs
   and restarts.

Made a mistake? Undo an unpushed release with `git tag -d v0.1.1` and `git reset --hard HEAD~1`. Once a release is
published, fix forward with the next number. Never reuse a version.

The release text shown next to the version in the app is the first line of `releaseBody` in
`.github/workflows/build-mac.yml` ("Fixes and small improvements."). To say something specific, change that line before
you release. (Editing the release on GitHub afterwards doesn't change it: the app reads the notes from `latest.json`,
written when the release is published.)

"Run workflow" on the Actions tab is still a test build: it keeps the `.dmg` as an artifact and publishes nothing.

## The update key: back it up

Updates are signed with a key that only you have:

- `~/.tauri/elmars-app-updater.key` and the file holding its password, next to it in `~/.tauri/`.
- The same key and password are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

**Back both files up** somewhere safe (a password manager, an encrypted drive). Never commit them. If the key is lost,
the copy on Elmar's Mac can't verify any new update. You'd make a new key, and he'd need one manual reinstall from the
`.dmg` (with "Open Anyway" once more).

The public half is `plugins.updater.pubkey` in `tauri.conf.json`. It's safe in the repo.

## What to expect without an Apple Developer account

- The app is ad-hoc signed, not Apple-signed. After an update, macOS **may ask once more** to let the app use the notes
  folder. That's one **Allow** click.
- The first install needs **"Open Anyway"**. Updates through the app don't.
- An Apple Developer account ($99 a year) would remove both. Only the build settings would change (signing identity and
  notarization secrets in the workflow), not the app.

## Where the pieces are

| What | Where |
|---|---|
| The release command | `tools/release.mjs` (logic and tests: `tools/release-lib.mjs`, `tools/release-lib.test.mjs`) |
| The build and publish | `.github/workflows/build-mac.yml` |
| The tag check | `tools/check-version.mjs` |
| `latest.json` check (both Apple silicon and Intel) | `tools/updater-json.mjs` |
| The update address and public key | `plugins.updater` in `apps/web/src-tauri/tauri.conf.json` |
| The app's side (check, offer, save, install, restart) | `apps/web/src/lib/updater.ts`, `apps/web/src/components/UpdateBar.tsx` |
