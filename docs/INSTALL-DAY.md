# Install day: Elmar's Mac

A one-time setup, about 15 minutes, on Elmar's Mac with him. After today every fix reaches him inside the app as
**"Update and restart"**: no more downloads, no more "Open Anyway".

**Before you go:** make sure a release exists (GitHub → Releases shows "Elmar's App v0.1.x" with a `.dmg`). If not,
see "First release" in [RELEASING.md](RELEASING.md). Ask Elmar to have his Evernote export ready, or do it together (step 3).

Date: ____________   Mac model / macOS version: ______________________________

---

## 1. Download and install (3 min)

- [ ] On Elmar's Mac, open **Safari** and go to
      **https://github.com/seankiley2109-create/elmars-app/releases/latest**
- [ ] Under **Assets**, click the `.dmg` (something like `Elmar's App_0.1.0_universal.dmg`). It lands in Downloads.
- [ ] Open the `.dmg`, drag **Elmar's App** into **Applications**, then eject the `.dmg`.
- [ ] Open **Elmar's App** from Applications. macOS says it can't check it for malware. That's expected (there's no
      Apple Developer signature). Click **Done** (or **OK** on older macOS). Don't click "Move to Bin".
- [ ] Open **System Settings → Privacy & Security**, scroll down to the line about "Elmar's App", click
      **Open Anyway**, enter the Mac password if asked, then **Open Anyway** once more.

This is the only time he will ever see that warning. Updates come through the app itself.

## 2. First run (2 min)

- [ ] The app suggests a folder called **Elmar's App** in **iCloud Drive**. Click **Use this folder**. If macOS asks to
      let the app use iCloud Drive, click **Allow**.
      (If it suggests his home folder instead, iCloud Drive is off: turn it on in System Settings → Apple Account →
      iCloud, then use **Choose another folder…** and pick iCloud Drive → Elmar's App.)
- [ ] Type his first name where it asks **What should we call you?**
- [ ] Choose **Bring your Evernote notes** (step 3), or **Start empty** and bring them later from Settings.

## 3. Bring his Evernote notes (5 min, optional)

- [ ] In Evernote on the Mac: select a notebook, then **File → Export Notebook…** (or right-click the notebook →
      **Export notebook…**), choose **ENEX** (`.enex`), and save it to the Desktop. Do this for each notebook he wants.
- [ ] In Elmar's App, choose the `.enex` file and let it run.
- [ ] Read the report with him to the end. Write down anything it says it couldn't bring across: ____________________
- [ ] Open one note with a photo next to the same note in Evernote. It looks right.

## 4. Five-minute check

- [ ] Tick a task on **Today**.
- [ ] Write a note and paste a photo into it.
- [ ] Add an event on the **Calendar**.
- [ ] Type a few words in the note and **immediately** press **⌘Q**. Open the app again: the words are still there.
- [ ] **Settings → Check for updates** says **"You're up to date (0.1.x)."**
- [ ] In Finder, **iCloud Drive → Elmar's App** shows his files (notes, `tasks`, `events`, `assets`).
- [ ] **Settings → Save a backup file…** once. Keep the file somewhere other than the Mac.

That's it. When you release a fix, Elmar sees **"A new version of Elmar's App is ready."** within a few hours and clicks
**Update and restart**. The app saves his work first. macOS may ask once more to let the app use the notes folder
after an update. Click **Allow**.

---

## Extra checks (5 minutes, worth doing once)

Optional, but these only show up on a real Mac.

- [ ] Open a note with an attached file (a PDF, say) and click **Open** next to it under **Attachments**. It opens in
      its usual app. In an imported Evernote note, **Open** next to **Original from Evernote** shows it in the browser.
- [ ] Drag a photo from Finder into a note. It appears where you dropped it and is still there after switching notes.
- [ ] Type a web address in a note. A plain click only places the cursor. **⌘-click** opens it in the browser.
- [ ] Type a few words and **immediately** right-click the app in the Dock → **Quit**. Reopen: are the words there?
      yes / no. (Known limit: Dock quit, log out and shut down skip the app's save, so the last second of typing can be
      lost. **⌘Q** always saves first.)
- [ ] In Finder, **iCloud Drive → Elmar's App**, right-click a note file → **Remove Download**. Quit and reopen the
      app. The note downloads and opens, or a "still downloading" screen appears and clears. Nothing is missing.

## If something goes wrong

- **No "Open Anyway" button in Privacy & Security.** Open the app once more from Applications first; the button
  appears only after macOS has blocked it once (it stays for about an hour).
- **"Your notes couldn't be opened"** (with the folder path). iCloud is signed out or still catching up. Check iCloud
  Drive in Finder, then click **Try again**. If the folder really moved, click **Choose another folder…**. While this
  screen is up the app writes nothing.
- **"Your notes folder isn't where it was".** The folder was moved or renamed, or iCloud Drive is off. Fix that and
  click **Look again**, or **Choose another folder…** and pick it where it is now. The app never makes a new, empty
  folder in its place.
- **"Your last change hasn't been saved. Quit anyway?"** Choose **Keep open**, wait a moment, and quit again.
- **An update says "The update couldn't be installed."** His notes are fine and the app keeps running. It offers the
  update again later, or try **Settings → Check for updates**. If it keeps failing, download the newest `.dmg` from the
  releases page and drag it over the old app in Applications (one more "Open Anyway").
- **Where his data is.** Plain files in **iCloud Drive → Elmar's App**
  (`~/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App`). Notes and projects are `.md` files, tasks and events
  are in `tasks/` and `events/`, photos in `assets/`. They open without the app. Removing the app does not delete them.
- **Quitting from the Dock** (or shutting down with the app open) can lose the last second of typing. **⌘Q** and the
  app's Quit menu always save first.
