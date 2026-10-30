//! Test setup: an Auth over a temporary file store, an in-memory-like
//! SQLite file, or the single account.
#![allow(dead_code)]

use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

use de_auth_server::accounts::Accounts;
use de_auth_server::auth::Outcome;
use de_auth_server::config::Cfg;
use de_auth_server::filedb::FileDb;
use de_auth_server::sqldb::SqlDb;
use de_auth_server::Auth;

pub struct Env {
    pub auth: Auth,
    pub dir: tempfile::TempDir,
}

pub fn file_mode() -> Env {
    let v_dir = tempfile::tempdir().unwrap();
    let v_file = v_dir.path().join("db_users.json");
    let v_cfg = Cfg::from_value(json!({ "account_storage_type": "file", "file_db": v_file.display().to_string() }));
    let v_accounts = Accounts { cfg: v_cfg, file: Some(Mutex::new(FileDb::open(&v_file))), db: None };
    Env { auth: Auth::new(v_accounts), dir: v_dir }
}

pub fn db_mode() -> Env {
    let v_dir = tempfile::tempdir().unwrap();
    let v_db = SqlDb::open(&v_dir.path().join("test.db")).unwrap();
    v_db.exec(include_str!("../../database/migrations/002_init_schema.sql")).unwrap();
    v_db.exec("ALTER TABLE teams ADD COLUMN RecoveryCode TEXT").unwrap();
    let v_cfg = Cfg::from_value(json!({ "account_storage_type": "db" }));
    let v_accounts = Accounts { cfg: v_cfg, file: None, db: Some(Arc::new(v_db)) };
    Env { auth: Auth::new(v_accounts), dir: v_dir }
}

pub fn single_mode() -> Env {
    let v_cfg = Cfg::from_value(json!({
        "account_storage_type": "single",
        "single_account_user_name": "single@x.com",
        "single_account_access_code": "singlecode"
    }));
    Env { auth: Auth::new(Accounts { cfg: v_cfg, file: None, db: None }), dir: tempfile::tempdir().unwrap() }
}

pub fn e(p_reply: &Value) -> Value {
    p_reply.get("e").cloned().unwrap_or(Value::Null)
}

/// The reply of an operation that answers synchronously.
pub fn reply(p_outcome: Outcome) -> Value {
    match p_outcome {
        Outcome::Reply(v) => v,
        Outcome::Invalid => panic!("fn_error invoked"),
        Outcome::Pending(_) => panic!("pending"),
        Outcome::Never => panic!("never answered"),
    }
}

impl Env {
    /// fn_createAccessCode directly: (access code, recovery code).
    pub fn create(&self, p_name: &str, p_permission: &str) -> (String, String) {
        let r =
            self.auth.accounts.create_access_code(&json!(p_name), &json!(p_permission), false, true).unwrap().unwrap();
        assert_eq!(e(&r), json!(0), "setup create should succeed: {}", r);
        (r["pwd"].as_str().unwrap().to_string(), r["rc"].as_str().unwrap().to_string())
    }

    /// fn_accountOperation on the web path.
    pub fn op(
        &self,
        p_sub: &str,
        p_name: Option<&str>,
        p_perm: Option<&str>,
        p_code: Option<&str>,
        p_session: Option<&str>,
        p_recovery: Option<&str>,
    ) -> Value {
        let j = |s: Option<&str>| s.map(|v| json!(v));
        reply(
            self.auth
                .account_operation(
                    Some(&json!(p_sub)),
                    j(p_name).as_ref(),
                    Some(&json!(p_perm.unwrap_or(""))),
                    j(p_code).as_ref(),
                    j(p_session).as_ref(),
                    None,
                    None,
                    false,
                    j(p_recovery).as_ref(),
                )
                .unwrap(),
        )
    }

    /// fn_accountOperationFromAgent
    pub fn agent_op(&self, p_sub: &str, p_name: Option<&str>, p_code: Option<&str>, p_recovery: Option<&str>) -> Value {
        let j = |s: Option<&str>| s.map(|v| json!(v));
        reply(
            self.auth
                .account_operation_from_agent(
                    Some(&json!(p_sub)),
                    j(p_name).as_ref(),
                    j(p_code).as_ref(),
                    Some(&json!("testapp")),
                    Some(&json!("testextra")),
                    j(p_recovery).as_ref(),
                )
                .unwrap(),
        )
    }

    /// fn_createLoginCard: the card (any error is in it).
    pub fn login(&self, p_name: &str, p_code: &str) -> Value {
        self.auth
            .sessions
            .create_login_card(&self.auth.accounts, &json!(p_name), &json!(p_code), &json!("g"), &json!("testgroup"))
            .unwrap()
            .unwrap()
    }

    pub fn record(&self, p_name: &str) -> Option<Value> {
        self.auth.accounts.fdb("fn_get_record").unwrap().get_record(&json!(p_name)).unwrap()
    }
}
