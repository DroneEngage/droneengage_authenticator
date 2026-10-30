//! migrate_file_db: builds the SQLite account database
//! (the former src/database/migrate_file_db.js).
//!
//!     migrate_file_db [json_db_file] [--csv-dir <dir>] [--output <sqlite_file>]
//!
//! Migrates a file-mode users JSON database (teams/logins, or the old flat
//! `users` format) and/or imports account.csv + account_details.csv, into a
//! fresh database with database/migrations/002_init_schema.sql. Without
//! arguments the input is server.config's file_db and the output its
//! dbdatabase (default database/andruav.db). Paths are relative to the
//! server directory (the current directory).

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use de_auth_server::jsv::js_keys;
use de_auth_server::sqldb::SqlDb;
use droneengage_server_common::util::{js_parse_int, js_to_string, js_truthy, json_number_f64, now_ms};

const EMBEDDED_SCHEMA: &str = include_str!("../../database/migrations/002_init_schema.sql");

/// parsePermission
fn parse_permission(p_perm: Option<&Value>) -> Value {
    let v_full = json!(4294967295u32);
    let Some(v) = p_perm.filter(|v| js_truthy(Some(v))) else { return v_full };
    if v == &json!("D1G1T3R4V5C6") {
        return v_full;
    }
    if v.is_number() {
        return v.clone();
    }
    let v_n = de_auth_server::jsv::parse_int16(de_auth_server::validator::js_trim(&js_to_string(v)));
    if v_n.is_nan() {
        v_full
    } else {
        de_auth_server::jsv::num(v_n)
    }
}

/// parseEnabled
fn parse_enabled(p_enabled: Option<&Value>) -> i64 {
    match p_enabled {
        Some(Value::Bool(true)) => 1,
        Some(Value::Number(n)) if json_number_f64(n) == 1.0 => 1,
        Some(Value::String(s)) => {
            let v = de_auth_server::validator::js_trim(s).to_lowercase();
            (v == "1" || v == "true" || v == "yes") as i64
        }
        _ => 0,
    }
}

/// parseDateTime
fn parse_date_time(p_dt: Option<&Value>) -> Option<String> {
    match p_dt {
        Some(Value::String(s)) => {
            let t = de_auth_server::validator::js_trim(s);
            (!t.is_empty()).then(|| t.to_string())
        }
        _ => None,
    }
}

/// `new Date().toISOString().replace('T', ' ').substring(0, 19)`
fn now_text() -> String {
    droneengage_server_common::util::iso_time(now_ms()).replace('T', " ")[..19].to_string()
}

/// parseCsv: header row, quoted fields with "" escapes, trimmed values.
fn parse_csv(p_text: &str) -> Vec<Map<String, Value>> {
    let v_lines: Vec<&str> = p_text.trim().split('\n').collect();
    if v_lines.len() < 2 {
        return vec![];
    }
    let parse_line = |p_line: &str| -> Vec<String> {
        let v_chars: Vec<char> = p_line.chars().collect();
        let mut v_out = Vec::new();
        let mut v_cur = String::new();
        let mut v_quoted = false;
        let mut i = 0;
        while i < v_chars.len() {
            let ch = v_chars[i];
            if ch == '"' {
                if v_quoted && v_chars.get(i + 1) == Some(&'"') {
                    v_cur.push('"');
                    i += 1;
                } else {
                    v_quoted = !v_quoted;
                }
            } else if ch == ',' && !v_quoted {
                v_out.push(std::mem::take(&mut v_cur));
            } else {
                v_cur.push(ch);
            }
            i += 1;
        }
        v_out.push(v_cur);
        v_out
    };
    let v_headers = parse_line(v_lines[0]);
    v_lines[1..]
        .iter()
        .map(|l| {
            let v_values = parse_line(l);
            let mut m = Map::new();
            for (i, h) in v_headers.iter().enumerate() {
                let v = v_values.get(i).map(|s| s.trim().to_string()).unwrap_or_default();
                m.insert(h.trim().to_string(), json!(v));
            }
            m
        })
        .collect()
}

/// A JavaScript Map keyed by SameValueZero, in insertion order.
#[derive(Default)]
struct JsMap {
    m_entries: Vec<(Value, Value)>,
}

impl JsMap {
    fn same(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => json_number_f64(x) == json_number_f64(y),
            _ => a == b,
        }
    }

    fn set(&mut self, k: Value, v: Value) {
        match self.m_entries.iter_mut().find(|(e, _)| Self::same(e, &k)) {
            Some(e) => e.1 = v,
            None => self.m_entries.push((k, v)),
        }
    }
}

fn values_in_order(p_obj: Option<&Value>) -> Vec<Value> {
    match p_obj {
        Some(Value::Object(m)) => js_keys(m).into_iter().map(|k| m[&k].clone()).collect(),
        Some(Value::Array(a)) => a.clone(),
        _ => vec![],
    }
}

fn fail(p_msg: &str) -> ! {
    eprintln!("{}", p_msg);
    std::process::exit(1);
}

fn main() {
    let v_args: Vec<String> = std::env::args().skip(1).collect();
    let (mut v_input, mut v_csv_dir, mut v_output): (Option<String>, Option<String>, Option<String>) =
        (None, None, None);
    let mut i = 0;
    while i < v_args.len() {
        match v_args[i].as_str() {
            "--csv-dir" => {
                i += 1;
                v_csv_dir = v_args.get(i).cloned();
            }
            "--output" => {
                i += 1;
                v_output = v_args.get(i).cloned();
            }
            a if v_input.is_none() && !a.starts_with("--") => v_input = Some(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    let v_root: PathBuf = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let v_config: Value = match std::fs::read_to_string(v_root.join("server.config")) {
        Ok(t) => match serde_json::from_str(&droneengage_server_common::config::strip_json_comments(&t)) {
            Ok(v) => v,
            Err(e) => {
                println!("[WARN] Could not read server.config: {}", e);
                json!({})
            }
        },
        Err(e) => {
            println!("[WARN] Could not read server.config: {}", e);
            json!({})
        }
    };
    if v_input.is_none() {
        if let Some(f) = v_config.get("file_db").filter(|v| js_truthy(Some(v))) {
            v_input = Some(v_root.join(js_to_string(f)).display().to_string());
        }
    }
    let v_output: PathBuf = match v_output {
        Some(o) => PathBuf::from(o),
        None => match v_config.get("dbdatabase").filter(|v| js_truthy(Some(v))) {
            Some(d) => v_root.join(js_to_string(d)),
            None => v_root.join("database").join("andruav.db"),
        },
    };
    if let Some(d) = v_output.parent().filter(|d| !d.as_os_str().is_empty()) {
        let _ = std::fs::create_dir_all(d);
    }
    println!("[INFO] Input JSON DB: {}", v_input.as_deref().unwrap_or("(none)"));
    println!("[INFO] Output SQLite: {}", v_output.display());
    if let Some(d) = &v_csv_dir {
        println!("[INFO] CSV directory: {}", d);
    }
    if v_input.is_none() && v_csv_dir.is_none() {
        fail("[ERROR] Nothing to do. Provide an input JSON db file or --csv-dir.");
    }

    // JSON input
    let mut v_teams: Vec<Value> = Vec::new();
    let mut v_logins: Vec<Value> = Vec::new();
    let v_json = v_input.as_ref().filter(|p| Path::new(p).exists()).and_then(|p| match std::fs::read_to_string(p) {
        Ok(t) => match serde_json::from_str::<Value>(&t) {
            Ok(v @ (Value::Object(_) | Value::Array(_))) => Some(v),
            Ok(_) => None,
            Err(e) => {
                println!("[WARN] Could not read input JSON db: {}", e);
                None
            }
        },
        Err(e) => {
            println!("[WARN] Could not read input JSON db: {}", e);
            None
        }
    });
    if let Some(v_data) = &v_json {
        if js_truthy(v_data.get("teams")) && js_truthy(v_data.get("logins")) {
            v_teams = values_in_order(v_data.get("teams"));
            v_logins = values_in_order(v_data.get("logins"));
            println!("[INFO] Loaded {} teams and {} logins from JSON DB", v_teams.len(), v_logins.len());
        } else if let Some(Value::Object(v_users)) = v_data.get("users") {
            let mut v_by_sid = Map::new();
            for k in js_keys(v_users) {
                let v_sid = v_users[&k].get("sid").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(1));
                let v_key = droneengage_server_common::util::js_key(Some(&v_sid));
                if !v_by_sid.contains_key(&v_key) {
                    v_by_sid.insert(
                        v_key,
                        json!({ "TeamID": v_sid, "TeamName": k, "Email": k, "InstanceLimit": 999, "Enabled": 1 }),
                    );
                }
            }
            v_teams = js_keys(&v_by_sid).into_iter().map(|k| v_by_sid[&k].clone()).collect();
            for (n, k) in js_keys(v_users).into_iter().enumerate() {
                let u = &v_users[&k];
                let mut v = json!({ "LoginID": n + 1 });
                v["TeamID"] = u.get("sid").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(1));
                v["LoginName"] = json!(k);
                v["AccessCode"] = u
                    .get("AccessCode")
                    .filter(|v| js_truthy(Some(v)))
                    .or_else(|| u.get("pwd"))
                    .cloned()
                    .unwrap_or(Value::Null);
                v["Permissions"] = parse_permission(u.get("prm"));
                v["IsAdmin"] = json!(js_truthy(u.get("isadmin")) as i64);
                v_logins.push(v);
            }
            println!("[INFO] Migrated {} teams and {} logins from old JSON format", v_teams.len(), v_logins.len());
        }
    }

    // CSV input
    let mut v_csv_teams: Vec<Value> = Vec::new();
    let mut v_csv_logins: Vec<Value> = Vec::new();
    if let Some(d) = &v_csv_dir {
        let (v_acc, v_det) = (Path::new(d).join("account.csv"), Path::new(d).join("account_details.csv"));
        if !v_acc.exists() || !v_det.exists() {
            println!("[WARN] CSV files not found in specified directory. Skipping CSV import.");
        } else {
            let (v_acc_text, v_det_text) = match (std::fs::read_to_string(&v_acc), std::fs::read_to_string(&v_det)) {
                (Ok(a), Ok(b)) => (a, b),
                (Err(e), _) | (_, Err(e)) => fail(&format!("[ERROR] Failed to import from CSV: {}", e)),
            };
            let mut v_by_sid: Map<String, Value> = Map::new();
            for a in parse_csv(&v_acc_text) {
                let Some(v_sid) = js_parse_int(a.get("Account_SID")).filter(|s| *s != 0) else { continue };
                let v_name = a.get("Name").cloned().unwrap_or(Value::Null);
                v_by_sid.insert(v_sid.to_string(), Value::Object(a.clone()));
                let v_limit = js_parse_int(a.get("Instance_Limit")).filter(|n| *n != 0).unwrap_or(999);
                let mut v = json!({ "TeamID": v_sid, "TeamName": v_name, "Email": v_name, "InstanceLimit": v_limit });
                v["Enabled"] = json!(parse_enabled(a.get("Enabled")));
                v["CreatedAt"] = parse_date_time(a.get("register_time")).map(Value::String).unwrap_or(Value::Null);
                v["UpdatedAt"] = v["CreatedAt"].clone();
                v_csv_teams.push(v);
            }
            for d in parse_csv(&v_det_text) {
                let Some(v_team) = js_parse_int(d.get("Account_SID")).filter(|s| *s != 0) else { continue };
                let Some(v_account) = v_by_sid.get(&v_team.to_string()) else { continue };
                let v_login_id = js_parse_int(d.get("SID")).map(Value::from).unwrap_or(Value::Null);
                let mut v = json!({ "LoginID": v_login_id, "TeamID": v_team, "LoginName": v_account.get("Name") });
                v["AccessCode"] = d.get("PWD").cloned().unwrap_or(Value::Null);
                v["Permissions"] = parse_permission(d.get("Permission"));
                v["IsAdmin"] = json!(0);
                v["CreatedAt"] = parse_date_time(d.get("register_time")).map(Value::String).unwrap_or(Value::Null);
                v_csv_logins.push(v);
            }
            println!("[INFO] Loaded {} teams and {} logins from CSV", v_csv_teams.len(), v_csv_logins.len());
        }
    }

    let mut v_team_map = JsMap::default();
    let mut v_login_map = JsMap::default();
    for t in v_teams.iter().chain(v_csv_teams.iter()) {
        v_team_map.set(t.get("TeamID").cloned().unwrap_or(Value::Null), t.clone());
    }
    for l in v_logins.iter().chain(v_csv_logins.iter()) {
        v_login_map.set(l.get("LoginID").cloned().unwrap_or(Value::Null), l.clone());
    }
    println!("[INFO] Total unique teams: {}", v_team_map.m_entries.len());
    println!("[INFO] Total unique logins: {}", v_login_map.m_entries.len());
    if v_team_map.m_entries.is_empty() && v_login_map.m_entries.is_empty() {
        fail("[ERROR] No data to write.");
    }

    let v_schema_path = v_root.join("database").join("migrations").join("002_init_schema.sql");
    let v_schema = match std::fs::read_to_string(&v_schema_path) {
        Ok(s) => s,
        Err(_) => {
            println!("[WARN] Schema file not found, using embedded schema.");
            EMBEDDED_SCHEMA.to_string()
        }
    };
    if v_output.exists() {
        println!("[INFO] Removing existing output file: {}", v_output.display());
        if let Err(e) = std::fs::remove_file(&v_output) {
            fail(&format!("[ERROR] Failed to remove existing output file: {}", e));
        }
    }
    let v_db = SqlDb::open(&v_output)
        .unwrap_or_else(|e| fail(&format!("[ERROR] Failed to open SQLite database: {}", e.message)));
    let v_result = (|| -> Result<(Value, Value), String> {
        v_db.exec("PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS team_hardware; DROP TABLE IF EXISTS logins; DROP TABLE IF EXISTS teams; PRAGMA foreign_keys = ON;")
            .map_err(|e| e.message)?;
        v_db.exec(&v_schema).map_err(|e| e.message)?;
        v_db.run("PRAGMA foreign_keys = ON", &[]).map_err(|e| e.message)?;
        v_db.run("BEGIN TRANSACTION", &[]).map_err(|e| e.message)?;
        let mut v_skipped = 0;
        let v_inner = (|| -> Result<(), String> {
            let v_team_sql = "INSERT OR REPLACE INTO teams (TeamID, TeamName, Email, InstanceLimit, Enabled, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)";
            for (_, t) in &v_team_map.m_entries {
                let v_created = parse_date_time(t.get("CreatedAt")).unwrap_or_else(now_text);
                let v_updated = parse_date_time(t.get("UpdatedAt")).unwrap_or_else(|| v_created.clone());
                let v_name = t.get("TeamName").cloned().unwrap_or(Value::Null);
                v_db.run(
                    v_team_sql,
                    &[
                        t.get("TeamID").cloned().unwrap_or(Value::Null),
                        v_name.clone(),
                        t.get("Email").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(v_name),
                        t.get("InstanceLimit").filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!(999)),
                        json!(parse_enabled(t.get("Enabled"))),
                        json!(v_created),
                        json!(v_updated),
                    ],
                )
                .map_err(|e| e.message)?;
            }
            println!("[INFO] Inserted {} teams", v_team_map.m_entries.len());
            let v_login_sql = "INSERT INTO logins (LoginID, TeamID, LoginName, AccessCode, Permissions, IsAdmin, Enabled, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
            let mut v_count = 0;
            for (_, l) in &v_login_map.m_entries {
                let v_enabled = match l.get("Enabled") {
                    None => 1,
                    v => parse_enabled(v),
                };
                let r = v_db.run(
                    v_login_sql,
                    &[
                        l.get("LoginID").cloned().unwrap_or(Value::Null),
                        l.get("TeamID").cloned().unwrap_or(Value::Null),
                        l.get("LoginName").cloned().unwrap_or(Value::Null),
                        l.get("AccessCode").cloned().unwrap_or(Value::Null),
                        parse_permission(l.get("Permissions")),
                        json!(js_truthy(l.get("IsAdmin")) as i64),
                        json!(v_enabled),
                        json!(parse_date_time(l.get("CreatedAt")).unwrap_or_else(now_text)),
                    ],
                );
                match r {
                    Ok(_) => v_count += 1,
                    Err(e) if e.message.contains("UNIQUE constraint failed: logins.AccessCode") => v_skipped += 1,
                    Err(e) => return Err(e.message),
                }
            }
            println!("[INFO] Inserted {} logins", v_count);
            Ok(())
        })();
        match v_inner {
            Ok(()) => {
                v_db.run("COMMIT", &[]).map_err(|e| e.message)?;
            }
            Err(e) => {
                let _ = v_db.run("ROLLBACK", &[]);
                return Err(e);
            }
        }
        if v_skipped > 0 {
            println!("[WARN] Skipped {} logins with duplicate AccessCode", v_skipped);
        }
        println!("[INFO] Transaction committed, verifying counts...");
        let v_teams = v_db.get("SELECT COUNT(*) as count FROM teams", &[]).map_err(|e| e.message)?;
        let v_logins = v_db.get("SELECT COUNT(*) as count FROM logins", &[]).map_err(|e| e.message)?;
        let f = |r: Option<Value>| r.map(|r| r["count"].clone()).unwrap_or(Value::Null);
        Ok((f(v_teams), f(v_logins)))
    })();
    match v_result {
        Ok((t, l)) => {
            drop(v_db);
            println!("[INFO] Operation completed successfully");
            println!("[INFO] SQLite file: {}", v_output.display());
            println!("[INFO] Teams written: {}", t);
            println!("[INFO] Logins written: {}", l);
        }
        Err(e) => fail(&format!("[ERROR] Failed to write SQLite database: {}", e)),
    }
}
