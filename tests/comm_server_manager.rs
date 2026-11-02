//! UDP relay status and proxy commands (js_comm_server_manager.test.js).

use de_auth_server::comm::CommManager;
use de_auth_server::sessions::Sessions;
use droneengage_server_common::util::js_stringify;
use serde_json::{json, Value};

fn info(p_mgr: &CommManager, p_sessions: &Sessions) {
    let v = json!({"c": "a", "d": {"isOnline": true, "serverId": "c1", "accounts": [], "accountDetails": {}}});
    p_mgr.on_message(p_sessions, "g1", js_stringify(&v).as_bytes());
}

fn relay(p_mgr: &CommManager, p_sessions: &Sessions, p_d: Value) {
    p_mgr.on_message(p_sessions, "g1", js_stringify(&json!({"c": "j", "d": p_d})).as_bytes());
}

#[test]
fn relay_status_per_relay_and_across_heartbeats() {
    let (m, s) = (CommManager::default(), Sessions::default());
    info(&m, &s);
    assert!(
        m.server("g1").unwrap()["m_server"]["m_udpRelayStatus"].is_null()
            || m.server("g1").unwrap()["m_server"].get("m_udpRelayStatus").is_none()
    );
    relay(&m, &s, json!({"relay_id": 1, "host": "h", "port": 5, "status": "cd", "pairs": 2, "timestamp": 9}));
    relay(&m, &s, json!({"relay_id": 2, "host": "h2", "port": 6, "status": "cg"}));
    let v = &m.server("g1").unwrap()["m_server"]["m_udpRelayStatus"];
    assert_eq!(v["1"]["status"], json!("cd"));
    assert_eq!(v["2"]["host"], json!("h2"));
    assert_eq!(v["2"]["error"], json!(null));
    relay(&m, &s, json!({"relay_id": 1, "status": "dc"}));
    info(&m, &s);
    let v = &m.server("g1").unwrap()["m_server"]["m_udpRelayStatus"];
    assert_eq!(v["1"]["status"], json!("dc"), "updated, and kept across INFO");
    relay(&m, &s, json!({"status": "er"}));
    assert_eq!(m.server("g1").unwrap()["m_server"]["m_udpRelayStatus"]["default"]["status"], json!("er"));
}

#[tokio::test]
async fn proxy_state_command_carries_the_account() {
    let (m, s) = (CommManager::default(), Sessions::default());
    let (v_tx, mut v_rx) = tokio::sync::mpsc::unbounded_channel();
    m.add_link("g1", v_tx);
    info(&m, &s);
    let v_server = m.server("g1").unwrap();
    let (v_sink, _v_wait) = tokio::sync::oneshot::channel();
    m.set_udp_proxy_blocked(&v_server, &json!("u1"), true, Some(&json!(" 7 ")), v_sink);
    let v_cmd: Value = serde_json::from_str(&v_rx.recv().await.unwrap()).unwrap();
    assert_eq!(v_cmd["c"], json!("g"));
    assert_eq!(v_cmd["d"]["name"], json!("u1"));
    assert_eq!(v_cmd["d"]["blocked"], json!(true));
    assert_eq!(v_cmd["d"]["account"], json!(" 7 "));
    let (v_sink, _v_wait) = tokio::sync::oneshot::channel();
    m.set_udp_proxy_blocked(&v_server, &json!("u1"), false, None, v_sink);
    let v_cmd: Value = serde_json::from_str(&v_rx.recv().await.unwrap()).unwrap();
    assert!(v_cmd["d"].get("account").is_none(), "no account when none was given");
    // the reply resolves the pending request
    let (v_sink, v_wait) = tokio::sync::oneshot::channel();
    m.request_udp_proxies(&v_server, v_sink);
    let v_cmd: Value = serde_json::from_str(&v_rx.recv().await.unwrap()).unwrap();
    let v_reply = json!({"c": "f", "d": {"r": v_cmd["d"]["r"], "proxies": [{"name": "u1"}]}});
    m.on_message(&s, "g1", js_stringify(&v_reply).as_bytes());
    let (v_list, _) = v_wait.await.unwrap().unwrap();
    assert_eq!(v_list, json!([{"name": "u1"}]));
}
