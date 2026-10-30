//! The Express app in-process: health, the 404 replies, login validation,
//! the agent's chunked reply, the admin login page and its CSRF guard.

mod common;
use common::*;
use de_auth_server::web::http::Request;
use de_auth_server::web::{handle, Reply, Web};
use serde_json::{json, Value};
use std::sync::Arc;

fn request(p_method: &str, p_path: &str, p_body: Option<Value>) -> Request {
    let mut v_headers = vec![("Host".to_string(), "x".to_string())];
    let v_body = match p_body {
        Some(b) => {
            v_headers.push(("Content-Type".into(), "application/json".into()));
            let v = b.to_string().into_bytes();
            v_headers.push(("Content-Length".into(), v.len().to_string()));
            v
        }
        None => vec![],
    };
    Request {
        method: p_method.into(),
        path: p_path.into(),
        query_raw: String::new(),
        headers: v_headers,
        body: v_body,
        ip: "127.0.0.1".into(),
        secure: false,
    }
}

async fn call(p_web: &Arc<Web>, p_req: Request, p_layout: bool) -> (u16, Vec<(String, String)>, String, bool) {
    match handle(p_web, &p_req, p_layout).await {
        Reply::Full(r) => (r.status, r.headers, String::from_utf8_lossy(&r.body).into_owned(), false),
        Reply::Chunked(r) => (r.status, r.headers, String::from_utf8_lossy(&r.body).into_owned(), true),
        Reply::Hang => panic!("no reply"),
    }
}

fn web() -> Arc<Web> {
    let mut env = single_mode();
    let v_cfg = de_auth_server::config::Cfg::from_value(json!({
        "account_storage_type": "single",
        "single_account_user_name": "single@x.com",
        "single_account_access_code": "singlecode",
        "server_id": "T1",
        "session_secret": "s3cret",
        "admin_username": "admin",
        "admin_password": "Secret123!",
        "altcha_enabled": false
    }));
    env.auth.accounts.cfg = v_cfg.clone();
    env.auth.cfg = v_cfg;
    Arc::new(Web::new(Arc::new(env.auth)))
}

#[tokio::test]
async fn health_and_not_found() {
    let w = web();
    let (s, h, b, _) = call(&w, request("GET", "/h/health", None), false).await;
    assert_eq!(s, 200);
    assert_eq!(b, format!("{{\"status\":\"OK\",\"version\":\"{}\",\"server_id\":\"T1\"}}", de_auth_server::VERSION));
    assert_eq!(h[0].0, "Content-Security-Policy");
    assert!(h.iter().any(|(k, v)| k == "Access-Control-Allow-Origin" && v == "*"));
    let (s, _, b, _) = call(&w, request("GET", "/w/nothing", None), false).await;
    assert_eq!((s, b.as_str()), (404, "{\"e\":10,\"em\":\"API endpoint not found\",\"cm\":\"error\"}"));
    let (s, _, b, _) = call(&w, request("GET", "/nothing", None), true).await;
    assert_eq!(s, 404);
    assert!(b.contains("<title>DE 404</title>") && b.contains("<h1>This page does not exist.</h1>"), "{}", b);
}

#[tokio::test]
async fn login_validation_and_agent_reply() {
    let w = web();
    let (s, _, b, _) = call(&w, request("POST", "/w/wl", Some(json!({ "pwd": "x" }))), false).await;
    assert_eq!((s, b.as_str()), (400, "{\"e\":1,\"em\":\"Invalid or malformed request.\",\"cm\":\"/wl\"}"));
    let v_login = json!({ "acc": "single@x.com", "pwd": "singlecode", "gr": "1", "app": "de", "ex": "x" });
    let (s, _, b, _) = call(&w, request("POST", "/w/wl", Some(v_login.clone())), false).await;
    assert_eq!((s, b.as_str()), (200, "{\"e\":5,\"em\":\"No available Server\",\"cm\":\"/wl\"}"));
    let (s, h, b, v_chunked) = call(&w, request("POST", "/agent/al", Some(v_login)), false).await;
    assert_eq!((s, v_chunked), (200, true));
    assert!(!h.iter().any(|(k, _)| k.eq_ignore_ascii_case("content-type")), "res.write sets no type");
    assert_eq!(b, "{\"e\":5,\"em\":\"No available Server\",\"cm\":\"/al\"}");
}

#[tokio::test]
async fn admin_login_page_and_csrf() {
    let w = web();
    let (s, h, b, _) = call(&w, request("GET", "/admin/login", None), false).await;
    assert_eq!(s, 200);
    assert!(b.contains("name=\"_csrf\""));
    assert!(h.iter().any(|(k, v)| k == "set-cookie" && v.starts_with("_csrf=")));
    assert!(h.iter().any(|(k, v)| k == "Content-Security-Policy" && v.contains("frame-ancestors 'none'")));
    let (s, h, _, _) = call(&w, request("POST", "/admin/api/users", Some(json!({}))), false).await;
    assert_eq!(s, 403);
    assert!(h.iter().any(|(k, _)| k == "set-cookie"));
    let (s, h, _, _) = call(&w, request("GET", "/admin/dashboard", None), false).await;
    assert_eq!(s, 302);
    assert!(h.iter().any(|(k, v)| k == "Location" && v == "/admin/login"));
}
