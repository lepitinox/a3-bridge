//! Local gateway: one TCP port on 127.0.0.1 serving plain HTTP requests and WebSocket upgrades.
//!
//! Browser requests are only accepted from the gateway's own test page (Origin
//! http://127.0.0.1:<port> or http://localhost:<port>), and a Host other than the loopback is
//! refused, so other websites cannot drive the game through the user's browser.

use crate::bridge::{Bridge, Client, Waiter};
use crate::spec::{BridgeError, SPEC_JSON, TOOLS_JSON, UI_HTML};
use crate::{log, VERSION};
use serde_json::{json, Value};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::Ordering;
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;
use tungstenite::protocol::Role;
use tungstenite::{Message, WebSocket};

const MAX_HEAD: usize = 64 * 1024;
const MAX_BODY: usize = 1024 * 1024;

pub fn start(bridge: &'static Bridge) -> Result<(), String> {
    let port = bridge.settings.num("port") as u16;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("cannot listen on 127.0.0.1:{port}: {e}"))?;
    log::write(format!("{VERSION} listening on http://127.0.0.1:{port} and ws://127.0.0.1:{port}"));
    thread::Builder::new()
        .name("a3_bridge-accept".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let _ = thread::Builder::new().name("a3_bridge-conn".into()).spawn(move || handle(bridge, stream));
            }
        })
        .map_err(|e| e.to_string())?;
    thread::Builder::new()
        .name("a3_bridge-janitor".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(200));
            bridge.expire();
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

struct Request {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    rest: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    fn query_param(&self, key: &str) -> Option<&str> {
        self.query.split('&').filter_map(|kv| kv.split_once('=')).find(|(k, _)| *k == key).map(|(_, v)| v)
    }
}

fn read_head(stream: &mut TcpStream) -> Option<Request> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
        let n = stream.read(&mut tmp).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
    };
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);
    req.parse(&buf[..end]).ok()?;
    let target = req.path?.to_string();
    let (path, query) = target.split_once('?').map(|(p, q)| (p.to_string(), q.to_string())).unwrap_or((target, String::new()));
    Some(Request {
        method: req.method?.to_string(),
        path,
        query,
        headers: req.headers.iter().map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).into_owned())).collect(),
        rest: buf[end..].to_vec(),
    })
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    respond_typed(stream, status, "application/json", body);
}

fn respond_typed(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body.as_bytes()));
}

/// The test page: ui\index.html in the mod folder when present (editable while the game runs),
/// else the copy built into the DLL.
fn ui_page() -> String {
    crate::settings::dll_dir()
        .map(|d| d.join("ui").join("index.html"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| UI_HTML.to_string())
}

fn error_body(code: &str, message: &str) -> String {
    json!({"ok": false, "error": {"code": code, "message": message}}).to_string()
}

fn status_for(reply: &Value) -> u16 {
    match reply["error"]["code"].as_str() {
        None => 200,
        Some("unknown_command" | "invalid_args" | "invalid_json") => 400,
        Some("game_not_running" | "busy" | "mission_restarted") => 503,
        Some("timeout") => 504,
        Some(_) => 422,
    }
}

/// Only loopback hosts are accepted, which defeats DNS rebinding from websites.
fn host_allowed(host: Option<&str>) -> bool {
    let Some(host) = host else { return true };
    let name = if host.starts_with('[') {
        host.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or_default().to_string()
    };
    matches!(name.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "[::1]")
}

/// No Origin means a non-browser client; a browser is only trusted on our own test page.
fn origin_allowed(origin: Option<&str>, port: u16) -> bool {
    match origin.map(str::trim) {
        None | Some("") => true,
        Some(o) => o.eq_ignore_ascii_case(&format!("http://127.0.0.1:{port}")) || o.eq_ignore_ascii_case(&format!("http://localhost:{port}")),
    }
}

fn handle(bridge: &'static Bridge, mut stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let Some(req) = read_head(&mut stream) else { return };

    let port = bridge.settings.num("port") as u16;
    if !origin_allowed(req.header("origin"), port) || !host_allowed(req.header("host")) {
        respond(&mut stream, 403, &error_body("forbidden", "requests from other websites or hosts are refused"));
        return;
    }
    let wants_html = req.header("accept").is_some_and(|a| a.contains("text/html"));
    let upgrade = req.header("upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket"));
    if upgrade {
        websocket(bridge, stream, req);
        return;
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/ui") | ("GET", "/ui/") => respond_typed(&mut stream, 200, "text/html", &ui_page()),
        ("GET", "/") if wants_html => respond_typed(&mut stream, 200, "text/html", &ui_page()),
        ("GET", "/") => respond(
            &mut stream,
            200,
            &json!({
                "name": "A3 Bridge",
                "version": VERSION,
                "endpoints": {
                    "GET /ui": "web test page",
                    "GET /map/<world>": "background map of a world (built by the game, cached)",
                    "GET /catalog": "placeable classes, groups, marker types and colours read from the game",
                    "GET /spec": "protocol description generated from the design tables",
                    "GET /health": "gateway and game status",
                    "GET /state": "latest state snapshot",
                    "GET /events?since=<seq>&limit=<n>": "events after a sequence number",
                    "GET /schema": "command descriptions as LLM tool definitions",
                    "POST /command": "{\"cmd\": name, \"args\": {...}} and wait for the result",
                    "WebSocket /": "live state and events; send {\"type\":\"command\",...}"
                }
            })
            .to_string(),
        ),
        ("GET", "/health") => respond(&mut stream, 200, &bridge.health().to_string()),
        ("GET", "/state") => match bridge.state() {
            Some(s) => respond(&mut stream, 200, &s),
            None => respond(&mut stream, 503, &error_body("no_state", "no state received from the game yet")),
        },
        ("GET", "/events") => {
            let since = req.query_param("since").and_then(|s| s.parse().ok()).unwrap_or(0);
            let limit = req.query_param("limit").and_then(|s| s.parse().ok()).unwrap_or(500).min(5000);
            let (events, last) = bridge.events_since(since, limit);
            let joined: Vec<&str> = events.iter().map(|e| e.as_ref()).collect();
            respond(&mut stream, 200, &format!("{{\"events\":[{}],\"last_seq\":{last}}}", joined.join(",")));
        }
        ("GET", path) if path.starts_with("/map/") => {
            let world = &path["/map/".len()..];
            let map = crate::bridge::lock(&bridge.maps).get(world);
            match map {
                Some(m) => respond(&mut stream, 200, &m),
                None => {
                    let status = crate::bridge::lock(&bridge.maps).status_json();
                    let body = json!({"ok": false, "error": {"code": "map_not_ready", "message": "no map built for this world yet"}, "status": status});
                    respond(&mut stream, 404, &body.to_string());
                }
            }
        }
        ("GET", "/catalog") => {
            let catalog = crate::bridge::lock(&bridge.catalog).get();
            match catalog {
                Some(c) => respond(&mut stream, 200, &c),
                None => respond(&mut stream, 404, &error_body("catalog_not_ready", "the game has not finished reading its catalog yet")),
            }
        }
        ("GET", "/spec") => respond(&mut stream, 200, SPEC_JSON),
        ("GET", "/schema") => respond(&mut stream, 200, &format!("{{\"version\":\"{VERSION}\",\"tools\":{TOOLS_JSON}}}")),
        ("POST", "/command") => http_command(bridge, &mut stream, req),
        _ => respond(&mut stream, 404, &error_body("not_found", "unknown endpoint; GET / lists them")),
    }
}

fn http_command(bridge: &'static Bridge, stream: &mut TcpStream, req: Request) {
    let len: usize = req.header("content-length").and_then(|l| l.trim().parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        respond(stream, 413, &error_body("too_large", "body over 1 MB"));
        return;
    }
    let mut body = req.rest;
    while body.len() < len {
        let mut tmp = vec![0u8; len - body.len()];
        match stream.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&tmp[..n]),
        }
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&body) else {
        respond(stream, 400, &error_body("invalid_json", "body must be JSON: {\"cmd\": ..., \"args\": {...}}"));
        return;
    };
    let (tx, rx) = mpsc::channel();
    let cmd = msg["cmd"].as_str().unwrap_or_default();
    if let Err((e, _)) = bridge.submit(cmd, &msg["args"], Waiter::Http(tx)) {
        let reply = e.to_json();
        respond(stream, status_for(&reply), &reply.to_string());
        return;
    }
    // The janitor always answers by the deadline; the margin only covers a stuck process.
    let reply = rx
        .recv_timeout(bridge.timeout() + Duration::from_secs(2))
        .unwrap_or_else(|_| BridgeError::new("timeout", "no answer").to_json());
    respond(stream, status_for(&reply), &reply.to_string());
}

fn websocket(bridge: &'static Bridge, mut stream: TcpStream, req: Request) {
    let Some(key) = req.header("sec-websocket-key") else {
        respond(&mut stream, 400, &error_body("bad_handshake", "missing Sec-WebSocket-Key"));
        return;
    };
    let Some(client) = bridge.add_client() else {
        respond(&mut stream, 503, &error_body("too_many_clients", "max_clients reached"));
        return;
    };
    let accept = tungstenite::handshake::derive_accept_key(key.as_bytes());
    let head = format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n");
    if stream.write_all(head.as_bytes()).is_err() {
        bridge.remove_client(client.id);
        return;
    }
    // A short read timeout turns the blocking socket into a polling loop that also drains outgoing messages.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(5)));
    let mut ws = WebSocket::from_partially_read(stream, req.rest, Role::Server, None);
    log::write(format!("client {} connected", client.id));

    let hello = json!({
        "type": "hello",
        "version": VERSION,
        "commands": bridge.spec.command_names(),
        "health": bridge.health(),
    });
    client.push(hello.to_string().into());
    if let Some(s) = bridge.state() {
        client.push(s);
    }

    'session: loop {
        match ws.read() {
            Ok(Message::Text(text)) => on_client_message(bridge, &client, text.as_str()),
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        let out = client.take();
        if out.is_empty() {
            match ws.flush() {
                Ok(()) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(_) => break,
            }
        }
        for msg in out {
            if ws.send(Message::text(msg.as_ref())).is_err() {
                break 'session;
            }
        }
    }
    bridge.remove_client(client.id);
    log::write(format!("client {} disconnected", client.id));
}

fn on_client_message(bridge: &'static Bridge, client: &Arc<Client>, text: &str) {
    let reply = |v: Value| client.push(v.to_string().into());
    let Ok(msg) = serde_json::from_str::<Value>(text) else {
        reply(json!({"type": "error", "error": {"code": "invalid_json", "message": "messages must be JSON objects"}}));
        return;
    };
    let kind = msg["type"].as_str().unwrap_or(if msg.get("cmd").is_some() { "command" } else { "" });
    match kind {
        "command" => {
            let id = msg.get("id").cloned().unwrap_or(Value::Null);
            let cmd = msg["cmd"].as_str().unwrap_or_default();
            if let Err((e, waiter)) = bridge.submit(cmd, &msg["args"], Waiter::Ws(client.clone(), id)) {
                bridge.deliver(waiter, e.to_json());
            }
        }
        "subscribe" => {
            if let Some(b) = msg["state"].as_bool() {
                client.want_state.store(b, Ordering::Relaxed);
            }
            if let Some(b) = msg["events"].as_bool() {
                client.want_events.store(b, Ordering::Relaxed);
            }
            if let Some(n) = msg["state_every"].as_u64() {
                client.state_every.store(n.max(1), Ordering::Relaxed);
            }
            reply(json!({
                "type": "subscribed",
                "state": client.want_state.load(Ordering::Relaxed),
                "events": client.want_events.load(Ordering::Relaxed),
                "state_every": client.state_every.load(Ordering::Relaxed),
            }));
        }
        "get_state" => match bridge.state() {
            Some(s) => client.push(s),
            None => reply(json!({"type": "error", "error": {"code": "no_state", "message": "no state received from the game yet"}})),
        },
        "health" => reply(json!({"type": "health", "health": bridge.health()})),
        "ping" => reply(json!({"type": "pong", "id": msg.get("id").cloned().unwrap_or(Value::Null)})),
        _ => reply(json!({"type": "error", "error": {"code": "unknown_type", "message": "type must be command, subscribe, get_state, health or ping"}})),
    }
}
