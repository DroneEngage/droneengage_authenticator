//! The base router (js_router_web.js and js_router_agent.js): web login,
//! captcha challenge, account management and logout under /w, and the
//! agent login, account and hardware commands under /agent. Agent replies
//! are written with res.write + res.end (chunked, no Content-Type).

use serde_json::{json, Value};

use super::{is, Ctx, Reply};
use crate::auth::Outcome;
use crate::constants::*;
use droneengage_server_common::util::{js_stringify, js_truthy, set_field};

/// fn_errorPage(res, true)'s body (status 404).
pub fn not_found_json() -> Value {
    json!({ ERROR: ERROR_NOT_FOUND, ERROR_MSG: "API endpoint not found", COMMAND: "error" })
}

fn has(p_body: &Value, p_key: &str) -> bool {
    p_body.as_object().map(|m| m.contains_key(p_key)).unwrap_or(false)
}

fn get<'a>(p_body: &'a Value, p_key: &str) -> Option<&'a Value> {
    p_body.as_object().and_then(|m| m.get(p_key))
}

/// typeis(req, types): false when the request has no body.
fn req_is(p_ctx: &Ctx<'_>, p_types: &[&str]) -> bool {
    let v_has_body = p_ctx.req.header("transfer-encoding").is_some()
        || p_ctx.req.header("content-length").map(|l| l.trim().parse::<f64>().is_ok()).unwrap_or(false);
    if !v_has_body {
        return false;
    }
    let Some(v_type) = p_ctx.req.header("content-type") else { return false };
    let v_type = v_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    p_types.contains(&v_type.as_str())
}

impl Ctx<'_> {
    fn json_reply(&self, p_status: u16, p_value: &Value) -> Reply {
        let mut r = self.response();
        r.status = p_status;
        r.json(self.req, p_value);
        Reply::Full(r)
    }

    /// res.write(JSON.stringify(data)); res.end()
    fn chunked(&self, p_value: &Value) -> Reply {
        let mut r = self.response();
        r.body = js_stringify(p_value).into_bytes();
        Reply::Chunked(r)
    }

    fn debug(&self, p_text: &str) {
        if self.auth().cfg.is_true("debug_logging") {
            println!("{}", p_text);
        }
    }

    fn info_log(&self, p_message: &str) {
        if let Some(l) = &self.auth().logger {
            l.info(p_message, None, Some(&self.body));
        }
    }
}

/// fn_errorJson
fn error_json(p_ctx: &Ctx<'_>, p_command: &str, p_message: Option<&str>) -> Reply {
    p_ctx.json_reply(
        400,
        &json!({ ERROR: ERROR_INVALID_DATA, ERROR_MSG: p_message.unwrap_or("Invalid or malformed request."), COMMAND: p_command }),
    )
}

fn too_many(p_ctx: &Ctx<'_>, p_command: &str) -> Reply {
    p_ctx.json_reply(
        429,
        &json!({ ERROR: ERROR_UNKNOWN, ERROR_MSG: "Too many requests. Please try again later.", COMMAND: p_command }),
    )
}

fn content_type_error(p_ctx: &Ctx<'_>, p_command: &str) -> Reply {
    p_ctx.json_reply(
        400,
        &json!({
            ERROR: ERROR_UNKNOWN,
            ERROR_MSG: "Invalid Content-Type. Expected application/json or application/x-www-form-urlencoded.",
            COMMAND: p_command
        }),
    )
}

/// The 255 / 128 character limits on account name and access code.
fn length_error(p_ctx: &Ctx<'_>, p_command: &str) -> Option<Reply> {
    let v_len = |k: &str| match get(&p_ctx.body, k) {
        Some(Value::String(s)) => s.encode_utf16().count(),
        _ => 0,
    };
    if v_len(ACCOUNT_NAME_PARAMETER) > 255 {
        return Some(p_ctx.json_reply(
            400,
            &json!({ ERROR: ERROR_UNKNOWN, ERROR_MSG: "Account name too long. Maximum 255 characters.", COMMAND: p_command }),
        ));
    }
    if v_len(ACCESS_CODE_PARAMETER) > 128 {
        return Some(p_ctx.json_reply(
            400,
            &json!({ ERROR: ERROR_UNKNOWN, ERROR_MSG: "Access code too long. Maximum 128 characters.", COMMAND: p_command }),
        ));
    }
    None
}

/// The first reply of an operation, with `cm` set; None: never answered.
async fn first_reply(p_outcome: Outcome) -> Result<Option<Value>, ()> {
    match p_outcome {
        Outcome::Reply(v) => Ok(Some(v)),
        Outcome::Invalid => Err(()),
        Outcome::Never => Ok(None),
        Outcome::Pending(mut rx) => Ok(rx.recv().await),
    }
}

/// The routes; None when nothing matches (the request continues).
pub async fn route(p_ctx: &mut Ctx<'_>, p_path: &str) -> Option<Reply> {
    let v_method = p_ctx.req.method.as_str();
    let v_get = v_method == "GET" || v_method == "HEAD";
    let v_post = v_method == "POST";
    if v_post && is(p_path, "/w/wl") {
        return Some(web_login(p_ctx).await);
    }
    if v_get && is(p_path, "/w/cc") {
        return Some(match p_ctx.auth().altcha.issue_challenge() {
            None => p_ctx.json_reply(
                404,
                &json!({ ERROR: ERROR_NOT_FOUND, ERROR_MSG: "Captcha is disabled on this server.", COMMAND: CAPTCHA_CHALLENGE }),
            ),
            Some(c) => p_ctx.json_reply(200, &c),
        });
    }
    if v_post && is(p_path, "/w/am") {
        return Some(web_account(p_ctx).await);
    }
    if v_post && is(p_path, "/w/wo") {
        return Some(web_logout(p_ctx));
    }
    if v_post && is(p_path, "/agent/al") {
        return Some(agent_login(p_ctx).await);
    }
    if v_post && is(p_path, "/agent/aam") {
        return Some(agent_account(p_ctx).await);
    }
    if v_post && is(p_path, "/agent/ah") {
        return Some(agent_hardware(p_ctx).await);
    }
    None
}

/// POST /w/wl
async fn web_login(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", WEB_LOGIN_COMMAND));
    if !p_ctx.web.web_login_limit.check(&p_ctx.req.ip) {
        return too_many(p_ctx, WEB_LOGIN_COMMAND);
    }
    if !req_is(p_ctx, &["application/json", "application/x-www-form-urlencoded"]) {
        return content_type_error(p_ctx, WEB_LOGIN_COMMAND);
    }
    let b = &p_ctx.body;
    if !has(b, ACCOUNT_NAME_PARAMETER) || !has(b, ACCESS_CODE_PARAMETER) {
        return error_json(p_ctx, WEB_LOGIN_COMMAND, None);
    }
    if let Some(r) = length_error(p_ctx, WEB_LOGIN_COMMAND) {
        return r;
    }
    if !has(b, APP_GROUP_PARAMETER) || !has(b, APP_NAME_PARAMETER) || !has(b, EXTRA_PARAMETER) {
        return error_json(p_ctx, WEB_LOGIN_COMMAND, None);
    }
    let v_outcome = p_ctx.auth().new_login_card(
        get(b, ACCOUNT_NAME_PARAMETER),
        get(b, ACCESS_CODE_PARAMETER),
        "g",
        get(b, APP_GROUP_PARAMETER),
        get(b, APP_NAME_PARAMETER),
        get(b, EXTRA_PARAMETER),
        true,
    );
    let v_outcome = match v_outcome {
        Ok(o) => o,
        Err(_) => return error_json(p_ctx, WEB_LOGIN_COMMAND, None),
    };
    match first_reply(v_outcome).await {
        Err(()) => error_json(
            p_ctx,
            WEB_LOGIN_COMMAND,
            Some("Invalid login request. Login name, access code, group and app fields must be alphanumeric."),
        ),
        Ok(None) => Reply::Hang,
        Ok(Some(mut v)) => {
            set_field(&mut v, COMMAND, json!(WEB_LOGIN_COMMAND));
            let r = p_ctx.json_reply(200, &v);
            p_ctx.debug(&format!("debug ... fn_newLoginCard: {}", js_stringify(&v)));
            r
        }
    }
}

/// POST /w/am
async fn web_account(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", ACCOUNT_MANAGMENT));
    let v_sub = get(&p_ctx.body, SUB_COMMAND).cloned();
    if v_sub.as_ref().map(Value::is_null).unwrap_or(true) {
        return error_json(p_ctx, ACCOUNT_MANAGMENT, None);
    }
    let v_sub_text = v_sub.as_ref().and_then(Value::as_str).unwrap_or("\u{0}");
    let v_read_only = v_sub_text == CMD_GET_TEAM_INFO || v_sub_text == CMD_LIST_TEAM_USERS;
    if !v_read_only && !p_ctx.web.web_account_limit.check(&p_ctx.req.ip) {
        return too_many(p_ctx, ACCOUNT_MANAGMENT);
    }
    let v_team = TEAM_ADMIN_COMMANDS.contains(&v_sub_text);
    if !v_team && get(&p_ctx.body, ACCOUNT_NAME_PARAMETER).map(Value::is_null).unwrap_or(true) {
        return error_json(p_ctx, ACCOUNT_MANAGMENT, None);
    }
    if (v_sub_text == CMD_CREATE_ACCESSCODE || v_sub_text == CMD_REGENERATE_ACCESSCODE)
        && !p_ctx.auth().altcha.verify_payload(get(&p_ctx.body, CAPTCHA_PAYLOAD_PARAMETER))
    {
        return p_ctx.json_reply(
            400,
            &json!({
                ERROR: ERROR_INVALID_DATA,
                ERROR_MSG: "Captcha verification failed. Please solve the captcha and retry.",
                COMMAND: ACCOUNT_MANAGMENT
            }),
        );
    }
    if get(&p_ctx.body, PERMISSION_PARAMETER).map(Value::is_null).unwrap_or(true) {
        set_field(&mut p_ctx.body, PERMISSION_PARAMETER, json!("0xffffffff"));
    }
    let b = &p_ctx.body;
    let v_outcome = p_ctx.auth().account_operation(
        get(b, SUB_COMMAND),
        get(b, ACCOUNT_NAME_PARAMETER),
        get(b, PERMISSION_PARAMETER),
        get(b, ACCESS_CODE_PARAMETER),
        get(b, SESSION_ID),
        get(b, TARGET_LOGIN_PARAMETER),
        get(b, IS_ADMIN_PARAMETER),
        false,
        get(b, RECOVERY_CODE_PARAMETER),
    );
    let Ok(v_outcome) = v_outcome else { return error_json(p_ctx, ACCOUNT_MANAGMENT, None) };
    match first_reply(v_outcome).await {
        Err(()) => error_json(p_ctx, ACCOUNT_MANAGMENT, None),
        Ok(None) => Reply::Hang,
        Ok(Some(mut v)) => {
            set_field(&mut v, COMMAND, json!(ACCOUNT_MANAGMENT));
            p_ctx.json_reply(200, &v)
        }
    }
}

/// POST /w/wo
fn web_logout(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", WEB_LOGOUT_COMMAND));
    let v_session = get(&p_ctx.body, SESSION_ID).cloned();
    if !js_truthy(v_session.as_ref()) {
        return p_ctx.json_reply(
            200,
            &json!({ ERROR: ERROR_SESSION_NOT_FOUND, ERROR_MSG: "Invalid or missing session ID", COMMAND: WEB_LOGOUT_COMMAND }),
        );
    }
    match p_ctx.auth().logout(v_session.as_ref()) {
        Ok(Outcome::Reply(mut v)) => {
            set_field(&mut v, COMMAND, json!(WEB_LOGOUT_COMMAND));
            p_ctx.json_reply(200, &v)
        }
        Ok(_) => p_ctx.json_reply(
            200,
            &json!({ ERROR: ERROR_SESSION_NOT_FOUND, ERROR_MSG: "Session not found or invalid", COMMAND: WEB_LOGOUT_COMMAND }),
        ),
        Err(e) => {
            eprintln!("Logout error: TypeError: {}", e);
            p_ctx.json_reply(
                200,
                &json!({ ERROR: ERROR_UNKNOWN, ERROR_MSG: "Server error during logout", COMMAND: WEB_LOGOUT_COMMAND }),
            )
        }
    }
}

fn agent_not_found(p_ctx: &Ctx<'_>) -> Reply {
    p_ctx.json_reply(404, &not_found_json())
}

/// POST /agent/al
async fn agent_login(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", AGENT_LOGIN_COMMAND));
    if !p_ctx.web.agent_login_limit.check(&p_ctx.req.ip) {
        return too_many(p_ctx, AGENT_LOGIN_COMMAND);
    }
    if !req_is(p_ctx, &["application/json", "application/x-www-form-urlencoded"]) {
        return content_type_error(p_ctx, AGENT_LOGIN_COMMAND);
    }
    p_ctx.info_log(AGENT_LOGIN_COMMAND);
    let b = &p_ctx.body;
    if !has(b, ACCOUNT_NAME_PARAMETER) || !has(b, ACCESS_CODE_PARAMETER) {
        return agent_not_found(p_ctx);
    }
    if let Some(r) = length_error(p_ctx, AGENT_LOGIN_COMMAND) {
        return r;
    }
    if !has(b, APP_GROUP_PARAMETER) || !has(b, APP_NAME_PARAMETER) || !has(b, EXTRA_PARAMETER) {
        return agent_not_found(p_ctx);
    }
    let v_outcome = p_ctx.auth().new_login_card(
        get(b, ACCOUNT_NAME_PARAMETER),
        get(b, ACCESS_CODE_PARAMETER),
        "d",
        get(b, APP_GROUP_PARAMETER),
        get(b, APP_NAME_PARAMETER),
        get(b, EXTRA_PARAMETER),
        false,
    );
    let Ok(v_outcome) = v_outcome else { return agent_not_found(p_ctx) };
    match first_reply(v_outcome).await {
        Err(()) => agent_not_found(p_ctx),
        Ok(None) => Reply::Hang,
        Ok(Some(mut v)) => {
            set_field(&mut v, COMMAND, json!(AGENT_LOGIN_COMMAND));
            let r = p_ctx.chunked(&v);
            p_ctx.debug(&format!("debug ... fn_newLoginCard: {}", js_stringify(&v)));
            r
        }
    }
}

/// POST /agent/aam
async fn agent_account(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", AGENT_ACCOUNT_MANAGMENT));
    if !p_ctx.web.agent_account_limit.check(&p_ctx.req.ip) {
        return too_many(p_ctx, ACCOUNT_MANAGMENT);
    }
    p_ctx.info_log(AGENT_ACCOUNT_MANAGMENT);
    let b = &p_ctx.body;
    if !has(b, SUB_COMMAND)
        || (!has(b, ACCOUNT_NAME_PARAMETER) && !has(b, ACCESS_CODE_PARAMETER))
        || !has(b, APP_NAME_PARAMETER)
        || !has(b, EXTRA_PARAMETER)
    {
        return agent_not_found(p_ctx);
    }
    let v_outcome = p_ctx.auth().account_operation_from_agent(
        get(b, SUB_COMMAND),
        get(b, ACCOUNT_NAME_PARAMETER),
        get(b, ACCESS_CODE_PARAMETER),
        get(b, APP_NAME_PARAMETER),
        get(b, EXTRA_PARAMETER),
        get(b, RECOVERY_CODE_PARAMETER),
    );
    let Ok(v_outcome) = v_outcome else { return agent_not_found(p_ctx) };
    match first_reply(v_outcome).await {
        Err(()) => agent_not_found(p_ctx),
        Ok(None) => Reply::Hang,
        Ok(Some(mut v)) => {
            set_field(&mut v, COMMAND, json!(ACCOUNT_MANAGMENT));
            p_ctx.chunked(&v)
        }
    }
}

/// POST /agent/ah
async fn agent_hardware(p_ctx: &mut Ctx<'_>) -> Reply {
    p_ctx.debug(&format!("debug ... {} called", AGENT_HARDWARE_MANAGMENT));
    p_ctx.info_log(AGENT_HARDWARE_MANAGMENT);
    let b = &p_ctx.body;
    if !has(b, SUB_COMMAND) || (!has(b, HARDWARE_ID) && !has(b, HARDWARE_TYPE)) || !has(b, SESSION_ID) {
        return agent_not_found(p_ctx);
    }
    let v_outcome = p_ctx.auth().hardware_operation_from_agent(
        get(b, SUB_COMMAND),
        get(b, SESSION_ID),
        get(b, HARDWARE_ID),
        get(b, HARDWARE_TYPE),
    );
    let Ok(v_outcome) = v_outcome else { return agent_not_found(p_ctx) };
    match first_reply(v_outcome).await {
        Err(()) => agent_not_found(p_ctx),
        Ok(None) => Reply::Hang,
        Ok(Some(mut v)) => {
            set_field(&mut v, COMMAND, json!(AGENT_HARDWARE_MANAGMENT));
            p_ctx.chunked(&v)
        }
    }
}
