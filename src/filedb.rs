//! The file account store (database/db_users.js): a lowdb JSON document
//! `{ db_info: {TeamID, LoginID}, teams: {<TeamID>: team}, logins:
//! {<LoginName>: login} }`, written as `JSON.stringify(data, null, 2)` to
//! `.<name>.tmp` and renamed over the file (steno). Keys follow JavaScript
//! object order (integer-like keys first) when iterated and written.
//!
//! lowdb writes asynchronously; here each write completes before the
//! operation replies, which is the order the JavaScript callbacks observe.

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::constants::*;
use crate::jsv::{js_gt, js_keys, js_ordered, locale_compare};
use crate::validator::{js_trim, Js};
use droneengage_server_common::password;
use droneengage_server_common::util::{
    is_undefined, js_key, js_strict_eq, js_stringify_pretty, js_to_string, js_truthy, set_field_opt, undefined,
};

pub const INFO_FIELD: &str = "db_info";

fn reply_err(p_msg: &str, p_code: i64) -> Value {
    json!({ ERROR_MSG: p_msg, ERROR: p_code })
}

fn type_error(p_key: &str) -> String {
    format!("Cannot read properties of undefined (reading '{}')", p_key)
}

/// `obj[key]` for a JSON value (None = undefined).
fn get<'a>(p_obj: &'a Value, p_key: &str) -> Option<&'a Value> {
    match p_obj {
        Value::Object(m) => m.get(p_key).filter(|v| !is_undefined(v)),
        _ => None,
    }
}

/// The public record shape of a login (fn_get_record and friends).
fn public_record(p_login: &Value) -> Value {
    let mut v = json!({});
    set_field_opt(&mut v, "sid", get(p_login, "TeamID").cloned());
    set_field_opt(&mut v, "AccessCode", get(p_login, "AccessCode").cloned());
    set_field_opt(&mut v, "prm", get(p_login, "Permissions").cloned());
    set_field_opt(&mut v, "isadmin", get(p_login, "IsAdmin").cloned());
    v["enabled"] = json!(!matches!(get(p_login, "Enabled"), Some(Value::Bool(false))));
    v
}

/// `isHashed(code) ? code : hash(code)`
fn stored_code(p_code: &Value) -> Value {
    let v_text = js_to_string(p_code);
    if password::is_hashed(&v_text) {
        p_code.clone()
    } else {
        password::hash(&v_text).map(Value::String).unwrap_or(Value::Null)
    }
}

/// Normalizes the 'D1G1T3R4V5C6' literal and converts to a number.
fn normalize_permission(p_prm: Option<&Value>) -> Option<Value> {
    if let Some(Value::String(s)) = p_prm {
        if s == "D1G1T3R4V5C6" {
            return crate::perm::to_int(Some(&json!("0xffffffff")));
        }
    }
    crate::perm::to_int(p_prm)
}

fn new_team(p_team_id: &Value, p_email: &str) -> Value {
    json!({ "TeamID": p_team_id, "TeamName": p_email, "Email": p_email, "InstanceLimit": 999, "Enabled": true })
}

pub struct FileDb {
    m_file: PathBuf,
    m_data: Value,
}

impl FileDb {
    /// new db_user(file): reads the file (defaults when missing or
    /// unreadable) and migrates the old flat `users` format.
    pub fn open(p_file: &Path) -> FileDb {
        let mut v_data = json!({ INFO_FIELD: { "TeamID": 0, "LoginID": 0 }, "teams": {}, "logins": {} });
        if p_file.exists() {
            match std::fs::read_to_string(p_file) {
                Ok(t) => match serde_json::from_str::<Value>(&t) {
                    Ok(v @ (Value::Object(_) | Value::Array(_))) => v_data = v,
                    Ok(_) => {}
                    Err(e) => eprintln!("Failed to read DB file, using defaults: {}", json_error_message(&t, &e)),
                },
                Err(e) => eprintln!("Failed to read DB file, using defaults: {}", e),
            }
        }
        let mut v_db = FileDb { m_file: p_file.to_path_buf(), m_data: v_data };
        if let Err(e) = v_db.migrate_if_needed() {
            eprintln!("Failed to migrate DB: TypeError: {}", e);
        }
        v_db
    }

    pub fn data(&self) -> &Value {
        &self.m_data
    }

    fn migrate_if_needed(&mut self) -> Js<()> {
        let d = &self.m_data;
        if js_truthy(get(d, "teams")) && js_truthy(get(d, "logins")) {
            return Ok(());
        }
        if !(js_truthy(get(d, "users")) && !js_truthy(get(d, "teams"))) {
            return Ok(());
        }
        println!("[INFO] Migrating old flat-file format to new teams/logins structure");
        let v_old = get(d, "users").cloned().unwrap_or(Value::Null);
        let v_old_map = v_old.as_object().cloned().unwrap_or_default();
        self.m_data["teams"] = json!({});
        self.m_data["logins"] = json!({});
        let mut v_max_team = json!(0);
        let mut v_max_login = 0i64;
        let mut v_by_sid = Map::new();
        for v_email in js_keys(&v_old_map) {
            let v_user = &v_old_map[&v_email];
            let v_sid = get(v_user, "sid").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(1));
            let v_key = js_key(Some(&v_sid));
            if !js_truthy(v_by_sid.get(&v_key)) {
                v_by_sid.insert(v_key, new_team(&v_sid, &v_email));
                if js_gt(&v_sid, &v_max_team) {
                    v_max_team = v_sid.clone();
                }
            }
        }
        for v_key in js_keys(&v_by_sid) {
            let v_team = v_by_sid[&v_key].clone();
            let v_id = js_key(get(&v_team, "TeamID"));
            self.m_data["teams"][v_id] = v_team;
        }
        for v_email in js_keys(&v_old_map) {
            let v_user = &v_old_map[&v_email];
            let v_sid = get(v_user, "sid").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(1));
            v_max_login += 1;
            let v_prm = get(v_user, "prm").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!("0xffffffff"));
            let mut v_login = json!({ "LoginID": v_max_login, "TeamID": v_sid, "LoginName": v_email });
            let v_code =
                get(v_user, "AccessCode").filter(|v| js_truthy(Some(v))).or_else(|| get(v_user, "pwd")).cloned();
            set_field_opt(&mut v_login, "AccessCode", v_code);
            set_field_opt(&mut v_login, "Permissions", normalize_permission(Some(&v_prm)));
            v_login["IsAdmin"] = get(v_user, "isadmin").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(false));
            self.m_data["logins"][v_email] = v_login;
        }
        match self.m_data.get_mut(INFO_FIELD) {
            Some(v_info @ Value::Object(_)) => {
                v_info["TeamID"] = v_max_team;
                v_info["LoginID"] = json!(v_max_login);
            }
            _ => return Err(type_error("TeamID").replace("reading", "setting")),
        }
        if let Value::Object(m) = &mut self.m_data {
            m.shift_remove("users");
        }
        if let Err(e) = self.write() {
            eprintln!("Failed to write migrated DB: {}", e);
        }
        println!("[INFO] Migration completed");
        Ok(())
    }

    /// lowdb's write: JSON.stringify(data, null, 2) through `.<name>.tmp`.
    pub fn write(&self) -> Result<(), String> {
        let v_text = js_stringify_pretty(&js_ordered(&self.m_data), 2);
        let v_name = self.m_file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let v_tmp = self.m_file.with_file_name(format!(".{}.tmp", v_name));
        std::fs::write(&v_tmp, v_text).map_err(|e| node_fs_error("open", &v_tmp, &e))?;
        std::fs::rename(&v_tmp, &self.m_file).map_err(|e| node_fs_error("rename", &v_tmp, &e))
    }

    fn logins(&self) -> Js<&Map<String, Value>> {
        match get(&self.m_data, "logins") {
            Some(Value::Object(m)) => Ok(m),
            _ => Err(type_error("logins")),
        }
    }

    fn login(&self, p_key: &str) -> Js<Option<&Value>> {
        Ok(self.logins()?.get(p_key).filter(|v| js_truthy(Some(v))))
    }

    fn info_value(&self, p_key: &str) -> Js<Value> {
        match get(&self.m_data, INFO_FIELD) {
            Some(i @ Value::Object(_)) => Ok(get(i, p_key).cloned().unwrap_or_else(undefined)),
            _ => Err(type_error(p_key)),
        }
    }

    /// `this.db.data[info_field].LoginID + 1`, stored back.
    fn next_login_id(&mut self) -> Js<Value> {
        let v_cur = self.info_value("LoginID")?;
        let v_next = match &v_cur {
            Value::String(s) if !is_undefined(&v_cur) => Value::String(format!("{}1", s)),
            v => crate::jsv::num(droneengage_server_common::util::js_number(Some(v)) + 1.0),
        };
        self.m_data[INFO_FIELD]["LoginID"] = v_next.clone();
        Ok(v_next)
    }

    /// Creates the team when missing and raises db_info.TeamID.
    fn ensure_team(&mut self, p_team_id: &Value, p_email: &str) -> Js<()> {
        let v_key = js_key(Some(p_team_id));
        let v_exists = match get(&self.m_data, "teams") {
            Some(t @ Value::Object(_)) => js_truthy(get(t, &v_key)),
            _ => return Err(type_error(&v_key)),
        };
        if !v_exists {
            self.m_data["teams"][v_key] = new_team(p_team_id, p_email);
            if js_gt(p_team_id, &self.info_value("TeamID")?) {
                self.m_data[INFO_FIELD]["TeamID"] = p_team_id.clone();
            }
        }
        Ok(())
    }

    fn check_user_data(p_key: &Value, p_data: &Value) -> Option<Value> {
        if !js_truthy(Some(p_data)) || js_strict_eq(Some(p_key), Some(&json!(INFO_FIELD))) {
            return Some(reply_err("Invalid parameters.", ERROR_DATA_DATABASE_ERROR));
        }
        if !js_truthy(get(p_data, "sid")) || !js_truthy(get(p_data, "AccessCode")) || !js_truthy(get(p_data, "prm")) {
            return Some(reply_err("Missing required fields (sid, AccessCode, or prm).", ERROR_DATA_DATABASE_ERROR));
        }
        None
    }

    fn written(&self, p_what: &str, p_msg: &str) -> Option<Value> {
        match self.write() {
            Ok(()) => None,
            Err(e) => {
                eprintln!("Failed to {}: {}", p_what, e);
                Some(reply_err(p_msg, ERROR_DATA_DATABASE_ERROR))
            }
        }
    }

    /// fn_add_record(email, {sid, AccessCode, prm, isadmin, enabled})
    pub fn add_record(&mut self, p_email: &Value, p_data: &Value) -> Js<Value> {
        if let Some(r) = Self::check_user_data(p_email, p_data) {
            return Ok(r);
        }
        let v_email = js_key(Some(p_email));
        let v_isadmin = get(p_data, "isadmin").filter(|v| !v.is_null()).cloned().unwrap_or(json!(false));
        if self.login(&v_email)?.is_some() {
            return Ok(reply_err("Duplicate entry.", ERROR_DATA_DATABASE_ERROR));
        }
        let v_team_id = get(p_data, "sid").cloned().unwrap_or(Value::Null);
        self.ensure_team(&v_team_id, &v_email)?;
        let v_login_id = self.next_login_id()?;
        let mut v_login = json!({ "LoginID": v_login_id, "TeamID": v_team_id, "LoginName": v_email });
        v_login["AccessCode"] = stored_code(get(p_data, "AccessCode").unwrap_or(&Value::Null));
        set_field_opt(&mut v_login, "Permissions", normalize_permission(get(p_data, "prm")));
        v_login["IsAdmin"] = v_isadmin;
        v_login["Enabled"] = json!(!matches!(get(p_data, "enabled"), Some(Value::Bool(false))));
        self.m_data["logins"][v_email.as_str()] = v_login;
        if let Some(r) = self.written("write record", "Storage Error.") {
            return Ok(r);
        }
        Ok(json!({ ERROR: ERROR_NON, ACCOUNT_ID_PARAMETER: v_team_id, LOGIN_ID_PARAMETER: v_login_id }))
    }

    /// fn_update_record(email, {sid, AccessCode, prm, isadmin, enabled})
    pub fn update_record(&mut self, p_email: &Value, p_data: &Value) -> Js<Value> {
        if let Some(r) = Self::check_user_data(p_email, p_data) {
            return Ok(r);
        }
        let v_email = js_key(Some(p_email));
        let v_isadmin = get(p_data, "isadmin").filter(|v| !v.is_null()).cloned().unwrap_or(json!(false));
        let Some(v_existing) = self.login(&v_email)?.cloned() else {
            return Ok(reply_err("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        };
        let v_team_id = get(p_data, "sid").cloned().unwrap_or(Value::Null);
        let mut v_login = match &v_existing {
            Value::Object(_) => v_existing.clone(),
            _ => json!({}),
        };
        v_login["TeamID"] = v_team_id.clone();
        v_login["LoginName"] = json!(v_email);
        v_login["AccessCode"] = stored_code(get(p_data, "AccessCode").unwrap_or(&Value::Null));
        set_field_opt(&mut v_login, "Permissions", normalize_permission(get(p_data, "prm")));
        v_login["IsAdmin"] = v_isadmin;
        v_login["Enabled"] = json!(match get(p_data, "enabled") {
            None => !matches!(get(&v_existing, "Enabled"), Some(Value::Bool(false))),
            Some(v) => !matches!(v, Value::Bool(false)),
        });
        self.m_data["logins"][v_email.as_str()] = v_login;
        self.ensure_team(&v_team_id, &v_email)?;
        if let Some(r) = self.written("write record", "Storage Error.") {
            return Ok(r);
        }
        let mut v_reply = json!({ ERROR: ERROR_NON });
        set_field_opt(&mut v_reply, ACCOUNT_ID_PARAMETER, get(&v_existing, "TeamID").cloned());
        set_field_opt(&mut v_reply, LOGIN_ID_PARAMETER, get(&v_existing, "LoginID").cloned());
        Ok(v_reply)
    }

    /// fn_get_keys
    pub fn keys(&self) -> Js<Vec<String>> {
        Ok(js_keys(self.logins()?))
    }

    /// fn_delete_record
    pub fn delete_record(&mut self, p_key: &Value) -> Js<()> {
        let v_key = js_key(Some(p_key));
        if js_strict_eq(Some(p_key), Some(&json!(INFO_FIELD))) || self.login(&v_key)?.is_none() {
            return Ok(());
        }
        if let Some(Value::Object(m)) = self.m_data.get_mut("logins") {
            m.shift_remove(&v_key);
        }
        if let Err(e) = self.write() {
            eprintln!("Failed to delete record: {}", e);
        }
        Ok(())
    }

    /// fn_set_login_enabled
    pub fn set_login_enabled(&mut self, p_email: &Value, p_enabled: bool) -> Js<Value> {
        let v_email = js_key(Some(p_email));
        if self.login(&v_email)?.is_none() {
            return Ok(reply_err("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        }
        self.m_data["logins"][v_email.as_str()]["Enabled"] = json!(p_enabled);
        if let Some(r) = self.written("write record", "Storage Error.") {
            return Ok(r);
        }
        Ok(json!({ ERROR: ERROR_NON }))
    }

    /// fn_get_record: the public shape, or None.
    pub fn get_record(&self, p_key: &Value) -> Js<Option<Value>> {
        Ok(self.login(&js_key(Some(p_key)))?.map(public_record))
    }

    /// fn_set_recovery_code
    pub fn set_recovery_code(&mut self, p_email: &Value, p_hash: &str) -> Js<Value> {
        let v_email = js_key(Some(p_email));
        if self.login(&v_email)?.is_none() {
            return Ok(reply_err("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        }
        let v_login = &mut self.m_data["logins"][v_email.as_str()];
        if v_login.is_object() {
            v_login["RecoveryCode"] = json!(p_hash);
        }
        if let Some(r) = self.written("write recovery code", "Storage Error.") {
            return Ok(r);
        }
        Ok(json!({ ERROR: ERROR_NON }))
    }

    /// fn_get_recovery_code
    pub fn get_recovery_code(&self, p_email: &Value) -> Js<Option<Value>> {
        Ok(self
            .login(&js_key(Some(p_email)))?
            .and_then(|l| get(l, "RecoveryCode"))
            .filter(|v| js_truthy(Some(v)))
            .cloned())
    }

    fn records(&self, p_filter: impl Fn(&Value) -> bool) -> Js<Value> {
        let v_logins = self.logins()?;
        let mut v_out = Map::new();
        for k in js_keys(v_logins) {
            let v_login = &v_logins[&k];
            if p_filter(v_login) {
                v_out.insert(k, public_record(v_login));
            }
        }
        Ok(Value::Object(v_out))
    }

    /// fn_get_all_users (non-admins)
    pub fn all_users(&self) -> Js<Value> {
        self.records(|l| matches!(get(l, "IsAdmin"), Some(Value::Bool(false))))
    }

    /// fn_get_all_users_including_admins
    pub fn all_users_including_admins(&self) -> Js<Value> {
        self.records(|_| true)
    }

    /// fn_get_users_by_sid
    pub fn users_by_sid(&self, p_sid: &Value) -> Js<Value> {
        let v_sid = js_to_string(p_sid);
        self.records(|l| js_to_string(get(l, "TeamID").unwrap_or(&undefined_text())) == v_sid)
    }

    /// fn_get_user_by_accesscode: the first login whose code verifies.
    pub fn user_by_access_code(&self, p_code: Option<&Value>) -> Js<Option<Value>> {
        let v_logins = self.logins()?;
        let v_plain = p_code.map(js_to_string);
        for k in js_keys(v_logins) {
            let v_login = &v_logins[&k];
            if verify(v_plain.as_deref(), get(v_login, "AccessCode")) {
                let mut v = public_record(v_login);
                v["acc"] = json!(k);
                return Ok(Some(v));
            }
        }
        Ok(None)
    }

    /// fn_get_team_info
    pub fn team_info(&self, p_team_id: &Value) -> Js<Option<Value>> {
        let v_key = js_key(Some(p_team_id));
        let v_team = match get(&self.m_data, "teams") {
            Some(t @ Value::Object(_)) => get(t, &v_key).filter(|v| js_truthy(Some(v))),
            _ => return Err(type_error(&v_key)),
        };
        Ok(v_team.map(|t| {
            let mut v = json!({});
            for f in ["TeamID", "TeamName", "Email", "InstanceLimit", "Enabled", "CreatedAt"] {
                set_field_opt(&mut v, f, get(t, f).cloned());
            }
            v
        }))
    }

    /// fn_get_team_logins: the team's logins without access codes, sorted
    /// by LoginName (localeCompare).
    pub fn team_logins(&self, p_team_id: &Value) -> Js<Vec<Value>> {
        let v_logins = self.logins()?;
        let v_team = js_to_string(p_team_id);
        let mut v_out = Vec::new();
        for k in js_keys(v_logins) {
            let v_login = &v_logins[&k];
            if js_to_string(get(v_login, "TeamID").unwrap_or(&undefined_text())) != v_team {
                continue;
            }
            let mut v = json!({});
            set_field_opt(&mut v, "LoginID", get(v_login, "LoginID").cloned());
            v["LoginName"] = get(v_login, "LoginName").filter(|n| js_truthy(Some(n))).cloned().unwrap_or(json!(k));
            set_field_opt(&mut v, "Permissions", get(v_login, "Permissions").cloned());
            v["IsAdmin"] = json!(matches!(get(v_login, "IsAdmin"), Some(Value::Bool(true))));
            v["Enabled"] = json!(!matches!(get(v_login, "Enabled"), Some(Value::Bool(false))));
            set_field_opt(&mut v, "CreatedAt", get(v_login, "CreatedAt").cloned());
            v_out.push(v);
        }
        let name = |v: &Value| match get(v, "LoginName") {
            Some(n) if js_truthy(Some(n)) => js_to_string(n),
            _ => String::new(),
        };
        v_out.sort_by(|a, b| locale_compare(&name(a), &name(b)));
        Ok(v_out)
    }

    /// fn_add_team_login (the access code is generated when empty).
    pub fn add_team_login(
        &mut self,
        p_team_id: &Value,
        p_name: &Value,
        p_code: Option<&Value>,
        p_permissions: &Value,
        p_is_admin: bool,
    ) -> Js<Value> {
        if !js_truthy(Some(p_name)) || js_strict_eq(Some(p_name), Some(&json!(INFO_FIELD))) {
            return Ok(reply_err("Invalid login name.", ERROR_INVALID_DATA));
        }
        let v_name = js_key(Some(p_name));
        if self.login(&v_name)?.is_some() {
            return Ok(reply_err("Duplicate login name.", ERROR_DATA_DATABASE_ERROR));
        }
        let v_code = match p_code {
            Some(c) if js_truthy(Some(c)) && !blank(c)? => c.clone(),
            _ => json!(crate::accounts::generate_access_code()),
        };
        let v_stored = stored_code(&v_code);
        let v_login_id = self.next_login_id()?;
        let mut v_login =
            json!({ "LoginID": v_login_id, "TeamID": p_team_id, "LoginName": v_name, "AccessCode": v_stored });
        set_field_opt(&mut v_login, "Permissions", crate::perm::to_int(Some(p_permissions)));
        v_login["IsAdmin"] = json!(p_is_admin);
        v_login["Enabled"] = json!(true);
        self.m_data["logins"][v_name.as_str()] = v_login;
        if let Some(r) = self.written("write team login", "Storage error.") {
            return Ok(r);
        }
        Ok(json!({ ERROR: ERROR_NON, ACCESS_CODE_PARAMETER: v_code, LOGIN_ID_PARAMETER: v_login_id }))
    }

    /// fn_update_team_login (the access code changes only when given).
    pub fn update_team_login(
        &mut self,
        p_team_id: &Value,
        p_name: &Value,
        p_code: Option<&Value>,
        p_permissions: &Value,
        p_is_admin: bool,
    ) -> Js<Value> {
        let v_name = js_key(Some(p_name));
        let v_ok = match self.login(&v_name)? {
            Some(e) => js_strict_eq(get(e, "TeamID"), Some(p_team_id)),
            None => false,
        };
        if !v_ok {
            return Ok(reply_err("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND));
        }
        let mut v_returned = None;
        if let Some(c) = p_code.filter(|c| js_truthy(Some(c))) {
            if !blank(c)? {
                let v_plain = js_trim(&js_to_string(c)).to_string();
                let v_stored = stored_code(&json!(v_plain));
                self.m_data["logins"][v_name.as_str()]["AccessCode"] = v_stored;
                v_returned = Some(v_plain);
            }
        }
        let v_existing = &mut self.m_data["logins"][v_name.as_str()];
        if let Some(p) = crate::perm::to_int(Some(p_permissions)) {
            v_existing["Permissions"] = p;
        } else {
            v_existing["Permissions"] = undefined();
        }
        v_existing["IsAdmin"] = json!(p_is_admin);
        if let Some(r) = self.written("update team login", "Storage error.") {
            return Ok(r);
        }
        let mut v_reply = json!({ ERROR: ERROR_NON });
        if let Some(c) = v_returned.filter(|c| !c.is_empty()) {
            v_reply[ACCESS_CODE_PARAMETER] = json!(c);
        }
        Ok(v_reply)
    }

    /// fn_delete_team_login
    pub fn delete_team_login(&mut self, p_team_id: &Value, p_name: &Value) -> Js<Value> {
        let v_name = js_key(Some(p_name));
        let v_ok = match self.login(&v_name)? {
            Some(e) => js_strict_eq(get(e, "TeamID"), Some(p_team_id)),
            None => false,
        };
        if !v_ok {
            return Ok(reply_err("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND));
        }
        if let Some(Value::Object(m)) = self.m_data.get_mut("logins") {
            m.shift_remove(&v_name);
        }
        if let Some(r) = self.written("delete team login", "Storage error.") {
            return Ok(r);
        }
        Ok(json!({ ERROR: ERROR_NON }))
    }

    /// fn_count_team_admins
    pub fn count_team_admins(&self, p_team_id: &Value) -> Js<usize> {
        let v_logins = self.logins()?;
        Ok(v_logins
            .values()
            .filter(|l| {
                js_strict_eq(get(l, "TeamID"), Some(p_team_id)) && matches!(get(l, "IsAdmin"), Some(Value::Bool(true)))
            })
            .count())
    }
}

/// String(undefined)
fn undefined_text() -> Value {
    json!("undefined")
}

/// `!code || code.trim() === ''` for a truthy value (Err: no trim()).
fn blank(p_code: &Value) -> Js<bool> {
    match p_code {
        Value::String(s) => Ok(js_trim(s).is_empty()),
        _ => Err("finalAccessCode.trim is not a function".into()),
    }
}

/// hlp_password.verify(plain, stored): false for a missing value.
pub fn verify(p_plain: Option<&str>, p_stored: Option<&Value>) -> bool {
    match (p_plain, p_stored) {
        (Some(p), Some(Value::String(s))) => password::verify(p, s),
        _ => false,
    }
}

/// A Node.js fs error message (`ENOENT: no such file or directory, open '<path>'`).
pub fn node_fs_error(p_syscall: &str, p_path: &Path, p_err: &std::io::Error) -> String {
    let v_code = match p_err.kind() {
        std::io::ErrorKind::NotFound => "ENOENT: no such file or directory",
        std::io::ErrorKind::PermissionDenied => "EACCES: permission denied",
        _ => return format!("{}: {}, {} '{}'", "Error", p_err, p_syscall, p_path.display()),
    };
    format!("Error: {}, {} '{}'", v_code, p_syscall, p_path.display())
}

/// SyntaxError message for an unparsable JSON file (approximately V8's).
fn json_error_message(p_text: &str, p_err: &serde_json::Error) -> String {
    if p_text.trim().is_empty() {
        return "Unexpected end of JSON input".into();
    }
    format!("{}", p_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_teams_and_js_key_order() {
        let v_dir = tempfile::tempdir().unwrap();
        let v_file = v_dir.path().join("db.json");
        let mut db = FileDb::open(&v_file);
        let r = db
            .add_record(&json!("b@x.io"), &json!({"sid": "123456789012", "AccessCode": "abc", "prm": "0x1"}))
            .unwrap();
        assert_eq!(r, json!({"e": 0, "aid": "123456789012", "lid": 1}));
        assert_eq!(db.data()["db_info"]["TeamID"], json!("123456789012"), "abstract > against 0");
        db.add_record(&json!("7"), &json!({"sid": 5, "AccessCode": "abc", "prm": "0xffffffff", "isadmin": true}))
            .unwrap();
        let r = db.add_record(&json!("7"), &json!({"sid": 5, "AccessCode": "x", "prm": "0x1"})).unwrap();
        assert_eq!(r, json!({"em": "Duplicate entry.", "e": 3}));
        let v_text = std::fs::read_to_string(&v_file).unwrap();
        assert!(v_text.find("\"5\": {").unwrap() < v_text.find("\"123456789012\": {").unwrap(), "integer keys first");
        assert!(v_text.contains("\"7\": {") && v_text.find("\"7\"").unwrap() < v_text.find("\"b@x.io\"").unwrap());
        assert!(!v_dir.path().join(".db.json.tmp").exists());

        let v_rec = db.get_record(&json!("7")).unwrap().unwrap();
        assert_eq!(v_rec["prm"], json!(4294967295u32));
        assert!(password::verify("abc", v_rec["AccessCode"].as_str().unwrap()));
        assert_eq!(db.user_by_access_code(Some(&json!("abc"))).unwrap().unwrap()["acc"], json!("7"));
        assert_eq!(db.count_team_admins(&json!(5)).unwrap(), 1);
        assert_eq!(db.count_team_admins(&json!("5")).unwrap(), 0, "strict equality");

        let r = db.add_team_login(&json!(5), &json!("a@x.io"), None, &json!("0x10"), false).unwrap();
        assert_eq!(r["e"], json!(0));
        assert_eq!(r["pwd"].as_str().unwrap().len(), 12);
        let v_names: Vec<Value> = db.team_logins(&json!(5)).unwrap().iter().map(|l| l["LoginName"].clone()).collect();
        assert_eq!(v_names, vec![json!("7"), json!("a@x.io")]);
        let r = db.update_team_login(&json!(5), &json!("a@x.io"), Some(&json!(" new1 ")), &json!("0x1"), true).unwrap();
        assert_eq!(r, json!({"e": 0, "pwd": "new1"}));
        assert_eq!(db.delete_team_login(&json!("5"), &json!("a@x.io")).unwrap()["e"], json!(2));

        let db2 = FileDb::open(&v_file);
        assert_eq!(db2.data(), db.data());
    }

    #[test]
    fn migrates_the_flat_format() {
        let v_dir = tempfile::tempdir().unwrap();
        let v_file = v_dir.path().join("old.json");
        std::fs::write(
            &v_file,
            r#"{"db_info": {}, "users": {"z@x.io": {"sid": 2, "pwd": "p", "prm": "D1G1T3R4V5C6"}, "a@x.io": {"AccessCode": "q"}}}"#,
        )
        .unwrap();
        let db = FileDb::open(&v_file);
        assert_eq!(db.data()["db_info"], json!({"TeamID": 2, "LoginID": 2}));
        assert_eq!(db.data()["teams"]["2"]["TeamName"], json!("z@x.io"));
        assert_eq!(db.data()["teams"]["1"]["TeamName"], json!("a@x.io"));
        assert_eq!(db.data()["logins"]["z@x.io"]["Permissions"], json!(4294967295u32));
        assert_eq!(db.data()["logins"]["a@x.io"]["IsAdmin"], json!(false));
        assert!(db.data().get("users").is_none());
    }
}
