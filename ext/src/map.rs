//! Background maps for the web page. The game builds one per world (fn_exportMap.sqf) and sends it
//! in small pieces; the result is cached in %LOCALAPPDATA%\Arma 3\a3_bridge_maps\<world>.json.

use crate::{log, sqf};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

struct Build {
    world: String,
    size: f64,
    n: u64,
    forest_n: u64,
    sections: HashMap<String, Vec<Value>>,
}

struct Status {
    world: String,
    progress: f64,
    stage: String,
}

#[derive(Default)]
pub struct MapStore {
    build: Option<Build>,
    ready: HashMap<String, Arc<str>>,
    status: Option<Status>,
}

/// File-safe, case-insensitive key for a world name.
pub fn key(world: &str) -> String {
    world.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect::<String>().to_ascii_lowercase()
}

fn dir() -> PathBuf {
    log::path().parent().map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("a3_bridge_maps")
}

fn file(world: &str) -> PathBuf {
    dir().join(format!("{}.json", key(world)))
}

impl MapStore {
    /// The cached map of a world, from memory or disk.
    pub fn get(&mut self, world: &str) -> Option<Arc<str>> {
        let k = key(world);
        if k.is_empty() {
            return None;
        }
        if let Some(m) = self.ready.get(&k) {
            return Some(m.clone());
        }
        let text: Arc<str> = std::fs::read_to_string(file(world)).ok()?.into();
        self.ready.insert(k, text.clone());
        Some(text)
    }

    /// True when the game must build this world's map (none cached, or cached for another size).
    pub fn needed(&mut self, world: &str, size: f64) -> bool {
        let cached_size = self.get(world).and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["size"].as_f64());
        if cached_size == Some(size) {
            self.status = Some(Status { world: world.into(), progress: 100.0, stage: "ready".into() });
            return false;
        }
        self.status = Some(Status { world: world.into(), progress: 0.0, stage: "waiting".into() });
        true
    }

    pub fn begin(&mut self, world: &str, size: f64, n: u64, forest_n: u64) {
        self.build = Some(Build { world: world.into(), size, n, forest_n, sections: HashMap::new() });
        self.progress(0.0, "heights");
    }

    pub fn add(&mut self, section: &str, text: &str) {
        if let (Some(b), Value::Array(items)) = (self.build.as_mut(), sqf::parse(text)) {
            b.sections.entry(section.to_string()).or_default().extend(items);
        }
    }

    pub fn progress(&mut self, progress: f64, stage: &str) {
        if let Some(s) = self.status.as_mut() {
            s.progress = progress;
            s.stage = stage.into();
        }
    }

    pub fn commit(&mut self) {
        let Some(b) = self.build.take() else { return };
        // add() already appended each piece's elements, so sections hold heights or items directly.
        let flat = |name: &str| -> Vec<Value> { b.sections.get(name).cloned().unwrap_or_default() };
        let heights = flat("heights");
        let forest = flat("forest");
        if heights.len() as u64 != b.n * b.n {
            log::write(format!("map of {} rejected: {} heights instead of {}", b.world, heights.len(), b.n * b.n));
            self.progress(0.0, "failed");
            return;
        }
        let generated = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let map = json!({
            "world": b.world,
            "size": b.size,
            "generated_at": generated,
            "heights": {"n": b.n, "cell": b.size / b.n as f64, "data": heights},
            "forest": {"n": b.forest_n, "cell": b.size / b.forest_n.max(1) as f64, "data": forest},
            "roads": flat("roads"),
            "buildings": flat("buildings"),
            "places": flat("places"),
        });
        let text: Arc<str> = map.to_string().into();
        let path = file(&b.world);
        match std::fs::create_dir_all(dir()).and_then(|_| std::fs::write(&path, text.as_bytes())) {
            Ok(()) => log::write(format!("map of {} cached in {} ({} KB)", b.world, path.display(), text.len() / 1024)),
            Err(e) => log::write(format!("map of {} not cached: {e}", b.world)),
        }
        self.ready.insert(key(&b.world), text);
        self.progress(100.0, "ready");
    }

    pub fn status_json(&self) -> Value {
        match &self.status {
            Some(s) => json!({"world": s.world, "progress": s.progress, "stage": s.stage, "ready": s.stage == "ready"}),
            None => Value::Null,
        }
    }
}
