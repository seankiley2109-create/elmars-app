# Elmar's App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a copy of HQ into Elmar's personal Mac app, with five places (Today, Projects, Notes, Calendar, Map), the
light Montana look, plain files in iCloud Drive, a one-time Evernote import, and a `.dmg` built in CI.

**Architecture:** Fork HQ's monorepo and cut it to five collections: projects, tasks, notes, links and assets, with
activity kept for history. Add a new events collection. The browser's `FileSystemDirectoryHandle` is replaced in the Mac
app by a stand-in backed by Tauri's file system plugin. That way HQ's vault storage, diffing and asset code run
unchanged, and Chrome on Windows keeps working for development. Each screen is rebuilt to match the mockup, and pure
selectors and layout functions carry the logic so it can be tested.

**Tech stack:** Vite 6, React 18, TypeScript 5.6, Zustand 5, Tailwind 4, Vitest 2, Tauri 2 (plugins fs, dialog and
opener), TipTap 2 with `tiptap-markdown`, `spark-md5`, and GitHub Actions on `macos-latest`.

**Spec:** `docs/superpowers/specs/2026-11-03-elmars-app-design.md` (read it first).
**Mockup source:** `docs/mockup/*.dc.html`. Each file is self-contained HTML; read the markup and CSS for exact layout,
sizes and copy. The live canvas is at https://claude.ai/artifact/4tzUyxEVqGW6GNkaWcyPLS (private).

**Paths:** `<repo>` = `C:\Users\seank\Documents\2026\MontanaDC\Projects\Elmars App`. `<hq>` = `C:\Users\seank\Documents\Sean OS\system`
(read only, never modify). `<hub>` = `C:\Users\seank\Documents\2026\MontanaDC\Projects\Hub` (read only).

## Global constraints

- **Mac only, one Mac, one user.** No sign-in, no network calls apart from iCloud Drive's own syncing, and no web fonts.
- **No Sean data.** Nothing from `<hq>/vault`, `seed.ts`, the HQ fixtures or Sean's work data may ship. Task 2's guard
  test enforces this.
- **Copy rules.** No visible "vault", "job(s)", "run(s)", "backlog", "shipped" or "signal(s)" (Task 3's copy test). Use
  sentence case, and button labels that say what happens.
- **Project status labels:** `active` → "On the go", `blocked` → "On hold", `later` → "Someday", `shipped` → "Done".
- **Light only.** Montana tokens, and one pink (`#C21E62`) primary button per screen at most. Project colours are
  allowed on dots, rings, bars and event tints.
- **Targets and accessibility:** 44 px minimum targets, WCAG 2.2 AA contrast, and real `<button>` and `<a>` elements.
- **Dates:** tasks and events keep day precision on disk (`YYYY-MM-DD`). Event times are `HH:MM`, 24-hour.
- **The vault round trip `deserialize(serialize(d)) ≡ canonical(d)` must hold** for every collection, at every commit.
- **The data folder holds only managed paths.** Never delete anything outside `MANAGED_DIRS` or `assets/`.
- **Sean works on Windows with Node 24 and no Rust yet.** Mac-only behaviour (iCloud placeholders, Gatekeeper, universal
  build) is verified on install day (Task 16), not before.
- **Commits:** small, one per task at least, in the repo's own git history. Never push unless Sean asks.

## Review focus

Ways it could fail that no feature test covers. Each one has a test added in the task named.

1. **Quitting with ⌘Q within 500 ms of typing** must still save the edit. Tauri doesn't reliably fire `pagehide`.
   (Task 5)
2. **A save that fails** (folder removed, disk full or iCloud error) must show "Couldn't save your changes" and keep the
   edit in memory to retry, never dropping it silently. (Task 5)
3. **Awkward note titles**, such as `Plans: Q4/Q1?`, two notes both called `Untitled`, or emoji, must each get their own
   file and survive the round trip. (Task 2)
4. **The app left open past midnight** must move Today and the calendar to the new day when the window regains focus.
   (Task 8)
5. **Evernote content with accents, emoji or right-to-left text** must import byte-exact in titles and bodies. (Task 13)

---

### Task 1: Fork HQ into a new repository

**Files:**
- Create: `<repo>/package.json`, `<repo>/package-lock.json`, `<repo>/.gitignore`, `<repo>/.gitattributes`, and
  `<repo>/README.md`, all copied from `<hq>`.
- Create: `<repo>/apps/web/**` from `<hq>/apps/web`, excluding `dist/`, `node_modules/` and `vercel.json`.
- Create: `<repo>/packages/hq-core/**` and `<repo>/packages/hq-store-fs/**`, excluding `node_modules/`.
- Do not copy: `vault/`, `scratch/`, `scripts/`, `docs/`, `.claude/`, `CLAUDE.md`, `worklog.html` or `hq-backup-*.json`.

**Interfaces:**
- Produces: a workspace whose `npm test` and `npm run typecheck` pass exactly as HQ's do. Package names stay `@hq/core`,
  `@hq/store-fs` and `@hq/web`; these are internal names Elmar never sees, and keeping them avoids churn.

- [ ] **Step 1:** Copy the listed paths. In the root `package.json`, set `"name": "elmars-app"` and delete the
  `vault:build`, `vault:check` and `vault:save` scripts.
- [ ] **Step 2:** Replace `README.md` with five lines: what the app is, `npm install`, `npm run dev` (Chrome, for
  development), `npm test`, and a pointer to the spec.
- [ ] **Step 3:** Run `git init`, then `npm install`, then `npm test`. Expected: everything passes (HQ's suites).
- [ ] **Step 4:** Commit: `chore: fork HQ as the starting point for Elmar's app`.

### Task 2: Cut the data model to five collections, plus the personal-data guard

**Files:**
- Modify: `packages/hq-core/src/types.ts`, `data.ts`, `validate.ts`, `selectors.ts` and `index.ts`.
- Delete: `packages/hq-core/src/jobs.ts`.
- Modify: `packages/hq-store-fs/src/codecs.ts`, `fixtures.ts`, `index.ts`, `serialize.test.ts` and `equal.test.ts`.
- Delete: `packages/hq-store-fs/src/inbox.ts`.
- Create: `packages/hq-store-fs/src/no-personal-data.test.ts`.
- Modify: `apps/web/src/lib/vault-fs.ts` (`MANAGED_DIRS`).

**Interfaces:**
- Produces, in `@hq/core/types`:
  - `HQData = { version: 1; settings: Settings; projects: Project[]; tasks: Task[]; notes: Note[]; links: Link[]; assets: Asset[]; activity: ActivityEvent[] }`
  - `Settings = { userName: string; onboarded: boolean; lastExportAt?: string }`, with `theme` removed.
  - `EntityType = 'project' | 'task' | 'note' | 'asset'`.
  - `ActivityType`: only the members that the kept store actions emit.
  - `STATUS_LABEL` set to the four labels in Global constraints.
- Produces: `validateImport(raw: unknown): HQData | null`, which accepts `version: 1` only. All `upgradeV*` functions
  are deleted.
- Produces: `MANAGED_DIRS = ['config', 'projects', 'notes', 'tasks', '.activity']`. Task 4 adds `'events'`.

- [ ] **Step 1: Write the guard test** `no-personal-data.test.ts`. It walks `<repo>/apps` and `<repo>/packages`
  (skipping `node_modules`, `dist` and `src-tauri/target`) over `.ts`, `.tsx`, `.css`, `.html`, `.json` and `.md` files,
  and asserts that no file matches
  any name from Sean's work world (the term list lives, encoded, in the test itself). Failures list file and line.
- [ ] **Step 2:** Run `npm test -w @hq/store-fs`. Expected: FAIL, listing `seed.ts`, `fixtures.ts` and others.
- [ ] **Step 3:** Remove the job, jobRun, journal, decision, certification, skill, automation, savedView, inbox,
  signalMute and timeEntry types, codecs, selectors and validators. The `CODECS` mapped type is the checklist: it won't
  compile until every key of the new `VaultDoc` has a codec and nothing else does.
- [ ] **Step 4:** Rewrite `fullFixture()` with generic, mockup-flavoured content (Kitchen renovation, December in
  Knysna, and so on). Every kept collection and every optional field must be present. Include notes titled
  `Plans: Q4/Q1?`, `Untitled`, `Untitled` (two different ids) and `Braai 🔥 marinade` (Review focus 3).
- [ ] **Step 5:** Add a test in `serialize.test.ts`: `gives filename-hostile and duplicate note titles distinct files and round-trips them`.
  It asserts that the four notes above produce four distinct `notes/**` paths and that
  `deserialize(serialize(f)) ≡ canonical(f)`.
- [ ] **Step 6:** Delete `apps/web/src/seed.ts`, and every import of it in tests, which now use `fullFixture()`.
  Clean up other Sean-specific strings until the guard passes.
- [ ] **Step 7:** Run `npm test` and `npm run typecheck` at the root. Expected: the store-fs and core suites PASS. The
  web app may fail to compile until Task 3; that's acceptable within this task only if Task 3 is next.
- [ ] **Step 8:** Commit: `feat: cut the data model to projects, tasks, notes, links, assets`.

### Task 3: Cut the app to the five places, plus the copy guard

**Files:**
- Delete views: `Jobs.tsx`, `Journal.tsx`, `Decisions.tsx`, `Certifications.tsx`, `Skills.tsx`, `VaultView.tsx`,
  `Tasks.tsx`.
- Delete components: `OpsPanels.tsx`, `RunRow.tsx`, `TodayRun.tsx`, `TimerChip.tsx`, `Celebration.tsx`,
  `CountUp.tsx`, `ViewChips.tsx`, and anything left orphaned.
- Rename `views/DataPage.tsx` → `views/Settings.tsx`. It keeps backup export and import; Task 15 finishes it.
- Modify: `store.ts`, `App.tsx`, `components/Sidebar.tsx`, `components/Onboarding.tsx`, `components/TaskRow.tsx`,
  `components/CommandPalette.tsx`, `components/ShortcutHelp.tsx`.
- Create: `apps/web/src/copy.test.tsx`.

**Interfaces:**
- Produces routes: `/` (Today), `/projects`, `/projects/:id`, `/notes`, `/notes/:id`, `/calendar`, `/map` and
  `/settings`.
- Produces `NAV_ITEMS`, in this order:
  - `{ to: '/', label: 'Today', key: 't' }`
  - `{ to: '/projects', label: 'Projects', key: 'p' }`
  - `{ to: '/notes', label: 'Notes', key: 'n' }`
  - `{ to: '/calendar', label: 'Calendar', key: 'c' }`
  - `{ to: '/map', label: 'Map', key: 'm' }`
- Produces the store: persist `name: 'elmar-data'`, `version: 1`, no `migrate`. Actions for the removed collections,
  inbox, timers, automations, signals and saved views are gone. `toggleTask(id)` switches between `'ready'` and
  `'done'`, and a new task starts as `'ready'`.
- Produces `Onboarding`: asks for his name, then offers two buttons, "Bring your Evernote notes" (Task 14 wires it; until
  then it calls `onImport?.()`) and "Start empty".

- [ ] **Step 1: Write the copy test** in `copy.test.tsx`. For each route above, render `<App/>` in a `MemoryRouter`
  with the store set to `fullFixture()` and `onboarded: true`. Assert that `document.body.textContent` doesn't match
  `/\b(vault|jobs?|runs?|backlog|shipped|signals?|inbox)\b/i`.
- [ ] **Step 2:** Run `npm test -w @hq/web -- copy`. Expected: FAIL (compile errors or forbidden words).
- [ ] **Step 3:** Delete and modify the files listed until the app compiles. On screen, tasks show only a tick for
  open or done; the five statuses stay in the data. Remove the theme toggle and `data-theme`.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS. Then run `npm run dev`, open it in Chrome,
  start empty, and click through all five places with no errors in the console.
- [ ] **Step 5:** Commit: `feat: cut the app to Today, Projects, Notes, Calendar, Map`.

### Task 4: Events collection

**Files:**
- Modify: `packages/hq-core/src/types.ts` and `data.ts`; `packages/hq-store-fs/src/codecs.ts`, `index.ts` and
  `fixtures.ts`.
- Create: `packages/hq-store-fs/src/events.ts` and `events.test.ts`.
- Modify: `apps/web/src/store.ts` and `apps/web/src/lib/vault-fs.ts` (add `'events'` to `MANAGED_DIRS`).

**Interfaces:**
- Produces `CalEvent = { id: ID; title: string; date: string; start?: string; end?: string; projectId?: ID; location?: string; notes?: string; createdAt: string }`.
  - `date` and `createdAt` are `YYYY-MM-DD`; `start` and `end` are `HH:MM`.
  - The event is all day exactly when `start` is undefined.
  - `HQData` gains `events: CalEvent[]`.
- Produces from `@hq/store-fs`: `printEventLine(e: CalEvent): string`, `parseEventLine(line: string, date: string): CalEvent | null`,
  `printEventFile(events: readonly CalEvent[]): string`, `parseEventFile(text: string): CalEvent[]` and
  `eventMonth(e: CalEvent): string` (`YYYY-MM`).
- Produces store actions: `addEvent(input: Omit<CalEvent, 'id' | 'createdAt'>): ID`,
  `updateEvent(id: ID, patch: Partial<Omit<CalEvent, 'id' | 'createdAt'>>): void` and
  `deleteEvent(id: ID): DeleteSnapshot | undefined` (`DeleteSnapshot.removed` gains `events`).

**File format:** one file per month, `events/<YYYY-MM>.md`, with a `## YYYY-MM-DD` heading per day, in ascending order.
Within a day, lines sort all-day first, then by `start`, then by `id`. Line grammar, with tokens printed in this order
and stripped from the right:

```
- <HH:MM>–<HH:MM> <title>[ 📍 <location>][ 📝[[notes/<id>]]] ➕ <YYYY-MM-DD> ^<id>[ →<projectId>]
- all day <title>[ 📍 <location>][ 📝[[notes/<id>]]] ➕ <YYYY-MM-DD> ^<id>[ →<projectId>]
```

The separator between times is an en dash (U+2013). `notes` lives in the sidecar `events/notes/<id>.md`, the same way
tasks do. If `start` is set and `end` isn't, print `<start>–<start>`.

- [ ] **Step 1: Write failing tests** in `events.test.ts`:
  - `prints and parses a timed event with location, project and notes`: the line equals
    `- 08:30–09:15 Leadership check-in 📍 Office 📝[[notes/e1]] ➕ 2026-11-01 ^e1 →p1`, and parsing it with date
    `2026-11-03` returns the original event minus `notes`.
  - `prints and parses an all-day event`: `- all day Family lunch ➕ 2026-11-01 ^e2`.
  - `keeps a title ending in " ^abc" intact`.
  - `orders a day all-day first, then by start`.
  - Round trip: `fullFixture()` now includes one timed event with every field and one all-day event, and
    `deserialize(serialize(f)) ≡ canonical(f)` holds.
- [ ] **Step 2:** Run `npm test -w @hq/store-fs`. Expected: FAIL (`printEventLine` not defined).
- [ ] **Step 3:** Implement `events.ts`, modelled on `tasks.ts` (same strip-from-the-right approach), plus the `events`
  codec and the store actions.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add calendar events to the data and the vault format`.

### Task 5: The Tauri shell and the file layer

**Files:**
- Create: `apps/web/src-tauri/` (via `npx tauri init`), including `tauri.conf.json`, `Cargo.toml`, `src/lib.rs` and
  `capabilities/default.json`.
- Create: `apps/web/src/lib/platform.ts`, `fs-port.ts`, `tauri-root.ts` and `tauri-root.test.ts`;
  `apps/web/src/components/FirstRun.tsx`.
- Modify: `apps/web/src/lib/vault-boot.ts`, `vault-storage.ts` and `apps/web/package.json`.

**Interfaces:**
- Produces `platform.ts`: `isTauri(): boolean` (`'__TAURI_INTERNALS__' in window`) and
  `onAppFocus(cb: () => void): () => void` (in Tauri, `getCurrentWindow().onFocusChanged` when focused; in a browser,
  `visibilitychange` to visible).
- Produces `fs-port.ts`:
  - `interface FsPort { readDir(p: string): Promise<{ name: string; isDirectory: boolean }[]>; readFile(p: string): Promise<Uint8Array>; writeFile(p: string, d: Uint8Array): Promise<void>; mkdir(p: string): Promise<void>; remove(p: string): Promise<void>; exists(p: string): Promise<boolean>; ensureDownloaded(p: string): Promise<boolean> }`
  - `mkdir` is recursive. In this task, `ensureDownloaded` returns `exists(p)`; Task 6 replaces it.
  - `tauriFsPort: FsPort` wraps `@tauri-apps/plugin-fs`.
  - `class MemFsPort implements FsPort`, an in-memory version for tests, with `files: Map<string, Uint8Array>`.
- Produces `tauri-root.ts`: `createTauriRoot(rootPath: string, fs: FsPort): FileSystemDirectoryHandle`.
  - It implements exactly the surface `lib/mem-fs.ts` implements: `kind`, `name`,
    `getDirectoryHandle(name, {create})`, `getFileHandle(name, {create})`, `removeEntry(name)`, `entries()` and
    `keys()`.
  - File handles provide `getFile()`, which returns a real `File`, and `createWritable()`, whose `write` accepts
    `string | Blob | ArrayBuffer | Uint8Array`.
  - Missing entries reject with a `DOMException` named `NotFoundError`, which `vault-fs.ts` already relies on.
- Produces `vault-storage.ts`:
  - `createVaultStorage(root, opts?: { onSaveError?: (err: unknown) => void })`. A failed write calls `onSaveError` and
    leaves the path out of `lastWritten`, so the next save retries it.
  - `flushOnQuit(storage: VaultStorage): Promise<() => void>`. In Tauri, `getCurrentWindow().onCloseRequested` calls
    `preventDefault`, then `await storage.flush()`, then `destroy()`. In a browser it falls back to `flushOnUnload`.
- Produces `vault-boot.ts`, with Tauri state `{ kind: 'needs-folder'; suggested: string }` and `localStorage` key
  `elmar.vaultPath`. `defaultVaultPath(): Promise<string>` returns
  `$HOME/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App` when the iCloud Drive folder exists, and
  `$HOME/Elmar's App` otherwise.
- Tauri config:
  - `productName` "Elmar's App"; `identifier` `app.elmars.personal`.
  - Window 1440×900, minimum 1100×720, title "Elmar's App".
  - `bundle.targets: ["dmg"]`, `bundle.macOS.minimumSystemVersion: "13.0"`, `bundle.macOS.signingIdentity: "-"`.
  - Capabilities: fs read and write scoped to `$HOME/**`, dialog `open`, opener `reveal`.

- [ ] **Step 0 (needs Sean):** Install Rust with rustup (stable, MSVC) and the Visual Studio C++ Build Tools, as Tauri's
  Windows prerequisites require. Ask Sean before installing; if he declines, skip the `tauri dev` checks and rely on
  Task 16's CI build.
- [ ] **Step 1: Write failing tests** in `tauri-root.test.ts`, using `createVaultStorage(createTauriRoot('/v', new MemFsPort()))`:
  - `writes the serialized fixture as files under the root`: after `setItem` and `flush`, the port's files equal
    `serialize(fullFixture())` with `/v/` prefixed.
  - `one edit writes one file`.
  - `never removes an unmanaged path`: `/v/My stuff.txt` survives a save that drops a note.
  - `round-trips an asset byte for byte`: a 3-byte PNG blob, written and then read.
  - `reports a failed write and retries it` (Review focus 2): a port whose `writeFile` throws once calls `onSaveError`
    once, and the next `flush` writes the file.
  - `flushOnQuit flushes before the window closes` (Review focus 1): with a fake window, `destroy` is called only after
    the storage's pending write has landed.
- [ ] **Step 2:** Run `npm test -w @hq/web -- tauri-root`. Expected: FAIL.
- [ ] **Step 3:** Implement `platform.ts`, `fs-port.ts`, `tauri-root.ts` and the `vault-storage.ts` options.
- [ ] **Step 4:** Wire `vault-boot.ts`.
  - **Tauri branch:** saved path → `createTauriRoot` → the existing `createVaultStorage` wiring. `watchVault` uses
    `onAppFocus`, and quitting uses `flushOnQuit`. `onSaveError` shows a toast reading "Couldn't save your changes.
    Trying again…".
  - **Browser branch:** unchanged (File System Access API), so Chrome development still works.
- [ ] **Step 5:** Build `FirstRun.tsx`, shown for `needs-folder`. It reads "Where should your notes live?", shows the
  suggested path and a line explaining that iCloud Drive keeps a copy safe if the laptop is lost. Buttons: "Use this
  folder" (primary; runs `mkdir`, saves the path, boots) and "Choose another folder…" (dialog `open({ directory: true })`).
- [ ] **Step 6:** Run `npm test`. Expected: PASS. Then run `npx tauri dev` in `apps/web` (Windows) and check:
  - first run → choose a temp folder → create a project, and its `.md` appears in the folder;
  - edit that file in Notepad → refocus the app, and the change toast appears;
  - type a note title and press Alt+F4 at once → reopen, and the title is there.
- [ ] **Step 7:** Commit: `feat: run as a Tauri app with the vault on the real file system`.

### Task 6: Files still in iCloud

**Files:**
- Create: `apps/web/src-tauri/src/icloud.rs` (registered in `lib.rs`); `apps/web/src/components/IcloudPending.tsx`.
- Modify: `apps/web/src/lib/fs-port.ts`, `tauri-root.ts`, `tauri-root.test.ts` and `vault-boot.ts`.

**Interfaces:**
- Produces the Tauri command `ensure_downloaded(path: String, timeout_ms: u64) -> Result<bool, String>`.
  - If `path` exists, it returns true.
  - On macOS, if the placeholder `<dir>/.<name>.icloud` exists, it runs `/usr/bin/brctl download <path>` and checks
    every 200 ms until `path` exists (true) or `timeout_ms` runs out (false).
  - On other systems, it returns whether the path exists.
  - `tauriFsPort.ensureDownloaded(p)` invokes it with `timeout_ms: 20000`.
- Produces `class IcloudPendingError extends Error { paths: string[] }`, exported from `tauri-root.ts`.
  - `entries()` maps any entry named `/^\.(.+)\.icloud$/` to `ensureDownloaded(<dir>/<name>)`. If that returns true, it
    yields `<name>` as a file. Otherwise it records the vault-relative path.
  - At the end of iterating, if anything was recorded, it throws `IcloudPendingError`.
- Produces the boot state `{ kind: 'icloud-pending'; count: number }`, which renders `IcloudPending` with "Some of your
  notes are still downloading from iCloud (n). Check you're online, then try again." and a "Try again" button.
  **Nothing in the store hydrates in this state**, so nothing can be overwritten or deleted.

- [ ] **Step 1: Write failing tests** in `tauri-root.test.ts`:
  - `downloads a placeholder and reads the note`: the port has `/v/notes/.a.md.icloud`, and `ensureDownloaded` creates
    `/v/notes/a.md`; the read includes it.
  - `refuses to load while a note is still in iCloud`: `ensureDownloaded` returns false, `readManagedFiles` rejects with
    `IcloudPendingError` and `paths` equals `['notes/a.md']`, and nothing was written or removed.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the shim change, `icloud.rs` and the boot state.
- [ ] **Step 4:** Run `npm test` and `cargo check` (in `src-tauri`). Expected: PASS. The macOS behaviour is checked on
  install day (Task 16).
- [ ] **Step 5:** Commit: `feat: wait for iCloud downloads instead of loading partial data`.

### Task 7: Montana look, sidebar, capture and search

**Files:**
- Create: `apps/web/src/assets/fonts/*.woff2`, copied from `<hub>/app/public/kit/summit@2.1.0/fonts/`. Copy all eight
  files and keep their names.
- Create: `apps/web/src/fonts.css`, `apps/web/src/lib/capture.ts`, `capture.test.ts`, `apps/web/src/lib/search.ts` and
  `search.test.ts`.
- Modify: `apps/web/src/index.css`, `main.tsx`, `components/Sidebar.tsx`, `CaptureBar.tsx`, `CommandPalette.tsx`,
  `ui.tsx` and `App.tsx`.

**Interfaces:**
- Produces CSS tokens on `:root` (light only):
  - **Montana:** `--mt-paper #F6F5F1`, `--mt-panel #FFFFFF`, `--mt-raised #EFEDE7`, `--mt-line #E2DFD7`,
    `--mt-line-strong #878379`, `--mt-ink #16171A`, `--mt-ink-2 #5A5852`, `--mt-ink-3 #6B6963`, `--mt-action #C21E62`,
    `--mt-action-hover #A8175A`, `--mt-accent-text #B8175F`, `--mt-ok #0E7A5C`/`#E1F2EA`, `--mt-warn #8F5B00`/`#FAEFD5`,
    `--mt-crit #B42B2B`/`#F8E2E0`, `--mt-soon #3A4FB0`/`#E6EAF8`, `--mt-pend #6B3FA0`/`#EFE8F7`.
  - **HQ's tokens, remapped:** `--bg`→paper, `--surface`→panel, `--surface2`→raised, `--line`→line, `--ink`→ink,
    `--muted`→ink-2, `--dim`→ink-3, `--accent`→accent-text, `--ok`/`--warn`/`--danger`→ok/warn/crit.
  - **Fonts:** Inter 14/20 body, Archivo 700/800 for headings, IBM Plex Mono 500 with tabular numerals for figures.
- Produces `ui.tsx`: `Button` gains `variant: 'primary' | 'secondary' | 'quiet'`. Primary uses `--mt-action`.
- Produces `capture.ts`: `parseCapture(text: string, projects: Project[]): { title: string; projectId?: ID }`.
  - After an `@`, take the longest run of whole words that is a case-insensitive prefix of a non-archived project's
    name. If several projects match, the first in board order wins.
  - The matched `@words` are removed from the title. With no match, the text is left as it is.
- Produces `search.ts`: `searchAll(doc: VaultDoc, q: string, limit = 20): { type: 'project' | 'task' | 'note' | 'event'; id: ID; title: string; snippet?: string }[]`.
  It matches titles first, then note bodies (with a snippet of up to 80 characters around the hit), and is
  case-insensitive and accent-insensitive (NFD with diacritics stripped).
- Shortcuts: ⌘N or Ctrl+N opens the capture bar; ⌘K or Ctrl+K opens search; `g` plus a letter navigates by
  `NAV_ITEMS`. The bare `c` capture key is removed.

- [ ] **Step 1: Write failing tests:**
  - `parseCapture('Call Pieter @kitch', ps)` → `{ title: 'Call Pieter', projectId: kitchenId }`.
  - `parseCapture('Email @nobody', ps)` → `{ title: 'Email @nobody' }`.
  - `parseCapture('@kitchen reno call Pieter', ps)` → `{ title: 'call Pieter', projectId: kitchenId }`.
  - `searchAll(doc, 'cafe')` finds a note whose body contains "Café", with a snippet.
  - `searchAll` ranks a title match before a body match.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `capture.ts` and `search.ts`; wire `CaptureBar` (task only, title from `parseCapture`) and
  `CommandPalette` (results from `searchAll`, Enter opens the item).
- [ ] **Step 4:** Restyle to match `docs/mockup/Today.dc.html`'s sidebar exactly:
  - 240 px wide, with the name avatar tile, "Personal", and a search button showing ⌘K;
  - the five places, with the signal gradient `#F20274→#F57939` tick on the active one;
  - a "Projects" list of the top-level On the go and On hold projects, each with a colour dot;
  - the footer: "Saved on this Mac · iCloud Drive" when the vault path contains `com~apple~CloudDocs`, otherwise
    "Saved on this Mac only", plus a settings link.
- [ ] **Step 5:** Run `npm test`. Expected: PASS, including the copy test. Check by eye in `npm run dev` against the
  mockup.
- [ ] **Step 6:** Commit: `feat: Montana light look, sidebar, capture and search`.

### Task 8: Today

**Files:**
- Modify: `apps/web/src/views/Home.tsx`; `packages/hq-core/src/selectors.ts`.
- Create: `packages/hq-core/src/today.test.ts`; `apps/web/src/lib/use-today.ts`.

**Interfaces:**
- Produces, in `@hq/core/selectors`:
  - `todayTasks(doc, today: string): Task[]`: open tasks with `dueDate <= today` (overdue first, then by priority),
    followed by tasks completed today.
  - `comingUp(doc, today: string): Task[]`: open tasks due in `(today, today+6]`, by date.
  - `recentNotes(doc, n: number): Note[]`, sorted by `updatedAt` descending.
  - `eventsOn(doc, date: string): CalEvent[]`, all-day first, then by start.
  - `projectProgress(doc): { project: Project; done: number; total: number }[]`, for non-archived projects in
    `active | blocked`, in board order.
  - `greeting(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening'`, with boundaries `<12` and `<17`.
- Produces `use-today.ts`: `useToday(): string` (`YYYY-MM-DD`), which re-reads the clock on `onAppFocus` and every
  60 s.

- [ ] **Step 1: Write failing tests** in `today.test.ts`, using a fixture dated around `2026-11-03`:
  - overdue first, then today;
  - a task completed today is included, and one completed yesterday isn't;
  - `comingUp` excludes today and day +7;
  - `greeting(11)`, `greeting(12)`, `greeting(17)`.
  - `useToday rolls over at midnight on focus` (Review focus 4): fake timers set to 23:59:30, then 00:00:30, then the
    focus callback fires, and the hook returns the new date.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the selectors and `useToday`.
- [ ] **Step 4:** Rebuild `Home.tsx` to match `docs/mockup/Today.dc.html`:
  - the greeting with the gradient name, the date line (`Tuesday 3 November`), and a "New" primary button;
  - the inline capture bar;
  - the Today panel, with tick in place and pills ("Overdue · 31 Oct" in red, "Today" in blue, "Done" in green);
  - Coming up this week;
  - three recent note cards;
  - Today's calendar (with an "In n min" pill on the next event under 60 minutes away);
  - Projects with progress bars.
  Empty states are one plain sentence each.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Check by eye against the mockup.
- [ ] **Step 6:** Commit: `feat: Today`.

### Task 9: Projects board

**Files:**
- Modify: `apps/web/src/views/Projects.tsx`, `components/ProjectBoard.tsx`, `views/ProjectWorkspace.tsx`;
  `packages/hq-core/src/selectors.ts`.
- Create: `packages/hq-core/src/projects.test.ts`.

**Interfaces:**
- Produces `projectCard(doc, p: Project): { done: number; total: number; notes: number; next?: string; target?: string }`.
- Produces `PROJECT_COLORS = ['#D64D1E', '#16877A', '#3A4FB0', '#8F5B00', '#0E7A5C', '#6B3FA0', '#B8175F', '#5A5852']`,
  exported from `@hq/core/data`. A new top-level project gets the first colour not yet in use, or cycles round.
- Board columns, in order: active, blocked, later, shipped, with Global constraints' labels. Drag uses
  `setProjectStatus`.

- [ ] **Step 1: Write failing tests:** `projectCard` counts only that project's tasks and notes, including subprojects'
  tasks; a new project picks the first unused colour.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the selector and the colour choice in `addProject`.
- [ ] **Step 4:** Rebuild the page to match `docs/mockup/Projects.dc.html`:
  - the header meta ("4 on the go, 1 on hold, 2 for someday");
  - the view switch: Board, Timeline (the existing `RoadmapCalendar`) and Map (navigates to `/map`);
  - "New project" as the primary button;
  - each column on the raised surface, with a "+" button per column;
  - cards showing name, "Next: …", bar, "n of m", notes count and target pill ("By 15 Dec");
  - a dashed "Drop an idea here" slot in Someday.
  A click on a card opens `/projects/:id`, whose workspace keeps HQ's layout restyled in the Montana look.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Check by eye.
- [ ] **Step 6:** Commit: `feat: Projects board`.

### Task 10: Notes and the rich editor

**Files:**
- Modify: `apps/web/src/views/Notes.tsx`; `apps/web/src/store.ts`; `packages/hq-core/src/selectors.ts`.
- Create: `apps/web/src/components/MarkdownEditor.tsx`, `MarkdownEditor.test.tsx`, `apps/web/src/lib/mentions.ts` and
  `mentions.test.ts`.
- Add dependencies: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-task-list`,
  `@tiptap/extension-task-item`, `@tiptap/extension-image`, `@tiptap/extension-link`, `@tiptap/extension-mention`,
  `@tiptap/extension-table` (with row, cell and header) and `tiptap-markdown`.

**Interfaces:**
- **Markdown conventions in note bodies:**
  - an inline attachment is `![<name>](asset:<assetId>)`;
  - a mention is `[<name>](elmar://project/<id>)` or `[<name>](elmar://note/<id>)`.
- Produces `MarkdownEditor(props: { value: string; onChange: (md: string) => void; onPickMention: (q: string) => { type: 'project' | 'note'; id: ID; label: string }[]; onFile: (f: File) => Promise<{ assetId: ID; name: string }> })`.
  - Images resolve `asset:` sources through `getAssetBlob` to object URLs.
  - The toolbar has Bold, Italic, Heading, Bulleted list, Checklist, Photo or file, and Link (all with `aria-label`s).
  - Paste or drop of a file → `onFile` → an image node (images) or a link (other files).
- Produces `mentions.ts`: `mentionTargets(md: string): { type: 'project' | 'note'; id: ID }[]`.
- Produces store action `syncMentions(noteId: ID, body: string): void`.
  - It adds a `related` link `note → target` for each target in the body that isn't linked yet.
  - It removes `related` links from this note to projects or notes whose mention is gone.
  - `updateNote` calls it whenever `body` changes.
- Produces `notebooks(doc): { path: string; count: number }[]`. It returns top-level folders and their subfolders,
  with paths under `From Evernote/` grouped beneath a "From Evernote" entry.

- [ ] **Step 1: Write failing tests:**
  - `MarkdownEditor round-trips the supported markdown`: for each sample (`# H`, `**b** _i_`, nested `- a\n  - b`,
    `1. x`, `- [ ] t\n- [x] d`, `[l](https://x.y)`, `![p](asset:a1)`, a 2×2 table, a mention link), load it and read
    `getMarkdown()`; the result equals the input after trailing-whitespace normalisation.
  - `mentionTargets` finds both kinds and ignores ordinary links.
  - `syncMentions adds and removes links`: a body with project P adds a link; editing P out removes it; links of kind
    `blocks` and links from other notes are untouched.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the editor, `mentions.ts`, `syncMentions` and `notebooks`.
- [ ] **Step 4:** Rebuild `Notes.tsx` to match `docs/mockup/Notes.dc.html`. It has three panes:
  1. **Notebooks:** All notes, folders, By project, and From Evernote with its import date.
  2. **The list:** title, snippet, project dot and date, plus "New note" as the primary button.
  3. **The editor:** the toolbar, the title, project and tag chips, the body, and "Mentioned in" built from incoming
     links and from tasks and events in the note's project.
  `/notes/:id` selects a note. Typing `@` opens the mention list.
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Check by eye; paste an image in Chrome dev and confirm it appears and
  that a file lands in `assets/`.
- [ ] **Step 6:** Commit: `feat: Notes with a rich editor, mentions and inline attachments`.

### Task 11: Calendar

**Files:**
- Modify: `apps/web/src/views/CalendarPage.tsx`, `components/MonthCalendar.tsx`.
- Create: `apps/web/src/components/WeekGrid.tsx`, `EventSheet.tsx`; `apps/web/src/lib/day-layout.ts`,
  `day-layout.test.ts`, `apps/web/src/lib/color.ts`, `color.test.ts`.

**Interfaces:**
- Produces `layoutDay(events: CalEvent[], hourPx: number, firstHour: number): { event: CalEvent; top: number; height: number; col: number; cols: number }[]`.
  It covers timed events only. Overlapping events split the column; an event without an end, or shorter than 30
  minutes, is drawn 30 minutes tall.
- Produces `tint(hex: string, alpha: number): string`, which blends the colour over white and returns a `#RRGGBB` value.
  Event fill is `tint(projectColor, 0.14)`, or `#EFEDE7` when there's no project.
- Produces `EventSheet(props: { event?: CalEvent; date: string; onClose: () => void })`.
  - Fields: title, date, an "All day" toggle, start and end, project, location and note.
  - Buttons: Save and Cancel, plus Delete (with confirmation) when editing.
- The page has Day, Week and Month views, Previous and Next buttons, "Today" and "New event" (primary).
  - The week starts on Monday. The visible hours are 07:00 to 19:00, scrolled there at 54 px per hour, and the whole day
    is scrollable.
  - A "Due" row shows tasks due that day (tickable) and project start and target dates.

- [ ] **Step 1: Write failing tests:**
  - `layoutDay` places 08:30–09:15 at `top = 1.5 * hourPx`, `height = 0.75 * hourPx`, when `firstHour` is 7.
  - Two overlapping events get `cols: 2` and columns 0 and 1.
  - An event without an end is 30 minutes tall.
  - `tint('#D64D1E', 0.14)` → `#F9E6E0`, within ±1 per channel.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `day-layout.ts`, `color.ts`, `WeekGrid`, `EventSheet` and the page, matching
  `docs/mockup/Calendar.dc.html`. Clicking an event opens `EventSheet`, and clicking an empty slot opens a new event at
  that time. The "now" line is ink-coloured and only in today's column.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Check by eye.
- [ ] **Step 5:** Commit: `feat: Calendar with events`.

### Task 12: Map

**Files:**
- Modify: `apps/web/src/views/MapView.tsx`.
- Create: `apps/web/src/lib/map-layout.ts`, `map-layout.test.ts`; `apps/web/src/components/MapDetail.tsx`.

**Interfaces:**
- Produces `layoutMap(doc: VaultDoc, filters: { tasks: boolean; notes: boolean; someday: boolean }, size: { w: number; h: number }): { nodes: MapNode[]; edges: MapEdge[] }`, where:
  - `MapNode = { id: string; kind: 'me' | 'project' | 'task' | 'note'; refId?: ID; label: string; x: number; y: number; color: string; done?: boolean; progress?: number; someday?: boolean; parentId?: string }`
  - `MapEdge = { from: string; to: string; style: 'hub' | 'kid' | 'mention' }`
- **Layout:**
  - The `me` node sits at the centre, slightly left of middle at `x = 0.42w`.
  - Top-level, non-archived projects whose status isn't `shipped` sit on an ellipse with `rx = 0.26w` and `ry = 0.33h`,
    evenly spaced from -90°.
  - Each project's tasks and notes fan outward at radius 86, spaced 30° apart with at most 150° in total.
  - Notes with no project sit on an outer arc in the lower right.
  - Mention edges come from `related` links between nodes that are on the map.
  - Subprojects collapse into their root project's cluster.
- **What the page draws:**
  - Each project is a conic ring of `progress` in its colour, with "done/total" in the middle. Someday projects are
    dashed and grey.
  - Tasks are 14 px circles, hollow while open and filled when done. Notes are 16 px rounded squares.
  - Selecting a node shows its cluster's labels and dims the other clusters to 0.35.
  - `MapDetail` (bottom right) shows the kind, title, details and an Open button. Projects open `/projects/:id`, tasks
    open the task detail, and notes open `/notes/:id`.
  - Filter chips (Tasks, Notes, Someday) are remembered with `usePersistentState`.
  - Zoom in, zoom out and fit, plus drag to pan, are kept from HQ.
  - A small key at the bottom left, as in `docs/mockup/Map.dc.html`.

- [ ] **Step 1: Write failing tests** in `map-layout.test.ts`:
  - every visible task and note has a `kid` edge to its project;
  - `someday: false` removes `later` projects and their children;
  - a project-less note has no `kid` edge and does have a `mention` edge when linked;
  - `tasks: false` removes all task nodes;
  - with 12 projects, no two project nodes are closer than 110 px when `size` is `{ w: 1120, h: 760 }`;
  - every node lies within `size`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `map-layout.ts`, then rebuild `MapView.tsx` and `MapDetail.tsx` on top of it, reusing HQ's
  pan and zoom code.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Check by eye against the mockup, with the fixture loaded.
- [ ] **Step 5:** Commit: `feat: the Map`.

### Task 13: Reading Evernote exports

**Files:**
- Create: `apps/web/src/lib/evernote/enex.ts`, `enml.ts`, `enex.test.ts`, `enml.test.ts`,
  `__fixtures__/sample.enex`.
- Add dependency: `spark-md5`, plus `@types/spark-md5` as a dev dependency.

**Interfaces:**
- Produces `parseEnex(xml: string, notebook: string): EnexNote[]`, where:
  - `EnexNote = { title: string; created: string; updated: string; tags: string[]; notebook: string; enml: string; resources: EnexResource[]; tasks: EnexTask[]; reminderAt?: string }`
  - `EnexResource = { hash: string; mime: string; fileName?: string; data: Uint8Array }`
  - `EnexTask = { title: string; done: boolean; due?: string }`
  - Dates `yyyyMMddTHHmmssZ` become ISO strings.
  - A resource's `hash` is the MD5 (in hex) of its decoded data.
  - `<task>` elements give the title, `taskStatus === 'completed'`, and a `dueDate` cut to `YYYY-MM-DD`.
  - `note-attributes/reminder-time` gives `reminderAt`.
- Produces `enmlToMarkdown(enml: string, assets: Map<string, { id: ID; name: string; mime: string }>): { markdown: string; fallback: boolean; encrypted: number }`.
  - **Converted:** `h1`–`h6`, `p`/`div` blocks, `br`, `b`/`strong`, `i`/`em`, `u` (plain text), `a`, `ul`/`ol`
    (nested), `en-todo` (`- [ ]` or `- [x]`), simple tables, `hr` and `en-media`.
  - **`en-media`:** for images, `![name](asset:id)`; otherwise `[name](asset:id)`.
  - **`en-crypt`:** the line `> Encrypted in Evernote; not imported`, which counts in `encrypted`.
  - **Dropped:** `style`, `font` and `span` styling.
  - **`fallback` is true** when it meets `table` with `colspan`/`rowspan`, a nested `table`, `iframe`, `object`, `svg`,
    or an element it doesn't recognise. It still produces its best markdown.
  - It uses `DOMParser`, which is available in WKWebView and jsdom.

- [ ] **Step 1: Build `sample.enex`** by hand, with three notebooks' worth of cases:
  - every converted element;
  - a PNG and a PDF resource;
  - `en-crypt`;
  - a styled span;
  - a `colspan` table;
  - one `<task>` that is done and one with a due date;
  - a `reminder-time`;
  - tags;
  - two notes with the same title and different `created` dates;
  - a title and body with "Café", "👍" and Hebrew "שלום" (Review focus 5).
- [ ] **Step 2: Write failing tests:**
  - `parseEnex` counts the notes and reads dates as ISO, the tags, the resources' MD5 hashes (checked against known
    values) and the tasks.
  - `enmlToMarkdown`: one assertion per converted element with the exact expected markdown; `encrypted === 1`; `fallback`
    is true only for the colspan note.
  - Review focus 5: titles and bodies contain "Café", "👍" and "שלום" exactly.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement `enex.ts` and `enml.ts`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat: read Evernote exports into notes, attachments and tasks`.

### Task 14: Importing from Evernote

**Files:**
- Create: `apps/web/src/lib/evernote/import.ts`, `import.test.ts`; `apps/web/src/components/EvernoteImport.tsx`.
- Modify: `apps/web/src/components/Onboarding.tsx`, `apps/web/src/views/Settings.tsx`.

**Interfaces:**
- Produces `importEnexFiles(files: { name: string; text: string }[], deps: { store: Pick<HQState, 'notes' | 'addNote' | 'addTask' | 'updateTask' | 'addAsset' | 'addLink'>; putAssetBlob: (id: ID, blob: Blob, name: string) => Promise<void> }): Promise<ImportReport>`.
- Produces `ImportReport = { notes: number; attachments: number; tasks: number; skipped: number; notebooks: string[]; fallbacks: { noteId: ID; title: string }[]; encrypted: { noteId: ID; title: string }[] }`.
- **Rules:**
  - **Notebook and folder:** the notebook is the file name without `.enex`; the folder is `From Evernote/<notebook>`.
  - **Note fields:** `createdAt` and `updatedAt` come from Evernote, and tags are kept.
  - **Duplicates:** skip a note when an existing note has the same `title` and `createdAt`; it counts in `skipped`.
  - **Resources:** each becomes an `Asset` linked to its note.
  - **Fallback:** the original ENML is saved as an asset named `Original from Evernote.html` (`text/html`) and linked.
  - **Tasks:** each `EnexTask` becomes a task (`done` → status `done`) linked to the note.
  - **Reminders:** `reminderAt` becomes the task `Reminder: <title>`, due that day.
- Produces `EvernoteImport` (a sheet):
  - It opens with "Bring your Evernote notes" and two steps: export each notebook from Evernote as `.enex`, then choose
    the files.
  - It uses `<input type="file" multiple accept=".enex">`, shows progress (n of m notes), and then the report.
  - The report has counts in words, a list of fallback and encrypted notes linking to them, and a closing line saying
    you can keep Evernote until you're happy.

- [ ] **Step 1: Write failing tests** in `import.test.ts`, using `sample.enex` and an in-memory store:
  - the report counts match the sample;
  - folders are `From Evernote/sample`;
  - importing the same file again gives `notes: 0` and `skipped: <n>`;
  - the colspan note has a linked `Original from Evernote.html` asset;
  - the done task's status is `done`, and the reminder task is due on the reminder's date;
  - `putAssetBlob` is called once per resource, plus once per fallback, with byte-exact data.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `import.ts` and the sheet, and wire "Bring your Evernote notes" in Onboarding and Settings.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then in `npm run dev`, import `sample.enex` and check the report and
  three notes by eye.
- [ ] **Step 5:** Commit: `feat: Evernote import with a report`.

### Task 15: Settings

**Files:**
- Modify: `apps/web/src/views/Settings.tsx`.
- Create: `apps/web/src/lib/backup.test.ts` (or extend the existing `lib/backup.ts` tests).

**Interfaces:**
- Settings is reached from the sidebar footer and has four sections:
  - **Your name.**
  - **Where your notes live:** the path, "Show in Finder" (opener `revealItemInDir`), and a line saying iCloud Drive
    keeps a copy.
  - **Evernote:** "Bring your Evernote notes".
  - **Backup:** "Save a backup file…" (dialog `save` plus fs `writeFile` in Tauri, a download in the browser) and
    "Restore from a backup…" (with a confirmation that names what will be replaced).
  - **About:** the app name and version (`getVersion()` in Tauri).
- The backup file is `exportData()` JSON, named `Elmar's App backup YYYY-MM-DD.json`. Restoring goes through
  `validateImport`.

- [ ] **Step 1: Write a failing test:** `a backup restores to the same document`. Taking the fixture through
  `exportData`, JSON, `validateImport` and `importData` gives back the same document under `canonical`. A version-6 HQ
  backup is rejected with the message "This isn't a backup from Elmar's App."
- [ ] **Step 2:** Run it. Expected: FAIL (wrong message).
- [ ] **Step 3:** Implement the page and the message.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: Settings`.

### Task 16: The Mac build, and the install-day checklist

**Files:**
- Create: `<repo>/.github/workflows/build-mac.yml`; `<repo>/docs/INSTALL-DAY.md`; app icons, generated with
  `npx tauri icon` from a 1024 px PNG of an ink tile with a white "E" in Archivo 800 (placed in
  `apps/web/src-tauri/icons/`).

**Interfaces:**
- The workflow:
  - runs on `workflow_dispatch` and on tags `v*`, on `macos-latest`;
  - sets up Node 24 and Rust stable with targets `aarch64-apple-darwin` and `x86_64-apple-darwin`;
  - runs `npm ci` and `npm test`;
  - runs `tauri-apps/tauri-action@v0` with `projectPath: apps/web` and `args: --target universal-apple-darwin`, with no
    signing secrets;
  - uploads the `.dmg` as an artifact.
- `INSTALL-DAY.md` is a checklist Sean works through on Elmar's Mac, ticking each item and noting results:
  1. Install from the `.dmg`, then open through System Settings → Privacy & Security → "Open Anyway".
  2. On first run, the suggested folder is in iCloud Drive. Allow access if asked.
  3. Bring the Evernote notes across. Read the report, then compare three notes (one with a photo, one with a checklist,
     one that needed a fallback) side by side with Evernote.
  4. Create a task, a note with a pasted photo, and an event. Quit with ⌘Q straight after typing, reopen, and check
     everything is there.
  5. In Finder, check the files are in iCloud Drive → Elmar's App.
  6. Turn on "Optimise Mac Storage", or evict one note with right-click → Remove Download, then reopen the app. The
     note downloads, or the "still downloading" screen appears; nothing is missing.
  7. Install a second build over the first. Record whether "Open Anyway" and the folder prompt come back. This decides
     whether a later version adds Tauri's updater or an Apple Developer account.

- [ ] **Step 1 (needs Sean):** Sean creates a private GitHub repository and adds it as `origin`. Don't create or push it
  without him.
- [ ] **Step 2:** Add the workflow, the icons and `INSTALL-DAY.md`. Commit: `build: universal macOS dmg in CI`.
- [ ] **Step 3 (needs Sean):** Push and run the workflow. Expected: green, with an artifact
  `Elmar's App_<version>_universal.dmg`.
- [ ] **Step 4:** Commit the checklist results after install day.

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| §2 Five places, map as a place | 3, 7, 12 |
| §2 Non-goals cut | 2, 3 |
| §2 Anti-goals: no Sean data, no forbidden vocabulary | 2 (guard), 3 (copy test) |
| §3 Shell, Today, Projects, Notes, Calendar, Map, simple tasks | 7, 8, 9, 10, 11, 12, 3 |
| §4 Fork HQ, Montana look, Tauri, CI, ad-hoc signing | 1, 7, 5, 16 |
| §5 Plain files, iCloud default, file layer, reload on change, placeholders, backup | 5, 6, 15 |
| §6 Events in the app | 4, 11 |
| §7 Evernote import | 13, 14, 16 (first real import) |
| §8 Rich editor, paste, @ mentions | 10 |
| §9 Updater decision | 16 (install-day item 7) |
