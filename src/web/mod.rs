//! The two Express apps (server.js): the API server on server_port and the
//! views server on webadmin_listening_ip:webadmin_port. Both run the same
//! middleware and routers over shared state (rate limits, admin sessions):
//! helmet v3 and cors headers, CORS preflight, JSON / urlencoded bodies,
//! then the routes of js_router.js in order — the base router (full
//! /w/... and /agent/... paths) at `/`, `<health_utl>/health`, `/public`
//! static files, the /admin router, the base router again under `/w` and
//! `/agent`, and the 404 catch-all. The views server wraps every rendered
//! page in the `template` layout and hosts the web terminal WebSocket.
//!
//! Differences from the Node.js server: the default error page shows the
//! error without the stack trace; static files ignore Range requests.

pub mod admin;
pub mod api;
pub mod headers;
pub mod server;
pub mod terminal;
pub mod wiki;

pub use droneengage_server_common::web::{csrf, http, limiter, session, views};

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use self::http::{Request, Response};
use crate::Auth;
use droneengage_server_common::util::now_ms;

/// How a request is answered.
pub enum Reply {
    Full(Response),
    /// `res.write(body); res.end()`: chunked, no Content-Type.
    Chunked(Response),
    /// Never answered (the JavaScript never calls back).
    Hang,
}

/// The routers' "simple in-memory rate limiter": at most p_max requests
/// per IP in the trailing minute.
pub struct SlidingLimiter {
    m_max: usize,
    m_window_ms: i64,
    m_hits: Mutex<HashMap<String, Vec<i64>>>,
}

impl SlidingLimiter {
    pub fn new(p_max: usize) -> SlidingLimiter {
        SlidingLimiter { m_max: p_max, m_window_ms: 60000, m_hits: Mutex::new(HashMap::new()) }
    }

    /// fn_checkRateLimit
    pub fn check(&self, p_ip: &str) -> bool {
        let v_now = now_ms();
        let mut m = self.m_hits.lock().unwrap();
        let mut v_list: Vec<i64> = m.get(p_ip).cloned().unwrap_or_default();
        v_list.retain(|t| *t > v_now - self.m_window_ms);
        if v_list.len() >= self.m_max {
            return false;
        }
        v_list.push(v_now);
        m.insert(p_ip.to_string(), v_list);
        true
    }
}

/// State shared by both servers.
pub struct Web {
    pub auth: Arc<Auth>,
    pub admin: admin::AdminState,
    pub web_login_limit: SlidingLimiter,
    pub web_account_limit: SlidingLimiter,
    pub agent_login_limit: SlidingLimiter,
    pub agent_account_limit: SlidingLimiter,
    pub views: minijinja::Environment<'static>,
    pub root: PathBuf,
}

/// A JSON value for `<%- JSON.stringify(x) %>` of a non-string.
fn json_value(p_value: minijinja::Value) -> minijinja::Value {
    let v: Value = serde_json::to_value(&p_value).unwrap_or(Value::Null);
    minijinja::Value::from_safe_string(droneengage_server_common::util::js_stringify(&v))
}

impl Web {
    pub fn new(p_auth: Arc<Auth>) -> Web {
        let v_root = p_auth.cfg.root().to_path_buf();
        let mut v_views = views::environment(&v_root.join("views"));
        v_views.add_filter("json_value", json_value);
        Web {
            admin: admin::AdminState::new(&p_auth.cfg),
            auth: p_auth,
            web_login_limit: SlidingLimiter::new(10),
            web_account_limit: SlidingLimiter::new(30),
            agent_login_limit: SlidingLimiter::new(10),
            agent_account_limit: SlidingLimiter::new(13),
            views: v_views,
            root: v_root,
        }
    }

    /// res.render(view, ctx), inside the `template` layout on the views server.
    pub fn render(&self, p_view: &str, p_ctx: minijinja::Value, p_layout: bool) -> Result<String, String> {
        let v_html =
            self.views.get_template(p_view).and_then(|t| t.render(p_ctx.clone())).map_err(|e| e.to_string())?;
        if !p_layout {
            return Ok(v_html);
        }
        let v_ctx = minijinja::context! { body => minijinja::Value::from_safe_string(v_html), ..p_ctx };
        self.views.get_template("template.html").and_then(|t| t.render(v_ctx)).map_err(|e| e.to_string())
    }
}

/// One request in an app: the request, its parsed body and whether the
/// app renders inside the layout (the views server).
pub struct Ctx<'a> {
    pub web: &'a Arc<Web>,
    pub req: &'a Request,
    pub body: Value,
    pub layout: bool,
}

impl Ctx<'_> {
    /// A response with this request's helmet and cors headers.
    pub fn response(&self) -> Response {
        Response::with_headers(&headers::base(self.req.header("user-agent")))
    }

    pub fn auth(&self) -> &Auth {
        &self.web.auth
    }

    /// res.status(code).render(view, ctx) onto p_res.
    pub fn render_into(&self, p_res: &mut Response, p_view: &str, p_ctx: minijinja::Value) {
        match self.web.render(p_view, p_ctx, self.layout) {
            Ok(h) => p_res.html(self.req, h),
            Err(e) => {
                eprintln!("Error: {}", e);
                let v_status = 500;
                let v_headers = p_res.headers.clone();
                *p_res = Response::error_page(&v_headers, v_status, "Error", &e);
            }
        }
    }

    /// The `pages/404` page (status 404).
    pub fn page_404(&self, mut p_res: Response, p_title: &str, p_message: &str) -> Response {
        p_res.status = 404;
        self.render_into(&mut p_res, "pages/404.html", minijinja::context! { title => p_title, message => p_message });
        p_res
    }
}

/// An Express route path match: case-insensitive, optional trailing slash.
pub fn is(p_path: &str, p_route: &str) -> bool {
    let v = if p_path.len() > 1 { p_path.strip_suffix('/').unwrap_or(p_path) } else { p_path };
    v.eq_ignore_ascii_case(p_route)
}

/// app.use(prefix, ...): the path inside the mount, if it matches.
pub fn mounted<'a>(p_path: &'a str, p_prefix: &str) -> Option<&'a str> {
    let n = p_prefix.len();
    if p_path.len() < n || !p_path[..n].eq_ignore_ascii_case(p_prefix) {
        return None;
    }
    match p_path.as_bytes().get(n) {
        None => Some("/"),
        Some(b'/') => Some(&p_path[n..]),
        _ => None,
    }
}

/// `/x/:param/y` style match: the decoded parameter. Err(()) for a
/// malformed escape (Express answers 400).
pub fn param(p_path: &str, p_prefix: &str, p_suffix: &str) -> Option<Result<String, ()>> {
    let v = if p_path.len() > 1 { p_path.strip_suffix('/').unwrap_or(p_path) } else { p_path };
    if v.len() < p_prefix.len()
        || !v.is_char_boundary(p_prefix.len())
        || !v[..p_prefix.len()].eq_ignore_ascii_case(p_prefix)
    {
        return None;
    }
    let v_rest = &v[p_prefix.len()..];
    let v_id = if p_suffix.is_empty() {
        v_rest
    } else {
        let i = v_rest.len().checked_sub(p_suffix.len())?;
        if !v_rest.is_char_boundary(i) || !v_rest[i..].eq_ignore_ascii_case(p_suffix) {
            return None;
        }
        &v_rest[..i]
    };
    if v_id.is_empty() || v_id.contains('/') {
        return None;
    }
    Some(http::percent_decode(v_id).ok_or(()))
}

fn mime(p_path: &std::path::Path) -> &'static str {
    match p_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "css" => "text/css; charset=UTF-8",
        "js" | "mjs" => "application/javascript; charset=UTF-8",
        "json" | "map" => "application/json; charset=UTF-8",
        "html" | "htm" => "text/html; charset=UTF-8",
        "txt" => "text/plain; charset=UTF-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "eot" => "application/vnd.ms-fontobject",
        "scss" => "text/x-scss; charset=UTF-8",
        "md" => "text/markdown; charset=UTF-8",
        _ => "application/octet-stream",
    }
}

/// send's file response (sendFile / express.static): ETag, Last-Modified,
/// 304 when fresh. A Content-Type already set is kept.
pub fn serve_file(p_req: &Request, p_path: &std::path::Path, mut r: Response) -> Option<Response> {
    let v_meta = std::fs::metadata(p_path).ok()?;
    if !v_meta.is_file() {
        return None;
    }
    let v_mtime = v_meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let v_etag = format!("W/\"{:x}-{:x}\"", v_meta.len(), v_mtime);
    r.set("Accept-Ranges", "bytes");
    r.set("Cache-Control", "public, max-age=0");
    r.set("Last-Modified", http::http_date(v_mtime));
    r.set("ETag", v_etag.clone());
    if http::fresh(p_req, Some(&v_etag), Some(v_mtime)) {
        r.status = 304;
        return Some(r);
    }
    if r.get("content-type").is_none() {
        r.set("Content-Type", mime(p_path));
    }
    r.set("Content-Length", v_meta.len().to_string());
    r.body = if p_req.method == "HEAD" { Vec::new() } else { std::fs::read(p_path).ok()? };
    Some(r)
}

/// express.static(public) under /public: None falls through.
fn serve_static(p_ctx: &Ctx<'_>, p_rest: &str) -> Option<Response> {
    let p_req = p_ctx.req;
    if p_req.method != "GET" && p_req.method != "HEAD" {
        return None;
    }
    let v_decoded = http::percent_decode(if p_rest.is_empty() { "/" } else { p_rest })?;
    if v_decoded.contains('\0') {
        return None;
    }
    let v_segments: Vec<&str> = v_decoded.split(['/', '\\']).collect();
    if v_segments.iter().any(|s| *s == ".." || (s.starts_with('.') && !s.is_empty())) {
        return None;
    }
    let v_path = p_ctx.web.root.join("public").join(v_decoded.trim_start_matches('/'));
    let v_meta = std::fs::metadata(&v_path).ok()?;
    let mut r = p_ctx.response();
    if v_meta.is_dir() {
        if v_decoded.ends_with('/') {
            return serve_file(p_req, &v_path.join("index.html"), r);
        }
        let v_loc = http::encode_url(&format!(
            "{}/{}",
            p_req.path,
            if p_req.query_raw.is_empty() { String::new() } else { format!("?{}", p_req.query_raw) }
        ));
        let v_body = format!(
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Redirecting</title>\n</head>\n<body>\n<pre>Redirecting to {}</pre>\n</body>\n</html>\n",
            http::escape_html(&v_loc)
        );
        r.status = 301;
        r.set("Content-Type", "text/html; charset=UTF-8");
        r.set("Content-Length", v_body.len().to_string());
        r.set("Content-Security-Policy", "default-src 'none'");
        r.set("X-Content-Type-Options", "nosniff");
        r.set("Location", v_loc);
        r.body = v_body.into_bytes();
        return Some(r);
    }
    serve_file(p_req, &v_path, r)
}

/// The app for one request.
pub async fn handle(p_web: &Arc<Web>, p_req: &Request, p_layout: bool) -> Reply {
    let v_ua = p_req.header("user-agent");
    // cors(): every OPTIONS is a preflight
    if p_req.method == "OPTIONS" {
        let mut r = Response::with_headers(&headers::base(v_ua));
        r.status = 204;
        r.set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
        if let Some(h) = p_req.header("access-control-request-headers") {
            r.set("Vary", "Access-Control-Request-Headers");
            r.set("Access-Control-Allow-Headers", h.to_string());
        }
        r.set("Content-Length", "0");
        return Reply::Full(r);
    }
    let v_body = match http::parse_body(p_req) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("{}: {}", e.name, e.message);
            return Reply::Full(Response::error_page(&headers::base(v_ua), e.status, e.name, &e.message));
        }
    };
    let mut ctx = Ctx { web: p_web, req: p_req, body: v_body, layout: p_layout };
    let v_path = p_req.path.clone();

    if let Some(r) = api::route(&mut ctx, &v_path).await {
        return r;
    }
    let v_health = ctx.auth().cfg.text("health_utl").unwrap_or_else(|| "/h".into());
    if (p_req.method == "GET" || p_req.method == "HEAD") && is(&v_path, &format!("{}/health", v_health)) {
        let mut r = ctx.response();
        let mut v = serde_json::json!({ "status": "OK", "version": crate::VERSION });
        droneengage_server_common::util::set_field_opt(&mut v, "server_id", ctx.auth().cfg.get("server_id").cloned());
        r.json(p_req, &v);
        return Reply::Full(r);
    }
    if let Some(v_rest) = mounted(&v_path, "/public") {
        if let Some(r) = serve_static(&ctx, if v_rest == "/" && v_path.len() == 7 { "" } else { v_rest }) {
            return Reply::Full(r);
        }
    }
    let mut v_admin_headers = None;
    if let Some(v_rest) = mounted(&v_path, "/admin") {
        match admin::handle(&ctx, v_rest).await {
            admin::Outcome::Done(r) => return r,
            admin::Outcome::Next(h) => v_admin_headers = Some(h),
        }
    }
    for v_prefix in ["/w", "/agent"] {
        if let Some(v_rest) = mounted(&v_path, v_prefix) {
            if let Some(r) = api::route(&mut ctx, v_rest).await {
                return r;
            }
        }
    }
    // catch-all
    let mut r = ctx.response();
    if let Some(h) = v_admin_headers {
        r.headers = h;
    }
    let v_original = format!(
        "{}{}",
        p_req.path,
        if p_req.query_raw.is_empty() { String::new() } else { format!("?{}", p_req.query_raw) }
    );
    if v_original.starts_with(crate::constants::WEB_FUNCTION)
        || v_original.starts_with(crate::constants::AGENT_FUNCTION)
    {
        r.status = 404;
        r.json(p_req, &api::not_found_json());
        return Reply::Full(r);
    }
    Reply::Full(ctx.page_404(r, "DE 404", "This page does not exist."))
}
