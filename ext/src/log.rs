//! Append-only log file next to the game's own logs (%LOCALAPPDATA%\Arma 3\a3_bridge.log).

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static FILE: OnceLock<Mutex<Option<File>>> = OnceLock::new();

pub fn path() -> PathBuf {
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("Arma 3"))
        .filter(|d| d.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    dir.join("a3_bridge.log")
}

pub fn write(msg: impl AsRef<str>) {
    let file = FILE.get_or_init(|| Mutex::new(OpenOptions::new().create(true).append(true).open(path()).ok()));
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    if let Ok(mut f) = file.lock() {
        if let Some(f) = f.as_mut() {
            let _ = writeln!(f, "[{}.{:03}] {}", now.as_secs(), now.subsec_millis(), msg.as_ref());
        }
    }
}
