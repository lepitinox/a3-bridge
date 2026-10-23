//! Shared state between the game thread (callExtension) and the network threads:
//! command queue, pending results, latest state snapshot, event history and connected clients.

use crate::catalog::CatalogStore;
use crate::map::MapStore;
use crate::settings::Settings;
use crate::spec::{BridgeError, Spec};
use crate::{log, net, sqf, VERSION};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, VecDeque};
use std::ffi::c_int;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// The game counts as connected while it polled within this delay.
const GAME_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_QUEUE: usize = 1000;
const MAX_CHUNKS: usize = 64 * 1024 * 1024;
const CLIENT_BACKLOG: usize = 256;

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

pub fn get() -> &'static Bridge {
    BRIDGE.get_or_init(Bridge::new)
}

/// Entry point for every callExtension call; returns the output text and the return code.
pub fn call(function: &str, args: &[Vec<u8>], output_size: usize) -> (String, c_int) {
    let b = get();
    let arg = |i: usize| args.get(i).map(|a| String::from_utf8_lossy(&sqf::unquote(a)).into_owned()).unwrap_or_default();
    match function {
        "version" => (VERSION.to_string(), 0),
        "start" => b.start(&arg(0), &arg(1), arg(2) == "true"),
        "poll" => (b.poll(arg(0).parse::<f64>().map(|f| f.max(1.0) as usize).unwrap_or(25), output_size), 0),
        "chunk" => {
            b.chunk(args);
            (String::new(), 0)
        }
        "commit" => {
            b.commit(&arg(0));
            (String::new(), 0)
        }
        "catalog_needed" => (if lock(&b.catalog).needed() { "1" } else { "0" }.to_string(), 0),
        "catalog_begin" => {
            lock(&b.catalog).begin();
            (String::new(), 0)
        }
        "catalog_add" => {
            lock(&b.catalog).add(&arg(0), &arg(1));
            (String::new(), 0)
        }
        "catalog_commit" => {
            lock(&b.catalog).commit(&b.spec);
            (String::new(), 0)
        }
        "map_needed" => {
            let needed = lock(&b.maps).needed(&arg(0), arg(1).parse().unwrap_or(0.0));
            (if needed { "1" } else { "0" }.to_string(), 0)
        }
        "map_begin" => {
            lock(&b.maps).begin(&arg(0), arg(1).parse().unwrap_or(0.0), arg(2).parse::<f64>().unwrap_or(0.0) as u64, arg(3).parse::<f64>().unwrap_or(0.0) as u64);
            (String::new(), 0)
        }
        "map_add" => {
            lock(&b.maps).add(&arg(0), &arg(1));
            (String::new(), 0)
        }
        "map_progress" => {
            lock(&b.maps).progress(arg(0).parse().unwrap_or(0.0), &arg(1));
            (String::new(), 0)
        }
        "map_commit" => {
            lock(&b.maps).commit();
            (String::new(), 0)
        }
        _ => (format!("unknown function '{function}'"), 1),
    }
}

pub enum Waiter {
    Http(mpsc::Sender<Value>),
    Ws(Arc<Client>, Value),
}

struct Pending {
    cmd: usize,
    deadline: Instant,
    polled: bool,
    waiter: Waiter,
}

struct Mission {
    mission: String,
    world: String,
    dedicated: bool,
}

#[derive(Default)]
struct Inner {
    queue: VecDeque<(u64, String)>,
    outbound: Vec<u8>,
    outbound_pos: usize,
    chunks: Vec<u8>,
    pending: HashMap<u64, Pending>,
    last_poll: Option<Instant>,
    mission: Option<Mission>,
    state: Option<Arc<str>>,
    events: VecDeque<(u64, Arc<str>)>,
}

impl Inner {
    fn game_connected(&self) -> bool {
        self.last_poll.is_some_and(|t| t.elapsed() < GAME_TIMEOUT)
    }
}

pub struct Client {
    pub id: u64,
    out: Mutex<VecDeque<Arc<str>>>,
    pub want_state: AtomicBool,
    pub want_events: AtomicBool,
    pub state_every: AtomicU64,
    state_counter: AtomicU64,
}

impl Client {
    pub fn push(&self, msg: Arc<str>) {
        let mut out = lock(&self.out);
        if out.len() >= CLIENT_BACKLOG {
            out.pop_front();
        }
        out.push_back(msg);
    }

    pub fn take(&self) -> Vec<Arc<str>> {
        lock(&self.out).drain(..).collect()
    }

    fn wants_this_state(&self) -> bool {
        self.want_state.load(Ordering::Relaxed)
            && self.state_counter.fetch_add(1, Ordering::Relaxed) % self.state_every.load(Ordering::Relaxed).max(1) == 0
    }
}

pub struct Bridge {
    pub spec: Spec,
    pub settings: Settings,
    inner: Mutex<Inner>,
    clients: Mutex<Vec<Arc<Client>>>,
    pub maps: Mutex<MapStore>,
    pub catalog: Mutex<CatalogStore>,
    server: Mutex<Option<Result<(), String>>>,
    next_req: AtomicU64,
    next_client: AtomicU64,
    state_seq: AtomicU64,
    event_seq: AtomicU64,
}

pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn zip(fields: &[String], row: &Value) -> Value {
    let values = row.as_array();
    let mut obj = Map::new();
    for (i, f) in fields.iter().enumerate() {
        obj.insert(f.clone(), values.and_then(|v| v.get(i)).cloned().unwrap_or(Value::Null));
    }
    Value::Object(obj)
}

impl Bridge {
    fn new() -> Bridge {
        let spec = Spec::load();
        let settings = Settings::load(&spec);
        Bridge {
            spec,
            settings,
            inner: Mutex::new(Inner::default()),
            clients: Mutex::new(Vec::new()),
            maps: Mutex::new(MapStore::default()),
            catalog: Mutex::new(CatalogStore::default()),
            server: Mutex::new(None),
            next_req: AtomicU64::new(0),
            next_client: AtomicU64::new(0),
            state_seq: AtomicU64::new(0),
            event_seq: AtomicU64::new(0),
        }
    }

    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.settings.num("command_timeout_ms").max(100.0) as u64)
    }

    /// Starts the network side once per game process; later calls return the first outcome.
    pub fn ensure_server(&'static self) -> Result<(), String> {
        lock(&self.server).get_or_insert_with(|| net::start(self)).clone()
    }

    // ------------------------------------------------------------ game side

    fn start(&'static self, mission: &str, world: &str, dedicated: bool) -> (String, c_int) {
        let server = self.ensure_server();
        let dropped: Vec<Pending> = {
            let mut inner = lock(&self.inner);
            inner.queue.clear();
            inner.outbound.clear();
            inner.outbound_pos = 0;
            inner.chunks.clear();
            inner.state = None;
            inner.last_poll = Some(Instant::now());
            inner.mission = Some(Mission { mission: mission.into(), world: world.into(), dedicated });
            inner.pending.drain().map(|(_, p)| p).collect()
        };
        for p in dropped {
            self.deliver(p.waiter, BridgeError::new("mission_restarted", "a new scenario started before this command ran").to_json());
        }
        match &server {
            Ok(()) => log::write(format!("scenario '{mission}' on {world} started (dedicated: {dedicated})")),
            Err(e) => log::write(format!("scenario '{mission}' started but the gateway is down: {e}")),
        }
        (self.settings.sqf_array(), if server.is_ok() { 0 } else { 2 })
    }

    /// Hands the next part of the pending command batch to the game: "1<part>" while more
    /// follows, "0<last part>" at the end, "" when nothing is waiting.
    fn poll(&self, max: usize, output_size: usize) -> String {
        let mut inner = lock(&self.inner);
        inner.last_poll = Some(Instant::now());
        if inner.outbound_pos >= inner.outbound.len() {
            inner.outbound.clear();
            inner.outbound_pos = 0;
            let mut items = Vec::new();
            while items.len() < max {
                let Some((req, text)) = inner.queue.pop_front() else { break };
                if let Some(p) = inner.pending.get_mut(&req) {
                    p.polled = true;
                    items.push(text);
                }
            }
            if items.is_empty() {
                return String::new();
            }
            inner.outbound = format!("[{}]", items.join(",")).into_bytes();
        }
        let rest = &inner.outbound[inner.outbound_pos..];
        let mut n = rest.len().min(output_size.saturating_sub(2).max(1));
        while n > 0 && n < rest.len() && (rest[n] & 0xC0) == 0x80 {
            n -= 1;
        }
        let more = n < rest.len();
        let part = format!("{}{}", if more { '1' } else { '0' }, String::from_utf8_lossy(&rest[..n]));
        inner.outbound_pos += n;
        part
    }

    fn chunk(&self, args: &[Vec<u8>]) {
        let mut inner = lock(&self.inner);
        if inner.chunks.len() > MAX_CHUNKS {
            log::write("dropping oversized uncommitted data");
            inner.chunks.clear();
        }
        for a in args {
            inner.chunks.extend_from_slice(&sqf::unquote(a));
        }
    }

    fn commit(&self, kind: &str) {
        let data = std::mem::take(&mut lock(&self.inner).chunks);
        let value = sqf::parse(&String::from_utf8_lossy(&data));
        match kind {
            "state" => self.on_state(value),
            "events" => self.on_events(value),
            "result" => self.on_result(value),
            _ => log::write(format!("commit of unknown kind '{kind}'")),
        }
    }

    fn on_state(&self, value: Value) {
        let parts = value.as_array().cloned().unwrap_or_default();
        let mut obj = Map::new();
        obj.insert("type".into(), "state".into());
        obj.insert("seq".into(), (self.state_seq.fetch_add(1, Ordering::Relaxed) + 1).into());
        for (i, ent) in self.spec.entities.iter().enumerate() {
            let part = parts.get(i).cloned().unwrap_or(Value::Null);
            let v = if ent.multiple {
                Value::Array(part.as_array().into_iter().flatten().map(|row| zip(&ent.fields, row)).collect())
            } else {
                zip(&ent.fields, &part)
            };
            obj.insert(ent.name.clone(), v);
        }
        let text: Arc<str> = Value::Object(obj).to_string().into();
        lock(&self.inner).state = Some(text.clone());
        for c in lock(&self.clients).iter() {
            if c.wants_this_state() {
                c.push(text.clone());
            }
        }
    }

    fn on_events(&self, value: Value) {
        let history = self.settings.num("event_history").max(1.0) as usize;
        let mut fresh = Vec::new();
        for ev in value.as_array().into_iter().flatten() {
            let name = ev.get(0).and_then(Value::as_str).unwrap_or_default().to_string();
            let data = ev.get(2).cloned().unwrap_or(Value::Null);
            let data = match self.spec.events.iter().find(|e| e.name == name) {
                Some(spec) => zip(&spec.fields, &data),
                None => data,
            };
            let seq = self.event_seq.fetch_add(1, Ordering::Relaxed) + 1;
            let msg = json!({"type": "event", "seq": seq, "event": name, "time": ev.get(1).cloned().unwrap_or(Value::Null), "data": data});
            fresh.push((seq, Arc::<str>::from(msg.to_string())));
        }
        {
            let mut inner = lock(&self.inner);
            for e in &fresh {
                inner.events.push_back(e.clone());
            }
            while inner.events.len() > history {
                inner.events.pop_front();
            }
        }
        for c in lock(&self.clients).iter() {
            if c.want_events.load(Ordering::Relaxed) {
                for (_, msg) in &fresh {
                    c.push(msg.clone());
                }
            }
        }
    }

    fn on_result(&self, value: Value) {
        let req = value.get(0).and_then(Value::as_str).and_then(|s| s.parse::<u64>().ok());
        let Some(p) = req.and_then(|r| lock(&self.inner).pending.remove(&r)) else {
            return; // timed out or from a previous scenario
        };
        let ok = value.get(1).and_then(Value::as_bool).unwrap_or(false);
        let payload = value.get(2).cloned().unwrap_or(Value::Null);
        let reply = if ok {
            json!({"ok": true, "result": zip(&self.spec.commands[p.cmd].returns, &payload)})
        } else {
            let message = payload.as_str().map(String::from).unwrap_or_else(|| payload.to_string());
            BridgeError::new("execution_error", message).to_json()
        };
        self.deliver(p.waiter, reply);
    }

    // ------------------------------------------------------------ network side

    /// Validates and queues a command; the result reaches `waiter` later.
    pub fn submit(&self, cmd: &str, args: &Value, waiter: Waiter) -> Result<u64, (BridgeError, Waiter)> {
        let (idx, sqf_args) = match self.spec.build_call(cmd, args) {
            Ok(x) => x,
            Err(e) => return Err((e, waiter)),
        };
        let mut inner = lock(&self.inner);
        if !inner.game_connected() {
            return Err((BridgeError::new("game_not_running", "no scenario with the a3_bridge mod is running"), waiter));
        }
        if inner.queue.len() >= MAX_QUEUE {
            return Err((BridgeError::new("busy", "too many commands waiting; retry later"), waiter));
        }
        let req = self.next_req.fetch_add(1, Ordering::Relaxed) + 1;
        inner.queue.push_back((req, format!("[\"{req}\",{},{sqf_args}]", sqf::string(cmd))));
        inner.pending.insert(req, Pending { cmd: idx, deadline: Instant::now() + self.timeout(), polled: false, waiter });
        Ok(req)
    }

    pub fn deliver(&self, waiter: Waiter, reply: Value) {
        match waiter {
            Waiter::Http(tx) => {
                let _ = tx.send(reply);
            }
            Waiter::Ws(client, id) => {
                let mut msg = Map::new();
                msg.insert("type".into(), "result".into());
                msg.insert("id".into(), id);
                if let Value::Object(fields) = reply {
                    msg.extend(fields);
                }
                client.push(Value::Object(msg).to_string().into());
            }
        }
    }

    /// Fails commands whose deadline passed; called periodically by the janitor thread.
    pub fn expire(&self) {
        let now = Instant::now();
        let expired: Vec<Pending> = {
            let mut inner = lock(&self.inner);
            let ids: Vec<u64> = inner.pending.iter().filter(|(_, p)| p.deadline <= now).map(|(id, _)| *id).collect();
            inner.queue.retain(|(id, _)| !ids.contains(id));
            ids.iter().filter_map(|id| inner.pending.remove(id)).collect()
        };
        for p in expired {
            let message = if p.polled {
                "the game took the command but did not answer in time; it may still have run"
            } else {
                "the game did not pick the command up in time; it was not run"
            };
            self.deliver(p.waiter, BridgeError::new("timeout", message).to_json());
        }
    }

    pub fn state(&self) -> Option<Arc<str>> {
        lock(&self.inner).state.clone()
    }

    pub fn events_since(&self, since: u64, limit: usize) -> (Vec<Arc<str>>, u64) {
        let inner = lock(&self.inner);
        let events = inner.events.iter().filter(|(s, _)| *s > since).take(limit).map(|(_, e)| e.clone()).collect();
        (events, self.event_seq.load(Ordering::Relaxed))
    }

    pub fn health(&self) -> Value {
        let inner = lock(&self.inner);
        json!({
            "ok": true,
            "version": VERSION,
            "game_connected": inner.game_connected(),
            "mission": inner.mission.as_ref().map(|m| json!({"mission": m.mission, "world": m.world, "dedicated": m.dedicated})),
            "state_seq": self.state_seq.load(Ordering::Relaxed),
            "event_seq": self.event_seq.load(Ordering::Relaxed),
            "queued_commands": inner.queue.len(),
            "clients": lock(&self.clients).len(),
            "map": lock(&self.maps).status_json(),
            "catalog": lock(&self.catalog).status_json(),
            "settings": self.settings.as_json(),
        })
    }

    pub fn add_client(&self) -> Option<Arc<Client>> {
        let mut clients = lock(&self.clients);
        if clients.len() >= self.settings.num("max_clients").max(1.0) as usize {
            return None;
        }
        let c = Arc::new(Client {
            id: self.next_client.fetch_add(1, Ordering::Relaxed) + 1,
            out: Mutex::new(VecDeque::new()),
            want_state: AtomicBool::new(true),
            want_events: AtomicBool::new(true),
            state_every: AtomicU64::new(1),
            state_counter: AtomicU64::new(0),
        });
        clients.push(c.clone());
        Some(c)
    }

    pub fn remove_client(&self, id: u64) {
        lock(&self.clients).retain(|c| c.id != id);
    }
}
