//! Game recordings for the web page's review tab. Each scenario start opens a new file in
//! %LOCALAPPDATA%\Arma 3\a3_bridge_replays, one JSON object per line: a header, then state frames
//! holding only what changed since the previous frame, plus every event and command result.

use crate::spec::Spec;
use crate::{log, map, VERSION};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const EXT: &str = "jsonl";
/// The end of a file read to find its duration.
const TAIL: u64 = 512 * 1024;
const MAX_COMMAND_PART: usize = 4096;

#[repr(C)]
#[derive(Default)]
struct SystemTimeParts {
    year: u16,
    month: u16,
    weekday: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    millis: u16,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetLocalTime(time: *mut SystemTimeParts);
}

fn local_stamp() -> String {
    let mut t = SystemTimeParts::default();
    unsafe { GetLocalTime(&mut t) };
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second)
}

pub fn dir() -> PathBuf {
    log::path().parent().map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("a3_bridge_replays")
}

/// Recording names are generated here; anything else is refused, so requests cannot leave the folder.
fn file_of(id: &str) -> Option<PathBuf> {
    let valid = !id.is_empty() && id.len() <= 160 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    valid.then(|| dir().join(format!("{id}.{EXT}")))
}

/// Numbers are rounded so that sensor noise does not count as a change: 0.1 inside arrays
/// (positions, in metres) and 0.01 for single values (health, fuel, time...).
fn round(v: &Value, in_array: bool) -> Value {
    match v {
        Value::Number(n) if n.is_f64() => {
            let f = n.as_f64().unwrap_or(0.0);
            let k = if in_array { 10.0 } else { 100.0 };
            json!((f * k).round() / k)
        }
        Value::Array(items) => Value::Array(items.iter().map(|x| round(x, true)).collect()),
        other => other.clone(),
    }
}

/// Command arguments and results are kept whole up to 4 KB (an exec_sqf answer can be far larger).
fn capped(v: &Value) -> Value {
    let text = v.to_string();
    if text.len() <= MAX_COMMAND_PART {
        return v.clone();
    }
    let mut end = MAX_COMMAND_PART;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    json!({"truncated": text.len(), "start": &text[..end]})
}

fn changed(old: Option<&Map<String, Value>>, new: &Map<String, Value>) -> Map<String, Value> {
    new.iter().filter(|(k, v)| old.and_then(|o| o.get(*k)) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect()
}

struct Recording {
    id: String,
    out: BufWriter<File>,
    /// Last written values: entity -> key (id, or name for markers) -> fields.
    last: HashMap<String, HashMap<String, Map<String, Value>>>,
    last_frame: Option<Instant>,
}

#[derive(Default)]
pub struct Recorder {
    current: Option<Recording>,
    game_time: f64,
}

impl Recorder {
    /// Closes the previous recording and opens a new one for the scenario that just started.
    pub fn begin(&mut self, spec: &Spec, mission: &str, world: &str, dedicated: bool, interval_ms: f64, max_files: usize) {
        self.end();
        self.game_time = 0.0;
        if let Err(e) = fs::create_dir_all(dir()) {
            log::write(format!("recording disabled: cannot create {}: {e}", dir().display()));
            return;
        }
        if max_files > 0 {
            prune(max_files - 1);
        }
        let mission_key: String = map::key(mission).chars().take(60).collect();
        let id = format!("{}_{}_{}", local_stamp(), map::key(world), if mission_key.is_empty() { "mission".into() } else { mission_key });
        let Some(path) = file_of(&id) else { return };
        let file = match File::create(&path) {
            Ok(f) => f,
            Err(e) => {
                log::write(format!("recording disabled: cannot create {}: {e}", path.display()));
                return;
            }
        };
        let header = json!({
            "type": "header",
            "format": 1,
            "version": VERSION,
            "mission": mission,
            "world": world,
            "dedicated": dedicated,
            "started_at": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            "interval_ms": interval_ms,
            "entities": spec.entities.iter().map(|e| json!({"name": e.name, "multiple": e.multiple, "fields": e.fields})).collect::<Vec<_>>(),
        });
        let mut rec = Recording { id, out: BufWriter::new(file), last: HashMap::new(), last_frame: None };
        let _ = writeln!(rec.out, "{header}");
        log::write(format!("recording to {}", path.display()));
        self.current = Some(rec);
    }

    pub fn end(&mut self) {
        if let Some(mut rec) = self.current.take() {
            let _ = rec.out.flush();
        }
    }

    pub fn current_id(&self) -> Option<String> {
        self.current.as_ref().map(|r| r.id.clone())
    }

    /// Called with every state snapshot; writes a frame when the recording interval has passed.
    pub fn state(&mut self, spec: &Spec, state: &Map<String, Value>, interval: Duration) {
        if let Some(t) = state.get("world").and_then(|w| w.get("time")).and_then(Value::as_f64) {
            self.game_time = t;
        }
        let Some(rec) = self.current.as_mut() else { return };
        if rec.last_frame.is_some_and(|t| t.elapsed() < interval) {
            return;
        }
        rec.last_frame = Some(Instant::now());
        let mut set = Map::new();
        let mut del = Map::new();
        for ent in &spec.entities {
            let rows: Vec<&Value> = match state.get(&ent.name) {
                Some(Value::Array(items)) if ent.multiple => items.iter().collect(),
                Some(v) if !ent.multiple => vec![v],
                _ => continue,
            };
            let key_field = ent.fields.first().map(String::as_str).unwrap_or("id");
            let last = rec.last.entry(ent.name.clone()).or_default();
            let mut seen = HashMap::new();
            let mut ent_set = Map::new();
            for row in rows {
                let Some(obj) = row.as_object() else { continue };
                let fields: Map<String, Value> = obj.iter().map(|(k, v)| (k.clone(), round(v, false))).collect();
                let key = if ent.multiple { obj.get(key_field).and_then(Value::as_str).unwrap_or_default().to_string() } else { String::new() };
                let diff = changed(last.get(&key), &fields);
                if !diff.is_empty() {
                    ent_set.insert(key.clone(), Value::Object(diff));
                }
                seen.insert(key, fields);
            }
            let gone: Vec<Value> = last.keys().filter(|k| !seen.contains_key(*k)).map(|k| Value::from(k.clone())).collect();
            *last = seen;
            if !ent.multiple {
                if let Some(Value::Object(diff)) = ent_set.remove("") {
                    set.insert(ent.name.clone(), Value::Object(diff));
                }
                continue;
            }
            if !ent_set.is_empty() {
                set.insert(ent.name.clone(), Value::Object(ent_set));
            }
            if !gone.is_empty() {
                del.insert(ent.name.clone(), Value::Array(gone));
            }
        }
        let frame = json!({"type": "frame", "t": round(&json!(self.game_time), false), "set": set, "del": del});
        let _ = writeln!(rec.out, "{frame}");
        // Flushed once per frame so the page can open a game still in progress.
        let _ = rec.out.flush();
    }

    /// An event message as sent to clients ({"type": "event", ...}).
    pub fn event(&mut self, msg: &str) {
        if let Some(rec) = self.current.as_mut() {
            let _ = writeln!(rec.out, "{msg}");
        }
    }

    pub fn command(&mut self, cmd: &str, args: &Value, source: &str, reply: &Value) {
        let Some(rec) = self.current.as_mut() else { return };
        let mut line = json!({"type": "command", "t": round(&json!(self.game_time), false), "cmd": cmd, "source": source, "args": capped(args)});
        if let (Value::Object(l), Value::Object(r)) = (&mut line, reply) {
            l.extend(r.iter().map(|(k, v)| (k.clone(), capped(v))));
        }
        let _ = writeln!(rec.out, "{line}");
    }
}

/// Deletes the oldest recordings so that at most `keep` remain.
fn prune(keep: usize) {
    let mut files = list_files();
    if files.len() <= keep {
        return;
    }
    files.sort();
    let excess = files.len() - keep;
    for path in files.into_iter().take(excess) {
        match fs::remove_file(&path) {
            Ok(()) => log::write(format!("old recording removed: {}", path.display())),
            Err(e) => log::write(format!("cannot remove old recording {}: {e}", path.display())),
        }
    }
}

fn list_files() -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir()) else { return Vec::new() };
    entries.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x == EXT)).collect()
}

/// Header and duration of each recording, newest first.
pub fn list(current: Option<&str>) -> Value {
    let mut files = list_files();
    files.sort();
    files.reverse();
    let items: Vec<Value> = files
        .iter()
        .filter_map(|path| {
            let id = path.file_stem()?.to_str()?.to_string();
            let size = fs::metadata(path).ok()?.len();
            let mut first = String::new();
            BufReader::new(File::open(path).ok()?).read_line(&mut first).ok()?;
            let header: Value = serde_json::from_str(&first).ok()?;
            Some(json!({
                "id": id,
                "mission": header["mission"],
                "world": header["world"],
                "dedicated": header["dedicated"],
                "started_at": header["started_at"],
                "duration": duration(path),
                "bytes": size,
                "recording": current == Some(id.as_str()),
            }))
        })
        .collect();
    json!({"replays": items, "recording": current, "folder": dir().display().to_string()})
}

/// Game time of the last frame, read from the end of the file.
fn duration(path: &PathBuf) -> f64 {
    let Ok(mut f) = File::open(path) else { return 0.0 };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(TAIL)));
    let mut tail = Vec::new();
    let _ = f.read_to_end(&mut tail);
    String::from_utf8_lossy(&tail)
        .lines()
        .rev()
        .filter(|l| l.starts_with("{\"type\":\"frame\""))
        .find_map(|l| serde_json::from_str::<Value>(l).ok()?["t"].as_f64())
        .unwrap_or(0.0)
}

pub fn read(id: &str) -> Option<String> {
    fs::read_to_string(file_of(id)?).ok()
}
