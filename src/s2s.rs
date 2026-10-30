//! The WebSocket listener comm servers connect to
//! (js_comm_server_manager_server.js): an Express app with no routes (a
//! plain request gets Express's 404) and a ws server on every upgrade.
//! With s2s_auth_enabled a comm server must answer an Ed25519 challenge
//! within 8 s before its traffic is accepted.

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::web::http::{encode_url, escape_html, Response};
use crate::web::server::{serve, ws_handshake, BoxIo, Conn, Head, Upgrade};
use crate::web::Reply;
use crate::Auth;
use droneengage_server_common::colors as c;
use droneengage_server_common::s2s_auth::{
    build_challenge, generate_nonce, parse_envelope, S2sAuth, S2S_AUTH_HANDSHAKE_TIMEOUT_MS, S2S_AUTH_RESPONSE,
};
use droneengage_server_common::util::{js_interp, js_strict_eq};

/// finalhandler's 404 for an app without routes.
fn express_404(p_method: &str, p_path: &str) -> Response {
    let mut r = Response::new();
    r.status = 404;
    r.set("Content-Security-Policy", "default-src 'none'");
    r.set("X-Content-Type-Options", "nosniff");
    let v_body = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot {} {}</pre>\n</body>\n</html>\n",
        p_method,
        escape_html(&encode_url(p_path))
    );
    r.set("Content-Type", "text/html; charset=utf-8");
    r.set("Content-Length", v_body.len().to_string());
    r.body = v_body.into_bytes();
    r
}

/// One comm server connection (fn_onConnect_Handler).
async fn connection(p_auth: Arc<Auth>, p_s2s: Arc<S2sAuth>, p_ws: WebSocketStream<BoxIo>) {
    let v_guid = uuid::Uuid::new_v4().to_string();
    let (mut v_sink, mut v_source) = p_ws.split();
    let (v_tx, mut v_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    p_auth.comm.add_link(&v_guid, v_tx.clone());
    if let Some(l) = &p_auth.logger {
        l.info("Communication server connecting...", Some("fn_onConnect_Handler"), None);
    }
    let v_auth_enabled = p_auth.cfg.is_true("s2s_auth_enabled");
    let mut v_authed = !v_auth_enabled;
    let mut v_nonce = String::new();
    let v_deadline = tokio::time::Instant::now() + Duration::from_millis(S2S_AUTH_HANDSHAKE_TIMEOUT_MS);
    if v_auth_enabled {
        v_nonce = generate_nonce();
        let _ = v_tx.send(build_challenge(&v_nonce, None));
    }
    let (v_kill_tx, mut v_kill_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let v_writer = tokio::spawn(async move {
        loop {
            tokio::select! {
                v = v_rx.recv() => match v {
                    Some(t) => if v_sink.send(Message::Text(t.into())).await.is_err() { break },
                    None => break,
                },
                _ = v_kill_rx.recv() => break,
            }
        }
    });
    let mut v_closed_by_us = false;
    loop {
        let v_timer = async {
            if v_authed {
                std::future::pending::<()>().await
            } else {
                tokio::time::sleep_until(v_deadline).await
            }
        };
        tokio::select! {
            _ = v_timer => {
                println!("{}[ATTENTION!!] Communication Server failed S2S handshake (timeout){}", c::ERROR, c::RESET);
                if let Some(l) = &p_auth.logger {
                    l.warn("S2S handshake timeout", Some("fn_onConnect_Handler"), None);
                }
                v_closed_by_us = true;
                break;
            }
            v_in = v_source.next() => {
                let v_msg = match v_in {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        if !droneengage_server_common::net::is_abrupt_close(&e) {
                            println!("{}[ATTENTION!!] Error with Communication Server{} {}", c::ERROR, c::RESET, e);
                            if let Some(l) = &p_auth.logger {
                                l.error("WS Error", Some("fn_onWsError"), None);
                            }
                        }
                        break;
                    }
                    None => break,
                };
                let v_bytes: Vec<u8> = match &v_msg {
                    Message::Text(t) => t.as_bytes().to_vec(),
                    Message::Binary(b) => b.to_vec(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                if !v_authed {
                    let v_env = parse_envelope(&v_bytes);
                    let v_ok = match &v_env {
                        Some(e) => {
                            js_strict_eq(e.get("s2s_auth"), Some(&Value::String(S2S_AUTH_RESPONSE.into())))
                                && e.get("id").map(|i| !i.is_null()).unwrap_or(false)
                                && p_s2s.verify(&v_nonce, e.get("sig"), e.get("id"))
                        }
                        None => false,
                    };
                    if v_ok {
                        let v_id = v_env.as_ref().and_then(|e| e.get("id")).cloned().unwrap_or(Value::Null);
                        v_authed = true;
                        println!("{}[OK] Communication Server passed S2S handshake [{}]{}", c::SUCCESS, js_interp(Some(&v_id)), c::RESET);
                        if let Some(l) = &p_auth.logger {
                            l.write("Info", "S2S handshake OK", Some("fn_onWsMessage"), None, Some(&v_id));
                        }
                    } else {
                        println!("{}[ATTENTION!!] Communication Server failed S2S handshake (bad signature or missing id){}", c::ERROR, c::RESET);
                        if let Some(l) = &p_auth.logger {
                            l.warn("S2S handshake rejected", Some("fn_onWsMessage"), None);
                        }
                        v_closed_by_us = true;
                        break;
                    }
                    continue;
                }
                if let Some(l) = &p_auth.logger {
                    let v_text = Value::String(String::from_utf8_lossy(&v_bytes).into_owned());
                    l.write("Debug", "WS Msg", Some("fn_onWsMessage"), None, Some(&v_text));
                }
                p_auth.comm.on_message(&p_auth.sessions, &v_guid, &v_bytes);
            }
        }
    }
    let _ = v_closed_by_us;
    let _ = v_kill_tx.send(());
    v_writer.abort();
    // fn_onWsClose
    println!("{}[ATTENTION!!] Closed with Communication Server{}", c::ERROR, c::RESET);
    if let Some(l) = &p_auth.logger {
        l.warn("WS Closing", Some("fn_onWsClose"), None);
    }
    p_auth.comm.server_closed(&v_guid);
    p_auth.comm.remove_link(&v_guid);
}

async fn on_upgrade(p_auth: Arc<Auth>, p_s2s: Arc<S2sAuth>, mut p_conn: Conn<BoxIo>, p_head: Head) -> Upgrade<BoxIo> {
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
    connection(p_auth, p_s2s, v_ws).await;
    Upgrade::Taken
}

/// fn_startWebSocketListener: serves the bound listener.
pub fn run(p_auth: Arc<Auth>, p_listener: TcpListener, p_tls: Option<tokio_rustls::TlsAcceptor>) {
    let v_s2s = Arc::new(S2sAuth::new(p_auth.cfg.config(), std::env::var("de_s2s_shared_secret").ok()));
    tokio::spawn(async move {
        loop {
            let Ok((v_tcp, v_remote)) = p_listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            };
            let (v_auth, v_s2s, v_tls) = (p_auth.clone(), v_s2s.clone(), p_tls.clone());
            tokio::spawn(async move {
                let v_io: BoxIo = match v_tls {
                    Some(a) => match a.accept(v_tcp).await {
                        Ok(s) => Box::new(s),
                        Err(_) => return,
                    },
                    None => Box::new(v_tcp),
                };
                serve_s2s(v_auth, v_s2s, v_io, v_remote).await;
            });
        }
    });
}

async fn serve_s2s(p_auth: Arc<Auth>, p_s2s: Arc<S2sAuth>, p_io: BoxIo, p_remote: SocketAddr) {
    let v_handler = |r: crate::web::http::Request| async move { Reply::Full(express_404(&r.method, &r.path)) };
    let v_upgrade = move |p_conn: Conn<BoxIo>, p_head: Head| on_upgrade(p_auth.clone(), p_s2s.clone(), p_conn, p_head);
    serve(p_io, p_remote, false, v_handler, Some(v_upgrade)).await;
}
