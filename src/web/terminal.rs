//! The web terminal (js_web_terminal.js): a WebSocket on the views server
//! at /admin[/<guid>]/api/terminal/ws that runs a shell in a
//! pseudo-terminal for an authenticated admin session. Messages are JSON:
//! `{type: 'input', data}` and `{type: 'resize', cols, rows}` from the
//! browser; `ready`, `output`, `exit` and `error` to it.

use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::server::{ws_handshake, BoxIo, Conn, Head, Upgrade};
use super::session;
use super::Web;
use droneengage_server_common::colors as c;
use droneengage_server_common::util::{js_interp, js_parse_bytes, js_stringify, js_truthy};

/// `^/admin/(?:<guid>/)?api/terminal/ws$`
fn path_matches(p_guid: Option<&str>, p_path: &str) -> bool {
    if p_path == "/admin/api/terminal/ws" {
        return true;
    }
    match p_guid {
        Some(g) => p_path == format!("/admin/{}/api/terminal/ws", g),
        None => false,
    }
}

/// `new URL(origin).host`
fn origin_host(p_origin: &str) -> Option<String> {
    let (v_scheme, v_rest) = p_origin.split_once("://")?;
    if v_scheme.is_empty() || !v_scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
        return None;
    }
    let v_authority = v_rest.split(['/', '?', '#']).next().unwrap_or("");
    let v_host = v_authority.rsplit('@').next().unwrap_or("").to_ascii_lowercase();
    if v_host.is_empty() {
        return None;
    }
    // default ports are dropped
    let v_default = match v_scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => Some(":80"),
        "https" | "wss" => Some(":443"),
        _ => None,
    };
    Some(match v_default {
        Some(d) if v_host.ends_with(d) => v_host[..v_host.len() - d.len()].to_string(),
        _ => v_host,
    })
}

async fn refuse(mut p_conn: Conn<BoxIo>, p_status: &str) -> Upgrade<BoxIo> {
    let _ = p_conn.stream.write_all(format!("HTTP/1.1 {}\r\n\r\n", p_status).as_bytes()).await;
    let _ = p_conn.stream.shutdown().await;
    Upgrade::Taken
}

/// The views server's 'upgrade' handler.
pub async fn upgrade(p_web: Arc<Web>, mut p_conn: Conn<BoxIo>, p_head: Head) -> Upgrade<BoxIo> {
    let v_cfg = &p_web.auth.cfg;
    let v_path = p_head.head.url.split(['?', '#']).next().unwrap_or("").to_string();
    if !path_matches(v_cfg.admin_guid().as_deref(), &v_path) {
        // not this route: nothing answers the socket
        p_conn.wait_closed().await;
        return Upgrade::Taken;
    }
    if v_cfg.is_false("webadmin_terminal_enabled") {
        return refuse(p_conn, "404 Not Found").await;
    }
    let (Some(v_origin), Some(v_host)) = (p_head.head.header("origin"), p_head.head.header("host")) else {
        return refuse(p_conn, "403 Forbidden").await;
    };
    if origin_host(&v_origin).as_deref() != Some(v_host.as_str()) {
        return refuse(p_conn, "403 Forbidden").await;
    }
    let v_state = &p_web.admin;
    let v_cookie = cookie(&p_head, session::cookie_name());
    let v_session = match (&v_state.secret, v_cookie) {
        (Some(s), Some(v)) if v.starts_with("s:") => Some(v_state.sessions.load(Some(&v), s)),
        _ => None,
    };
    let Some(v_session) = v_session.filter(|s| s.authenticated()) else {
        return refuse(p_conn, "401 Unauthorized").await;
    };
    match ws_handshake(&p_head.head) {
        Ok(v_resp) => {
            if p_conn.stream.write_all(&v_resp).await.is_err() {
                return Upgrade::Taken;
            }
        }
        Err(v_resp) => {
            let _ = p_conn.stream.write_all(&v_resp).await;
            let _ = p_conn.stream.shutdown().await;
            return Upgrade::Taken;
        }
    }
    let v_ws = WebSocketStream::from_partially_read(
        p_conn.stream,
        p_conn.buf,
        Role::Server,
        Some(droneengage_server_common::net::ws_config()),
    )
    .await;
    let v_cwd = v_session
        .get("terminalCwd")
        .filter(|v| js_truthy(Some(v)))
        .map(|v| js_interp(Some(v)))
        .unwrap_or_else(|| std::env::current_dir().map(|d| d.display().to_string()).unwrap_or_default());
    let v_user = v_session
        .get("adminUsername")
        .filter(|v| js_truthy(Some(v)))
        .map(|v| js_interp(Some(v)))
        .unwrap_or("admin".into());
    run(v_ws, v_cwd, v_user).await;
    Upgrade::Taken
}

/// cookie-parser's value of a cookie in the upgrade request.
fn cookie(p_head: &Head, p_name: &str) -> Option<String> {
    let v_req = super::http::Request {
        method: String::new(),
        path: String::new(),
        query_raw: String::new(),
        headers: p_head.head.headers.clone(),
        body: Vec::new(),
        ip: String::new(),
        secure: false,
    };
    v_req.cookie(p_name)
}

/// The signal number for strsignal's description.
fn signal_number(p_name: &str) -> i32 {
    const NAMES: [&str; 15] = [
        "Hangup",
        "Interrupt",
        "Quit",
        "Illegal instruction",
        "Trace/breakpoint trap",
        "Aborted",
        "Bus error",
        "Floating point exception",
        "Killed",
        "User defined signal 1",
        "Segmentation fault",
        "User defined signal 2",
        "Broken pipe",
        "Alarm clock",
        "Terminated",
    ];
    NAMES.iter().position(|n| *n == p_name).map(|i| i as i32 + 1).unwrap_or(0)
}

/// Decodes PTY output as UTF-8 across reads (StringDecoder).
#[derive(Default)]
struct Utf8Decoder {
    m_pending: Vec<u8>,
}

impl Utf8Decoder {
    fn push(&mut self, p_bytes: &[u8]) -> String {
        self.m_pending.extend_from_slice(p_bytes);
        let mut v_out = String::new();
        loop {
            match std::str::from_utf8(&self.m_pending) {
                Ok(s) => {
                    v_out.push_str(s);
                    self.m_pending.clear();
                    return v_out;
                }
                Err(e) => {
                    let v_valid = e.valid_up_to();
                    v_out.push_str(std::str::from_utf8(&self.m_pending[..v_valid]).unwrap_or(""));
                    match e.error_len() {
                        Some(n) => {
                            v_out.push('\u{fffd}');
                            self.m_pending.drain(..v_valid + n);
                        }
                        None => {
                            self.m_pending.drain(..v_valid);
                            return v_out;
                        }
                    }
                }
            }
        }
    }
}

enum Event {
    Output(String),
    Exit(i64, i32),
}

/// handleConnection: the shell in a PTY, piped to and from the socket.
async fn run(p_ws: WebSocketStream<BoxIo>, p_cwd: String, p_user: String) {
    let (mut v_sink, mut v_source) = p_ws.split();
    let v_shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/bash".into());
    let v_spawned = (|| -> Result<_, String> {
        let v_pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut v_cmd = CommandBuilder::new(&v_shell);
        v_cmd.cwd(&p_cwd);
        v_cmd.env("TERM", "xterm-256color");
        v_cmd.env("COLORTERM", "truecolor");
        let v_child = v_pair.slave.spawn_command(v_cmd).map_err(|e| e.to_string())?;
        drop(v_pair.slave);
        let v_reader = v_pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let v_writer = v_pair.master.take_writer().map_err(|e| e.to_string())?;
        Ok((v_pair.master, v_child, v_reader, v_writer))
    })();
    let (v_master, mut v_child, mut v_reader, v_writer) = match v_spawned {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[WebTerminal] Failed to spawn PTY: {}", e);
            let v_msg = json!({ "type": "error", "message": format!("Failed to spawn terminal: {}", e) });
            let _ = v_sink.send(Message::Text(js_stringify(&v_msg).into())).await;
            let _ = v_sink.send(Message::Close(None)).await;
            return;
        }
    };
    let v_killer = Arc::new(Mutex::new(v_child.clone_killer()));
    let v_writer = Arc::new(Mutex::new(v_writer));
    let v_master = Arc::new(Mutex::new(v_master));
    let (v_tx, mut v_rx) = tokio::sync::mpsc::unbounded_channel::<Event>();
    {
        let v_tx = v_tx.clone();
        std::thread::spawn(move || {
            let mut v_decoder = Utf8Decoder::default();
            let mut v_buf = [0u8; 8192];
            loop {
                match v_reader.read(&mut v_buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let v_text = v_decoder.push(&v_buf[..n]);
                        if !v_text.is_empty() && v_tx.send(Event::Output(v_text)).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    std::thread::spawn(move || {
        if let Ok(s) = v_child.wait() {
            let v_signal = s.signal().map(signal_number).unwrap_or(0);
            let v_code = if v_signal != 0 { 0 } else { s.exit_code() as i64 };
            let _ = v_tx.send(Event::Exit(v_code, v_signal));
        }
    });

    let v_ready = json!({ "type": "ready", "cwd": p_cwd, "user": p_user, "shell": v_shell });
    let mut v_open = v_sink.send(Message::Text(js_stringify(&v_ready).into())).await.is_ok();
    loop {
        tokio::select! {
            v_event = v_rx.recv() => {
                match v_event {
                    Some(Event::Output(t)) if v_open => {
                        let v = json!({ "type": "output", "data": t });
                        v_open = v_sink.send(Message::Text(js_stringify(&v).into())).await.is_ok();
                    }
                    Some(Event::Output(_)) => {}
                    Some(Event::Exit(code, signal)) => {
                        if v_open {
                            let v = json!({ "type": "exit", "exitCode": code, "signal": signal });
                            let _ = v_sink.send(Message::Text(js_stringify(&v).into())).await;
                            let _ = v_sink.send(Message::Close(None)).await;
                        }
                        break;
                    }
                    None => break,
                }
            }
            v_in = v_source.next() => {
                let v_msg = match v_in {
                    Some(Ok(m)) => m,
                    _ => break,
                };
                let v_bytes: Vec<u8> = match &v_msg {
                    Message::Text(t) => t.as_bytes().to_vec(),
                    Message::Binary(b) => b.to_vec(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                let Some(v_parsed) = js_parse_bytes(&v_bytes) else { continue };
                match v_parsed.get("type").and_then(Value::as_str) {
                    Some("input") => {
                        if let Some(Value::String(d)) = v_parsed.get("data") {
                            let _ = v_writer.lock().unwrap().write_all(d.as_bytes());
                        }
                    }
                    Some("resize") => {
                        let (v_cols, v_rows) = (v_parsed.get("cols"), v_parsed.get("rows"));
                        if js_truthy(v_cols) && js_truthy(v_rows) {
                            let n = |v: Option<&Value>| v.and_then(Value::as_f64).filter(|f| *f > 0.0 && *f < 65536.0);
                            if let (Some(cols), Some(rows)) = (n(v_cols), n(v_rows)) {
                                let v_size = PtySize { rows: rows as u16, cols: cols as u16, pixel_width: 0, pixel_height: 0 };
                                let _ = v_master.lock().unwrap().resize(v_size);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let _ = v_killer.lock().unwrap().kill();
}

/// The startup line once the handler is attached.
pub fn attached() {
    println!("{}[OK] Web Terminal WebSocket handler attached{}", c::SUCCESS, c::RESET);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_and_path() {
        assert_eq!(origin_host("http://127.0.0.1:42001").as_deref(), Some("127.0.0.1:42001"));
        assert_eq!(origin_host("https://Example.com:443/x").as_deref(), Some("example.com"));
        assert_eq!(origin_host("null"), None);
        assert!(path_matches(None, "/admin/api/terminal/ws"));
        assert!(path_matches(Some("g"), "/admin/g/api/terminal/ws"));
        assert!(!path_matches(None, "/admin/g/api/terminal/ws"));
        let mut d = Utf8Decoder::default();
        assert_eq!(d.push(&[0xe2, 0x82]), "");
        assert_eq!(d.push(&[0xac, b'x']), "€x");
    }
}
