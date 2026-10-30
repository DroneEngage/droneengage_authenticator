//! Account storage operations: js_database_manager.js (SQLite, `db` mode)
//! and js_account_manager.js (create/regenerate/lookup over `file` or
//! `db`, hardware verification, team administration).
//!
//! Replies are the JavaScript reply objects. An operation's result is
//! `Js<Option<Value>>`: Err for an exception thrown synchronously (the
//! router's catch answers), Ok(None) where the JavaScript never calls back
//! (the request is left waiting), Ok(Some(reply)) otherwise.

use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

use crate::config::Cfg;
use crate::constants::*;
use crate::filedb::{verify, FileDb};
use crate::sqldb::SqlDb;
use crate::validator::{js_trim, valid_account_name, Js};
use droneengage_server_common::colors as c;
use droneengage_server_common::password;
use droneengage_server_common::util::{js_key, js_nullish, js_strict_eq, js_to_string, js_truthy};
use droneengage_server_common::validation::{is_alphanumeric, protected_from_injection};

/// `uuidv4().replaceAll('-', '').substr(0, 12)`
pub fn generate_access_code() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// fn_generateRecoveryCode: 16 hex characters.
pub fn generate_recovery_code() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..16].to_string()
}

fn reply(p_msg: &str, p_code: i64) -> Value {
    json!({ ERROR_MSG: p_msg, ERROR: p_code })
}

fn db_error() -> Value {
    json!({ ERROR: ERROR_DATA_DATABASE_ERROR, ERROR_MSG: "Database Error" })
}

/// `hlp_string.fn_protectedFromInjection(name)` as a bind value.
fn protect(p_name: &Value) -> Value {
    match p_name {
        Value::String(s) => json!(protected_from_injection(s)),
        other => other.clone(),
    }
}

/// `(x == null) || (!fn_isValidAccountName(x))`
fn bad_name(p_name: Option<&Value>) -> Js<bool> {
    Ok(js_nullish(p_name) || !valid_account_name(p_name)?)
}

/// `(x == null) || (!fn_isAlphanumeric(x))`
fn bad_code(p_code: Option<&Value>) -> Js<bool> {
    Ok(js_nullish(p_code) || !is_alphanumeric(p_code)?)
}

fn verify_value(p_plain: Option<&Value>, p_stored: Option<&Value>) -> bool {
    verify(p_plain.map(js_to_string).as_deref(), p_stored)
}

fn is_one_or_true(p_value: Option<&Value>) -> bool {
    matches!(p_value, Some(Value::Bool(true))) || p_value.and_then(Value::as_f64) == Some(1.0)
}

/// console.log(rows) for the hardware query (Node's inspect, roughly).
fn inspect_rows(p_rows: &[Value]) -> String {
    let v_items: Vec<String> = p_rows
        .iter()
        .map(|r| {
            let v_fields: Vec<String> = r
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| match v {
                            Value::String(s) => format!("{}: '{}'", k, s),
                            other => format!("{}: {}", k, other),
                        })
                        .collect()
                })
                .unwrap_or_default();
            format!("  {{\n    {}\n  }}", v_fields.join(",\n    "))
        })
        .collect();
    format!("[\n{}\n]", v_items.join(",\n"))
}

pub enum Kind {
    Single,
    File,
    Db,
    Other,
}

/// The account store and the account/database managers over it.
pub struct Accounts {
    pub cfg: Cfg,
    /// global.db_users (file mode with file_db)
    pub file: Option<Mutex<FileDb>>,
    /// global.m_db (db mode)
    pub db: Option<Arc<SqlDb>>,
}

impl Accounts {
    pub fn kind(&self) -> Kind {
        match self.cfg.storage_type().as_str() {
            "single" => Kind::Single,
            "file" => Kind::File,
            "db" => Kind::Db,
            _ => Kind::Other,
        }
    }

    /// global.db_users, or the TypeError of calling a method on undefined.
    pub fn fdb(&self, p_method: &str) -> Js<std::sync::MutexGuard<'_, FileDb>> {
        match &self.file {
            Some(f) => Ok(f.lock().unwrap_or_else(|e| e.into_inner())),
            None => Err(format!("Cannot read properties of undefined (reading '{}')", p_method)),
        }
    }

    fn sql(&self) -> &SqlDb {
        static EMPTY: std::sync::OnceLock<SqlDb> = std::sync::OnceLock::new();
        // m_db is undefined outside db mode; those paths are not reachable
        self.db.as_deref().unwrap_or_else(|| EMPTY.get_or_init(SqlDb::memory))
    }

    // ── js_database_manager.js ────────────────────────────────────────────

    /// fn_do_loginAccount
    pub fn db_login(&self, p_account: Option<&Value>, p_code: Option<&Value>) -> Js<Value> {
        if bad_name(p_account)? || bad_code(p_code)? {
            return Ok(db_error());
        }
        let v_sql = "SELECT logins.LoginID, logins.AccessCode, logins.IsAdmin, logins.Enabled AS LoginEnabled, teams.TeamID, teams.Enabled, teams.InstanceLimit, logins.Permissions FROM logins JOIN teams ON teams.TeamID = logins.TeamID WHERE logins.LoginName = ?";
        let v_rows = match self.sql().all(v_sql, &[protect(p_account.unwrap())]) {
            Ok(r) => r,
            Err(_) => return Ok(reply("Server is Down.", ERROR_DATA_DATABASE_ERROR)),
        };
        if v_rows.is_empty() {
            return Ok(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        }
        let Some(v_row) = v_rows.iter().find(|r| verify_value(p_code, r.get("AccessCode"))) else {
            return Ok(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        };
        if let Some(Value::String(v_stored)) = v_row.get("AccessCode") {
            if !password::is_hashed(v_stored) {
                if let Some(v_hash) = password::hash(&js_to_string(p_code.unwrap())) {
                    let v_up = "UPDATE `logins` SET `AccessCode` = ? WHERE `LoginID` = ?";
                    if let Err(e) = self.sql().run(v_up, &[json!(v_hash), v_row["LoginID"].clone()]) {
                        eprintln!("[login] lazy hash upgrade failed: {}", e.inspect());
                    }
                }
            }
        }
        let mut v_prm = v_row.get("Permissions").cloned().unwrap_or(Value::Null);
        if v_prm == json!("D1G1T3R4V5C6") {
            v_prm = json!("0xffffffff");
        }
        let mut v_data = json!({ "m_sid": v_row["TeamID"], "m_permission": "D1G1T3R4V5C6" });
        droneengage_server_common::util::set_field_opt(&mut v_data, "m_prm", crate::perm::to_int(Some(&v_prm)));
        v_data["m_enabled"] = v_row["Enabled"].clone();
        v_data["m_instance_limit"] = v_row["InstanceLimit"].clone();
        let mut v_reply = json!({ "m_data": v_data, "m_isadmin": is_one_or_true(v_row.get("IsAdmin")) });
        let v_disabled =
            |v: &Value| v.as_f64() == Some(0.0) || v == &json!(false) || v == &json!("0") || v == &json!("");
        if v_disabled(&v_row["Enabled"]) || v_disabled(&v_row["LoginEnabled"]) {
            v_reply[ERROR] = json!(ERROR_ACCOUNT_DISABLED);
            v_reply[ERROR_MSG] = json!("Account is Disabled.");
        } else {
            v_reply[ERROR] = json!(ERROR_NON);
        }
        Ok(v_reply)
    }

    /// fn_do_getAccountNameByAccessCode
    fn db_account_name_by_code(&self, p_code: Option<&Value>) -> Js<Value> {
        if bad_code(p_code)? {
            return Ok(db_error());
        }
        let v_rows = match self
            .sql()
            .all("SELECT logins.AccessCode, teams.TeamName FROM logins JOIN teams ON teams.TeamID = logins.TeamID", &[])
        {
            Ok(r) => r,
            Err(_) => return Ok(reply("Server is Down.", ERROR_DATA_DATABASE_ERROR)),
        };
        match v_rows.iter().find(|r| verify_value(p_code, r.get("AccessCode"))) {
            Some(r) if !r["TeamName"].is_null() => {
                Ok(json!({ "m_data": { "m_accountName": r["TeamName"] }, ERROR: ERROR_NON }))
            }
            _ => Ok(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND)),
        }
    }

    /// fn_createSubLogin: a login on the account's team (a failed query
    /// replies with the raw error object).
    fn db_create_sub_login(
        &self,
        p_account: &Value,
        p_code: &str,
        p_permission: &Value,
        p_is_admin: bool,
    ) -> Js<Value> {
        if bad_name(Some(p_account))? {
            return Ok(json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: "Bad LoginName" }));
        }
        if bad_code(Some(&json!(p_code)))? {
            return Ok(json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: "Bad AccessCode" }));
        }
        let v_rows = match self.sql().all("SELECT `TeamID` FROM `teams` WHERE `TeamName` = ?", &[protect(p_account)]) {
            Ok(r) => r,
            Err(e) => return Ok(e.to_value()),
        };
        let Some(v_team) = v_rows.first().map(|r| r["TeamID"].clone()) else {
            return Ok(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND));
        };
        let v_hash = password::hash(p_code).unwrap_or_default();
        let v_sql = "INSERT INTO `logins`(`TeamID`, `LoginName`, `AccessCode`, `Permissions`, `IsAdmin`) VALUES (?, ?, ?, ?, ?)";
        let v_prm = crate::perm::to_int(Some(p_permission)).unwrap_or(Value::Null);
        match self
            .sql()
            .run(v_sql, &[v_team.clone(), protect(p_account), json!(v_hash), v_prm, json!(p_is_admin as i32)])
        {
            Ok(r) if r.changes == 0 => Ok(reply("Database Error.", ERROR_DATA_DATABASE_ERROR)),
            Ok(r) => Ok(json!({ ERROR: ERROR_NON, ACCOUNT_ID_PARAMETER: v_team, LOGIN_ID_PARAMETER: r.last_id })),
            Err(e) => Ok(e.to_value()),
        }
    }

    /// fn_createNewAccessCode: the team row of a new account.
    fn db_create_team(&self, p_account: &Value, p_code: &str, p_has_card: bool, p_is_admin: bool) -> Js<Value> {
        if bad_name(Some(p_account))? {
            return Ok(json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: "Bad LoginName" }));
        }
        if bad_code(Some(&json!(p_code)))? {
            return Ok(json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: "Bad AccessCode" }));
        }
        if p_has_card && self.cfg.has("file_db") {
            // writes to global.db_users (undefined in db mode); the reply is
            // the still-empty object
            let mut v_db = self.fdb("fn_add_record")?;
            let _ = v_db.add_record(&json!(p_code), &json!({ "acc": p_account, "isadmin": p_is_admin, "sid": 1 }));
            return Ok(json!({}));
        }
        match self.sql().run("INSERT INTO `teams` (`TeamID`, `TeamName`)  VALUES (NULL, ?)", &[protect(p_account)]) {
            Ok(r) => Ok(json!({ ERROR: ERROR_NON, ACCOUNT_ID_PARAMETER: r.last_id })),
            Err(e) if e.code == "SQLITE_CONSTRAINT" => Ok(reply("Duplicate entry.", ERROR_DATA_DATABASE_ERROR)),
            Err(_) => Ok(reply("Database Error.", ERROR_DATA_DATABASE_ERROR)),
        }
    }

    /// fn_deleteSubLogins: every non-admin login of the team plus the
    /// account's own login.
    fn db_delete_sub_logins(&self, p_account: &Value) -> Js<Value> {
        if bad_name(Some(p_account))? {
            return Ok(json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: "Bad LoginName" }));
        }
        let v_sql = "DELETE FROM `logins` WHERE `TeamID` in ( select `TeamID` FROM `teams` WHERE `TeamName` LIKE ?) and (`LoginName` = ? or COALESCE(`IsAdmin`,0) <> 1)";
        match self.sql().run(v_sql, &[protect(p_account), protect(p_account)]) {
            Ok(_) => Ok(json!({ ERROR: ERROR_NON })),
            Err(e) if e.code == "SQLITE_CONSTRAINT" => Ok(reply("Duplicate entry.", ERROR_DATA_DATABASE_ERROR)),
            Err(_) => Ok(reply("Database Error.", ERROR_DATA_DATABASE_ERROR)),
        }
    }

    /// fn_do_getHardwareVerifyByAccountSID
    fn db_hardware(&self, p_sid: Option<&Value>) -> Value {
        if js_nullish(p_sid) {
            return db_error();
        }
        let v_sql = "select team_hardware.HardwareSID, team_hardware.HardwareID, team_hardware.HardwareType, team_hardware.RegisteredAt from team_hardware  WHERE team_hardware.TeamID=? ";
        let v_rows = match self.sql().all(v_sql, &[p_sid.unwrap().clone()]) {
            Ok(r) => r,
            Err(_) => return reply("Server is Down.", ERROR_DATA_DATABASE_ERROR),
        };
        if v_rows.is_empty() {
            return reply("No hardware is found.", ERROR_HARDWARE_NOT_FOUND);
        }
        println!("{}", inspect_rows(&v_rows));
        let mut v_hw = serde_json::Map::new();
        for r in &v_rows {
            v_hw.insert(
                js_key(Some(&r["HardwareID"])),
                json!({ "m_hwType": r["HardwareType"], "m_registerTime": r["RegisteredAt"] }),
            );
        }
        json!({ "m_data": { "m_hwID": v_hw }, ERROR: ERROR_NON })
    }

    fn db_query_reply(&self, p_sql: &str, p_params: &[Value], p_ok: impl FnOnce(Vec<Value>) -> Value) -> Value {
        match self.sql().all(p_sql, p_params) {
            Ok(r) => p_ok(r),
            Err(_) => reply("Database error.", ERROR_DATA_DATABASE_ERROR),
        }
    }

    /// fn_getTeamInfo
    fn db_team_info(&self, p_team: &Value) -> Value {
        self.db_query_reply(
            "SELECT TeamID, TeamName, Email, InstanceLimit, Enabled, CreatedAt FROM teams WHERE TeamID = ?",
            std::slice::from_ref(p_team),
            |r| match r.into_iter().next() {
                None => reply("Team not found.", ERROR_ACCOUNT_NOT_FOUND),
                Some(v) => json!({ ERROR: ERROR_NON, "m_data": v }),
            },
        )
    }

    /// fn_getTeamLogins (no access codes)
    fn db_team_logins(&self, p_team: &Value) -> Value {
        self.db_query_reply(
            "SELECT LoginID, LoginName, Permissions, IsAdmin, CreatedAt FROM logins WHERE TeamID = ? ORDER BY LoginName",
            std::slice::from_ref(p_team),
            |r| {
                let v_list: Vec<Value> = r
                    .into_iter()
                    .map(|l| {
                        let mut v = json!({ "LoginID": l["LoginID"], "LoginName": l["LoginName"] });
                        droneengage_server_common::util::set_field_opt(
                            &mut v,
                            "Permissions",
                            crate::perm::to_int(l.get("Permissions")),
                        );
                        v["IsAdmin"] = json!(is_one_or_true(l.get("IsAdmin")));
                        v["CreatedAt"] = l["CreatedAt"].clone();
                        v
                    })
                    .collect();
                json!({ ERROR: ERROR_NON, "m_data": v_list })
            },
        )
    }

    /// fn_verifyTeamLoginPassword
    fn db_verify_team_login(&self, p_team: &Value, p_name: &Value, p_code: &Value) -> Value {
        self.db_query_reply(
            "SELECT AccessCode FROM logins WHERE TeamID = ? AND LoginName = ?",
            &[p_team.clone(), p_name.clone()],
            |r| match r.first() {
                Some(row) if verify_value(Some(p_code), row.get("AccessCode")) => json!({ ERROR: ERROR_NON }),
                _ => reply("Access code does not match this login.", ERROR_ACCOUNT_NOT_FOUND),
            },
        )
    }

    /// fn_addTeamLogin (a duplicate is a plain "Database error.")
    fn db_add_team_login(
        &self,
        p_team: &Value,
        p_name: &Value,
        p_code: Option<&Value>,
        p_prm: &Value,
        p_admin: &Value,
    ) -> Js<Value> {
        let v_code = match p_code {
            Some(c) if js_truthy(Some(c)) && !blank(c)? => c.clone(),
            _ => json!(generate_access_code()),
        };
        let v_hash = password::hash(&js_to_string(&v_code)).unwrap_or_default();
        let v_admin = js_truthy(Some(p_admin)) as i32;
        let v_prm = crate::perm::to_int(Some(p_prm)).unwrap_or(Value::Null);
        match self.sql().run(
            "INSERT INTO logins (TeamID, LoginName, AccessCode, Permissions, IsAdmin) VALUES (?, ?, ?, ?, ?)",
            &[p_team.clone(), p_name.clone(), json!(v_hash), v_prm, json!(v_admin)],
        ) {
            Ok(r) => Ok(json!({ ERROR: ERROR_NON, ACCESS_CODE_PARAMETER: v_code, LOGIN_ID_PARAMETER: r.last_id })),
            Err(_) => Ok(reply("Database error.", ERROR_DATA_DATABASE_ERROR)),
        }
    }

    /// fn_updateTeamLogin
    fn db_update_team_login(
        &self,
        p_team: &Value,
        p_name: &Value,
        p_code: Option<&Value>,
        p_prm: &Value,
        p_admin: &Value,
    ) -> Js<Value> {
        let v_admin = json!(js_truthy(Some(p_admin)) as i32);
        let v_prm = crate::perm::to_int(Some(p_prm)).unwrap_or(Value::Null);
        let v_code = match p_code {
            Some(c) if js_truthy(Some(c)) && !blank(c)? => Some(js_trim(&js_to_string(c)).to_string()),
            _ => None,
        };
        let v_result = match &v_code {
            Some(code) => self.sql().run(
                "UPDATE logins SET AccessCode = ?, Permissions = ?, IsAdmin = ? WHERE TeamID = ? AND LoginName = ?",
                &[json!(password::hash(code).unwrap_or_default()), v_prm, v_admin, p_team.clone(), p_name.clone()],
            ),
            None => self.sql().run(
                "UPDATE logins SET Permissions = ?, IsAdmin = ? WHERE TeamID = ? AND LoginName = ?",
                &[v_prm, v_admin, p_team.clone(), p_name.clone()],
            ),
        };
        Ok(match v_result {
            Ok(r) if r.changes == 0 => reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND),
            Ok(_) => {
                let mut v = json!({ ERROR: ERROR_NON });
                if let Some(code) = v_code {
                    v[ACCESS_CODE_PARAMETER] = json!(code);
                }
                v
            }
            Err(_) => reply("Database error.", ERROR_DATA_DATABASE_ERROR),
        })
    }

    /// fn_deleteTeamLogin
    fn db_delete_team_login(&self, p_team: &Value, p_name: &Value) -> Value {
        match self.sql().run("DELETE FROM logins WHERE TeamID = ? AND LoginName = ?", &[p_team.clone(), p_name.clone()])
        {
            Ok(r) if r.changes == 0 => reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND),
            Ok(_) => json!({ ERROR: ERROR_NON }),
            Err(_) => reply("Database error.", ERROR_DATA_DATABASE_ERROR),
        }
    }

    /// fn_countTeamAdmins: Ok(count) or the error reply.
    fn db_count_team_admins(&self, p_team: &Value) -> Result<Value, Value> {
        match self
            .sql()
            .all("SELECT COUNT(*) as cnt FROM logins WHERE TeamID = ? AND IsAdmin = 1", std::slice::from_ref(p_team))
        {
            Ok(r) => Ok(r.first().map(|r| r["cnt"].clone()).unwrap_or(json!(0))),
            Err(_) => Err(reply("Database error.", ERROR_DATA_DATABASE_ERROR)),
        }
    }

    /// fn_getAccountPermission: Ok(permission) or the error reply.
    pub fn db_account_permission(&self, p_account: &Value) -> Js<Result<Value, Value>> {
        if bad_name(Some(p_account))? {
            return Ok(Err(reply("Bad LoginName", ERROR_INVALID_DATA)));
        }
        Ok(match self.sql().all("SELECT Permissions FROM logins WHERE LoginName = ? LIMIT 1", &[protect(p_account)]) {
            Ok(r) => match r.first() {
                None => Err(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND)),
                Some(row) => {
                    let mut v_perm = row["Permissions"].clone();
                    if v_perm.is_null() || v_perm == json!("D1G1T3R4V5C6") {
                        v_perm = json!("0xffffffff");
                    }
                    Ok(crate::perm::to_int(Some(&v_perm)).unwrap_or(Value::Null))
                }
            },
            Err(_) => Err(reply("Database error.", ERROR_DATA_DATABASE_ERROR)),
        })
    }

    /// fn_getIsAdmin
    fn db_is_admin(&self, p_account: &Value) -> Js<bool> {
        if bad_name(Some(p_account))? {
            return Ok(false);
        }
        Ok(match self.sql().all("SELECT IsAdmin FROM logins WHERE LoginName = ? LIMIT 1", &[protect(p_account)]) {
            Ok(r) => r.first().map(|row| is_one_or_true(row.get("IsAdmin"))).unwrap_or(false),
            Err(_) => false,
        })
    }

    /// fn_setRecoveryCode
    fn db_set_recovery_code(&self, p_account: &Value, p_hash: &str) -> Value {
        match self
            .sql()
            .run("UPDATE `teams` SET `RecoveryCode` = ? WHERE `TeamName` = ?", &[json!(p_hash), protect(p_account)])
        {
            Ok(r) if r.changes == 0 => reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND),
            Ok(_) => json!({ ERROR: ERROR_NON }),
            Err(_) => reply("Database error.", ERROR_DATA_DATABASE_ERROR),
        }
    }

    /// fn_getRecoveryCode: the stored hash, or None.
    pub fn db_recovery_code(&self, p_account: &Value) -> Option<Value> {
        match self.sql().all("SELECT `RecoveryCode` FROM `teams` WHERE `TeamName` = ? LIMIT 1", &[protect(p_account)]) {
            Ok(r) => r.first().map(|row| row["RecoveryCode"].clone()).filter(|v| js_truthy(Some(v))),
            Err(_) => None,
        }
    }

    // ── js_account_manager.js ─────────────────────────────────────────────

    /// fn_issueRecoveryCode: stores the hash, adds `rc` to the reply.
    fn issue_recovery_code(&self, p_account: &Value, mut p_reply: Value) -> Js<Value> {
        let v_code = generate_recovery_code();
        let v_hash = password::hash(&v_code).unwrap_or_default();
        let v_stored = match self.kind() {
            Kind::File => self.fdb("fn_set_recovery_code")?.set_recovery_code(p_account, &v_hash)?,
            _ => self.db_set_recovery_code(p_account, &v_hash),
        };
        if !js_strict_eq(v_stored.get(ERROR), Some(&json!(ERROR_NON))) {
            return Ok(v_stored);
        }
        p_reply[RECOVERY_CODE_PARAMETER] = json!(v_code);
        Ok(p_reply)
    }

    fn with_code_and_recovery(&self, p_account: &Value, mut p_reply: Value, p_code: &str) -> Js<Value> {
        if js_strict_eq(p_reply.get(ERROR), Some(&json!(ERROR_NON))) {
            p_reply[ACCESS_CODE_PARAMETER] = json!(p_code);
            return self.issue_recovery_code(p_account, p_reply);
        }
        Ok(p_reply)
    }

    /// fn_createAccessCode
    pub fn create_access_code(
        &self,
        p_account: &Value,
        p_permission: &Value,
        p_has_card: bool,
        p_is_admin: bool,
    ) -> Js<Option<Value>> {
        let v_code = generate_access_code();
        match self.kind() {
            Kind::File => {
                let v_data = json!({ "sid": generate_access_code(), "AccessCode": v_code, "prm": p_permission, "isadmin": p_is_admin });
                let v_reply = self.fdb("fn_add_record")?.add_record(p_account, &v_data)?;
                Ok(Some(self.with_code_and_recovery(p_account, v_reply, &v_code)?))
            }
            Kind::Db => {
                let v_reply = self.db_create_team(p_account, &v_code, p_has_card, p_is_admin)?;
                if !js_strict_eq(v_reply.get(ERROR), Some(&json!(ERROR_NON))) {
                    return Ok(Some(v_reply));
                }
                let v_reply = self.db_create_sub_login(p_account, &v_code, p_permission, p_is_admin)?;
                Ok(Some(self.with_code_and_recovery(p_account, v_reply, &v_code)?))
            }
            _ => Ok(None),
        }
    }

    /// fn_regenerateAccessCode (the existing permission and IsAdmin are kept)
    pub fn regenerate_access_code(&self, p_account: &Value, p_permission: Option<&Value>) -> Js<Option<Value>> {
        let v_code = generate_access_code();
        if js_nullish(p_permission) {
            return Ok(Some(json!({
                ERROR_MSG: "Cannot determine existing permission — regenerate refused.",
                ERROR: ERROR_DATA_DATABASE_ERROR
            })));
        }
        match self.kind() {
            Kind::File => {
                let v_reply = {
                    let mut v_db = self.fdb("fn_get_record")?;
                    let v_existing = v_db.get_record(p_account)?;
                    let v_admin = v_existing.as_ref().map(|e| e["isadmin"] == json!(true)).unwrap_or(false);
                    let v_sid = match &v_existing {
                        Some(e) => e.get("sid").cloned().unwrap_or(Value::Null),
                        None => json!(generate_access_code()),
                    };
                    let v_data = json!({ "sid": v_sid, "AccessCode": v_code, "prm": p_permission, "isadmin": v_admin });
                    v_db.update_record(p_account, &v_data)?
                };
                Ok(Some(self.with_code_and_recovery(p_account, v_reply, &v_code)?))
            }
            Kind::Db => {
                let v_admin = self.db_is_admin(p_account)?;
                let v_reply = self.db_delete_sub_logins(p_account)?;
                if !js_strict_eq(v_reply.get(ERROR), Some(&json!(ERROR_NON))) {
                    return Ok(Some(v_reply));
                }
                let v_reply = self.db_create_sub_login(p_account, &v_code, p_permission.unwrap(), v_admin)?;
                Ok(Some(self.with_code_and_recovery(p_account, v_reply, &v_code)?))
            }
            _ => Ok(None),
        }
    }

    /// fn_getAccountNameByAccessCode
    pub fn account_name_by_code(&self, p_code: Option<&Value>) -> Js<Option<Value>> {
        match self.kind() {
            Kind::Single => {
                if !(self.cfg.has("single_account_user_name") && self.cfg.has("single_account_access_code")) {
                    return Ok(None);
                }
                if !verify_value(p_code, self.cfg.get("single_account_access_code")) {
                    return Ok(Some(reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND)));
                }
                let v_name = self.cfg.get("single_account_user_name").cloned().unwrap_or(Value::Null);
                return Ok(Some(json!({ ACCOUNT_NAME_PARAMETER: v_name, ERROR: ERROR_NON })));
            }
            Kind::File if self.cfg.has("file_db") => {
                return Ok(Some(match self.fdb("fn_get_user_by_accesscode")?.user_by_access_code(p_code)? {
                    None => reply("Account Not Found.", ERROR_ACCOUNT_NOT_FOUND),
                    Some(r) => {
                        let mut v = json!({});
                        droneengage_server_common::util::set_field_opt(
                            &mut v,
                            ACCOUNT_NAME_PARAMETER,
                            r.get("acc").cloned(),
                        );
                        v[ERROR] = json!(ERROR_NON);
                        v
                    }
                }));
            }
            Kind::Db => {
                let v_reply = self.db_account_name_by_code(p_code)?;
                if !js_strict_eq(v_reply.get(ERROR), Some(&json!(ERROR_NON))) {
                    return Ok(Some(v_reply));
                }
                return Ok(Some(
                    json!({ ERROR: ERROR_NON, ACCOUNT_NAME_PARAMETER: v_reply["m_data"]["m_accountName"] }),
                ));
            }
            _ => {}
        }
        println!(
            "{}FATAL ERROR:{} account_storage_type or file_db or db connection{} are not specified in config file. ",
            c::B_ERROR,
            c::FG_YELLOW,
            c::RESET
        );
        Ok(None)
    }

    /// fn_do_verifyHardwareByAccountSID
    pub fn verify_hardware(&self, p_sid: Option<&Value>, p_hw_id: &Value, p_hw_type: &Value) -> Value {
        if !self.cfg.is_false("skip_hardware_validation") {
            return json!({ ERROR: ERROR_NON });
        }
        let v_type = self.cfg.storage_type();
        if v_type != "db" {
            // Colors.Warn is undefined in the JavaScript
            println!(
                "undefined[WARN] Hardware validation is enabled but account_storage_type is '{}' — hardware validation requires 'db' mode. Skipping hardware check.{}",
                v_type,
                c::RESET
            );
            return json!({ ERROR: ERROR_NON });
        }
        let v_reply = self.db_hardware(p_sid);
        if !js_strict_eq(v_reply.get(ERROR), Some(&json!(ERROR_NON))) {
            return v_reply;
        }
        let v_hw = v_reply["m_data"]["m_hwID"].as_object().cloned().unwrap_or_default();
        let v_id = js_to_string(p_hw_id);
        for k in crate::jsv::js_keys(&v_hw) {
            if k == v_id
                && js_to_string(&v_hw[&k]["m_hwType"]) == js_to_string(p_hw_type)
                && !v_hw[&k]["m_hwType"].is_null()
            {
                return json!({ ERROR: ERROR_NON });
            }
        }
        json!({ ERROR: ERROR_HARDWARE_NOT_FOUND, ERROR_MSG: "Hardware not authorized" })
    }

    /// fn_teamUserOperation: team administration within the caller's team.
    pub fn team_user_operation(&self, p_sub: &Value, p_card: &Value, p_params: &TeamParams) -> Js<Value> {
        let v_sid = p_card.get("m_data").and_then(|d| d.get("m_sid")).cloned();
        if !js_truthy(p_card.get("m_data")) || js_nullish(v_sid.as_ref()) {
            return Ok(reply("Session not found.", ERROR_SESSION_NOT_FOUND));
        }
        if p_card.get("m_isadmin") != Some(&json!(true)) {
            return Ok(reply("You do not have admin permission.", ERROR_NO_PERMISSION));
        }
        let v_team = v_sid.unwrap();
        let v_type = self.cfg.storage_type();
        if v_type == "single" {
            return Ok(reply("Team administration is not available in single-account mode.", ERROR_NO_PERMISSION));
        }
        let v_unsupported = || reply("Unsupported storage type.", ERROR_DATA_DATABASE_ERROR);
        let v_target = p_params.target.clone().unwrap_or(Value::Null);
        let v_permission = p_params.permission.clone().filter(|p| js_truthy(Some(p))).unwrap_or(json!("0xffffffff"));
        let v_code = p_params.access_code.clone();
        let v_is_admin = p_params.is_admin == Some(json!(true));
        let valid_name = |n: &Value| -> Js<bool> { Ok(!n.is_null() && valid_account_name(Some(n))?) };
        let valid_permission = |p: &Value| match p {
            Value::String(s) => s.len() == 10 && s.starts_with("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit()),
            _ => false,
        };
        let v_file = v_type == "file";
        let v_db = v_type == "db";
        let v_sub = p_sub.as_str().unwrap_or("\u{0}");

        if v_sub == CMD_GET_TEAM_INFO {
            if v_file {
                return Ok(match self.fdb("fn_get_team_info")?.team_info(&v_team)? {
                    None => reply("Team not found.", ERROR_ACCOUNT_NOT_FOUND),
                    Some(i) => json!({ ERROR: ERROR_NON, "m_data": i }),
                });
            }
            return Ok(if v_db { self.db_team_info(&v_team) } else { v_unsupported() });
        }
        if v_sub == CMD_LIST_TEAM_USERS {
            if v_file {
                return Ok(
                    json!({ ERROR: ERROR_NON, "m_data": self.fdb("fn_get_team_logins")?.team_logins(&v_team)? }),
                );
            }
            return Ok(if v_db { self.db_team_logins(&v_team) } else { v_unsupported() });
        }
        if v_sub == CMD_VERIFY_TEAM_USER {
            if !valid_name(&v_target)? {
                return Ok(reply("Invalid target login name.", ERROR_INVALID_DATA));
            }
            let v_code_text = match &v_code {
                Some(Value::String(s)) if !js_trim(s).is_empty() => s.clone(),
                _ => return Ok(reply("Access code is required.", ERROR_INVALID_DATA)),
            };
            if v_file {
                let v_record = self.fdb("fn_get_record")?.get_record(&v_target)?;
                let v_ok = match &v_record {
                    Some(r) => {
                        js_to_string(r.get("sid").unwrap_or(&json!("undefined"))) == js_to_string(&v_team)
                            && verify(Some(&v_code_text), r.get("AccessCode"))
                    }
                    None => false,
                };
                return Ok(if v_ok {
                    json!({ ERROR: ERROR_NON })
                } else {
                    reply("Access code does not match this login.", ERROR_ACCOUNT_NOT_FOUND)
                });
            }
            return Ok(if v_db {
                self.db_verify_team_login(&v_team, &v_target, &json!(v_code_text))
            } else {
                v_unsupported()
            });
        }
        if v_sub == CMD_ADD_TEAM_USER {
            if !valid_name(&v_target)? {
                return Ok(reply("Invalid login name.", ERROR_INVALID_DATA));
            }
            if !valid_permission(&v_permission) {
                return Ok(reply("Invalid permission value.", ERROR_INVALID_DATA));
            }
            if v_file {
                return self.fdb("fn_add_team_login")?.add_team_login(
                    &v_team,
                    &v_target,
                    v_code.as_ref(),
                    &v_permission,
                    v_is_admin,
                );
            }
            return if v_db {
                self.db_add_team_login(&v_team, &v_target, v_code.as_ref(), &v_permission, &json!(v_is_admin))
            } else {
                Ok(v_unsupported())
            };
        }
        if v_sub == CMD_UPDATE_TEAM_USER {
            if !valid_name(&v_target)? {
                return Ok(reply("Invalid target login name.", ERROR_INVALID_DATA));
            }
            if !valid_permission(&v_permission) {
                return Ok(reply("Invalid permission value.", ERROR_INVALID_DATA));
            }
            let v_target_admin = if v_file {
                let v_logins = self.fdb("fn_get_team_logins")?.team_logins(&v_team)?;
                match v_logins.iter().find(|l| js_strict_eq(l.get("LoginName"), Some(&v_target))) {
                    None => return Ok(reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND)),
                    Some(t) => t["IsAdmin"] == json!(true),
                }
            } else if v_db {
                let v_list = self.db_team_logins(&v_team);
                if !js_strict_eq(v_list.get(ERROR), Some(&json!(ERROR_NON))) {
                    return Ok(v_list);
                }
                let v_logins = v_list["m_data"].as_array().cloned().unwrap_or_default();
                match v_logins.iter().find(|l| js_strict_eq(l.get("LoginName"), Some(&v_target))) {
                    None => return Ok(reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND)),
                    Some(t) => t["IsAdmin"] == json!(true),
                }
            } else {
                return Ok(v_unsupported());
            };
            if v_target_admin && !v_is_admin {
                let v_count = if v_file {
                    json!(self.fdb("fn_count_team_admins")?.count_team_admins(&v_team)?)
                } else {
                    match self.db_count_team_admins(&v_team) {
                        Ok(n) => n,
                        Err(r) => return Ok(r),
                    }
                };
                if v_count.as_f64().map(|n| n <= 1.0).unwrap_or(false) {
                    return Ok(reply("Cannot demote the last admin of the team.", ERROR_NO_PERMISSION));
                }
            }
            if v_file {
                return self.fdb("fn_update_team_login")?.update_team_login(
                    &v_team,
                    &v_target,
                    v_code.as_ref(),
                    &v_permission,
                    v_is_admin,
                );
            }
            return self.db_update_team_login(&v_team, &v_target, v_code.as_ref(), &v_permission, &json!(v_is_admin));
        }
        if v_sub == CMD_DELETE_TEAM_USER {
            if !valid_name(&v_target)? {
                return Ok(reply("Invalid target login name.", ERROR_INVALID_DATA));
            }
            if js_strict_eq(Some(&v_target), p_card.get("m_login_name")) {
                return Ok(reply("You cannot delete your own account.", ERROR_NO_PERMISSION));
            }
            let v_target_admin = if v_file {
                let v_logins = self.fdb("fn_get_team_logins")?.team_logins(&v_team)?;
                match v_logins.iter().find(|l| js_strict_eq(l.get("LoginName"), Some(&v_target))) {
                    None => return Ok(reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND)),
                    Some(t) => t["IsAdmin"] == json!(true),
                }
            } else if v_db {
                let v_list = self.db_team_logins(&v_team);
                if !js_strict_eq(v_list.get(ERROR), Some(&json!(ERROR_NON))) {
                    return Ok(v_list);
                }
                let v_logins = v_list["m_data"].as_array().cloned().unwrap_or_default();
                match v_logins.iter().find(|l| js_strict_eq(l.get("LoginName"), Some(&v_target))) {
                    None => return Ok(reply("Login not found in this team.", ERROR_ACCOUNT_NOT_FOUND)),
                    Some(t) => t["IsAdmin"] == json!(true),
                }
            } else {
                return Ok(v_unsupported());
            };
            if v_target_admin {
                let v_count = if v_file {
                    json!(self.fdb("fn_count_team_admins")?.count_team_admins(&v_team)?)
                } else {
                    match self.db_count_team_admins(&v_team) {
                        Ok(n) => n,
                        Err(r) => return Ok(r),
                    }
                };
                if v_count.as_f64().map(|n| n <= 1.0).unwrap_or(false) {
                    return Ok(reply("Cannot delete the last admin of the team.", ERROR_NO_PERMISSION));
                }
            }
            if v_file {
                return self.fdb("fn_delete_team_login")?.delete_team_login(&v_team, &v_target);
            }
            return Ok(self.db_delete_team_login(&v_team, &v_target));
        }
        Ok(reply("Unknown team operation.", ERROR_INVALID_DATA))
    }
}

/// `{ targetLoginName, permission, accessCode, isAdmin }`
#[derive(Default)]
pub struct TeamParams {
    pub target: Option<Value>,
    pub permission: Option<Value>,
    pub access_code: Option<Value>,
    pub is_admin: Option<Value>,
}

/// `!code || code.trim() === ''` for a truthy value (Err: no trim()).
fn blank(p_code: &Value) -> Js<bool> {
    match p_code {
        Value::String(s) => Ok(js_trim(s).is_empty()),
        _ => Err("finalAccessCode.trim is not a function".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accounts_db() -> Accounts {
        let db = SqlDb::memory();
        db.exec(include_str!("../database/migrations/002_init_schema.sql")).unwrap();
        db.exec("ALTER TABLE teams ADD COLUMN RecoveryCode TEXT").unwrap();
        Accounts { cfg: Cfg::from_value(json!({"account_storage_type": "db"})), file: None, db: Some(Arc::new(db)) }
    }

    #[test]
    fn create_login_regenerate_in_db_mode() {
        let a = accounts_db();
        let r = a.create_access_code(&json!("a@x.io"), &json!("0xffffffff"), false, true).unwrap().unwrap();
        assert_eq!(r["e"], json!(0));
        let v_keys: Vec<&String> = r.as_object().unwrap().keys().collect();
        assert_eq!(v_keys, ["e", "aid", "lid", "pwd", "rc"]);
        let v_code = r["pwd"].clone();
        let r2 = a.create_access_code(&json!("a@x.io"), &json!("0xffffffff"), false, true).unwrap().unwrap();
        assert_eq!(r2, json!({"em": "Duplicate entry.", "e": 3}));

        let l = a.db_login(Some(&json!("a@x.io")), Some(&v_code)).unwrap();
        assert_eq!(l["e"], json!(0));
        assert_eq!(l["m_isadmin"], json!(true));
        assert_eq!(l["m_data"]["m_prm"], json!(4294967295u32));
        assert_eq!(a.db_login(Some(&json!("a@x.io")), Some(&json!("wrong"))).unwrap()["e"], json!(2));

        let g = a.account_name_by_code(Some(&v_code)).unwrap().unwrap();
        assert_eq!(g, json!({"e": 0, "acc": "a@x.io"}));

        let r3 = a.regenerate_access_code(&json!("a@x.io"), Some(&json!("0xffffffff"))).unwrap().unwrap();
        assert_eq!(r3["e"], json!(0));
        assert_eq!(a.db_login(Some(&json!("a@x.io")), Some(&v_code)).unwrap()["e"], json!(2), "old code is dead");
        let l = a.db_login(Some(&json!("a@x.io")), Some(&r3["pwd"])).unwrap();
        assert_eq!(l["m_isadmin"], json!(true), "IsAdmin preserved");
    }

    #[test]
    fn team_admin_in_db_mode() {
        let a = accounts_db();
        let r = a.create_access_code(&json!("own@x.io"), &json!("0xffffffff"), false, true).unwrap().unwrap();
        let v_card = json!({"m_data": {"m_sid": r["aid"]}, "m_isadmin": true, "m_login_name": "own@x.io"});
        let p = |t: &str, adm: bool| TeamParams {
            target: Some(json!(t)),
            permission: Some(json!("0x00000011")),
            access_code: None,
            is_admin: Some(json!(adm)),
        };
        let r = a.team_user_operation(&json!("atu"), &v_card, &p("m@x.io", false)).unwrap();
        assert_eq!(r["e"], json!(0));
        let r = a.team_user_operation(&json!("ltu"), &v_card, &TeamParams::default()).unwrap();
        assert_eq!(r["m_data"].as_array().unwrap().len(), 2);
        let r = a.team_user_operation(&json!("utu"), &v_card, &p("own@x.io", false)).unwrap();
        assert_eq!(r["em"], json!("Cannot demote the last admin of the team."));
        let r = a.team_user_operation(&json!("dtu"), &v_card, &p("own@x.io", false)).unwrap();
        assert_eq!(r["em"], json!("You cannot delete your own account."));
        let r = a.team_user_operation(&json!("dtu"), &v_card, &p("m@x.io", false)).unwrap();
        assert_eq!(r, json!({"e": 0}));
        let r = a.team_user_operation(&json!("zzz"), &v_card, &p("m@x.io", false)).unwrap();
        assert_eq!(r["em"], json!("Unknown team operation."));
    }
}
