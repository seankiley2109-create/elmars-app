mod icloud;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

/// Asks the page to save before the app quits. Must match `EXIT_EVENT` in src/lib/vault-storage.ts.
const EXIT_EVENT: &str = "elmar://flush-and-exit";

/// If the page does not even acknowledge (a hung or dead web view), quit anyway. A live page answers at
/// once with `hold_exit`, which stands this down; from then on the page's own 5 s save timeout, and his
/// answer if the save failed, decide.
const EXIT_FALLBACK: Duration = Duration::from_secs(3);

/// The id of the app menu's own Quit item (see `build_menu`).
const QUIT_MENU_ID: &str = "quit";

/// Quitting the whole app (Cmd+Q, the Quit menu) does not close the window first, so the page's
/// close handler never runs and the last half-second of typing could be lost. The first such request
/// is held while the page saves.
///
/// On macOS the system Quit menu item sends `terminate:`, which ends the app without ever raising
/// `ExitRequested`, so the menu carries our own Quit item (see `build_menu`) that asks the page first.
/// Quitting from the Dock, or logging out, still goes through `terminate:` and is not held.
#[derive(Default)]
struct ExitState {
  /// An exit is being held. A further Quit meanwhile is held too; the page's answer decides.
  requested: AtomicBool,
  /// The page has saved, or the fallback fired: let the exit through.
  allowed: AtomicBool,
  /// Bumped whenever a hold is answered or cancelled, so a stale fallback timer does nothing.
  generation: AtomicU64,
}

impl ExitState {
  /// Start holding an exit. `None` when one is already held: a second Quit meanwhile is held too, not
  /// let through (that would cut the save short or skip "Quit anyway?"); the page's answer or the
  /// fallback decides. `Some(generation)` for a new hold. The generation is read here, before the page
  /// can hear the request: a page that answers (hold_exit) at once must not leave the fallback holding
  /// the already-bumped value, or it would fire mid-save.
  fn begin(&self) -> Option<u64> {
    if self.requested.swap(true, Ordering::SeqCst) {
      return None;
    }
    Some(self.generation.load(Ordering::SeqCst))
  }

  /// The page heard the request: the no-answer fallback stands down.
  fn hold(&self) {
    self.generation.fetch_add(1, Ordering::SeqCst);
  }

  /// "Keep open": forget this request, so the next Quit is held (and saved) again.
  fn cancel(&self) {
    self.generation.fetch_add(1, Ordering::SeqCst);
    self.requested.store(false, Ordering::SeqCst);
  }

  /// Let the exit through.
  fn allow(&self) {
    self.allowed.store(true, Ordering::SeqCst);
  }

  /// Whether an exit request goes through untouched. `app.exit(..)` (from allow_exit or the fallback)
  /// arrives with a code and sets `allowed` first, so our own exit is never held again: no loop.
  fn lets_through(&self, code: Option<i32>) -> bool {
    code.is_some() || self.allowed.load(Ordering::SeqCst)
  }

  /// The fallback timer for `generation` fired: quit only if nothing answered or cancelled meanwhile.
  fn fallback_due(&self, generation: u64) -> bool {
    self.generation.load(Ordering::SeqCst) == generation && self.requested.load(Ordering::SeqCst)
  }
}

/// The page heard the request and is saving: the no-answer fallback stands down.
/// Must match `EXIT_COMMANDS.hold` in src/lib/vault-storage.ts.
#[tauri::command]
fn hold_exit(state: State<'_, ExitState>) {
  state.hold();
}

/// The page has saved (or he chose "Quit anyway"). Must match `EXIT_COMMANDS.exit`.
#[tauri::command]
fn allow_exit(app: AppHandle, state: State<'_, ExitState>) {
  state.allow();
  app.exit(0);
}

/// He chose "Keep open": forget this request, so the next Quit is held (and saved) again.
/// Must match `EXIT_COMMANDS.cancel`.
#[tauri::command]
fn cancel_exit(state: State<'_, ExitState>) {
  state.cancel();
}

/// Ask the page to save, then quit. Used by the menu's Quit (Cmd+Q) and by a held exit request.
/// The page answers with hold_exit, then allow_exit (whose `app.exit(0)` carries a code and is let
/// through) or cancel_exit. A page that never answers is quit after `EXIT_FALLBACK`.
fn request_exit(handle: &AppHandle) {
  let state = handle.state::<ExitState>();
  if state.lets_through(None) {
    handle.exit(0);
    return;
  }
  // No window, so no page with anything to save: nothing to hold.
  if handle.webview_windows().is_empty() {
    state.allow();
    handle.exit(0);
    return;
  }
  let Some(generation) = state.begin() else {
    return;
  };
  if handle.emit(EXIT_EVENT, ()).is_err() {
    state.allow();
    handle.exit(0);
    return;
  }
  let fallback = handle.clone();
  std::thread::spawn(move || {
    std::thread::sleep(EXIT_FALLBACK);
    let state = fallback.state::<ExitState>();
    if state.fallback_due(generation) {
      state.allow();
      fallback.exit(0);
    }
  });
}

/// `ExitRequested` without a code: the last window was destroyed, or something asked the app to end.
fn hold_exit_for_save(handle: &AppHandle, code: Option<i32>, api: &tauri::ExitRequestApi) {
  let state = handle.state::<ExitState>();
  if state.lets_through(code) {
    return;
  }
  // The last window closed: the page's close handler already saved (or asked) before destroying it.
  if handle.webview_windows().is_empty() {
    return;
  }
  // From here on this exit is held.
  api.prevent_exit();
  request_exit(handle);
}

/// Whether a predefined menu item's label is the system Quit: "Quit Elmar's App" on macOS, "&Quit" on
/// Linux, "&Exit" on Windows (`&` marks a keyboard mnemonic).
fn is_quit_label(label: &str) -> bool {
  let plain = label.replace('&', "");
  let plain = plain.trim();
  plain == "Quit" || plain.starts_with("Quit ") || plain == "Exit"
}

/// The default menu (its Edit menu keeps Cmd+C, Cmd+V and Cmd+Z working), with the system Quit
/// replaced by our own, which goes through `request_exit` and so saves first.
fn build_menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
  let menu = Menu::default(handle)?;
  for top in menu.items()? {
    let MenuItemKind::Submenu(sub) = top else { continue };
    for (position, entry) in sub.items()?.into_iter().enumerate() {
      let MenuItemKind::Predefined(item) = &entry else { continue };
      if !is_quit_label(&item.text()?) {
        continue;
      }
      sub.remove_at(position)?;
      let quit = MenuItem::with_id(handle, QUIT_MENU_ID, "Quit Elmar's App", true, Some("CmdOrCtrl+Q"))?;
      sub.insert(&quit, position)?;
      return Ok(menu);
    }
  }
  log::warn!("the default menu has no Quit item to replace");
  Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    // The notes folder is plain files on disk: read and write them, choose another folder, show it in Finder.
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(ExitState::default())
    .menu(build_menu)
    .on_menu_event(|handle, event| {
      if event.id() == QUIT_MENU_ID {
        request_exit(handle);
      }
    })
    .invoke_handler(tauri::generate_handler![hold_exit, allow_exit, cancel_exit, icloud::ensure_downloaded])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|handle, event| {
    if let RunEvent::ExitRequested { code, api, .. } = &event {
      hold_exit_for_save(handle, *code, api);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_first_quit_is_held_and_a_second_meanwhile_is_held_too() {
    let state = ExitState::default();
    assert!(!state.lets_through(None));
    assert_eq!(state.begin(), Some(0));
    assert_eq!(state.begin(), None);
    assert!(!state.lets_through(None));
  }

  #[test]
  fn our_own_exit_carries_a_code_and_is_let_through() {
    let state = ExitState::default();
    state.begin();
    assert!(state.lets_through(Some(0)));
    state.allow();
    assert!(state.lets_through(None));
  }

  #[test]
  fn the_fallback_fires_only_when_the_page_never_answers() {
    let state = ExitState::default();
    let generation = state.begin().unwrap();
    assert!(state.fallback_due(generation));
    state.hold();
    assert!(!state.fallback_due(generation));
  }

  #[test]
  fn keep_open_forgets_the_request_so_the_next_quit_is_held_again() {
    let state = ExitState::default();
    let first = state.begin().unwrap();
    state.hold();
    state.cancel();
    assert!(!state.fallback_due(first));
    let second = state.begin().expect("the next Quit starts a new hold");
    assert_ne!(first, second);
    assert!(state.fallback_due(second));
  }

  #[test]
  fn recognises_the_system_quit_label_on_each_platform() {
    assert!(is_quit_label("Quit Elmar's App"));
    assert!(is_quit_label("&Quit"));
    assert!(is_quit_label("&Exit"));
    assert!(!is_quit_label("Quit-ish"));
    assert!(!is_quit_label("Hide Elmar's App"));
    assert!(!is_quit_label("Close Window"));
  }
}
