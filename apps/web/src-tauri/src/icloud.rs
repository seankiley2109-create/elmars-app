//! Files still in iCloud.
//!
//! iCloud Drive can move a file's bytes off the Mac to save space ("Optimise Mac Storage"), leaving a
//! small `.<name>.icloud` placeholder beside where the file was. The notes folder usually lives in
//! iCloud Drive, so a note can be "there" without its bytes being on disk. Such a note must never be
//! read as missing: the page would load without it and the next save would delete it for good.
//!
//! `ensure_downloaded` asks iCloud for the file (`brctl download`) and waits for it to land. It runs on
//! the real file system, outside the page's fs scope, which only lets the page ask whether a
//! placeholder exists.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

/// How often to look for the file while iCloud fetches it.
pub const POLL_EVERY: Duration = Duration::from_millis(200);

/// `brctl`, the command-line side of iCloud Drive, ships with macOS.
#[cfg(any(target_os = "macos", test))]
const BRCTL: &str = "/usr/bin/brctl";

/// `<dir>/<name>` → `<dir>/.<name>.icloud`, or None for a path with no file name.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn placeholder_for(path: &Path) -> Option<PathBuf> {
  let name = path.file_name()?.to_str()?;
  Some(path.with_file_name(format!(".{name}.icloud")))
}

/// Time, injectable so the polling can be tested without waiting.
pub trait Clock {
  /// Time since the wait began.
  fn elapsed(&self) -> Duration;
  fn sleep(&mut self, d: Duration);
}

/// The real clock, started when made.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct SystemClock(std::time::Instant);

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
impl SystemClock {
  pub fn start() -> Self {
    SystemClock(std::time::Instant::now())
  }
}

impl Clock for SystemClock {
  fn elapsed(&self) -> Duration {
    self.0.elapsed()
  }
  fn sleep(&mut self, d: Duration) {
    std::thread::sleep(d);
  }
}

/// Look for the file now, then every `every`, until it is there (true) or `timeout` has passed (false).
/// The last look is made at the deadline, so a file that lands just in time still counts.
pub fn wait_for(mut ready: impl FnMut() -> bool, timeout: Duration, every: Duration, clock: &mut impl Clock) -> bool {
  loop {
    if ready() {
      return true;
    }
    let spent = clock.elapsed();
    if spent >= timeout {
      return false;
    }
    clock.sleep(every.min(timeout - spent));
  }
}

/// The whole decision, with the disk and `brctl` passed in so it can be tested anywhere:
/// - the file is there: true, nothing asked;
/// - no placeholder either: false (there is no such file);
/// - a placeholder: ask iCloud for it, then wait for it, up to `timeout`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn ensure_downloaded_with(
  path: &Path,
  timeout: Duration,
  exists: impl Fn(&Path) -> bool,
  request: impl FnOnce(&Path) -> Result<(), String>,
  clock: &mut impl Clock,
) -> Result<bool, String> {
  if exists(path) {
    return Ok(true);
  }
  match placeholder_for(path) {
    Some(placeholder) if exists(&placeholder) => {}
    _ => return Ok(false),
  }
  request(path)?;
  Ok(wait_for(|| exists(path), timeout, POLL_EVERY, clock))
}

/// Only paths under his home folder, with no `..`: the page may ask about his notes, nothing else.
pub fn allowed(path: &Path, home: &Path) -> bool {
  path != home && path.starts_with(home) && !path.components().any(|c| c == Component::ParentDir)
}

/// Make sure a file in the notes folder is on this Mac, fetching it from iCloud if only its placeholder
/// is. True once it is there; false if there is no such file or it did not arrive within `timeout_ms`.
/// Must match `tauriFsPort.ensureDownloaded` in src/lib/fs-port.ts, which sends `timeout_ms` as is.
#[tauri::command(rename_all = "snake_case")]
pub async fn ensure_downloaded(app: tauri::AppHandle, path: String, timeout_ms: u64) -> Result<bool, String> {
  use tauri::Manager;
  let home = app.path().home_dir().map_err(|e| e.to_string())?;
  let path = PathBuf::from(path);
  if !allowed(&path, &home) {
    return Err("Only files in the home folder can be fetched.".into());
  }
  let timeout = Duration::from_millis(timeout_ms);
  // the wait sleeps: keep it off the async runtime's threads (several files are fetched at once)
  tauri::async_runtime::spawn_blocking(move || fetch(&path, timeout))
    .await
    .map_err(|e| e.to_string())?
}

/// macOS: ask iCloud for the file with `brctl download`, then watch for it every 200 ms.
#[cfg(target_os = "macos")]
fn fetch(path: &Path, timeout: Duration) -> Result<bool, String> {
  fetch_with_brctl(path, timeout)
}

/// Also compiled (never run) by `cargo test` elsewhere, so a Windows build still type-checks it.
#[cfg(any(target_os = "macos", test))]
fn fetch_with_brctl(path: &Path, timeout: Duration) -> Result<bool, String> {
  use std::process::{Command, Stdio};
  let mut child = None;
  let result = ensure_downloaded_with(
    path,
    timeout,
    |p| p.exists(),
    |p| {
      let spawned = Command::new(BRCTL)
        .arg("download")
        .arg(p)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Couldn't ask iCloud for the file: {e}"))?;
      child = Some(spawned);
      Ok(())
    },
    &mut SystemClock::start(),
  );
  // brctl normally returns at once; never leave one running or unreaped
  if let Some(mut c) = child {
    if let Ok(None) = c.try_wait() {
      let _ = c.kill();
    }
    let _ = c.wait();
  }
  result
}

/// Elsewhere there is no iCloud eviction to undo: the file is there or it is not.
#[cfg(not(target_os = "macos"))]
fn fetch(path: &Path, _timeout: Duration) -> Result<bool, String> {
  Ok(path.exists())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cell::{Cell, RefCell};
  use std::collections::HashSet;

  /// A clock that only moves when slept on.
  struct FakeClock {
    now: Duration,
    sleeps: Vec<Duration>,
  }
  impl FakeClock {
    fn new() -> Self {
      FakeClock { now: Duration::ZERO, sleeps: vec![] }
    }
  }
  impl Clock for FakeClock {
    fn elapsed(&self) -> Duration {
      self.now
    }
    fn sleep(&mut self, d: Duration) {
      self.sleeps.push(d);
      self.now += d;
    }
  }

  const MS: fn(u64) -> Duration = Duration::from_millis;

  #[test]
  fn placeholder_sits_beside_the_file_with_a_dot_and_icloud() {
    assert_eq!(
      placeholder_for(Path::new("/Users/elmar/Notes/notes/braai.md")),
      Some(PathBuf::from("/Users/elmar/Notes/notes/.braai.md.icloud"))
    );
    assert_eq!(placeholder_for(Path::new("/")), None);
  }

  #[test]
  fn waits_every_200ms_until_the_file_lands() {
    let mut clock = FakeClock::new();
    let looks = Cell::new(0);
    // there on the fourth look: after three sleeps
    let got = wait_for(
      || {
        looks.set(looks.get() + 1);
        looks.get() == 4
      },
      MS(20_000),
      POLL_EVERY,
      &mut clock,
    );
    assert!(got);
    assert_eq!(looks.get(), 4);
    assert_eq!(clock.sleeps, vec![MS(200), MS(200), MS(200)]);
  }

  #[test]
  fn gives_up_at_the_timeout_after_a_last_look_at_the_deadline() {
    let mut clock = FakeClock::new();
    let looks = Cell::new(0);
    let got = wait_for(
      || {
        looks.set(looks.get() + 1);
        false
      },
      MS(500),
      POLL_EVERY,
      &mut clock,
    );
    assert!(!got);
    // looks at 0, 200, 400 and 500 (the deadline): never sleeps past it
    assert_eq!(clock.sleeps, vec![MS(200), MS(200), MS(100)]);
    assert_eq!(looks.get(), 4);
    assert_eq!(clock.now, MS(500));
  }

  #[test]
  fn a_file_that_lands_at_the_deadline_still_counts() {
    let mut clock = FakeClock::new();
    let looks = Cell::new(0);
    // the fourth look is the one at the deadline (0, 200, 400, 500 ms)
    let got = wait_for(
      || {
        looks.set(looks.get() + 1);
        looks.get() == 4
      },
      MS(500),
      POLL_EVERY,
      &mut clock,
    );
    assert!(got);
    assert_eq!(clock.now, MS(500));
  }

  #[test]
  fn a_zero_timeout_looks_once() {
    let mut clock = FakeClock::new();
    assert!(!wait_for(|| false, Duration::ZERO, POLL_EVERY, &mut clock));
    assert!(clock.sleeps.is_empty());
  }

  #[test]
  fn a_file_already_here_is_true_and_asks_nothing() {
    let mut clock = FakeClock::new();
    let asked = Cell::new(false);
    let got = ensure_downloaded_with(
      Path::new("/h/n/a.md"),
      MS(20_000),
      |p| p == Path::new("/h/n/a.md"),
      |_| {
        asked.set(true);
        Ok(())
      },
      &mut clock,
    );
    assert_eq!(got, Ok(true));
    assert!(!asked.get());
    assert!(clock.sleeps.is_empty());
  }

  #[test]
  fn no_file_and_no_placeholder_is_false_and_asks_nothing() {
    let mut clock = FakeClock::new();
    let asked = Cell::new(false);
    let got = ensure_downloaded_with(
      Path::new("/h/n/a.md"),
      MS(20_000),
      |_| false,
      |_| {
        asked.set(true);
        Ok(())
      },
      &mut clock,
    );
    assert_eq!(got, Ok(false));
    assert!(!asked.get());
  }

  #[test]
  fn a_placeholder_asks_icloud_for_the_file_and_waits_for_it() {
    let mut clock = FakeClock::new();
    let disk = RefCell::new(HashSet::from([PathBuf::from("/h/n/.a.md.icloud")]));
    let looks = Cell::new(0);
    let asked = RefCell::new(None);
    let got = ensure_downloaded_with(
      Path::new("/h/n/a.md"),
      MS(20_000),
      |p| {
        if p == Path::new("/h/n/a.md") {
          looks.set(looks.get() + 1);
          // lands on the third look after the request
          if looks.get() == 4 {
            disk.borrow_mut().insert(p.to_path_buf());
          }
        }
        disk.borrow().contains(p)
      },
      |p| {
        *asked.borrow_mut() = Some(p.to_path_buf());
        Ok(())
      },
      &mut clock,
    );
    assert_eq!(got, Ok(true));
    // asked for the file itself, not the placeholder
    assert_eq!(*asked.borrow(), Some(PathBuf::from("/h/n/a.md")));
    assert_eq!(clock.sleeps, vec![MS(200), MS(200)]);
  }

  #[test]
  fn a_placeholder_that_never_arrives_is_false_after_the_timeout() {
    let mut clock = FakeClock::new();
    let got = ensure_downloaded_with(
      Path::new("/h/n/a.md"),
      MS(20_000),
      |p| p == Path::new("/h/n/.a.md.icloud"),
      |_| Ok(()),
      &mut clock,
    );
    assert_eq!(got, Ok(false));
    assert_eq!(clock.now, MS(20_000));
    assert_eq!(clock.sleeps.len(), 100);
  }

  #[test]
  fn brctl_failing_is_an_error_not_a_missing_file() {
    let mut clock = FakeClock::new();
    let got = ensure_downloaded_with(
      Path::new("/h/n/a.md"),
      MS(20_000),
      |p| p == Path::new("/h/n/.a.md.icloud"),
      |_| Err("brctl: not found".into()),
      &mut clock,
    );
    assert!(got.is_err());
  }

  /// The real-disk path, on cases that never reach brctl (so this runs on any system).
  #[test]
  fn the_real_fetch_answers_from_disk_when_there_is_no_placeholder() {
    let dir = std::env::temp_dir().join(format!("elmar-icloud-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let here = dir.join("here.md");
    std::fs::write(&here, "x").unwrap();
    assert_eq!(fetch_with_brctl(&here, MS(20_000)), Ok(true));
    assert_eq!(fetch_with_brctl(&dir.join("gone.md"), MS(20_000)), Ok(false));
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn only_paths_under_home_without_dot_dot() {
    let home = Path::new("/Users/elmar");
    assert!(allowed(Path::new("/Users/elmar/Library/Mobile Documents/com~apple~CloudDocs/Elmar's App/notes/a.md"), home));
    assert!(!allowed(Path::new("/Users/elmar/../root/a.md"), home));
    assert!(!allowed(Path::new("/etc/passwd"), home));
    assert!(!allowed(Path::new("/Users/elmarx/a.md"), home));
    assert!(!allowed(Path::new("notes/a.md"), home));
    assert!(!allowed(Path::new("/Users/elmar"), home));
  }
}
