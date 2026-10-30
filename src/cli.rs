//! The server binary (the former src/server.js): arguments, configuration, banner,
//! logger, the account store, the comm server listener, then the API and
//! views servers.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::accounts::Accounts;
use crate::config::{Args, Cfg, DEFAULT_CONFIG_FILENAME};
use crate::logger::FileLogger;
use crate::sqldb::SqlDb;
use crate::web::server::{serve, BoxIo, Conn, Head};
use crate::web::Web;
use crate::{colors as c, Auth, VERSION};
use droneengage_server_common::util::{iso_time, js_interp, now_ms};
use droneengage_server_common::ws_accept::bind_listener;

fn display_help() {
    println!("==============================================");
    println!("{}DE Authentication Server version \"{}\"{}", c::BRIGHT, VERSION, c::RESET);
    println!("----------------------------------");
    println!("--config=config_filename config file ");
    println!("-h help ");
    println!("-v version");
    println!("==============================================");
}

/// fn_displayInfo: the banner; the file logger when enableLog.
fn display_info(p_cfg: &Cfg) -> Option<FileLogger> {
    println!("==============================================");
    println!("{}DE Authentication Server version \"{}\"{}", c::BRIGHT, VERSION, c::RESET);
    println!("----------------------------------");
    println!("{}Server Name  {}{}{}", c::LOG, c::B_SUCCESS, p_cfg.interp("server_id"), c::RESET);
    println!(
        "{}listening on ip: {}{}{} port: {}{}{}",
        c::LOG,
        c::B_SUCCESS,
        p_cfg.interp("server_ip"),
        c::LOG,
        c::B_SUCCESS,
        p_cfg.interp("server_port"),
        c::RESET
    );
    println!(
        "{}S2S WS ip: {}{}{} port: {}{}{}",
        c::LOG,
        c::B_SUCCESS,
        p_cfg.interp("s2s_ws_listening_ip"),
        c::LOG,
        c::B_SUCCESS,
        p_cfg.interp("s2s_ws_listening_port"),
        c::RESET
    );
    let v_s2s = p_cfg.truthy("s2s_auth_enabled");
    println!(
        "{}S2S Auth: {}{}",
        c::LOG,
        if v_s2s { format!("{}enabled", c::B_SUCCESS) } else { format!("{}disabled", c::B_FG_YELLOW) },
        c::RESET
    );
    if p_cfg.is_true("s2s_auth_enabled") {
        let v_keys: Vec<(String, String)> = match p_cfg.get("s2s_trusted_server_keys") {
            Some(serde_json::Value::Object(m)) => {
                crate::jsv::js_keys(m).into_iter().map(|k| (k.clone(), js_interp(m.get(&k)))).collect()
            }
            Some(serde_json::Value::String(s)) => {
                s.chars().enumerate().map(|(i, ch)| (i.to_string(), ch.to_string())).collect()
            }
            Some(serde_json::Value::Array(a)) => {
                a.iter().enumerate().map(|(i, v)| (i.to_string(), js_interp(Some(v)))).collect()
            }
            _ => Vec::new(),
        };
        if v_keys.is_empty() {
            println!(
                "{}FATAL ERROR:{} s2s_auth_enabled is true but s2s_trusted_server_keys is not configured or empty.{}",
                c::B_ERROR,
                c::B_FG_YELLOW,
                c::RESET
            );
            std::process::exit(1);
        }
        println!("{}Trusted S2S Servers:{}", c::LOG, c::RESET);
        for (k, v) in v_keys {
            println!("  - {}{}{} : {}", c::B_SUCCESS, k, c::RESET, v);
        }
    }
    let v_logger = if !p_cfg.is_true("enableLog") {
        println!("{}logging is {}disabled{}", c::LOG, c::B_FG_YELLOW, c::RESET);
        None
    } else {
        let v_dir = p_cfg.text("log_directory").unwrap_or_else(|| "./log".into());
        let v_tz = match p_cfg.get("log_timeZone") {
            None | Some(serde_json::Value::Null) => "GMT".to_string(),
            v => js_interp(v),
        };
        let v_logger = FileLogger::new(
            p_cfg.resolve(&v_dir),
            p_cfg
                .get("log_detailed")
                .map(|v| v == &serde_json::json!(true) || v == &serde_json::json!(1))
                .unwrap_or(false),
            Some(&v_tz),
        );
        println!("logging is {}enabled{}", c::B_FG_YELLOW, c::RESET);
        Some(v_logger)
    };
    println!("Datetime: {}", iso_time(now_ms()));
    println!("==============================================");
    match p_cfg.get("account_storage_type") {
        Some(serde_json::Value::String(s)) => {
            println!(" account_storage_type is {}{}{}", c::FG_YELLOW, s.to_lowercase(), c::RESET)
        }
        _ => {
            println!(
                "{}FATAL ERROR:{} account_storage_type {} is not specified in config file. ",
                c::B_ERROR,
                c::FG_YELLOW,
                c::RESET
            );
            std::process::exit(0);
        }
    }
    let v_type = p_cfg.storage_type();
    if !p_cfg.is_false("skip_hardware_validation") {
        println!("{} Hardware Validation: {}skipped (skip_hardware_validation=true){}", c::LOG, c::FG_YELLOW, c::RESET);
    } else if v_type != "db" {
        println!(
            "{} Hardware Validation: {}skipped (not supported in {} mode, requires db mode){}",
            c::LOG,
            c::FG_YELLOW,
            v_type,
            c::RESET
        );
    } else {
        println!("{} Hardware Validation: {}enabled{}", c::LOG, c::B_SUCCESS, c::RESET);
    }
    if let Some(l) = &v_logger {
        l.info("System Started.", None, None);
    }
    v_logger
}

/// js_database_manager.fn_initialize: the store, plus the lines the
/// JavaScript prints from its asynchronous database callbacks (printed
/// once the servers are up).
pub fn open_store(p_cfg: &Cfg) -> (Accounts, Vec<String>) {
    let mut v_accounts = Accounts { cfg: p_cfg.clone(), file: None, db: None };
    let mut v_later = Vec::new();
    match p_cfg.storage_type().as_str() {
        "single" => {}
        "file" if p_cfg.has("file_db") => {
            let v_raw = p_cfg.interp("file_db");
            let v_path = p_cfg.resolve(&v_raw);
            v_accounts.file = Some(std::sync::Mutex::new(crate::filedb::FileDb::open(&v_path)));
            println!("Users Database File  {}{}{}", c::B_SUCCESS, v_raw, c::RESET);
            if !std::path::Path::new(&v_raw).exists() {
                // Colors.Warn is undefined in the JavaScript
                println!(
                    "undefined[WARN] Database file not found: {} - will be created on first user registration{}",
                    v_raw,
                    c::RESET
                );
            } else {
                println!("{}[OK] Database file exists and loaded{}", c::SUCCESS, c::RESET);
            }
        }
        "db" => {
            let v_raw = p_cfg.text("dbdatabase").unwrap_or_else(|| "database/andruav.db".into());
            let v_path = p_cfg.resolve(&v_raw);
            if let Some(d) = v_path.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let v_db = match SqlDb::open(&v_path) {
                Ok(d) => d,
                Err(e) => {
                    println!("[FATAL] database error.");
                    println!("{}", crate::util::js_stringify(&e.to_value()));
                    std::process::exit(1);
                }
            };
            if let Err(e) = v_db.run("PRAGMA foreign_keys = ON", &[]) {
                v_later.push(format!("[WARN] Failed to enable foreign keys: {}", e.message))
            }
            v_later.push(format!("{}[OK] SQLite Database is Connected: {}{}", c::SUCCESS, v_path.display(), c::RESET));
            for (v_table, v_column, v_sql, v_ok) in [
                (
                    "logins",
                    "Enabled",
                    "ALTER TABLE logins ADD COLUMN Enabled INTEGER DEFAULT 1",
                    "[OK] Added logins.Enabled column (default 1)",
                ),
                (
                    "teams",
                    "RecoveryCode",
                    "ALTER TABLE teams ADD COLUMN RecoveryCode TEXT",
                    "[OK] Added teams.RecoveryCode column",
                ),
            ] {
                let v_cols = v_db.all(&format!("PRAGMA table_info({})", v_table), &[]).unwrap_or_default();
                if !v_cols.iter().any(|c| c["name"] == serde_json::json!(v_column)) {
                    match v_db.run(v_sql, &[]) {
                        Err(e) => {
                            v_later.push(format!("[WARN] Failed to add {}.{} column: {}", v_table, v_column, e.message))
                        }
                        Ok(_) => v_later.push(format!("{}{}{}", c::SUCCESS, v_ok, c::RESET)),
                    }
                }
            }
            v_accounts.db = Some(Arc::new(v_db));
        }
        _ => {
            println!(
                "{}FATAL ERROR:{} account_storage_type or file_db or db connection{} are not specified in config file. ",
                c::B_ERROR,
                c::FG_YELLOW,
                c::RESET
            );
            std::process::exit(0);
        }
    }
    (v_accounts, v_later)
}

/// `path.isAbsolute(p) ? p : root + p` for the SSL files.
fn ssl_path(p_cfg: &Cfg, p_key: &str) -> PathBuf {
    p_cfg.resolve(&p_cfg.interp(p_key))
}

fn tls(p_cfg: &Cfg) -> Result<tokio_rustls::TlsAcceptor, String> {
    droneengage_server_common::net::tls_acceptor(&ssl_path(p_cfg, "ssl_key_file"), &ssl_path(p_cfg, "ssl_cert_file"))
}

/// The accept loop of an app server.
fn serve_app(
    p_web: Arc<Web>,
    p_listener: tokio::net::TcpListener,
    p_tls: Option<tokio_rustls::TlsAcceptor>,
    p_views: bool,
) {
    let v_terminal = p_views && !p_web.auth.cfg.is_false("webadmin_terminal_enabled");
    tokio::spawn(async move {
        loop {
            let Ok((v_tcp, v_remote)) = p_listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            };
            let (v_web, v_tls) = (p_web.clone(), p_tls.clone());
            tokio::spawn(async move {
                let v_secure = v_tls.is_some();
                let v_io: BoxIo = match v_tls {
                    Some(a) => match a.accept(v_tcp).await {
                        Ok(s) => Box::new(s),
                        Err(_) => return,
                    },
                    None => Box::new(v_tcp),
                };
                connection(v_web, v_io, v_remote, v_secure, p_views, v_terminal).await;
            });
        }
    });
}

async fn connection(
    p_web: Arc<Web>,
    p_io: BoxIo,
    p_remote: SocketAddr,
    p_secure: bool,
    p_views: bool,
    p_terminal: bool,
) {
    let v_web = p_web.clone();
    let v_handler = move |r: crate::web::http::Request| {
        let v_web = v_web.clone();
        async move { crate::web::handle(&v_web, &r, p_views).await }
    };
    let v_upgrade = if p_terminal {
        let v_web = p_web.clone();
        Some(move |p_conn: Conn<BoxIo>, p_head: Head| crate::web::terminal::upgrade(v_web.clone(), p_conn, p_head))
    } else {
        None
    };
    serve(p_io, p_remote, p_secure, v_handler, v_upgrade).await;
}

fn listen_failed(p_err: &str) -> ! {
    // an 'error' event with no listener: Node.js exits
    eprintln!("Error: {}", p_err);
    std::process::exit(1);
}

/// Runs the server until SIGINT.
pub async fn run() {
    let v_argv: Vec<String> = std::env::args().skip(1).collect();
    let v_args = Args::parse(&v_argv);
    if v_args.has("h") || v_args.has("help") {
        display_help();
        std::process::exit(0);
    }
    if v_args.has("v") || v_args.has("version") {
        println!("Andruav Authentication Server version: \"{}\"", VERSION);
        std::process::exit(0);
    }
    let v_file = v_args.get("config").map(str::to_string).unwrap_or_else(|| DEFAULT_CONFIG_FILENAME.to_string());
    let v_root: PathBuf = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let v_cfg = match crate::config::load(&v_root, &v_file, &|k| std::env::var(k).ok(), &|l| println!("{}", l)) {
        Ok(cfg) => Cfg::new(cfg),
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    };
    let v_logger = display_info(&v_cfg);

    // fn_startServer
    println!("{}[OK] Auth Server Started{}", c::SUCCESS, c::RESET);
    let (v_accounts, v_db_lines) = open_store(&v_cfg);
    let v_auth = Arc::new(Auth {
        cfg: v_cfg.clone(),
        accounts: v_accounts,
        sessions: Default::default(),
        comm: Default::default(),
        altcha: crate::altcha::Altcha::new(v_cfg.clone()),
        logger: v_logger,
    });
    println!(
        "{}[OK] Comm Server Manager Started at port {}{}",
        c::SUCCESS,
        v_cfg.interp("s2s_ws_listening_port"),
        c::RESET
    );
    let v_s2s_tls = if v_cfg.is_true("enable_SSL") {
        let (v_key, v_cert) = (ssl_path(&v_cfg, "ssl_key_file"), ssl_path(&v_cfg, "ssl_cert_file"));
        let mut v_missing = false;
        if !v_key.exists() {
            eprintln!(
                "{}[ERROR] Communication Server: Missing SSL key file not found: {}{}",
                c::ERROR,
                v_key.display(),
                c::RESET
            );
            v_missing = true;
        }
        if !v_cert.exists() {
            eprintln!(
                "{}[ERROR] Communication Server: Missing SSL certificate file not found: {}{}",
                c::ERROR,
                v_cert.display(),
                c::RESET
            );
            v_missing = true;
        }
        if v_missing {
            std::process::exit(1);
        }
        Some(tls(&v_cfg).unwrap_or_else(|e| listen_failed(&e)))
    } else {
        None
    };
    let v_s2s_listener =
        bind_listener(&v_cfg.interp("s2s_ws_listening_ip"), &v_cfg.interp("s2s_ws_listening_port")).await;
    match v_s2s_listener {
        Ok(l) => crate::s2s::run(v_auth.clone(), l, v_s2s_tls),
        Err(e) => listen_failed(&e),
    }

    // fn_startApiServer
    let v_web = Arc::new(Web::new(v_auth.clone()));
    v_web.admin.warn_secret();
    {
        let v_web = v_web.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(300)).await;
                v_web.admin.lockout.sweep();
            }
        });
    }
    let v_api_port = match std::env::var("de_auth_server_port") {
        Ok(p) if !p.is_empty() => p,
        _ => v_cfg.interp("server_port"),
    };
    let v_ssl = v_cfg.truthy("enable_SSL");
    let v_api_tls = if v_ssl {
        println!("{}READING {}{}", c::LOG, v_cfg.interp("ssl_key_file"), c::RESET);
        println!("{}READING {}{}", c::LOG, v_cfg.interp("ssl_cert_file"), c::RESET);
        Some(tls(&v_cfg).unwrap_or_else(|e| listen_failed(&e)))
    } else {
        None
    };
    match bind_listener("", &v_api_port).await {
        Ok(l) => serve_app(v_web.clone(), l, v_api_tls.clone(), false),
        Err(e) => listen_failed(&e),
    }
    println!("{}[OK] API Server Started{}", c::SUCCESS, c::RESET);
    let v_proto = if v_ssl { "https" } else { "http" };
    let v_host = if v_cfg.get("server_ip") == Some(&serde_json::json!("0.0.0.0")) {
        "localhost".to_string()
    } else {
        v_cfg.interp("server_ip")
    };
    println!(
        "{}API Server:{}  {}://{}:{}{}",
        c::LOG,
        c::B_SUCCESS,
        v_proto,
        v_host,
        v_cfg.interp("server_port"),
        c::RESET
    );

    // fn_startViewsServer
    if v_cfg.truthy("webadmin_enable") {
        let v_port = match std::env::var("de_auth_webadminport") {
            Ok(p) if !p.is_empty() => p,
            _ => v_cfg.text("webadmin_port").unwrap_or_else(|| "19409".into()),
        };
        let Some(v_ip) = v_cfg.text("webadmin_listening_ip") else {
            println!(
                "{}FATAL ERROR:{} webadmin_listening_ip {} is not specified in config file. ",
                c::B_ERROR,
                c::FG_YELLOW,
                c::RESET
            );
            std::process::exit(0);
        };
        match bind_listener(&v_ip, &v_port).await {
            Ok(l) => serve_app(v_web.clone(), l, v_api_tls, true),
            Err(e) => listen_failed(&e),
        }
        if !v_cfg.is_false("webadmin_terminal_enabled") {
            crate::web::terminal::attached();
        }
        println!("{}[OK] Views Server Started{}", c::SUCCESS, c::RESET);
        let v_guid = v_cfg.admin_guid().unwrap_or_default();
        let v_path = if v_guid.is_empty() { "/admin/login".to_string() } else { format!("/admin/{}/login", v_guid) };
        println!(
            "{}Admin Routes:{}  {}://{}:{}{}{} - Admin Login{}",
            c::LOG,
            c::B_SUCCESS,
            v_proto,
            v_ip,
            v_port,
            v_path,
            c::RESET,
            if v_guid.is_empty() { "" } else { " (GUID mode)" }
        );
    }
    for l in v_db_lines {
        println!("{}", l);
    }

    let _ = tokio::signal::ctrl_c().await;
    if let Some(l) = &v_auth.logger {
        l.warn("SIGINT.", None, None);
    }
    std::process::exit(0);
}
