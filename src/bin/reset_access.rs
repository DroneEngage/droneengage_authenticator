//! reset_access: last-resort account credential reset (the former tools/reset_access.js).
//!
//!     reset_access <account-name>
//!
//! Rotates the account's access code (keeping its permission and IsAdmin
//! flag), issues a fresh one-time recovery code and prints both — the
//! recovery path for an owner with no live session, access code or
//! recovery code. Run it in the server's directory (server.config).
//!
//! File mode: the server keeps the users file in memory and rewrites it on
//! every change, so a reset made while it runs is lost. The tool refuses to
//! run while the server is up (the API port answers, or an andruavauth /
//! server.js process runs from this directory). db mode (SQLite) has no
//! such restriction. Single-account mode is refused.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

use de_auth_server::config::Cfg;
use de_auth_server::constants::*;

fn api_port_alive(p_cfg: &Cfg) -> bool {
    let v_port = match std::env::var("de_auth_server_port") {
        Ok(p) if !p.is_empty() => p,
        _ => match p_cfg.get("server_port").filter(|v| !v.is_null()) {
            Some(v) => droneengage_server_common::util::js_interp(Some(v)),
            None => return false,
        },
    };
    let v_host = match p_cfg.text("server_ip") {
        Some(ip) if ip != "0.0.0.0" => ip,
        _ => "127.0.0.1".into(),
    };
    let Ok(v_port) = v_port.trim().parse::<u16>() else { return false };
    let v_addrs: Vec<std::net::SocketAddr> = match std::net::ToSocketAddrs::to_socket_addrs(&(v_host.as_str(), v_port))
    {
        Ok(a) => a.collect(),
        Err(_) => return false,
    };
    v_addrs.iter().any(|a| std::net::TcpStream::connect_timeout(a, Duration::from_millis(800)).is_ok())
}

/// Server processes (andruavauth or server.js) whose working directory is this one.
fn server_processes(p_root: &std::path::Path) -> Vec<u32> {
    let v_me = std::process::id();
    let Ok(v_entries) = std::fs::read_dir("/proc") else { return vec![] };
    let mut v_pids = Vec::new();
    for e in v_entries.flatten() {
        let v_name = e.file_name().to_string_lossy().into_owned();
        let Ok(v_pid) = v_name.parse::<u32>() else { continue };
        if v_pid == v_me {
            continue;
        }
        let Ok(v_cwd) = std::fs::read_link(format!("/proc/{}/cwd", v_pid)) else { continue };
        if v_cwd != p_root {
            continue;
        }
        let Ok(v_cmd) = std::fs::read(format!("/proc/{}/cmdline", v_pid)) else { continue };
        let v_cmd = String::from_utf8_lossy(&v_cmd);
        if v_cmd.contains("server.js") || v_cmd.split('\0').next().map(|a| a.ends_with("andruavauth")).unwrap_or(false)
        {
            v_pids.push(v_pid);
        }
    }
    v_pids
}

fn refuse_running(p_reason: &str) -> ! {
    eprintln!("reset_access: the auth server appears to be running ({}).", p_reason);
    eprintln!("In file mode the server keeps the user database in memory and would");
    eprintln!("overwrite this tool's change on its next write. Stop the auth server");
    eprintln!("first (e.g. `pm2 stop` / `systemctl stop`), re-run this tool, then start it.");
    std::process::exit(1);
}

fn main() {
    let v_account = match std::env::args().nth(1) {
        Some(a) if !a.is_empty() => a,
        _ => {
            eprintln!("usage: reset_access <account-name>");
            std::process::exit(2);
        }
    };
    let v_root: PathBuf = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let v_cfg = match de_auth_server::config::load(&v_root, "server.config", &|k| std::env::var(k).ok(), &|l| {
        println!("{}", l)
    }) {
        Ok(c) => Cfg::new(c),
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    };
    let v_type = v_cfg.storage_type();
    if v_type == "single" {
        eprintln!("reset_access: single-account mode has no account database — edit single_account_access_code in server.config instead.");
        std::process::exit(1);
    }
    if v_type != "file" && v_type != "db" {
        eprintln!("reset_access: unsupported account_storage_type '{}'.", v_cfg.interp("account_storage_type"));
        std::process::exit(1);
    }
    if v_type == "file" {
        if api_port_alive(&v_cfg) {
            refuse_running("listening on the configured API port");
        }
        let v_pids = server_processes(&std::fs::canonicalize(&v_root).unwrap_or(v_root.clone()));
        if !v_pids.is_empty() {
            let v_list: Vec<String> = v_pids.iter().map(|p| p.to_string()).collect();
            refuse_running(&format!("server process(es) {} running from this directory", v_list.join(", ")));
        }
    }

    let (v_accounts, v_db_lines) = de_auth_server::cli::open_store(&v_cfg);
    for l in v_db_lines {
        println!("{}", l);
    }
    let v_name = json!(v_account);
    let v_permission = if v_type == "file" {
        match v_accounts.fdb("fn_get_record").and_then(|d| d.get_record(&v_name)) {
            Ok(Some(r)) => r.get("prm").cloned().unwrap_or(Value::Null),
            _ => {
                eprintln!("reset_access: account not found: {}", v_account);
                std::process::exit(1);
            }
        }
    } else {
        match v_accounts.db_account_permission(&v_name) {
            Ok(Ok(p)) => p,
            Ok(Err(r)) => {
                let v_msg = r.get(ERROR_MSG).and_then(Value::as_str).unwrap_or("account lookup failed").to_string();
                eprintln!("reset_access: {}", v_msg);
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!("reset_access: {}", e);
                std::process::exit(1);
            }
        }
    };
    let v_reply = match v_accounts.regenerate_access_code(&v_name, Some(&v_permission)) {
        Ok(Some(r)) => r,
        Ok(None) => std::process::exit(1),
        Err(e) => {
            eprintln!("reset_access: failed — {}", e);
            std::process::exit(1);
        }
    };
    if v_reply.get(ERROR) != Some(&json!(ERROR_NON)) {
        let v_msg = match v_reply.get(ERROR_MSG) {
            Some(Value::String(m)) if !m.is_empty() => m.clone(),
            _ => droneengage_server_common::util::js_stringify(&v_reply),
        };
        eprintln!("reset_access: failed — {}", v_msg);
        std::process::exit(1);
    }
    let v_text = |k: &str| droneengage_server_common::util::js_interp(v_reply.get(k));
    println!("Access code reset for account: {}", v_account);
    println!("  new access code   : {}", v_text(ACCESS_CODE_PARAMETER));
    println!("  new recovery code : {}", v_text(RECOVERY_CODE_PARAMETER));
    println!("Hand these to the account owner over a trusted channel.");
    println!("The recovery code is shown once — the owner should store it safely.");
}
