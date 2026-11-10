//! The /admin router (js_router_admin.js): session, the router's CSP, the
//! optional GUID gate, CSRF, admin login (bcrypt or plaintext, rate
//! limited, with lockout), the pages, the JSON API over the file store,
//! the SQLite database and the comm servers, the terminal page and the
//! wiki.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Mutex;

use super::http::{Request, Response};
use super::limiter::{seconds_left, Limiter};
use super::session::{self, Session, Store};
use super::{csrf, headers, is, param, Ctx, Reply};
use crate::config::Cfg;
use crate::constants::*;
use crate::filedb::verify;
use crate::sessions::Sessions;
use droneengage_server_common::colors as c;
use droneengage_server_common::config_handler::is_bcrypt_hash;
use droneengage_server_common::password;
use droneengage_server_common::util::{
    field, is_undefined, js_interp, js_parse_int, js_strict_eq, js_to_string, js_truthy, now_ms, set_field_opt,
};
use droneengage_server_common::validation::{
    is_valid_admin_password as valid_password, is_valid_admin_username as valid_username,
};

const LOCKOUT_MS: i64 = 30 * 60 * 1000;
const FAILED_ATTEMPTS_MAX_ENTRIES: usize = 10000;
const DEFAULT_SESSION_SECRET: &str = "change-this-secret-in-production";

/// Account lockout: failed logins per `ip:username`.
#[derive(Default)]
pub struct Lockout {
    m_failed: Mutex<HashMap<String, (u32, i64)>>,
}

impl Lockout {
    fn locked(&self, p_key: &str) -> bool {
        let mut m = self.m_failed.lock().unwrap();
        let Some((v_count, v_last)) = m.get(p_key).copied() else { return false };
        if now_ms() - v_last > LOCKOUT_MS {
            m.remove(p_key);
            return false;
        }
        v_count >= 5
    }

    fn record(&self, p_key: &str) {
        let mut m = self.m_failed.lock().unwrap();
        let e = m.entry(p_key.to_string()).or_insert((0, 0));
        e.0 += 1;
        e.1 = now_ms();
        if m.len() > FAILED_ATTEMPTS_MAX_ENTRIES {
            let mut v_all: Vec<(String, i64)> = m.iter().map(|(k, v)| (k.clone(), v.1)).collect();
            v_all.sort_by_key(|(_, t)| *t);
            let v_excess = m.len() - FAILED_ATTEMPTS_MAX_ENTRIES;
            for (k, _) in v_all.into_iter().take(v_excess) {
                m.remove(&k);
            }
        }
    }

    fn clear(&self, p_key: &str) {
        self.m_failed.lock().unwrap().remove(p_key);
    }

    /// The 5-minute sweep of stale entries.
    pub fn sweep(&self) {
        let v_now = now_ms();
        self.m_failed.lock().unwrap().retain(|_, (_, t)| v_now - *t <= LOCKOUT_MS);
    }
}

/// js_admin_session.js and the router's limiters.
pub struct AdminState {
    pub sessions: Store,
    pub login_limiter: Limiter,
    pub api_limiter: Limiter,
    pub lockout: Lockout,
    /// session_secret
    pub secret: Option<String>,
    /// cookie.secure (enable_SSL)
    pub secure_cookie: bool,
}

impl AdminState {
    pub fn new(p_cfg: &Cfg) -> AdminState {
        AdminState {
            sessions: Store::default(),
            login_limiter: Limiter::new(15 * 60 * 1000, 5),
            api_limiter: Limiter::new(60 * 1000, 60),
            lockout: Lockout::default(),
            secret: p_cfg.text("session_secret"),
            secure_cookie: p_cfg.truthy("enable_SSL"),
        }
    }

    /// The startup warning for a missing or default session_secret.
    pub fn warn_secret(&self) {
        if self.secret.is_none() || self.secret.as_deref() == Some(DEFAULT_SESSION_SECRET) {
            println!(
                "{}[WARNING]{} session_secret {} is missing or still set to the default value in the config file. Set a unique, high-entropy secret before using in production.",
                c::B_ERROR,
                c::B_FG_YELLOW,
                c::RESET
            );
        }
    }
}

/// adminPath(p)
pub fn admin_path(p_cfg: &Cfg, p_path: &str) -> String {
    match p_cfg.admin_guid() {
        Some(g) => format!("/admin/{}{}", g, p_path),
        None => format!("/admin{}", p_path),
    }
}

/// The router's result: answered, or fell through with the headers set so
/// far (CSP, cookies).
pub enum Outcome {
    Done(Reply),
    Next(Vec<(String, String)>),
}

struct A<'a, 'b> {
    c: &'a Ctx<'b>,
    session: Session,
    res: Response,
    csrf_secret: String,
    query: Value,
}

impl A<'_, '_> {
    fn cfg(&self) -> &Cfg {
        &self.c.auth().cfg
    }

    fn req(&self) -> &Request {
        self.c.req
    }

    fn body(&self, p_key: &str) -> Option<Value> {
        field(&self.c.body, p_key).cloned()
    }

    fn json(&mut self, p_value: Value) {
        let r = self.c.req;
        self.res.json(r, &p_value);
    }

    fn fail(&mut self, p_message: &str) {
        self.json(json!({ "error": 1, "errorMessage": p_message }));
    }

    fn redirect(&mut self, p_path: &str) {
        let v_url = admin_path(self.cfg(), p_path);
        let r = self.c.req;
        self.res.redirect(r, &v_url);
    }

    fn render(&mut self, p_view: &str, p_ctx: minijinja::Value) {
        let v_ctx = minijinja::context! { csrfToken => csrf::create(&self.csrf_secret), ..p_ctx };
        let mut r = std::mem::take(&mut self.res);
        self.c.render_into(&mut r, p_view, v_ctx);
        self.res = r;
    }

    fn not_found(&mut self, p_message: &str) {
        let v_ctx =
            minijinja::context! { title => "404", message => p_message, csrfToken => csrf::create(&self.csrf_secret) };
        self.res.status = 404;
        let mut r = std::mem::take(&mut self.res);
        self.c.render_into(&mut r, "pages/404.html", v_ctx);
        self.res = r;
    }

    fn username(&self) -> Option<String> {
        self.session.get("adminUsername").filter(|v| js_truthy(Some(v))).map(|v| js_interp(Some(v)))
    }

    /// The locals every page gets.
    fn page(&self, p_title: &str) -> minijinja::Value {
        minijinja::context! {
            title => p_title,
            adminUsername => self.username(),
            accountStorageType => self.cfg().get("account_storage_type").cloned().map(|v| js_interp(Some(&v))),
            serversStatusGuid => self.cfg().admin_guid(),
        }
    }

    fn storage(&self) -> String {
        match self.cfg().get("account_storage_type") {
            Some(Value::String(s)) => s.to_lowercase(),
            _ => String::new(),
        }
    }

    /// `account_storage_type !== 'db'` (case-sensitive)
    fn not_sql(&self) -> bool {
        self.cfg().get("account_storage_type") != Some(&json!("db"))
    }
}

/// The router for a request under /admin; p_path is the rest.
pub async fn handle(p_ctx: &Ctx<'_>, p_path: &str) -> Outcome {
    let v_state = &p_ctx.web.admin;
    let v_ua = p_ctx.req.header("user-agent");
    let Some(v_secret) = v_state.secret.clone() else {
        eprintln!("Error: secret option required for sessions");
        let r = Response::error_page(&p_ctx.response().headers, 500, "Error", "secret option required for sessions");
        return Outcome::Done(Reply::Full(r));
    };
    let v_session = v_state.sessions.load(p_ctx.req.cookie(session::cookie_name()).as_deref(), &v_secret);
    let mut v_res = p_ctx.response();
    headers::admin_csp(&mut v_res.headers, v_ua);
    let mut a = A { c: p_ctx, session: v_session, res: v_res, csrf_secret: String::new(), query: p_ctx.req.query() };
    let v_handled = route(&mut a, p_path).await;
    let v_cookie = v_state.sessions.commit(&a.session, &v_secret, v_state.secure_cookie, p_ctx.req.secure);
    let mut r = a.res;
    if let Some(c) = v_cookie {
        // joins an existing set-cookie header (Node keeps one entry per name)
        match r.headers.iter().rposition(|(k, _)| k.eq_ignore_ascii_case("set-cookie")) {
            Some(i) => r.headers.insert(i + 1, ("Set-Cookie".into(), c)),
            None => r.append("Set-Cookie", c),
        }
        // the last setHeader names the entry
        for h in r.headers.iter_mut().filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie")) {
            h.0 = "Set-Cookie".into();
        }
    }
    match v_handled {
        Some(true) => Outcome::Done(Reply::Full(r)),
        Some(false) => Outcome::Next(r.headers),
        None => Outcome::Done(Reply::Hang),
    }
}

fn under_api(p_path: &str) -> bool {
    super::mounted(p_path, "/api").is_some()
}

/// The middleware and routes in order: Some(true) answered, Some(false)
/// fell through, None never answered.
async fn route(a: &mut A<'_, '_>, p_path: &str) -> Option<bool> {
    let mut v_path = p_path.to_string();
    // GUID gate
    if let Some(g) = a.cfg().admin_guid() {
        let v_prefix = format!("/{}", g);
        if v_path == v_prefix || v_path.starts_with(&format!("{}/", v_prefix)) {
            let v_url = format!(
                "{}{}",
                &v_path[v_prefix.len()..],
                if a.req().query_raw.is_empty() { String::new() } else { format!("?{}", a.req().query_raw) }
            );
            if v_url.is_empty() || v_url == "/" {
                a.redirect("/login");
                return Some(true);
            }
            v_path = v_path[v_prefix.len()..].to_string();
        } else if !a.session.authenticated() {
            a.not_found_plain();
            return Some(true);
        }
    }

    // csurf (cookie mode): the secret cookie, then the token check
    a.csrf_secret = match a.req().cookie(csrf::cookie_name()) {
        Some(v) if !v.is_empty() => v,
        _ => {
            let v = csrf::new_secret();
            a.res.append("set-cookie", format!("{}={}; Path=/", csrf::cookie_name(), super::http::encode_component(&v)));
            v
        }
    };
    let v_method = if a.req().method == "HEAD" { "GET".to_string() } else { a.req().method.clone() };
    if !matches!(v_method.as_str(), "GET" | "OPTIONS") {
        let v_token = [
            field(&a.c.body, "_csrf").cloned(),
            field(&a.query, "_csrf").cloned(),
            a.req().header("csrf-token").map(|h| json!(h)),
            a.req().header("xsrf-token").map(|h| json!(h)),
            a.req().header("x-csrf-token").map(|h| json!(h)),
            a.req().header("x-xsrf-token").map(|h| json!(h)),
        ]
        .into_iter()
        .flatten()
        .find(|v| js_truthy(Some(v)));
        if !csrf::verify(&a.csrf_secret, v_token.as_ref().and_then(Value::as_str)) {
            if v_path.starts_with("/api/") {
                a.res.status = 403;
                a.fail("Invalid or missing CSRF token");
            } else {
                a.session.set("error", json!("Session expired, please log in again"));
                a.redirect("/login");
            }
            return Some(true);
        }
    }
    let p = v_path.as_str();
    let v_auth = a.session.authenticated();
    macro_rules! auth {
        () => {
            if !v_auth {
                a.redirect("/login");
                return Some(true);
            }
        };
    }
    match v_method.as_str() {
        "GET" if is(p, "/login") => {
            let v_error = a.session.get("error").cloned();
            let v_ctx = minijinja::context! {
                error => v_error.filter(|e| !e.is_null()).map(|e| js_interp(Some(&e))),
                title => "Admin Login",
                adminPath => admin_path(a.cfg(), ""),
            };
            // the route then sets session.error = null, but only after the
            // (synchronous) render saved the session: the message stays
            a.render("admin/login.html", v_ctx);
            return Some(true);
        }
        "POST" if is(p, "/login") => {
            let v_limiter = &a.c.web.admin.login_limiter;
            let v_hit = v_limiter.hit(&a.req().ip);
            a.res.set("X-RateLimit-Limit", v_limiter.limit.to_string());
            a.res.set("X-RateLimit-Remaining", v_limiter.remaining(&v_hit).to_string());
            // express-rate-limit sets Date itself before the reset time
            a.res.set("Date", super::http::http_date(now_ms()));
            a.res.set("X-RateLimit-Reset", ((v_hit.reset_ms + 999) / 1000).to_string());
            if v_hit.limited {
                a.res.status = 429;
                a.res.set("Retry-After", seconds_left(v_hit.reset_ms).to_string());
                a.json(json!({ "error": "Too many login attempts, please try again later" }));
                return Some(true);
            }
            login(a);
            return Some(true);
        }
        "POST" if is(p, "/logout") => {
            a.c.web.admin.sessions.destroy(&mut a.session);
            a.redirect("/login");
            return Some(true);
        }
        "GET" => {
            let v_pages = [
                ("/dashboard", "admin/dashboard.html", "Admin Dashboard"),
                ("/users", "admin/users.html", "User Management"),
                ("/servers", "admin/servers.html", "Server Status"),
                ("/sql-management", "admin/sql-management.html", "Teams & Logins Management"),
            ];
            if let Some((v_route, v_view, v_title)) = v_pages.iter().find(|(r, _, _)| is(p, r)) {
                auth!();
                let mut v_ctx = a.page(v_title);
                match *v_route {
                    "/dashboard" => {
                        v_ctx = minijinja::context! { serverVersion => crate::VERSION, ..v_ctx };
                        // adminUsername without `|| null`
                        let v_user = a.session.get("adminUsername").map(|v| js_interp(Some(v)));
                        v_ctx = minijinja::context! { adminUsername => v_user, ..v_ctx };
                    }
                    "/users" | "/sql-management" => {
                        let v_port = a.cfg().get("server_port").filter(|v| js_truthy(Some(v))).cloned();
                        v_ctx =
                            minijinja::context! { authServerPort => minijinja::Value::from_serialize(v_port), ..v_ctx };
                    }
                    _ => {}
                }
                a.render(v_view, v_ctx);
                return Some(true);
            }
        }
        _ => {}
    }

    if under_api(p) {
        let v_limiter = &a.c.web.admin.api_limiter;
        let v_hit = v_limiter.hit(&a.req().ip);
        a.res.set("RateLimit-Policy", format!("{};w={}", v_limiter.limit, v_limiter.window_ms / 1000));
        a.res.set("RateLimit-Limit", v_limiter.limit.to_string());
        a.res.set("RateLimit-Remaining", v_limiter.remaining(&v_hit).to_string());
        a.res.set("RateLimit-Reset", seconds_left(v_hit.reset_ms).to_string());
        if v_hit.limited {
            a.res.status = 429;
            a.res.set("Retry-After", seconds_left(v_hit.reset_ms).to_string());
            a.json(json!({ "error": 1, "errorMessage": "Too many API requests, please slow down." }));
            return Some(true);
        }
        if let Some(v) = api(a, p, &v_method).await {
            return v;
        }
    }

    if v_method == "GET" {
        if is(p, "/terminal") {
            auth!();
            if a.cfg().is_false("webadmin_terminal_enabled") {
                a.not_found("Not found.");
                return Some(true);
            }
            let v_ctx = a.page("Web Terminal");
            a.render("admin/terminal.html", v_ctx);
            return Some(true);
        }
        if is(p, "/wiki") {
            auth!();
            let v_pages = super::wiki::pages(&a.c.web.root);
            let v_ctx = minijinja::context! {
                wikiPages => minijinja::Value::from_serialize(&v_pages),
                wikiContent => Option::<String>::None,
                activeWikiPage => Option::<String>::None,
                ..a.page("Wiki / Help")
            };
            a.render("admin/wiki.html", v_ctx);
            return Some(true);
        }
        if let Some(v_name) = param(p, "/wiki/images/", "") {
            auth!();
            let Ok(v_name) = v_name else { return Some(bad_param(a, p)) };
            match super::wiki::image(a.req(), &a.c.web.root, &v_name, a.res.headers.clone()) {
                Some(r) => a.res = r,
                None => a.not_found("Not found."),
            }
            return Some(true);
        }
        if let Some(v_name) = param(p, "/wiki/", "") {
            auth!();
            let Ok(v_name) = v_name else { return Some(bad_param(a, p)) };
            let v_pages = super::wiki::pages(&a.c.web.root);
            let Some(v_html) = super::wiki::render(&a.c.web.root, &v_name, a.cfg().admin_guid().as_deref()) else {
                a.not_found("Wiki page not found.");
                return Some(true);
            };
            let v_title = v_pages
                .iter()
                .find(|p| p["name"] == json!(v_name))
                .map(|p| js_interp(Some(&p["title"])))
                .unwrap_or_else(|| v_name.clone());
            let v_ctx = minijinja::context! {
                wikiPages => minijinja::Value::from_serialize(&v_pages),
                wikiContent => minijinja::Value::from_safe_string(v_html),
                activeWikiPage => v_name,
                ..a.page(&v_title)
            };
            a.render("admin/wiki.html", v_ctx);
            return Some(true);
        }
    }
    Some(false)
}

impl A<'_, '_> {
    /// The GUID gate's 404 (before CSRF: no token in the locals).
    fn not_found_plain(&mut self) {
        let v_ctx = minijinja::context! { title => "404", message => "Not found." };
        self.res.status = 404;
        let mut r = std::mem::take(&mut self.res);
        self.c.render_into(&mut r, "pages/404.html", v_ctx);
        self.res = r;
    }
}

/// decodeURIComponent failed on a route parameter: Express's 400. The
/// parameter is the last path segment(s) the route captured.
fn bad_param(a: &mut A<'_, '_>, p_path: &str) -> bool {
    let v_headers = a.res.headers.clone();
    let v_trimmed = if p_path.len() > 1 { p_path.strip_suffix('/').unwrap_or(p_path) } else { p_path };
    let v_param = v_trimmed
        .trim_end_matches("/enabled")
        .trim_end_matches("/query-udp-proxies")
        .trim_end_matches("/udp-proxy-state")
        .trim_end_matches("/user-traffic-state")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    eprintln!("URIError: Failed to decode param '{}'", v_param);
    a.res = Response::error_page(&v_headers, 400, "URIError", &format!("Failed to decode param '{}'", v_param));
    true
}

/// POST /login
fn login(a: &mut A<'_, '_>) {
    let v_user = a.body("username");
    let v_pass = a.body("password");
    let v_ip = a.req().ip.clone();
    let v_fail = |a: &mut A<'_, '_>, p_msg: &str| {
        a.session.set("error", json!(p_msg));
        a.redirect("/login");
    };
    match valid_username(v_user.as_ref()) {
        Ok(true) => {}
        Ok(false) => return v_fail(a, "Invalid username format"),
        Err(e) => {
            eprintln!("TypeError: {}", e);
            let v_headers = a.res.headers.clone();
            a.res = Response::error_page(&v_headers, 500, "TypeError", &e);
            return;
        }
    }
    if !valid_password(v_pass.as_ref()) {
        return v_fail(a, "Invalid password format");
    }
    let v_key = format!("{}:{}", v_ip, js_interp(v_user.as_ref()));
    let v_lockout = &a.c.web.admin.lockout;
    if v_lockout.locked(&v_key) {
        return v_fail(a, "Account temporarily locked due to too many failed attempts. Please try again later.");
    }
    let v_admin = a.cfg().get("admin_username").cloned();
    let v_stored = a.cfg().get("admin_password").cloned();
    if !js_strict_eq(v_user.as_ref(), v_admin.as_ref()) {
        v_lockout.record(&v_key);
        return v_fail(a, "Invalid username or password");
    }
    let v_hashed = is_bcrypt_hash(v_stored.as_ref());
    let v_match = if v_hashed {
        match (v_pass.as_ref(), v_stored.as_ref()) {
            (Some(Value::String(p)), Some(Value::String(h))) => h.len() == 60 && bcrypt::verify(p, h).unwrap_or(false),
            _ => false,
        }
    } else {
        js_strict_eq(v_pass.as_ref(), v_stored.as_ref())
    };
    if !v_match {
        v_lockout.record(&v_key);
        return v_fail(a, "Invalid username or password");
    }
    if !v_hashed {
        eprintln!(
            "{}[WARN] admin_password is stored in plaintext. Use $$HASH$$('...') in server.config and restart to hash it.{}",
            c::FG_YELLOW,
            c::RESET
        );
    }
    v_lockout.clear(&v_key);
    a.c.web.admin.sessions.regenerate(&mut a.session);
    a.session.set("adminAuthenticated", json!(true));
    if let Some(u) = v_user {
        a.session.set("adminUsername", u);
    }
    a.redirect("/dashboard");
}

/// `x.trim()` for a value the route trims (Err: no trim()).
fn trim(p_value: &Value, p_name: &str) -> Result<String, String> {
    match p_value {
        Value::String(s) => Ok(crate::validator::js_trim(s).to_string()),
        _ => Err(format!("{}.trim is not a function", p_name)),
    }
}

/// `(code && code.trim() !== '') ? code.trim() : otherwise`
fn given_code(p_code: Option<&Value>, p_name: &str) -> Result<Option<String>, String> {
    match p_code.filter(|c| js_truthy(Some(c))) {
        None => Ok(None),
        Some(c) => {
            let t = trim(c, p_name)?;
            Ok(if t.is_empty() { None } else { Some(t) })
        }
    }
}

type Res<T> = Result<T, String>;

/// The API routes behind the limiter; None when none matches.
async fn api(a: &mut A<'_, '_>, p: &str, p_method: &str) -> Option<Option<bool>> {
    let v_auth = a.session.authenticated();
    macro_rules! auth {
        () => {
            if !v_auth {
                a.redirect("/login");
                return Some(Some(true));
            }
        };
    }
    macro_rules! param_or_400 {
        ($e:expr) => {
            match $e {
                Ok(v) => v,
                Err(()) => return Some(Some(bad_param(a, p))),
            }
        };
    }
    let v_accounts = &a.c.auth().accounts;
    match p_method {
        "GET" if is(p, "/api/users") => {
            auth!();
            println!("[DEBUG] Fetching users for admin: {}", js_interp(a.session.get("adminUsername")));
            println!("[DEBUG] Using global.db_users: {}", v_accounts.file.is_some());
            let v_res = (|| -> Res<Value> {
                let mut v_users = v_accounts.fdb("fn_get_all_users_including_admins")?.all_users_including_admins()?;
                if let Value::Object(m) = &mut v_users {
                    for (_, u) in m.iter_mut() {
                        if let Value::Object(um) = u {
                            um.shift_remove("AccessCode");
                            um.shift_remove("pwd");
                            um.insert("hasAccessCode".into(), json!(true));
                        }
                    }
                    println!("[DEBUG] Users fetched: {}", m.len());
                }
                Ok(json!({ "error": 0, "users": v_users }))
            })();
            match v_res {
                Ok(v) => a.json(v),
                Err(e) => {
                    eprintln!("[ERROR] Error fetching users: TypeError: {}", e);
                    eprintln!("[ERROR] Stack: TypeError: {}", e);
                    a.fail("Failed to fetch users");
                }
            }
            return Some(Some(true));
        }
        "POST" if is(p, "/api/users") => {
            auth!();
            let v_res = (|| -> Res<Value> {
                let (v_email, v_sid, v_prm) = (a.body("email"), a.body("sid"), a.body("prm"));
                if !js_truthy(v_email.as_ref()) || !js_truthy(v_sid.as_ref()) || !js_truthy(v_prm.as_ref()) {
                    return Ok(json!({ "error": 1, "errorMessage": "Missing required fields" }));
                }
                let v_given = given_code(a.body("accessCode").as_ref(), "accessCode")?;
                let v_generated = v_given.clone().unwrap_or_else(crate::accounts::generate_access_code);
                let v_isadmin = a.body("isadmin").filter(|v| js_truthy(Some(v))).unwrap_or(json!(false));
                let v_email = v_email.unwrap();
                let mut v_db = v_accounts.fdb("fn_get_record")?;
                let v_existing = v_db.get_record(&v_email)?;
                let (v_code, v_reply, v_default) = match v_existing {
                    Some(e) => {
                        let v_final =
                            v_given.map(Value::String).or_else(|| e.get("AccessCode").cloned()).unwrap_or(Value::Null);
                        let v_data = user_data(v_sid, &v_final, v_prm, v_isadmin);
                        (v_final, v_db.update_record(&v_email, &v_data)?, "Failed to update user")
                    }
                    None => {
                        let v_data = user_data(v_sid, &json!(v_generated), v_prm, v_isadmin);
                        (json!(v_generated), v_db.add_record(&v_email, &v_data)?, "Failed to create user")
                    }
                };
                Ok(user_reply(&v_reply, v_code, v_default))
            })();
            match v_res {
                Ok(v) => a.json(v),
                Err(e) => {
                    eprintln!("Error creating user: TypeError: {}", e);
                    a.fail("Failed to create user");
                }
            }
            return Some(Some(true));
        }
        "PUT" => {
            if let Some(v_email) = param(p, "/api/users/", "/enabled") {
                auth!();
                let v_email = json!(param_or_400!(v_email));
                let v_enabled = a.body("enabled");
                let Some(Value::Bool(v_enabled)) = v_enabled else {
                    a.fail("Missing or invalid field: enabled");
                    return Some(Some(true));
                };
                if a.storage() == "db" {
                    let Some(v_db) = &v_accounts.db else {
                        a.fail("Database not connected");
                        return Some(Some(true));
                    };
                    match v_db
                        .run("UPDATE logins SET Enabled = ? WHERE LoginName = ?", &[json!(v_enabled as i32), v_email])
                    {
                        Err(e) => {
                            eprintln!("Error updating login enabled state: {}", e.inspect());
                            a.fail("Failed to update user");
                        }
                        Ok(r) if r.changes == 0 => a.fail("User not found"),
                        Ok(_) => a.json(json!({ "error": 0, "enabled": v_enabled })),
                    }
                    return Some(Some(true));
                }
                let v_res = match &v_accounts.file {
                    None => {
                        a.fail("User storage not available");
                        return Some(Some(true));
                    }
                    Some(_) => v_accounts
                        .fdb("fn_set_login_enabled")
                        .and_then(|mut d| d.set_login_enabled(&v_email, v_enabled)),
                };
                match v_res {
                    Ok(r) if js_strict_eq(r.get(ERROR), Some(&json!(ERROR_NON))) => {
                        a.json(json!({ "error": 0, "enabled": v_enabled }))
                    }
                    Ok(r) => a.json(error_reply(&r, "Failed to update user")),
                    Err(e) => {
                        eprintln!("Error updating user enabled state: TypeError: {}", e);
                        a.fail("Failed to update user");
                    }
                }
                return Some(Some(true));
            }
            if let Some(v_email) = param(p, "/api/users/", "") {
                auth!();
                let v_email = json!(param_or_400!(v_email));
                let v_res = (|| -> Res<Value> {
                    let (v_sid, v_prm) = (a.body("sid"), a.body("prm"));
                    if !js_truthy(v_sid.as_ref()) || !js_truthy(v_prm.as_ref()) {
                        return Ok(json!({ "error": 1, "errorMessage": "Missing required fields" }));
                    }
                    let mut v_db = v_accounts.fdb("fn_get_record")?;
                    let Some(v_existing) = v_db.get_record(&v_email)? else {
                        return Ok(json!({ "error": 1, "errorMessage": "User not found" }));
                    };
                    let v_final = given_code(a.body("accessCode").as_ref(), "accessCode")?
                        .map(Value::String)
                        .or_else(|| v_existing.get("AccessCode").cloned())
                        .unwrap_or(Value::Null);
                    let v_isadmin = a.body("isadmin").filter(|v| js_truthy(Some(v))).unwrap_or(json!(false));
                    let v_reply = v_db.update_record(&v_email, &user_data(v_sid, &v_final, v_prm, v_isadmin))?;
                    Ok(user_reply(&v_reply, v_final, "Failed to update user"))
                })();
                match v_res {
                    Ok(v) => a.json(v),
                    Err(e) => {
                        eprintln!("Error updating user: TypeError: {}", e);
                        a.fail("Failed to update user");
                    }
                }
                return Some(Some(true));
            }
            if let Some(v_id) = param(p, "/api/sql/logins/", "/enabled") {
                auth!();
                let v_id = json!(param_or_400!(v_id));
                if a.not_sql() {
                    a.fail("SQL mode not enabled");
                    return Some(Some(true));
                }
                let Some(Value::Bool(v_enabled)) = a.body("enabled") else {
                    a.fail("Missing or invalid field: enabled");
                    return Some(Some(true));
                };
                let Some(v_db) = &v_accounts.db else {
                    a.fail("Database not connected");
                    return Some(Some(true));
                };
                match v_db.run("UPDATE logins SET Enabled = ? WHERE LoginID = ?", &[json!(v_enabled as i32), v_id]) {
                    Err(e) => {
                        eprintln!("Error updating login enabled state: {}", e.inspect());
                        a.fail("Failed to update login");
                    }
                    Ok(r) if r.changes == 0 => a.fail("Login not found"),
                    Ok(_) => a.json(json!({ "error": 0, "enabled": v_enabled })),
                }
                return Some(Some(true));
            }
        }
        "DELETE" => {
            if let Some(v_email) = param(p, "/api/users/", "") {
                auth!();
                let v_email = json!(param_or_400!(v_email));
                match v_accounts.fdb("fn_delete_record").and_then(|mut d| d.delete_record(&v_email)) {
                    Ok(()) => a.json(json!({ "error": 0 })),
                    Err(e) => {
                        eprintln!("Error deleting user: TypeError: {}", e);
                        a.fail("Failed to delete user");
                    }
                }
                return Some(Some(true));
            }
            if let Some(v_id) = param(p, "/api/sql/teams/", "") {
                auth!();
                let v_id = json!(param_or_400!(v_id));
                sql_simple(a, "DELETE FROM teams WHERE TeamID = ?", &[v_id], "deleting team", "Failed to delete team");
                return Some(Some(true));
            }
            if let Some(v_id) = param(p, "/api/sql/logins/", "") {
                auth!();
                let v_id = json!(param_or_400!(v_id));
                sql_simple(
                    a,
                    "DELETE FROM logins WHERE LoginID = ?",
                    &[v_id],
                    "deleting login",
                    "Failed to delete login",
                );
                return Some(Some(true));
            }
        }
        "POST" if is(p, "/api/verify-login") => {
            auth!();
            let (v_login, v_code) = (a.body("loginId"), a.body("accessCode"));
            let v_ok_fields = matches!(&v_login, Some(Value::String(s)) if !crate::validator::js_trim(s).is_empty())
                && matches!(&v_code, Some(Value::String(s)) if !crate::validator::js_trim(s).is_empty());
            if !v_ok_fields {
                a.fail("Missing required fields");
                return Some(Some(true));
            }
            let v_login = crate::validator::js_trim(v_login.as_ref().unwrap().as_str().unwrap()).to_string();
            let v_code = crate::validator::js_trim(v_code.as_ref().unwrap().as_str().unwrap()).to_string();
            let v_matched = |m: bool| {
                let mut v = json!({ "error": if m { 0 } else { 1 } });
                if !m {
                    v["errorMessage"] = json!("Access code does not match this login.");
                }
                v
            };
            match a.storage().as_str() {
                "file" => {
                    let v_record = match &v_accounts.file {
                        Some(_) => {
                            v_accounts.fdb("fn_get_record").and_then(|d| d.get_record(&json!(v_login))).ok().flatten()
                        }
                        None => None,
                    };
                    let m = v_record.map(|r| verify(Some(&v_code), r.get("AccessCode"))).unwrap_or(false);
                    a.json(v_matched(m));
                }
                "db" => {
                    let Some(v_db) = &v_accounts.db else {
                        a.fail("Database not connected");
                        return Some(Some(true));
                    };
                    match v_db.get("SELECT AccessCode FROM logins WHERE LoginName = ?", &[json!(v_login)]) {
                        Err(e) => {
                            eprintln!("Error verifying login: {}", e.inspect());
                            a.fail("Failed to verify login");
                        }
                        Ok(row) => {
                            let m = row.map(|r| verify(Some(&v_code), r.get("AccessCode"))).unwrap_or(false);
                            a.json(v_matched(m));
                        }
                    }
                }
                _ => a.fail("Verification is not supported in this storage mode."),
            }
            return Some(Some(true));
        }
        "GET" if is(p, "/api/servers") => {
            auth!();
            match servers_json(&a.c.auth().comm, &a.c.auth().sessions) {
                Ok(v) => a.json(json!({ "error": 0, "servers": v })),
                Err(e) => {
                    eprintln!("Error fetching server status: {}", e);
                    a.fail("Failed to fetch server status");
                }
            }
            return Some(Some(true));
        }
        "POST" => {
            for (v_suffix, v_kind) in [("/query-udp-proxies", 0), ("/udp-proxy-state", 1), ("/user-traffic-state", 2)] {
                let Some(v_guid) = param(p, "/api/servers/", v_suffix) else { continue };
                auth!();
                let v_guid = param_or_400!(v_guid);
                return Some(Some(server_command(a, &v_guid, v_kind).await));
            }
            if is(p, "/api/sql/teams") {
                auth!();
                if a.not_sql() {
                    a.fail("SQL mode not enabled");
                    return Some(Some(true));
                }
                let v_params: Vec<Value> = ["teamName", "email", "instanceLimit", "enabled"]
                    .iter()
                    .map(|k| a.body(k).unwrap_or(Value::Null))
                    .collect();
                let Some(v_db) = &v_accounts.db else {
                    a.fail("Database not connected");
                    return Some(Some(true));
                };
                match v_db
                    .run("INSERT INTO teams (TeamName, Email, InstanceLimit, Enabled) VALUES (?, ?, ?, ?)", &v_params)
                {
                    Err(e) => {
                        eprintln!("Error creating team: {}", e.inspect());
                        a.fail("Failed to create team");
                    }
                    Ok(r) => a.json(json!({ "error": 0, "teamId": r.last_id })),
                }
                return Some(Some(true));
            }
            if is(p, "/api/sql/logins") {
                auth!();
                if a.not_sql() {
                    a.fail("SQL mode not enabled");
                    return Some(Some(true));
                }
                let Some(v_db) = &v_accounts.db else {
                    a.fail("Database not connected");
                    return Some(Some(true));
                };
                let v_res = (|| -> Res<Value> {
                    let v_name = a.body("loginName");
                    if !valid_username(v_name.as_ref())? {
                        return Ok(json!({ "error": 1, "errorMessage": "Invalid login name" }));
                    }
                    let v_code = match a.body("accessCode").filter(|c| js_truthy(Some(c))) {
                        Some(c) if !trim(&c, "finalAccessCode")?.is_empty() => c,
                        _ => json!(crate::accounts::generate_access_code()),
                    };
                    let v_text = js_to_string(&v_code);
                    let v_stored =
                        if password::is_hashed(&v_text) { v_text } else { password::hash(&v_text).unwrap_or_default() };
                    let v_prm = crate::perm::to_int(a.body("permissions").as_ref()).unwrap_or(Value::Null);
                    let v_params = [
                        a.body("teamId").unwrap_or(Value::Null),
                        v_name.unwrap_or(Value::Null),
                        json!(v_stored),
                        v_prm,
                        a.body("isAdmin").unwrap_or(Value::Null),
                    ];
                    Ok(match v_db.run("INSERT INTO logins (TeamID, LoginName, AccessCode, Permissions, IsAdmin) VALUES (?, ?, ?, ?, ?)", &v_params) {
                        Err(e) => {
                            eprintln!("Error creating login: {}", e.inspect());
                            json!({ "error": 1, "errorMessage": "Failed to create login" })
                        }
                        Ok(r) => json!({ "error": 0, "loginId": r.last_id, "accessCode": v_code }),
                    })
                })();
                match v_res {
                    Ok(v) => a.json(v),
                    Err(e) => {
                        eprintln!("Error in POST /api/sql/logins: TypeError: {}", e);
                        a.fail("Failed to create login");
                    }
                }
                return Some(Some(true));
            }
        }
        "GET" if is(p, "/api/sql/teams") => {
            auth!();
            sql_teams(a);
            return Some(Some(true));
        }
        "GET" if is(p, "/api/sql/stats") => {
            auth!();
            if a.not_sql() {
                a.fail("SQL mode not enabled");
                return Some(Some(true));
            }
            let Some(v_db) = &v_accounts.db else {
                a.fail("Database not connected");
                return Some(Some(true));
            };
            let v_logins = v_db.get("SELECT COUNT(*) as total FROM logins", &[]);
            let v_teams = v_db.get("SELECT COUNT(*) as total FROM teams", &[]);
            match (v_logins, v_teams) {
                (Err(e), _) => {
                    eprintln!("Error counting logins: {}", e.inspect());
                    a.fail("Failed to get stats");
                }
                (_, Err(e)) => {
                    eprintln!("Error counting teams: {}", e.inspect());
                    a.fail("Failed to get stats");
                }
                (Ok(l), Ok(t)) => {
                    let v_l = l.map(|r| r["total"].clone()).unwrap_or(Value::Null);
                    let v_t = t.map(|r| r["total"].clone()).unwrap_or(Value::Null);
                    a.json(json!({ "error": 0, "totalLogins": v_l, "totalTeams": v_t }));
                }
            }
            return Some(Some(true));
        }
        _ => {}
    }
    None
}

/// `{ sid, AccessCode, prm, isadmin }`
fn user_data(p_sid: Option<Value>, p_code: &Value, p_prm: Option<Value>, p_isadmin: Value) -> Value {
    json!({ "sid": p_sid.unwrap_or(Value::Null), "AccessCode": p_code, "prm": p_prm.unwrap_or(Value::Null), "isadmin": p_isadmin })
}

fn error_reply(p_reply: &Value, p_default: &str) -> Value {
    let v_msg = p_reply.get(ERROR_MSG).filter(|m| js_truthy(Some(m))).cloned().unwrap_or(json!(p_default));
    let mut v = json!({});
    set_field_opt(&mut v, "error", p_reply.get(ERROR).cloned());
    v["errorMessage"] = v_msg;
    v
}

fn user_reply(p_reply: &Value, p_code: Value, p_default: &str) -> Value {
    if js_strict_eq(p_reply.get(ERROR), Some(&json!(ERROR_NON))) {
        let mut v = json!({ "error": 0 });
        set_field_opt(&mut v, "AccessCode", Some(p_code).filter(|c| !is_undefined(c)));
        v
    } else {
        error_reply(p_reply, p_default)
    }
}

/// A db.run route answering `{error: 0}`.
fn sql_simple(a: &mut A<'_, '_>, p_sql: &str, p_params: &[Value], p_what: &str, p_fail: &str) {
    if a.not_sql() {
        a.fail("SQL mode not enabled");
        return;
    }
    let Some(v_db) = &a.c.auth().accounts.db else {
        a.fail("Database not connected");
        return;
    };
    match v_db.run(p_sql, p_params) {
        Err(e) => {
            eprintln!("Error {}: {}", p_what, e.inspect());
            a.fail(p_fail);
        }
        Ok(_) => a.json(json!({ "error": 0 })),
    }
}

/// GET /api/sql/teams (paginated, searchable, sortable)
fn sql_teams(a: &mut A<'_, '_>) {
    if a.not_sql() {
        a.fail("SQL mode not enabled");
        return;
    }
    let Some(v_db) = a.c.auth().accounts.db.clone() else {
        a.fail("Database not connected");
        return;
    };
    let q = |k: &str| field(&a.query, k).cloned();
    let v_int = |k: &str, d: i64| match js_parse_int(q(k).as_ref()) {
        Some(i) if i != 0 => i,
        _ => d,
    };
    let v_page = v_int("page", 1).max(1);
    let v_limit = v_int("limit", 20).clamp(1, 100);
    let v_offset = (v_page - 1) * v_limit;
    let v_text = |k: &str, d: &str| -> Res<String> {
        match q(k).filter(|v| js_truthy(Some(v))) {
            None => Ok(d.to_string()),
            Some(Value::String(s)) => Ok(crate::validator::js_trim(&s).to_string()),
            Some(_) => Err(format!("(req.query.{} || \"\").trim is not a function", k)),
        }
    };
    let v_res = (|| -> Res<Value> {
        let v_search = v_text("search", "")?;
        let v_sort_by = v_text("sortBy", "TeamID")?;
        let v_dir = if v_text("sortDir", "asc")?.to_lowercase() == "desc" { "DESC" } else { "ASC" };
        let v_allowed = ["TeamID", "TeamName", "Email", "CreatedAt", "UpdatedAt", "InstanceLimit", "Enabled"];
        let v_column = if v_allowed.contains(&v_sort_by.as_str()) { v_sort_by.as_str() } else { "TeamID" };
        let (v_where, v_count_params, v_query_params) = if !v_search.is_empty() {
            let v_num = js_parse_int(Some(&json!(v_search)));
            match v_num {
                Some(n) if v_search == n.to_string() => {
                    (" WHERE TeamID = ?", vec![json!(n)], vec![json!(n), json!(v_limit), json!(v_offset)])
                }
                _ => {
                    let v_like = json!(format!("%{}%", v_search));
                    (
                        " WHERE TeamName LIKE ? OR Email LIKE ?",
                        vec![v_like.clone(), v_like.clone()],
                        vec![v_like.clone(), v_like, json!(v_limit), json!(v_offset)],
                    )
                }
            }
        } else {
            ("", vec![], vec![json!(v_limit), json!(v_offset)])
        };
        let v_count = match v_db.get(&format!("SELECT COUNT(*) as total FROM teams{}", v_where), &v_count_params) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Error counting teams: {}", e.inspect());
                return Ok(json!({ "error": 1, "errorMessage": "Failed to fetch teams" }));
            }
        };
        let v_total = v_count.map(|r| r["total"].clone()).unwrap_or(Value::Null);
        let v_pages = crate::jsv::num((v_total.as_f64().unwrap_or(f64::NAN) / v_limit as f64).ceil());
        let v_sql = format!("SELECT * FROM teams{} ORDER BY {} {} LIMIT ? OFFSET ?", v_where, v_column, v_dir);
        let v_teams = match v_db.all(&v_sql, &v_query_params) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Error fetching teams: {}", e.inspect());
                return Ok(json!({ "error": 1, "errorMessage": "Failed to fetch teams" }));
            }
        };
        let mut v_out = Vec::new();
        for t in v_teams {
            let v_logins =
                match v_db.all("SELECT * FROM logins WHERE TeamID = ? ORDER BY LoginID", &[t["TeamID"].clone()]) {
                    Ok(l) => l,
                    Err(e) => {
                        eprintln!("Error fetching logins for team: {} {}", js_interp(Some(&t["TeamID"])), e.inspect());
                        vec![]
                    }
                };
            let mut m: Map<String, Value> = t.as_object().cloned().unwrap_or_default();
            m.insert("logins".into(), Value::Array(v_logins));
            v_out.push(Value::Object(m));
        }
        Ok(
            json!({ "error": 0, "teams": v_out, "total": v_total, "page": v_page, "limit": v_limit, "totalPages": v_pages }),
        )
    })();
    match v_res {
        Ok(v) => a.json(v),
        Err(e) => {
            eprintln!("Error in /api/sql/teams: TypeError: {}", e);
            a.fail("Failed to fetch teams");
        }
    }
}

/// Object.prototype's properties: `list[guid]` finds them (then fails).
const PROTO_KEYS: [&str; 12] = [
    "constructor",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toString",
    "valueOf",
    "toLocaleString",
];

/// The three per-server commands; p_kind: 0 query proxies, 1 proxy state,
/// 2 unit traffic state.
async fn server_command(a: &mut A<'_, '_>, p_guid: &str, p_kind: u8) -> bool {
    let v_fail_msg =
        ["Failed to query UDP proxies", "Failed to set UDP proxy state", "Failed to set user traffic state"]
            [p_kind as usize];
    let v_comm = a.c.auth().comm.clone();
    let Some(v_server) = v_comm.server(p_guid) else {
        if PROTO_KEYS.contains(&p_guid) {
            let v_what =
                ["querying UDP proxies", "setting UDP proxy state", "setting user traffic state"][p_kind as usize];
            eprintln!("Error {}: TypeError: Cannot read properties of undefined (reading 'm_isOnline')", v_what);
            a.fail(v_fail_msg);
        } else {
            a.fail("Server not found");
        }
        return true;
    };
    let v_name = a.body("name");
    let v_blocked = a.body("blocked") == Some(json!(true));
    let (v_tx, v_rx) = tokio::sync::oneshot::channel();
    match p_kind {
        0 => v_comm.request_udp_proxies(&v_server, v_tx),
        _ => {
            let v_name_ok = matches!(&v_name, Some(Value::String(s)) if !crate::validator::js_trim(s).is_empty());
            if !v_name_ok {
                a.fail("Missing or invalid fields (name, blocked)");
                return true;
            }
            let v_name = v_name.unwrap();
            if p_kind == 1 {
                let v_account = a
                    .body("account")
                    .filter(|v| matches!(v, Value::String(s) if !crate::validator::js_trim(s).is_empty()));
                v_comm.set_udp_proxy_blocked(&v_server, &v_name, v_blocked, v_account.as_ref(), v_tx);
            } else {
                v_comm.set_unit_traffic_blocked(&v_server, &v_name, v_blocked, v_tx);
            }
        }
    }
    let v_list_key = if p_kind == 2 { "units" } else { "proxies" };
    match v_rx.await {
        Ok(Ok((v_list, v_d))) => {
            let v_not_applied = p_kind != 0 && js_truthy(Some(&v_d)) && v_d.get("applied") == Some(&json!(false));
            if v_not_applied {
                let v_msg = if p_kind == 1 { "Proxy not found on server" } else { "Unit not found on server" };
                a.json(json!({ "error": 1, "errorMessage": v_msg, v_list_key: v_list }));
            } else {
                a.json(json!({ "error": 0, v_list_key: v_list }));
            }
        }
        _ => a.fail("Server did not reply (offline or timed out)"),
    }
    true
}

/// GET /api/servers: each comm server with its accounts resolved to the
/// login cards that own them.
fn servers_json(p_comm: &crate::comm::CommManager, p_sessions: &Sessions) -> Res<Vec<Value>> {
    let mut v_out = Vec::new();
    for (_, v_info) in p_comm.servers() {
        let s = &v_info["m_server"];
        let v_raw = crate::comm::field_or(s, "m_accounts", "accounts").cloned().unwrap_or(json!([]));
        let v_details = crate::comm::field_or(s, "m_accountDetails", "accountDetails").cloned().unwrap_or(json!({}));
        let Value::Array(v_raw) = v_raw else {
            return Err("TypeError: rawAccounts.forEach is not a function".into());
        };
        let mut v_accounts = Vec::new();
        for v_account in &v_raw {
            let v_cards = p_sessions.by_account_id(v_account);
            let resolve = |p_unit: Option<&Value>| -> Option<Value> {
                if v_cards.is_empty() {
                    return None;
                }
                if let Some(u) = p_unit {
                    if let Some(r) = u.get("requestId").filter(|r| !r.is_null()) {
                        if let Some(c) = v_cards.iter().find(|c| js_strict_eq(c.get("m_request_id"), Some(r))) {
                            return Some(c.clone());
                        }
                    }
                    if let Some(t) = u.get("actorType").filter(|t| !t.is_null()) {
                        if let Some(c) = v_cards.iter().find(|c| js_strict_eq(c.get("m_actorType"), Some(t))) {
                            return Some(c.clone());
                        }
                    }
                }
                Some(v_cards[0].clone())
            };
            let v_hashed_id = |p_card: &Option<Value>| -> Res<Value> {
                if let Some(sid) = p_card.as_ref().and_then(|c| c.get("m_data")).and_then(|d| d.get("m_sid")) {
                    if !sid.is_null() {
                        return Ok(sid.clone());
                    }
                }
                match v_account {
                    Value::String(a) => Ok(json!(a.strip_suffix("xx").unwrap_or(a))),
                    _ => Err("TypeError: accountId.replace is not a function".into()),
                }
            };
            let v_login = |p_card: &Option<Value>| match p_card {
                Some(c) => c.get("m_login_name").cloned().unwrap_or_else(droneengage_server_common::util::undefined),
                None => json!("Unknown"),
            };
            let v_units =
                v_details.get(js_interp(Some(v_account))).filter(|v| js_truthy(Some(v))).cloned().unwrap_or(json!([]));
            let v_len = match &v_units {
                Value::Array(a) => a.len(),
                Value::String(s) => s.len(),
                _ => 1,
            };
            if v_len == 0 {
                let v_card = resolve(None);
                v_accounts.push(json!({
                    "accountId": v_hashed_id(&v_card)?,
                    "hashedAccountId": v_account,
                    "loginId": v_login(&v_card),
                    "unitName": null,
                    "actorType": "a",
                }));
                continue;
            }
            let Value::Array(v_units) = v_units else {
                return Err("TypeError: unitDetails.forEach is not a function".into());
            };
            for v_unit in &v_units {
                let v_info = match v_unit {
                    Value::String(n) => json!({ "unitName": n, "actorType": "a" }),
                    other => other.clone(),
                };
                if v_info.is_null() {
                    return Err("TypeError: Cannot read properties of null (reading 'requestId')".into());
                }
                let v_card = resolve(Some(&v_info));
                let mut v = json!({
                    "accountId": v_hashed_id(&v_card)?,
                    "hashedAccountId": v_account,
                    "loginId": v_login(&v_card),
                });
                set_field_opt(&mut v, "unitName", v_info.get("unitName").cloned());
                v["actorType"] = v_info.get("actorType").filter(|t| js_truthy(Some(t))).cloned().unwrap_or(json!("a"));
                v["blocked"] = json!(v_info.get("blocked") == Some(&json!(true)));
                v_accounts.push(v);
            }
        }
        let mut v = json!({});
        set_field_opt(&mut v, "serverId", s.get("m_serverId").cloned());
        set_field_opt(&mut v, "commServerGUID", s.get("m_commServerGUID").cloned());
        set_field_opt(&mut v, "isOnline", s.get("m_isOnline").cloned());
        set_field_opt(&mut v, "public_host", s.get("m_serverPublicIP").cloned());
        set_field_opt(&mut v, "serverPort", s.get("m_serverPort").cloned());
        set_field_opt(&mut v, "version", s.get("m_version").cloned());
        v["accounts"] = Value::Array(v_accounts);
        let or = |k: &str, d: Value| s.get(k).filter(|v| js_truthy(Some(v))).cloned().unwrap_or(d);
        v["storageStatus"] = or("m_storageStatus", Value::Null);
        v["udpRelayStatus"] = or("m_udpRelayStatus", Value::Null);
        v["udpProxies"] = or("m_udpProxies", json!([]));
        v["udpProxiesTimestamp"] = or("m_udpProxiesTimestamp", Value::Null);
        v_out.push(v);
    }
    Ok(v_out)
}
