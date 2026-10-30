//! Communication servers (js_comm_server_manager.js): the list of comm
//! servers from their INFO cards, best-server selection, login requests to
//! a comm server and their replies, logout notifications, storage / UDP
//! relay status, and the UDP proxy and unit traffic queries of the admin
//! pages. Each server entry is the JavaScript object `{ m_server: {...} }`
//! kept as JSON, including its quirks: an INFO card whose isOnline changed
//! stores the raw card (unprefixed fields) until the next INFO.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

use crate::constants::*;
use crate::sessions::{login_reply, Sessions};
use droneengage_server_common::colors as c;
use droneengage_server_common::util::{
    is_undefined, js_interp, js_parse_bytes, js_strict_eq, js_stringify, js_to_string, js_truthy, now_ms, set_field_opt,
};

pub const LOGIN_REQUEST_TIMEOUT: Duration = Duration::from_millis(15000);
pub const UDP_PROXIES_QUERY_TIMEOUT: Duration = Duration::from_millis(5000);

/// A reply sink: called once per JavaScript callback invocation (the
/// receiver uses the first).
pub type Feedback = UnboundedSender<Value>;

/// Proxy / blocked-unit query result: `(list, reply.d)`, or Err on the
/// offline / timeout path.
pub type QuerySink = tokio::sync::oneshot::Sender<Result<(Value, Value), ()>>;

struct WaitingLogin {
    session_id: String,
    card: Value,
    feedback: Feedback,
}

#[derive(Default)]
struct State {
    servers: IndexMap<String, Value>,
    best: Option<String>,
    waiting_login: HashMap<String, WaitingLogin>,
    waiting_udp: HashMap<String, QuerySink>,
    waiting_blocked: HashMap<String, QuerySink>,
}

/// `TypeError: Cannot read properties of undefined (reading 'x')`
fn read_error(p_of: &str, p_key: &str) -> String {
    format!("TypeError: Cannot read properties of {} (reading '{}')", p_of, p_key)
}

fn nullish_name(p_value: Option<&Value>) -> &'static str {
    match p_value {
        Some(Value::Null) => "null",
        _ => "undefined",
    }
}

/// `obj.key` where obj must not be null/undefined.
fn prop<'a>(p_obj: Option<&'a Value>, p_key: &str) -> Result<Option<&'a Value>, String> {
    match p_obj {
        None | Some(Value::Null) => Err(read_error(nullish_name(p_obj), p_key)),
        Some(v) if is_undefined(v) => Err(read_error("undefined", p_key)),
        Some(Value::Object(m)) => Ok(m.get(p_key).filter(|v| !is_undefined(v))),
        Some(_) => Ok(None),
    }
}

/// `x.length` where x must not be null/undefined.
fn length(p_value: Option<&Value>) -> Result<Option<f64>, String> {
    match p_value {
        None | Some(Value::Null) => Err(read_error(nullish_name(p_value), "length")),
        Some(Value::Array(a)) => Ok(Some(a.len() as f64)),
        Some(Value::String(s)) if !is_undefined(p_value.unwrap()) => Ok(Some(s.encode_utf16().count() as f64)),
        Some(Value::String(_)) => Err(read_error("undefined", "length")),
        _ => Ok(None),
    }
}

/// `a < b` where either side may be undefined (false).
fn lt(p_a: Option<f64>, p_b: Option<f64>) -> bool {
    matches!((p_a, p_b), (Some(a), Some(b)) if a < b)
}

/// `a == b` for the scalar JSON values compared here.
fn loose_eq(p_a: Option<&Value>, p_b: Option<&Value>) -> bool {
    fn n(v: Option<&Value>) -> Option<&Value> {
        v.filter(|v| !is_undefined(v) && !v.is_null())
    }
    match (n(p_a), n(p_b)) {
        (None, None) => true,
        (None, _) | (_, None) => false,
        (Some(Value::String(a)), Some(Value::String(b))) => a == b,
        (
            Some(a @ (Value::Number(_) | Value::Bool(_) | Value::String(_))),
            Some(b @ (Value::Number(_) | Value::Bool(_) | Value::String(_))),
        ) => droneengage_server_common::util::js_number(Some(a)) == droneengage_server_common::util::js_number(Some(b)),
        (Some(a), Some(b)) => a == b && matches!(a, Value::Bool(_)),
    }
}

/// `x == true`
fn loose_true(p_value: Option<&Value>) -> bool {
    match p_value {
        Some(Value::Bool(b)) => *b,
        Some(v @ (Value::Number(_) | Value::String(_))) if !is_undefined(v) => {
            droneengage_server_common::util::js_number(Some(v)) == 1.0
        }
        _ => false,
    }
}

/// `x == false`
fn loose_false(p_value: Option<&Value>) -> bool {
    match p_value {
        Some(Value::Bool(b)) => !*b,
        Some(v @ (Value::Number(_) | Value::String(_))) if !is_undefined(v) => {
            droneengage_server_common::util::js_number(Some(v)) == 0.0
        }
        Some(Value::Array(a)) => a.is_empty() || (a.len() == 1 && loose_false(a.first())),
        _ => false,
    }
}

/// `%s` in console.log for a value.
fn fmt_s(p_value: Option<&Value>) -> String {
    match p_value {
        None => "undefined".into(),
        Some(v) if is_undefined(v) => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(v @ (Value::Object(_) | Value::Array(_))) => js_stringify(v),
        Some(v) => js_interp(Some(v)),
    }
}

fn status_text(p_code: Option<&Value>) -> String {
    match p_code.and_then(Value::as_str) {
        Some("dc") => "DISCONNECTED".into(),
        Some("cg") => "CONNECTING".into(),
        Some("cd") => "CONNECTED".into(),
        Some("uh") => "UNHEALTHY".into(),
        Some("er") => "ERROR".into(),
        _ => fmt_s(p_code),
    }
}

/// `x || null`
fn or_null(p_value: Option<&Value>) -> Value {
    p_value.filter(|v| js_truthy(Some(v))).cloned().unwrap_or(Value::Null)
}

/// The comm server list and pending requests, plus the connections they
/// are sent over (the S2S listener registers them).
#[derive(Clone, Default)]
pub struct CommManager {
    m_state: Arc<Mutex<State>>,
    m_links: Arc<Mutex<HashMap<String, UnboundedSender<String>>>>,
}

impl CommManager {
    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.m_state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// m_ws[guid] = ws
    pub fn add_link(&self, p_guid: &str, p_sender: UnboundedSender<String>) {
        self.m_links.lock().unwrap().insert(p_guid.to_string(), p_sender);
    }

    pub fn remove_link(&self, p_guid: &str) {
        self.m_links.lock().unwrap().remove(p_guid);
    }

    /// fn_sendMessage: to a connected comm server (no-op otherwise).
    pub fn send(&self, p_guid: &str, p_message: String) {
        if let Some(s) = self.m_links.lock().unwrap().get(p_guid) {
            let _ = s.send(p_message);
        }
    }

    fn send_to(&self, p_server: &Value, p_message: &Value) {
        let v_guid = js_interp(p_server.get("m_server").and_then(|s| s.get("m_commServerGUID")));
        self.send(&v_guid, js_stringify(p_message));
    }

    /// getCommunicationServersList (a snapshot).
    pub fn servers(&self) -> IndexMap<String, Value> {
        self.state().servers.clone()
    }

    pub fn server(&self, p_guid: &str) -> Option<Value> {
        self.state().servers.get(p_guid).cloned()
    }

    // ── selection ───────────────────────────────────────────────────────

    /// fn_SelectBestServer
    fn select_best(p_st: &mut State) -> Result<(), String> {
        let v_keys: Vec<String> = p_st.servers.keys().cloned().collect();
        for k in v_keys {
            let v_info = &p_st.servers[&k];
            let v_server = prop(Some(v_info), "m_server")?;
            if !loose_true(prop(v_server, "m_isOnline")?) {
                continue;
            }
            match &p_st.best {
                // m_bestServer.m_isOnline (the entry, not m_server) is never false
                None => p_st.best = Some(k.clone()),
                Some(b) => {
                    let v_best = p_st.servers.get(b).cloned();
                    let v_mine = length(prop(v_server, "m_accounts")?)?;
                    let v_best_server = prop(v_best.as_ref(), "m_server")?.cloned();
                    let v_theirs = length(prop(v_best_server.as_ref(), "m_accounts")?)?;
                    if lt(v_mine, v_theirs) && b != &k {
                        p_st.best = Some(k.clone());
                    }
                }
            }
        }
        Ok(())
    }

    /// fn_getServerCurrentlyServerAccountID
    fn current_server(p_st: &State, p_card: &Value) -> Result<Option<String>, String> {
        let v_acc = p_card.get("m_acc_id_hashed");
        for (k, v_info) in &p_st.servers {
            let v_server = prop(Some(v_info), "m_server")?;
            let v_accounts = prop(v_server, "m_accounts")?;
            let v_len = length(v_accounts)?.unwrap_or(0.0);
            for j in 0..(v_len.max(0.0) as usize) {
                let v_entry = match v_accounts {
                    Some(Value::Array(a)) => a.get(j).cloned(),
                    Some(Value::String(s)) => s.chars().nth(j).map(|c| json!(c.to_string())),
                    _ => None,
                };
                if loose_eq(v_entry.as_ref(), v_acc) {
                    if matches!(prop(v_server, "m_isOnline")?, Some(Value::Bool(false))) {
                        return Ok(None);
                    }
                    return Ok(Some(k.clone()));
                }
            }
        }
        Ok(None)
    }

    /// fn_selectServerforAccount: the server already serving the account,
    /// else the best server; None when none is online. Err: a TypeError.
    pub fn select_server_for_account(&self, p_card: &Value) -> Result<Option<Value>, String> {
        let mut st = self.state();
        let mut v_selected = Self::current_server(&st, p_card)?;
        if v_selected.is_none() {
            Self::select_best(&mut st)?;
            v_selected = st.best.clone();
        }
        let Some(v_guid) = v_selected else { return Ok(None) };
        let Some(v_info) = st.servers.get(&v_guid).cloned() else { return Ok(None) };
        if loose_false(prop(prop(Some(&v_info), "m_server")?, "m_isOnline")?) {
            return Ok(None);
        }
        Ok(Some(v_info))
    }

    // ── requests to comm servers ────────────────────────────────────────

    fn is_offline(p_server: &Value) -> bool {
        loose_false(p_server.get("m_server").and_then(|s| s.get("m_isOnline")))
    }

    /// fn_requestCommunicationLogin: asks the comm server for a login key
    /// for this card; the feedback receives the party reply, or `{e: 5}`
    /// when the server does not answer within 15 s.
    pub fn request_login(&self, p_sessions: &Sessions, p_card: &Value, p_server: &Value, p_feedback: Feedback) {
        if Self::is_offline(p_server) {
            let _ = p_feedback.send(json!({ ERROR: ERROR_SERVER_NOT_AVAILABLE }));
            return;
        }
        let v_request_id = uuid::Uuid::new_v4().to_string();
        let v_session = js_to_string(p_card.get("m_session_id").unwrap_or(&Value::Null));
        p_sessions.update(&v_session, |c| c["m_request_id"] = json!(v_request_id));
        let mut v_card = p_card.clone();
        v_card["m_request_id"] = json!(v_request_id);
        let mut d = json!({ CS_REQUEST_ID: v_request_id });
        set_field_opt(&mut d, CS_ACCOUNT_ID, v_card.get("m_acc_id_hashed").cloned());
        set_field_opt(&mut d, CS_GROUP_ID, v_card.get(CS_GROUP_ID).cloned());
        set_field_opt(&mut d, ACTOR_TYPE, v_card.get("m_actorType").cloned());
        let v_data = v_card.get("m_data").cloned().unwrap_or(Value::Null);
        set_field_opt(&mut d, INSTANCE_LIMIT, v_data.get("m_instance_limit").cloned());
        set_field_opt(&mut d, PERMISSION2, v_data.get("m_prm").cloned());
        self.state()
            .waiting_login
            .insert(v_request_id.clone(), WaitingLogin { session_id: v_session, card: v_card, feedback: p_feedback });
        self.send_to(p_server, &json!({ "c": CS_CMD_LOGIN_REQUEST, "d": d }));
        let v_state = self.m_state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(LOGIN_REQUEST_TIMEOUT).await;
            let v_waiting = v_state.lock().unwrap_or_else(|e| e.into_inner()).waiting_login.remove(&v_request_id);
            if let Some(w) = v_waiting {
                let _ = w.feedback.send(json!({ ERROR: ERROR_SERVER_NOT_AVAILABLE }));
            }
        });
    }

    fn query(&self, p_server: &Value, p_blocked_map: bool, p_cmd: Value, p_sink: QuerySink) {
        if Self::is_offline(p_server) {
            let _ = p_sink.send(Err(()));
            return;
        }
        let v_request_id = p_cmd["d"][CS_REQUEST_ID].as_str().unwrap_or_default().to_string();
        {
            let mut st = self.state();
            if p_blocked_map {
                st.waiting_blocked.insert(v_request_id.clone(), p_sink);
            } else {
                st.waiting_udp.insert(v_request_id.clone(), p_sink);
            }
        }
        self.send_to(p_server, &p_cmd);
        let v_state = self.m_state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(UDP_PROXIES_QUERY_TIMEOUT).await;
            let mut st = v_state.lock().unwrap_or_else(|e| e.into_inner());
            let v_pending = if p_blocked_map {
                st.waiting_blocked.remove(&v_request_id)
            } else {
                st.waiting_udp.remove(&v_request_id)
            };
            if let Some(s) = v_pending {
                let _ = s.send(Err(()));
            }
        });
    }

    /// fn_requestUdpProxies
    pub fn request_udp_proxies(&self, p_server: &Value, p_sink: QuerySink) {
        let v_id = uuid::Uuid::new_v4().to_string();
        self.query(p_server, false, json!({ "c": CS_CMD_QUERY_UDP_PROXIES, "d": { CS_REQUEST_ID: v_id } }), p_sink);
    }

    /// fn_setUdpProxyBlocked
    pub fn set_udp_proxy_blocked(
        &self,
        p_server: &Value,
        p_name: &Value,
        p_blocked: bool,
        p_account: Option<&Value>,
        p_sink: QuerySink,
    ) {
        let v_id = uuid::Uuid::new_v4().to_string();
        let mut d = json!({ CS_REQUEST_ID: v_id, "name": p_name, "blocked": p_blocked });
        if let Some(a) = p_account.filter(|a| !a.is_null() && *a != &json!("")) {
            d["account"] = json!(js_to_string(a));
        }
        self.query(p_server, false, json!({ "c": CS_CMD_SET_UDP_PROXY_STATE, "d": d }), p_sink);
    }

    /// fn_setUnitTrafficBlocked
    pub fn set_unit_traffic_blocked(&self, p_server: &Value, p_name: &Value, p_blocked: bool, p_sink: QuerySink) {
        let v_id = uuid::Uuid::new_v4().to_string();
        let d = json!({ CS_REQUEST_ID: v_id, "name": p_name, "blocked": p_blocked });
        self.query(p_server, true, json!({ "c": CS_CMD_SET_UNIT_TRAFFIC_STATE, "d": d }), p_sink);
    }

    /// fn_removePartyCommunicationSession: asks the card's comm server to
    /// drop the party (only once the card has a comm server).
    pub fn remove_party(&self, p_card: &Value, p_reason: Option<&str>) {
        let Some(v_guid) = p_card.get("m_commServerGUID").filter(|v| !is_undefined(v)) else { return };
        let mut d = json!({});
        set_field_opt(&mut d, CS_SENDER_ID, p_card.get("m_acc_id_hashed").cloned());
        if let Some(r) = p_reason {
            d["reason"] = json!(r);
            d["notice"] = json!("The access code for this account was reset. Sign in again with the new code.");
        }
        self.send(&js_interp(Some(v_guid)), js_stringify(&json!({ "c": CS_CMD_LOGOUT_REQUEST, "d": d })));
    }

    /// fn_ServerUpdated: the connection closed.
    pub fn server_closed(&self, p_guid: &str) {
        let mut st = self.state();
        if let Some(mut v_info) = st.servers.shift_remove(p_guid) {
            st.best = None;
            Self::on_disconnect(&mut v_info);
        }
        if let Err(e) = Self::select_best(&mut st) {
            // thrown from the ws 'close' handler
            eprintln!("Uncaught {}", e);
        }
    }

    fn on_disconnect(p_info: &mut Value) {
        println!(
            "{}[ATTENTION!!] Communication Server [{}] has been disconnected{}",
            c::ERROR,
            fmt_s(p_info["m_server"].get("m_serverId")),
            c::RESET
        );
        if p_info["m_server"].is_object() {
            p_info["m_server"]["m_isOnline"] = json!(false);
        }
    }

    // ── messages from comm servers ──────────────────────────────────────

    /// fn_commServerMessageHandler
    pub fn on_message(&self, p_sessions: &Sessions, p_guid: &str, p_msg: &[u8]) {
        let mut v_cmd = match js_parse_bytes(p_msg) {
            Some(v) => v,
            None => {
                println!("err:fn_decryptCommunicationMessage:SyntaxError: {}", json_syntax_error(p_msg));
                return;
            }
        };
        if v_cmd.is_null() {
            return;
        }
        match &mut v_cmd {
            Value::Object(m) => {
                m.insert("m_commServerGUID".into(), json!(p_guid));
            }
            Value::Array(_) => {}
            other => {
                println!(
                    "err:fn_commServerMessageHandler:TypeError: Cannot create property 'm_commServerGUID' on {} '{}'",
                    match other {
                        Value::Number(_) => "number",
                        Value::Bool(_) => "boolean",
                        _ => "string",
                    },
                    js_interp(Some(other))
                );
                return;
            }
        }
        let v_c = v_cmd.get("c").cloned();
        let v_is = |k: &str| js_strict_eq(v_c.as_ref(), Some(&json!(k)));
        let v_result = if v_is(CS_CMD_INFO) {
            if let Err(e) = self.handle_server_info(&v_cmd, p_guid) {
                println!("err:fn_handleServerInfo:{}", e);
            }
            Ok(())
        } else if v_is(CS_CMD_LOGIN_REQUEST) {
            self.handle_login_response(p_sessions, &v_cmd, p_guid)
        } else if v_is(CS_CMD_LOGOUT_REQUEST) {
            if let Err(e) = handle_logout(p_sessions, &v_cmd) {
                println!("err:fn_handleLogoutNotification:{}", e);
            }
            Ok(())
        } else if v_is(CS_CMD_STORAGE_STATUS) {
            if let Err(e) = self.handle_storage_status(&v_cmd, p_guid) {
                println!("err:fn_handleStorageStatus:{}", e);
            }
            Ok(())
        } else if v_is(CS_CMD_UDP_RELAY_STATUS) {
            if let Err(e) = self.handle_relay_status(&v_cmd, p_guid) {
                println!("err:fn_handleUdpRelayStatus:{}", e);
            }
            Ok(())
        } else if v_is(CS_CMD_REPORT_UDP_PROXIES) {
            self.handle_proxies_report(&v_cmd, p_guid);
            Ok(())
        } else if v_is(CS_CMD_REPORT_BLOCKED_UNITS) {
            if let Err(e) = self.handle_blocked_units(&v_cmd, p_guid) {
                println!("err:fn_handleBlockedUnitsReport:{}", e);
            }
            Ok(())
        } else {
            Ok(())
        };
        if let Err(e) = v_result {
            println!("err:fn_commServerMessageHandler:{}", e);
        }
    }

    /// fn_handleServerInfo: adds or refreshes the server entry.
    fn handle_server_info(&self, p_cmd: &Value, p_guid: &str) -> Result<(), String> {
        let v_d = p_cmd.get("d");
        let v_online = prop(v_d, "isOnline")?.cloned();
        let v_d = v_d.unwrap();
        let mut v_msg = json!({});
        set_field_opt(&mut v_msg, "m_isOnline", v_online.clone());
        for (k, src) in [
            ("m_version", "version"),
            ("m_serverId", "serverId"),
            ("m_serverPublicIP", "public_host"),
            ("m_serverPort", "serverPort"),
            ("m_accounts", "accounts"),
            ("m_accountDetails", "accountDetails"),
        ] {
            set_field_opt(&mut v_msg, k, prop(Some(v_d), src)?.cloned());
        }
        v_msg["m_commServerGUID"] = json!(p_guid);
        let mut v_raw = match v_d {
            Value::Object(_) => v_d.clone(),
            Value::Array(_) => json!({}),
            other => {
                return Err(format!(
                    "TypeError: Cannot create property 'm_commServerGUID' on {} '{}'",
                    if other.is_number() {
                        "number"
                    } else if other.is_boolean() {
                        "boolean"
                    } else {
                        "string"
                    },
                    js_interp(Some(other))
                ))
            }
        };
        v_raw["m_commServerGUID"] = json!(p_guid);
        v_raw["lastActiveTime"] = json!(now_ms());

        let mut st = self.state();
        if let Some(v_info) = st.servers.get_mut(p_guid) {
            let v_old = v_info["m_server"].clone();
            let v_preserved = [
                ("m_storageStatus", or_null(v_old.get("m_storageStatus"))),
                ("m_udpRelayStatus", or_null(v_old.get("m_udpRelayStatus"))),
                (
                    "m_udpProxies",
                    v_old.get("m_udpProxies").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!([])),
                ),
                ("m_udpProxiesTimestamp", or_null(v_old.get("m_udpProxiesTimestamp"))),
                (
                    "m_blockedUnits",
                    v_old.get("m_blockedUnits").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!([])),
                ),
            ];
            let v_changed = !loose_eq(v_old.get("m_isOnline"), v_online.as_ref());
            let mut v_new = if v_changed { v_raw } else { v_msg };
            for (k, v) in v_preserved {
                v_new[k] = v;
            }
            v_info["m_server"] = v_new;
            if v_changed {
                if loose_true(v_online.as_ref()) {
                    println!(
                        "[INFO] Communication Server [{}] has been disconnected",
                        fmt_s(v_info["m_server"].get("m_serverId"))
                    );
                    v_info["m_server"]["m_isOnline"] = json!(true);
                } else {
                    Self::on_disconnect(v_info);
                }
            }
        } else {
            println!(
                "{}[INFO] Communication Server [{}] has been added{}",
                c::LOG,
                fmt_s(v_msg.get("m_serverId")),
                c::RESET
            );
            st.servers.insert(p_guid.to_string(), json!({ "m_server": v_msg }));
        }
        Self::select_best(&mut st)
    }

    /// fn_handleLoginResponses
    fn handle_login_response(&self, p_sessions: &Sessions, p_cmd: &Value, p_guid: &str) -> Result<(), String> {
        let v_d = p_cmd.get("d");
        let v_request = js_interp(prop(v_d, CS_REQUEST_ID)?);
        let mut st = self.state();
        let v_ok = js_strict_eq(prop(v_d, CS_ERROR)?, Some(&json!(ERROR_NON)));
        if !v_ok || !st.waiting_login.contains_key(&v_request) {
            let Some(w) = st.waiting_login.get(&v_request) else {
                return Err(read_error("undefined", "m_client_conn_feedback"));
            };
            // the request stays pending: its timeout answers again
            let _ = w.feedback.send(login_reply(&json!({ ERROR: ERROR_SERVER_NOT_AVAILABLE })));
            return Ok(());
        }
        let w = st.waiting_login.remove(&v_request).unwrap();
        drop(st);
        let v_d = v_d.unwrap();
        let mut v_server_info = json!({});
        for k in [CS_LOGIN_TEMP_KEY, CS_SERVER_PUBLIC_HOST, CS_SERVER_PORT] {
            set_field_opt(&mut v_server_info, k, v_d.get(k).cloned());
        }
        let mut v_card = w.card;
        v_card["m_commServerGUID"] = json!(p_guid);
        v_card["m_serverInfo"] = v_server_info.clone();
        p_sessions.update(&w.session_id, |c| {
            c["m_commServerGUID"] = json!(p_guid);
            c["m_serverInfo"] = v_server_info;
        });
        let _ = w.feedback.send(login_reply(&v_card));
        Ok(())
    }

    /// fn_handleStorageStatus
    fn handle_storage_status(&self, p_cmd: &Value, p_guid: &str) -> Result<(), String> {
        let mut st = self.state();
        let Some(v_info) = st.servers.get_mut(p_guid) else {
            println!("[INFO] Storage status from unknown comm server: {}", p_guid);
            return Ok(());
        };
        let v_d = p_cmd.get("d");
        let v_server = &mut v_info["m_server"];
        if !js_truthy(v_server.get("m_storageStatus")) {
            v_server["m_storageStatus"] = json!({});
        }
        let v_prev = or_null(v_server["m_storageStatus"].get("status"));
        let v_status = prop(v_d, "status")?.cloned();
        let mut v_new = json!({});
        set_field_opt(&mut v_new, "status", v_status.clone());
        for k in ["storage_host", "storage_port", "timestamp"] {
            set_field_opt(&mut v_new, k, prop(v_d, k)?.cloned());
        }
        v_new["error"] = or_null(prop(v_d, "error")?);
        v_server["m_storageStatus"] = v_new;
        if !js_strict_eq(Some(&v_prev), v_status.as_ref()) {
            println!(
                "[INFO] Comm server {} storage status: {}",
                js_interp(v_server.get("m_serverId")),
                status_text(v_status.as_ref())
            );
        }
        Ok(())
    }

    /// fn_handleUdpRelayStatus
    fn handle_relay_status(&self, p_cmd: &Value, p_guid: &str) -> Result<(), String> {
        let mut st = self.state();
        let Some(v_info) = st.servers.get_mut(p_guid) else {
            println!("[INFO] UDP relay status from unknown comm server: {}", p_guid);
            return Ok(());
        };
        let v_d = p_cmd.get("d");
        let v_server = &mut v_info["m_server"];
        if v_server.get("m_udpRelayStatus").map(|v| v.is_null() || is_undefined(v)).unwrap_or(true) {
            v_server["m_udpRelayStatus"] = json!({});
        }
        let v_relay_id = prop(v_d, "relay_id")?.cloned();
        let v_key = match &v_relay_id {
            Some(v) if !v.is_null() => js_to_string(v),
            _ => "default".to_string(),
        };
        let v_prev = v_server["m_udpRelayStatus"]
            .get(&v_key)
            .filter(|v| !v.is_null())
            .map(|r| r.get("status").cloned().unwrap_or_else(droneengage_server_common::util::undefined));
        let v_status = prop(v_d, "status")?.cloned();
        let mut v_new = json!({});
        set_field_opt(&mut v_new, "relay_id", v_relay_id);
        set_field_opt(&mut v_new, "host", prop(v_d, "host")?.cloned());
        set_field_opt(&mut v_new, "port", prop(v_d, "port")?.cloned());
        set_field_opt(&mut v_new, "status", v_status.clone());
        set_field_opt(&mut v_new, "pairs", prop(v_d, "pairs")?.cloned());
        set_field_opt(&mut v_new, "timestamp", prop(v_d, "timestamp")?.cloned());
        v_new["error"] = or_null(prop(v_d, "error")?);
        if v_server["m_udpRelayStatus"].is_object() {
            v_server["m_udpRelayStatus"][v_key.as_str()] = v_new;
        }
        let v_prev_cmp = match &v_prev {
            None => Some(Value::Null),
            Some(v) if is_undefined(v) => None,
            Some(v) => Some(v.clone()),
        };
        if !js_strict_eq(v_prev_cmp.as_ref(), v_status.as_ref()) {
            println!(
                "[INFO] Comm server {} UDP relay {} status: {}",
                js_interp(v_server.get("m_serverId")),
                v_key,
                status_text(v_status.as_ref())
            );
        }
        Ok(())
    }

    /// fn_handleUdpProxiesReport
    fn handle_proxies_report(&self, p_cmd: &Value, p_guid: &str) {
        let v_d = p_cmd.get("d").filter(|d| js_truthy(Some(d))).cloned();
        let v_proxies =
            v_d.as_ref().and_then(|d| d.get("proxies")).filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!([]));
        let mut st = self.state();
        if let Some(v_info) = st.servers.get_mut(p_guid) {
            if v_info["m_server"].is_object() {
                v_info["m_server"]["m_udpProxies"] = v_proxies.clone();
                v_info["m_server"]["m_udpProxiesTimestamp"] = json!(now_ms());
            }
        }
        let v_request =
            v_d.as_ref().and_then(|d| d.get(CS_REQUEST_ID)).filter(|v| !v.is_null()).map(|v| js_interp(Some(v)));
        if let Some(r) = v_request {
            if let Some(s) = st.waiting_udp.remove(&r) {
                let _ = s.send(Ok((v_proxies, v_d.unwrap_or(Value::Null))));
            }
        }
    }

    /// fn_handleBlockedUnitsReport
    fn handle_blocked_units(&self, p_cmd: &Value, p_guid: &str) -> Result<(), String> {
        let v_d = p_cmd.get("d").filter(|d| js_truthy(Some(d))).cloned();
        let v_units =
            v_d.as_ref().and_then(|d| d.get("units")).filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!([]));
        let mut st = self.state();
        if let Some(v_info) = st.servers.get_mut(p_guid) {
            let v_server = &mut v_info["m_server"];
            if v_server.is_object() {
                v_server["m_blockedUnits"] = v_units.clone();
                let v_key =
                    if js_truthy(v_server.get("m_accountDetails")) { "m_accountDetails" } else { "accountDetails" };
                if let Some(Value::Object(v_details)) = v_server.get_mut(v_key) {
                    for (_, v_list) in v_details.iter_mut() {
                        let Value::Array(v_list) = v_list else { continue };
                        for v_unit in v_list.iter_mut() {
                            if let Value::Object(u) = v_unit {
                                let v_name = u.get("unitName").cloned();
                                let v_found = match &v_units {
                                    Value::Array(a) => a.iter().any(|x| js_strict_eq(Some(x), v_name.as_ref())),
                                    Value::String(s) => s.contains(&js_interp(v_name.as_ref())),
                                    _ => return Err("TypeError: c_units.indexOf is not a function".into()),
                                };
                                u.insert("blocked".into(), json!(v_found));
                            }
                        }
                    }
                }
            }
        }
        let v_request =
            v_d.as_ref().and_then(|d| d.get(CS_REQUEST_ID)).filter(|v| !v.is_null()).map(|v| js_interp(Some(v)));
        if let Some(r) = v_request {
            if let Some(s) = st.waiting_blocked.remove(&r) {
                let _ = s.send(Ok((v_units, v_d.unwrap_or(Value::Null))));
            }
        }
        Ok(())
    }
}

/// fn_handleLogoutNotification: drops the sender's login cards.
fn handle_logout(p_sessions: &Sessions, p_cmd: &Value) -> Result<(), String> {
    let v_sender = prop(p_cmd.get("d"), CS_SENDER_ID)?.cloned();
    let Some(v_sender) = v_sender.filter(|v| !v.is_null()) else {
        println!("err:fn_handleLogoutNotification: missing senderID");
        return Ok(());
    };
    let v_cards = p_sessions.by_account_id(&v_sender);
    if v_cards.is_empty() {
        println!("[INFO] No active sessions found for senderID: {}", js_interp(Some(&v_sender)));
    }
    for c in v_cards {
        let v_session = js_interp(c.get("m_session_id"));
        p_sessions.delete(&v_session);
        println!("[INFO] Session removed for senderID: {} sessionID: {}", js_interp(Some(&v_sender)), v_session);
    }
    Ok(())
}

/// A rough V8 JSON.parse error message.
fn json_syntax_error(p_msg: &[u8]) -> String {
    let v_text = String::from_utf8_lossy(p_msg);
    if v_text.trim().is_empty() {
        return "Unexpected end of JSON input".into();
    }
    match serde_json::from_str::<Value>(&v_text) {
        Err(e) if e.is_eof() => "Unexpected end of JSON input".into(),
        Err(e) => {
            let v_col = e.column().saturating_sub(1);
            let v_line = v_text.lines().nth(e.line().saturating_sub(1)).unwrap_or("");
            match v_line.chars().nth(v_col) {
                Some(ch) if v_text.chars().count() <= 10 => {
                    format!("Unexpected token '{}', \"{}\" is not valid JSON", ch, v_text)
                }
                Some(ch) => format!(
                    "Unexpected token '{}', \"{}\"... is not valid JSON",
                    ch,
                    v_text.chars().take(10).collect::<String>()
                ),
                None => "Unexpected end of JSON input".into(),
            }
        }
        Ok(_) => String::new(),
    }
}

/// Server-info fields used by the admin servers API (`m_x || x || d`).
pub fn field_or<'a>(p_server: &'a Value, p_a: &str, p_b: &str) -> Option<&'a Value> {
    p_server.get(p_a).filter(|v| js_truthy(Some(v))).or_else(|| p_server.get(p_b).filter(|v| js_truthy(Some(v))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(online: bool, id: &str, accounts: Value) -> Vec<u8> {
        js_stringify(&json!({"c": "a", "d": {"isOnline": online, "version": "1", "serverId": id, "public_host": "h", "serverPort": 9, "accounts": accounts, "accountDetails": {}}})).into_bytes()
    }

    #[tokio::test]
    async fn servers_selection_and_login_flow() {
        let m = CommManager::default();
        let s = Sessions::default();
        let (v_tx, mut v_rx) = tokio::sync::mpsc::unbounded_channel();
        m.add_link("g1", v_tx);
        m.on_message(&s, "g1", &info(true, "c1", json!(["9xx"])));
        let v_card = json!({"e": 0, "m_session_id": "s1", "m_acc_id_hashed": "1xx", "b": "1", "m_actorType": "g", "m_data": {"m_prm": 7}});
        let v_server = m.select_server_for_account(&v_card).unwrap().unwrap();
        assert_eq!(v_server["m_server"]["m_serverId"], json!("c1"));

        let (v_fb, mut v_replies) = tokio::sync::mpsc::unbounded_channel();
        m.request_login(&s, &v_card, &v_server, v_fb);
        let v_sent: Value = serde_json::from_str(&v_rx.recv().await.unwrap()).unwrap();
        assert_eq!(v_sent["c"], json!("b"));
        assert_eq!(v_sent["d"]["a"], json!("1xx"));
        assert!(v_sent["d"].get("il").is_none(), "undefined is omitted");
        let v_req = v_sent["d"]["r"].as_str().unwrap().to_string();
        let v_reply = js_stringify(&json!({"c": "b", "d": {"r": v_req, "e": 0, "f": "key", "g": "host", "h": 1}}));
        m.on_message(&s, "g1", v_reply.as_bytes());
        let v_party = v_replies.recv().await.unwrap();
        assert_eq!(v_party["cs"], json!({"f": "key", "g": "host", "h": 1}));
        assert_eq!(v_party["sid"], json!("s1"));

        // the INFO with a changed isOnline keeps the raw card
        m.on_message(&s, "g1", &info(false, "c1", json!([])));
        assert_eq!(m.server("g1").unwrap()["m_server"]["isOnline"], json!(false));
        assert_eq!(m.server("g1").unwrap()["m_server"]["m_isOnline"], json!(false));
        assert!(m.select_server_for_account(&v_card).is_err(), "raw card has no m_accounts");
        m.on_message(&s, "g1", &info(false, "c1", json!([])));
        assert!(m.select_server_for_account(&v_card).unwrap().is_none());
        m.server_closed("g1");
        assert!(m.servers().is_empty());
    }
}
