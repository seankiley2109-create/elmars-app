# Elmar's App: design

**Status:** for Sean's review, 3 Nov 2026 (v2: Sean's answers folded in, Map made its own place)
**Mockup:** [Elmar's App mockup](https://claude.ai/artifact/4tzUyxEVqGW6GNkaWcyPLS) (private; five screens: Today, Projects,
Notes, Calendar, Map)
**Working name:** "Elmar's App" until there's a real one.

Items marked **(Claude's call)** were decided while writing this and haven't been confirmed by Sean. Everything else
was agreed in conversation.

## 1. What this is and why

Elmar (Sean's boss) wants a simple, visual tool on his Mac for his **personal** tasks, projects and notes. It replaces
Evernote, which he has stopped using. He's a visual person and found Evernote flat. He saw HQ, Sean's personal
operations app, and liked how it looks, above all **the map**.

So this is HQ, cut down to what one person needs, in the light look the Montana Hub uses, packaged as a real Mac app.
It is personal and stands entirely apart from Montana's systems.

**What success looks like:** Elmar stops opening Evernote. All his notes come across on day one. He opens this app
every morning without being reminded. The map is where he goes to see his life at a glance. Sean doesn't have to
babysit it.

## 2. Goals, non-goals, anti-goals

**Goals**
- Five places: **Today, Projects, Notes, Calendar, Map**, matching the mockup.
- **The map is crucial** (Sean's word). It is a place of its own, not a hidden view.
- Visual first: project colours, progress rings and bars, a board, a week calendar.
- Instant capture from anywhere in the app (⌘N), and search across everything (⌘K).
- Notes he can write in like Evernote: rich editing, checklists, pasted photos and attached files.
- One-time **Evernote import** that brings across notebooks, tags, dates and attachments.
- His data is plain files in a folder he owns, backed up off the laptop.

**Non-goals (v1)**
- iPhone, iPad, web or Windows versions. It's Mac only.
- **More than one Mac.** It runs on Elmar's own laptop and nowhere else (Sean's answer). There's no handling for two
  Macs sharing the folder.
- Sharing, collaboration or multiple users.
- **Any link to Montana or work:** the Hub, Entra, Graph, To Do, Outlook or work meetings (Sean's answer: "separate,
  personal app").
- **Reading Apple Calendar.** The calendar holds what he puts in this app (§6).
- HQ's operator features: jobs and runs, certifications, decisions, skills, webhooks and automations, time tracking,
  signals, context packs and agents.

**Anti-goals: things that would make it a failure even if it works**
- **Any of Sean's data in the app.** HQ's seed and fixtures contain Sean's work data: infrastructure names and projects. None
  of it may ship. Elmar's first launch is empty, or offers the Evernote import.
- **Losing or mangling a note**, including during the Evernote import.
- **A sign-in screen, an account, or anything sent off his Mac** (apart from iCloud Drive doing its own syncing).
- **Builder and operator vocabulary on screen**, such as "vault", "jobs", "runs", "backlog", "shipped" or "signals". It
  speaks plainly.
- Needing Sean every few weeks to keep it working.

## 3. What he sees

The mockup is the reference for layout, density and tone.

**Shell.** On the left is a sidebar with:
- his name;
- a "Search everything ⌘K" button;
- the five places;
- his projects as coloured links;
- a quiet footer saying where his data is saved ("Saved on this Mac · iCloud Drive").

There's one pink primary button per screen at most.

**Today.** A greeting with the date, a capture bar, and these panels:
- **Today:** tasks due today or overdue, ticked in place.
- **Coming up this week.**
- **Recent notes,** as cards.
- **Today's calendar:** his events for today (§6).
- **Projects,** each with a progress bar.

**Projects.** A board with four columns: **On the go, On hold, Someday, Done**. These are HQ's `active`, `blocked`,
`later` and `shipped` with new labels. Each card shows the project's colour, its next step, "n of m" tasks done, its
note count and its target date. Cards drag between columns. Clicking a card opens HQ's project workspace (its tasks,
notes and dates). The board's view switch offers Board, Timeline (HQ's roadmap timeline) and Map (opens the Map place).

**Notes.** Three panes:
1. **Notebooks:** All notes; his folders; "By project"; and "From Evernote", holding the imported notes and the date
   they came in.
2. **The note list:** title, a two-line snippet, project dot and date.
3. **The editor:** a title, project and tag chips, a rich body, and "Mentioned in" backlinks at the bottom.

**Calendar.** Day, Week and Month views. His events show as blocks, tinted in the project colour when an event belongs
to a project and neutral otherwise. Tasks and project dates appear in a "Due" row along the top of each day and can be
ticked there. "New event" adds an event (§6).

**Map.** The whole of his life as one picture. It's built from HQ's `MapView.tsx`, recoloured for the light look and cut
to three kinds of thing:
- **Shape:** Elmar sits at the centre. His projects sit around him on an ellipse, each with its tasks and notes fanned
  out around it.
- **Projects:** each is a circle in its colour. Its ring fills with progress, and "6/11" sits inside. Someday projects
  are dashed and grey. On hold says so in its label.
- **Tasks:** small circles in the project's colour, hollow while open and filled when done.
- **Notes:** small rounded squares.
- **Lines:** solid lines show what belongs to what. Dashed lines show mentions: a note that @-links a project or
  another note. Notes in no project float on their own.
- **Clicking anything:**
  - selects it;
  - shows its cluster's labels and dims the other clusters;
  - opens a small card (bottom right) with its details and an "Open" button that goes to the right place.
- **Filter chips:** Tasks, Notes and Someday. **Zoom:** in, out and fit, plus pan by dragging.
- **Positions** are worked out automatically, not dragged by hand. **(Claude's call,** as in HQ.)

**Tasks** stay simple on screen. A task has a tick, a title, a project (optional), a due date (optional), a priority and
a star. HQ's five task statuses stay in the data, so there's no migration risk, but v1 shows only open or done.
**(Claude's call.)**

## 4. How it gets made (decided)

- **Start from HQ** (`C:\Users\seank\Documents\Sean OS\system`): Vite, React, TypeScript, Zustand, plus `hq-core`
  (logic) and `hq-store-fs` (the markdown serializer). Copy it into a new git repository in
  `C:\Users\seank\Documents\2026\MontanaDC\Projects\Elmars App` instead of sharing code with HQ, so the two can change
  independently. **(Claude's call.)**
- **Remove** every collection, view and component for the non-goals in §2, along with their codecs and tests. HQ's rule
  that "adding a collection to `HQData` won't compile until a codec handles it" also catches removals; keep that
  safeguard.
- **The look is the Montana design system ("Summit")**, from the Hub's `design/kit/`, in light mode only. Fonts are
  bundled with the app (Archivo, Inter, IBM Plex Mono), with no web font calls. The Montana rules apply (pink only for
  the one primary action, status only in pills, 44 px targets, WCAG AA), with one deliberate exception: **project
  colours** appear as dots, rings, bars and event tints, because colour coding is the point for him. HQ's dark theme
  and its count-up animations go.
- **A native Mac app built with Tauri 2.** It's a universal binary (Apple silicon and Intel) for macOS 13 or later, with
  a Dock icon and normal Mac menus and shortcuts.
- **Built on GitHub Actions' macOS machines**, because Sean works on Windows. The output is a `.dmg`.
- **Signing: there is no Apple Developer account** (Sean's answer), so the app is ad-hoc signed, which is Tauri's
  default and enough to run on Apple silicon.
  - **What that means for installing:** because the app isn't notarized, macOS blocks it the first time each new
    version is opened. He opens it once through System Settings → Privacy & Security → "Open Anyway". Sean does the
    first install with him.
  - **What it means for permissions:** macOS may ask again for access to the iCloud Drive folder after an update. That's
    one "Allow" click.
  - **Buying one later** (Apple Developer Program, $99 a year) removes both. The app doesn't need to change for that,
    only the build settings. **(Claude's call:** not worth it for one user now.)

## 5. His data

- **A folder of plain files**, in HQ's vault format: one markdown file per project and per note, tasks as lines in
  `tasks/<YYYY-MM>.md`, events as lines in `events/<YYYY-MM>.md` (new, §6), and attachments under `assets/`. Readable
  without the app, and never locked in.
- **Where it lives: an "Elmar's App" folder in his iCloud Drive.** He has iCloud Drive but barely uses it; Sean asked
  for the best option. **(Claude's call:** it's the only thing that keeps a copy off the laptop with no effort, and a
  laptop is exactly what gets lost, stolen or dropped.) First launch shows the folder and lets him change it.
- **Storage layer:** HQ reads and writes through the browser's File System Access API (`apps/web/src/lib/vault-fs.ts`,
  `vault-storage.ts`, `vault-handle.ts`, `assets.ts`), which Tauri's web view doesn't have. Replace it with Tauri's file
  system plugin behind the same storage interface. Keep HQ's safety rule that only managed paths are ever deleted.
- **Keep HQ's "something changed behind my back" reload**: if files change on disk, the app reloads and says what
  changed. With one Mac this is the only outside-change handling needed.
- **iCloud's "Optimise Mac Storage" can evict files** and leave placeholders on disk. The app must handle a file that
  isn't downloaded yet: download it, or show it as "still in iCloud". It must never treat that file as missing or deleted.
- **Backups:** iCloud Drive, plus HQ's existing export of everything to a single file, kept on the settings page.
- **Scale:** about 100 notes to start (Sean's estimate). Plan for headroom of about 1,000 notes and 5,000 tasks. At that
  size, HQ's load-everything, rewrite-what-changed approach is fine and stays as it is.

## 6. Calendar

- **The calendar is his own, kept in this app.** It doesn't read Apple Calendar or Outlook (Sean: work meetings aren't
  wanted, this is a separate personal app). That also means no calendar permission and no native code.
- **What shows:** his events, tasks with due dates, and project start and target dates.
- **A new, small Event entity** with a codec, so the round-trip safeguard covers it:
  - title, date, start and end time (or all day), and an optional project, location and note;
  - stored as one line each in `events/<YYYY-MM>.md`, in the same style as tasks.
- **Recurring events** (birthdays, a weekly ride) are out of v1. **(Claude's call;** an easy later addition.)
- HQ already has calendar components (`CalendarPage.tsx`, `MonthCalendar.tsx`, `HomeCalendar.tsx`, `TasksCalendar.tsx`)
  to build Day, Week and Month from.

## 7. Evernote import

- **In:** `.enex` files. Evernote exports one file per notebook, so the notebook name comes from the file name. He can
  pick several files at once.
- **What it keeps:** each note's title, created and updated dates, tags, and notebook (which becomes a folder under
  "From Evernote"). Body conversions:
  - headings, lists, links, tables and bold/italic → markdown;
  - Evernote to-dos → checklists;
  - images and files (base64 in the export) → attachments, shown in place.
- **What it can't keep:** fonts, colours and highlights are dropped. Encrypted sections become a visible line saying
  "Encrypted in Evernote; not imported". Nothing disappears silently.
- **Evernote Tasks and reminders** (their own elements in newer exports) become real tasks, linked to the note they came
  from, with their due dates. **(Claude's call.)**
- **Web clips and complex HTML:** when a note needs a fallback, the original HTML is also kept as an attachment on that
  note ("Original from Evernote"), so nothing is lost. **(Claude's call.)**
- **Safe to run again:** re-importing the same file doesn't create duplicates. Match on title plus created date (an
  `.enex` export has no stable id).
- **Ends with a short report:** how many notes, attachments and notebooks came in, and anything that needed a fallback,
  with links to those notes.
- **Offered on first launch** ("Bring your Evernote notes") and kept on the settings page.
- **Testing:** there's no real export to test against yet, so the builder makes a sample `.enex` covering every case
  above. **The first real import is done with Sean present.** He checks the report and a few notes side by side with
  Evernote. Elmar keeps his Evernote account until he's happy. **(Claude's call.)**

## 8. Notes editor

- **Rich editing over markdown.** He types into a formatted editor with a small toolbar: bold, italic, heading, list,
  checklist, photo or file, and link. What gets saved is still plain markdown.
- **Paste or drag** a photo or file in; it becomes an attachment.
- **Typing `@`** links a project or another note, which feeds "Mentioned in" and the map's dashed lines.

## 9. Left to the builder

- The editor library, as long as it saves markdown that HQ's serializer round-trips.
- How the Tauri file layer is built.
- Which HQ components to keep and which to rewrite to match the mockup.
- How the settings page is laid out (data folder, Evernote import, export, about and version).
- **Updates.** Tauri's updater signs updates with its own key and needs no Apple account. Check whether an update it
  installs avoids the "Open Anyway" step. If it does, include it. If not, updates are a new `.dmg` that Sean installs
  with him.
- Tests: keep HQ's round-trip test (`deserialize(serialize(d)) ≡ canonical(d)`) as the main safeguard, extend it to
  events, and add one for the Evernote import using the sample `.enex`.

## 10. Questions answered (3 Nov 2026, Sean)

| Question | Answer | What it changed |
|---|---|---|
| Apple Developer account? | No | Ad-hoc signing, "Open Anyway" on first open (§4) |
| Managed Mac? iCloud? | His own laptop; iCloud Drive on, barely used; "whatever you recommend" | Data in iCloud Drive (§5) |
| How many Macs? | One | No multi-Mac handling (§2, §5) |
| How many Evernote notes? | About 100 | Scale headroom lowered, no storage rework (§5); first import with Sean (§7) |
| Work meetings? | No, it's a separate personal app | Apple Calendar dropped, events kept in the app (§6) |
| The map | "Crucial", missing from the first mockup | Map made a place of its own and drawn in the mockup (§3) |
