# Install day: Elmar's Mac

Work through this on Elmar's Mac, with him. Tick each box and write what happened under it. If something is odd,
write down exactly what you saw (a photo of the screen is fine) and carry on to the next item where you can.

**Before you go:** run the "Build Mac app" workflow on GitHub (Actions tab, then "Run workflow"), download the
`elmars-app-dmg` artifact, and unzip it. Get the `.dmg` onto the Mac by **AirDrop or a browser download** (for example
upload it somewhere and download it on the Mac). **Don't use a USB stick**: files copied that way carry no download flag,
so the "Open Anyway" step wouldn't really be tested. The file is called something like
`Elmar's App_0.1.0_universal.dmg`. Also have a copy of his Evernote export ready.

Date: ____________   Mac model / macOS version: ______________________________

---

## 1. Install, then "Open Anyway"

- [ ] Open the `.dmg`, drag Elmar's App into Applications, and eject the `.dmg`.
- [ ] Open the app from Applications. macOS says it can't check it for malware. This is expected, because the app has no
      Apple Developer signature. Click **Done** (or **OK** on older macOS), not "Move to Bin". If no warning appears at
      all, note it: the file probably lost its download flag.
- [ ] Open **System Settings → Privacy & Security**, scroll down to the message about "Elmar's App", and click
      **Open Anyway**. Enter the Mac password if asked, then click **Open Anyway** once more.
- [ ] The app opens and shows the first-run screen.

Notes: ______________________________________________________________

## 2. First run: the folder

- [ ] The suggested folder is **Elmar's App** inside **iCloud Drive**. (If iCloud Drive isn't on, it suggests his home
      folder. If so, note it, turn iCloud Drive on in System Settings, and use "Choose another folder".)
- [ ] Accept it. If macOS asks to let the app access iCloud Drive, click **Allow**.
- [ ] The app opens to an empty Today screen with no error.

Notes: ______________________________________________________________

## 3. Bring the Evernote notes across

- [ ] Run the import with his Evernote export.
- [ ] Read the import report all the way through. Write down anything it says it couldn't handle.
- [ ] Pick **three notes** and open each one next to the same note in Evernote, side by side:
  - [ ] one with a **photo**: the photo is there and the right size
  - [ ] one with a **checklist**: the items and ticks match
  - [ ] one that **needed a fallback** (the report names these): the text is all there and reads sensibly
- [ ] Nothing important is missing from any of the three.

Notes: ______________________________________________________________

## 4. Make things, quit fast, reopen

- [ ] Create a **task**.
- [ ] Create a **note** and paste a **photo** into it.
- [ ] Create an **event** on the calendar.
- [ ] Straight after typing the last few words, press **⌘Q** to quit. Don't wait.
- [ ] If you see **"Your last change hasn't been saved. Quit anyway?"**, write that down and choose **Keep open**.
      Wait a moment, then press ⌘Q again.
- [ ] Reopen the app. The task, the note (with its photo) and the event are all there, including the last words typed.
- [ ] In Settings, choose **Save a backup file** once, and note where the file was saved: ______________________

Notes: ______________________________________________________________

## 5. The files are in iCloud Drive

- [ ] In Finder, open **iCloud Drive → Elmar's App**.
- [ ] You can see the project, note, task and event files (and an `assets` folder with the pasted photo).
- [ ] Open one of the note files in TextEdit. It reads as plain text.

Notes: ______________________________________________________________

## 6. "Optimise Mac Storage" and a removed download

Do the reliable test first:

- [ ] In Finder, right-click one note file in iCloud Drive → Elmar's App and choose **Remove Download**.

Optionally, as well:

- [ ] Turn on **Optimise Mac Storage**: System Settings → Apple Account (called Apple ID on macOS 13 and 14) → iCloud →
      iCloud Drive (on 13 and 14: **Options…**) → Optimise Mac Storage. The toggle alone rarely evicts anything unless the
      Mac is short of disk space, so don't rely on it.

Then:

- [ ] Quit the app and reopen it.
- [ ] Either the note downloads and opens, or a "still downloading" screen appears and then clears. Either is fine.
- [ ] **Nothing is missing.** No note, task or event has vanished or turned up empty.

Notes: ______________________________________________________________

## 7. A second build over the first

This one decides what a later version needs (Tauri's updater, or an Apple Developer account).

- [ ] Build a second version (bump the version in `apps/web/src-tauri/tauri.conf.json`, push, run the workflow again) and
      install it over the first in Applications.
- [ ] Open it. Write down:
  - Did **Open Anyway** come back? yes / no
  - Did the **iCloud folder prompt** (Allow) come back? yes / no
  - Did the app find all his notes without asking him to choose a folder again? yes / no

Result: ______________________________________________________________

Decision for later (circle one): keep as is  /  add the updater  /  get an Apple Developer account

## 8. Files, links and quitting straight after typing

Opening attached files:

- [ ] Open a note with an attached file (a PDF, say). Under **Attachments**, click **Open** next to it. The file opens
      in its usual app (Preview for a PDF).
- [ ] Open one of the imported Evernote notes and click **Open** next to **Original from Evernote**. It opens in the
      browser and shows the note as it looked in Evernote.
- [ ] Click a file link inside a note's text. The file opens the same way.
- [ ] Click **Save a copy…** next to a file, save it to the Desktop, and check the copy opens.

Dragging a file in:

- [ ] Drag a photo from Finder into a note. It appears where you dropped it, and it is still there after switching to
      another note and back.

Links:

- [ ] In a note, type a web address (for example `https://www.apple.com`). A plain click only puts the cursor there.
      Hold **⌘** and click it: it opens in the browser.
- [ ] Open a project, add a link under **Links**, and click it: it opens in the browser.

Quitting straight after typing (do these as two separate tries):

- [ ] Type a few words in a note and **immediately** press **⌘Q**. Reopen the app: the words are there.
- [ ] Type a few words in a note and **immediately** right-click the app in the Dock and choose **Quit**. Reopen the
      app and note whether the last words are there: yes / no.
      **Known limit:** quitting from the Dock (and logging out or shutting down with the app open) goes through macOS's
      own quit, which the app cannot pause to save. The last ¾ of a second or so of typing may be lost. ⌘Q and the
      app's Quit menu item always save first. If the words were lost here, that is this known limit, not a new fault.

Notes: ______________________________________________________________

---

## If something goes wrong

- **Where his data is.** Everything is plain files in one folder: **iCloud Drive → Elmar's App** (on disk:
  `~/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App`). If he chose a different folder, it's that one. Notes and
  projects are `.md` files, tasks and events are in `tasks/` and `events/`, and photos are in `assets/`. You can open
  them without the app.
- **The "Try again" screen.** If the app can't read his folder (for example iCloud is signed out or still catching up),
  it shows **"Your notes couldn't be opened"** with the folder path, instead of an empty app. You can't miss it, and you
  don't need to make it happen. Fix the cause (check iCloud Drive in Finder), then click **Try again**. If the folder
  has really moved, click **Choose another folder…**. While this screen is up the app writes nothing.
- **"Your notes folder isn't where it was".** If the folder he uses has been moved or renamed, or iCloud Drive is signed
  out, the app says so with the path instead of starting fresh. Fix the cause, then click **Look again**. If the folder
  really has moved, click **Choose another folder…** and pick it where it is now. The app never makes a new, empty folder
  in its place.
- **Nothing is deleted outside the folder.** The app only touches files inside the notes folder, and only the files it
  manages. Removing the app from Applications does not delete his notes.
- **Backup.** The settings page can export everything to a single file. Do that once before you leave, and keep the file
  somewhere other than the Mac.
