//! Login cards (js_session_manager.js): created on login, keyed by session
//! ID, removed on logout, on the comm server's logout notification and when
//! an account's access code is rotated. A card is the JavaScript object
//! (`m_data`, `m_session_id`, `m_acc_id_hashed`, ...), kept as JSON.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::sync::Mutex;

use crate::accounts::Accounts;
use crate::constants::*;
use crate::filedb::verify;
use droneengage_server_common::colors as c;
use droneengage_server_common::password;
use droneengage_server_common::util::{js_strict_eq, js_to_string, set_field_opt};

/// fn_generateSenderID
pub fn sender_id(p_sid: &Value) -> Value {
    json!(format!("{}xx", js_to_string(p_sid)))
}

/// fn_generateSessionID: a v4 UUID without dashes plus the nanosecond part
/// of process.hrtime().
pub fn session_id() -> String {
    let v_ns =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    format!("{}{}", uuid::Uuid::new_v4().simple(), v_ns)
}

/// `new Date()` as a card stores it (JSON.stringify writes the ISO form).
fn now_date() -> Value {
    json!(droneengage_server_common::util::iso_time(droneengage_server_common::util::now_ms()))
}

fn not_found() -> Value {
    json!({ ERROR_MSG: "Account Not Found.", ERROR: ERROR_ACCOUNT_NOT_FOUND })
}

fn prm(p_card: &Value) -> Option<&Value> {
    p_card.get("m_data").and_then(|d| d.get("m_prm"))
}

/// fn_isGCSLogin
pub fn is_gcs_login(p_card: &Value) -> bool {
    p_card.get("m_data").map(|d| !d.is_null()).unwrap_or(false) && crate::perm::validate(prm(p_card), ALLOW_GCS_LOGIN)
}

/// fn_isUnitLogin
pub fn is_unit_login(p_card: &Value) -> bool {
    p_card.get("m_data").map(|d| !d.is_null()).unwrap_or(false) && crate::perm::validate(prm(p_card), ALLOW_UNIT_LOGIN)
}

/// fn_isViewMode
pub fn is_view_mode(p_card: &Value) -> bool {
    p_card.get("m_data").map(|d| !d.is_null()).unwrap_or(false) && crate::perm::is_view_mode(prm(p_card))
}

/// fn_generateLoginReplyToParty
pub fn login_reply(p_card: &Value) -> Value {
    let mut v = json!({});
    set_field_opt(&mut v, ERROR, p_card.get(ERROR).cloned());
    if !p_card.get(ERROR).map(loose_zero).unwrap_or(false) {
        set_field_opt(&mut v, ERROR_MSG, p_card.get(ERROR_MSG).cloned());
    } else {
        let d = p_card.get("m_data").cloned().unwrap_or(Value::Null);
        set_field_opt(&mut v, SESSION_ID, p_card.get("m_session_id").cloned());
        set_field_opt(&mut v, PERMISSION, d.get("m_permission").cloned());
        set_field_opt(&mut v, PERMISSION2, d.get("m_prm").cloned());
        set_field_opt(&mut v, COMM_SERVER, p_card.get("m_serverInfo").cloned());
        set_field_opt(&mut v, ACCOUNT_ID_PARAMETER, d.get("m_sid").cloned());
        v[IS_ADMIN_PARAMETER] = json!(p_card.get("m_isadmin") == Some(&json!(true)));
    }
    v
}

/// m_loginCardList
#[derive(Default)]
pub struct Sessions {
    m_cards: Mutex<IndexMap<String, Value>>,
}

impl Sessions {
    fn finish_card(
        &self,
        mut p_card: Value,
        p_actor: &Value,
        p_group: &Value,
        p_login: &Value,
        p_sid: &Value,
    ) -> Value {
        p_card[CS_GROUP_ID] = p_group.clone();
        p_card["m_actorType"] = p_actor.clone();
        let v_session = session_id();
        p_card["m_session_id"] = json!(v_session);
        p_card["m_acc_id_hashed"] = sender_id(p_sid);
        p_card["m_login_name"] = p_login.clone();
        self.m_cards.lock().unwrap().insert(v_session, p_card.clone());
        p_card
    }

    /// fn_createLoginCard: verifies the credentials against the account
    /// store and registers the card. None: the JavaScript never calls back
    /// (a storage type it cannot serve).
    pub fn create_login_card(
        &self,
        p_accounts: &Accounts,
        p_account: &Value,
        p_code: &Value,
        p_actor: &Value,
        p_group: &Value,
    ) -> crate::validator::Js<Option<Value>> {
        let v_cfg = &p_accounts.cfg;
        let v_type = v_cfg.storage_type();
        let v_code_text = js_to_string(p_code);
        if v_type == "single" && v_cfg.has("single_account_user_name") && v_cfg.has("single_account_access_code") {
            let v_user = v_cfg.get("single_account_user_name").cloned().unwrap_or(Value::Null);
            let v_name_ok = loose_eq(&v_user, p_account);
            if !v_name_ok || !verify(Some(&v_code_text), v_cfg.get("single_account_access_code")) {
                return Ok(Some(not_found()));
            }
            let mut v_card = json!({
                "m_data": { "m_prm": 4294967295u32, "m_permission": "D1G1T3R4V5C6", "m_sid": "1" },
                "m_timestamp": now_date(),
                "m_isadmin": true,
                ERROR: ERROR_NON,
            });
            v_card = self.finish_card(v_card, p_actor, p_group, p_account, &json!("1"));
            return Ok(Some(v_card));
        }
        if v_type == "file" && v_cfg.has("file_db") {
            let v_record = p_accounts.fdb("fn_get_record")?.get_record(p_account)?;
            let Some(v_record) = v_record else { return Ok(Some(not_found())) };
            let v_stored = v_record
                .get("AccessCode")
                .filter(|v| droneengage_server_common::util::js_truthy(Some(v)))
                .or_else(|| v_record.get("pwd"))
                .cloned();
            if !droneengage_server_common::util::js_truthy(v_stored.as_ref())
                || !verify(Some(&v_code_text), v_stored.as_ref())
            {
                return Ok(Some(not_found()));
            }
            if v_record.get("enabled") == Some(&json!(false)) {
                return Ok(Some(json!({ ERROR_MSG: "Account is Disabled.", ERROR: ERROR_ACCOUNT_DISABLED })));
            }
            if !password::is_hashed(&js_to_string(v_stored.as_ref().unwrap())) {
                if let Some(v_hash) = password::hash(&v_code_text) {
                    let v_data = json!({
                        "sid": v_record.get("sid").cloned().unwrap_or(Value::Null),
                        "AccessCode": v_hash,
                        "prm": v_record.get("prm").cloned().unwrap_or(Value::Null),
                        "isadmin": v_record.get("isadmin").cloned().unwrap_or(Value::Null),
                    });
                    if let Err(e) = p_accounts.fdb("fn_update_record")?.update_record(p_account, &v_data) {
                        eprintln!("[session] lazy hash upgrade failed: TypeError: {}", e);
                    }
                }
            }
            let v_sid = v_record.get("sid").cloned().unwrap_or(Value::Null);
            let mut v_data = json!({});
            set_field_opt(&mut v_data, "m_prm", crate::perm::to_int(v_record.get("prm")));
            v_data["m_permission"] = json!("D1G1T3R4V5C6");
            set_field_opt(&mut v_data, "m_sid", v_record.get("sid").cloned());
            let v_card = json!({
                "m_data": v_data,
                "m_timestamp": now_date(),
                "m_isadmin": v_record.get("isadmin") == Some(&json!(true)),
                ERROR: ERROR_NON,
            });
            return Ok(Some(self.finish_card(v_card, p_actor, p_group, p_account, &v_sid)));
        }
        if v_type == "db" {
            let mut v_reply = p_accounts.db_login(Some(p_account), Some(p_code))?;
            if v_reply.get(ERROR).and_then(Value::as_f64) != Some(0.0) {
                return Ok(Some(v_reply));
            }
            let v_prm = crate::perm::to_int(v_reply["m_data"].get("m_prm"));
            set_field_opt(&mut v_reply["m_data"], "m_prm", v_prm);
            v_reply["m_timestamp"] = now_date();
            let v_sid = v_reply["m_data"]["m_sid"].clone();
            return Ok(Some(self.finish_card(v_reply, p_actor, p_group, p_account, &v_sid)));
        }
        println!(
            "{}FATAL ERROR:{} account_storage_type or file_db or db connection{} are not specified in config file. ",
            c::B_ERROR,
            c::FG_YELLOW,
            c::RESET
        );
        Ok(None)
    }

    /// fn_getLoginCardBySessionID
    pub fn by_session(&self, p_session: Option<&Value>) -> Option<Value> {
        let v_key = droneengage_server_common::util::js_key(p_session);
        self.m_cards.lock().unwrap().get(&v_key).cloned()
    }

    /// Changes a card in place (a no-op once the card is gone).
    pub fn update(&self, p_session: &str, p_change: impl FnOnce(&mut Value)) {
        if let Some(c) = self.m_cards.lock().unwrap().get_mut(p_session) {
            p_change(c);
        }
    }

    fn matching(&self, p_field: &str, p_value: &Value) -> Vec<Value> {
        let v_cards = self.m_cards.lock().unwrap();
        v_cards.values().filter(|c| js_strict_eq(c.get(p_field), Some(p_value))).cloned().collect()
    }

    /// fn_getLoginCardsByAccountId (m_acc_id_hashed)
    pub fn by_account_id(&self, p_id: &Value) -> Vec<Value> {
        self.matching("m_acc_id_hashed", p_id)
    }

    /// fn_getLoginCardsByAccountName (m_login_name)
    pub fn by_account_name(&self, p_name: &Value) -> Vec<Value> {
        self.matching("m_login_name", p_name)
    }

    /// fn_deleteOldCard
    pub fn delete(&self, p_session: &str) {
        self.m_cards.lock().unwrap().shift_remove(p_session);
    }

    pub fn len(&self) -> usize {
        self.m_cards.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// `v == 0` (loose equality with zero).
pub fn loose_zero(p_value: &Value) -> bool {
    match p_value {
        Value::Number(n) => droneengage_server_common::util::json_number_f64(n) == 0.0,
        Value::Bool(b) => !b,
        Value::String(_) => droneengage_server_common::util::js_number(Some(p_value)) == 0.0,
        Value::Array(a) => a.is_empty(),
        _ => false,
    }
}

/// `a != b` negated (loose equality) for the single-account name check.
fn loose_eq(p_a: &Value, p_b: &Value) -> bool {
    match (p_a, p_b) {
        (Value::Null, Value::Null) => true,
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Number(_), _) | (_, Value::Number(_)) | (Value::Bool(_), _) | (_, Value::Bool(_)) => {
            if p_a.is_null() || p_b.is_null() {
                return false;
            }
            let (a, b) = (
                droneengage_server_common::util::js_number(Some(p_a)),
                droneengage_server_common::util::js_number(Some(p_b)),
            );
            a == b
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Cfg;

    fn single() -> Accounts {
        Accounts {
            cfg: Cfg::from_value(json!({
                "account_storage_type": "single",
                "single_account_user_name": "a@x.io",
                "single_account_access_code": "pwd1"
            })),
            file: None,
            db: None,
        }
    }

    #[test]
    fn single_account_cards() {
        let s = Sessions::default();
        let a = single();
        let v_card =
            s.create_login_card(&a, &json!("a@x.io"), &json!("pwd1"), &json!("g"), &json!("1")).unwrap().unwrap();
        assert_eq!(v_card["m_acc_id_hashed"], json!("1xx"));
        assert_eq!(v_card["b"], json!("1"));
        assert!(is_gcs_login(&v_card) && is_unit_login(&v_card) && !is_view_mode(&v_card));
        let v_keys: Vec<&String> = v_card.as_object().unwrap().keys().collect();
        assert_eq!(
            v_keys,
            [
                "m_data",
                "m_timestamp",
                "m_isadmin",
                "e",
                "b",
                "m_actorType",
                "m_session_id",
                "m_acc_id_hashed",
                "m_login_name"
            ]
        );
        assert_eq!(s.by_account_id(&json!("1xx")).len(), 1);
        let v_bad =
            s.create_login_card(&a, &json!("a@x.io"), &json!("nope"), &json!("g"), &json!("1")).unwrap().unwrap();
        assert_eq!(v_bad, json!({"em": "Account Not Found.", "e": 2}));
        let v_reply = login_reply(&v_card);
        assert_eq!(v_reply["isadmin"], json!(true));
        assert_eq!(v_reply["aid"], json!("1"));
        assert!(v_reply.get("cs").map(droneengage_server_common::util::is_undefined).unwrap_or(false));
        s.delete(v_card["m_session_id"].as_str().unwrap());
        assert!(s.is_empty());
    }
}
