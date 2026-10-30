//! Request validation (js_input_validator.js). The JavaScript helpers call
//! string methods on their arguments, so some values of another type throw:
//! an `Err` here, which the routers' catch blocks turn into their
//! "invalid request" reply.

use serde_json::Value;

use crate::constants::*;
use droneengage_server_common::util::js_nullish;
use droneengage_server_common::validation::{is_alphanumeric, is_alphanumeric_sentence, is_email};

/// A thrown JavaScript exception (its message).
pub type Js<T> = Result<T, String>;

/// String.prototype.trim (Unicode whitespace and BOM).
pub fn js_trim(p_text: &str) -> &str {
    p_text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `value == null ? value : value.trim()` (None = null/undefined).
pub fn trim(p_value: Option<&Value>) -> Js<Option<Value>> {
    match p_value {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(Value::Null)),
        Some(Value::String(s)) => Ok(Some(Value::String(js_trim(s).to_string()))),
        Some(_) => Err("value.trim is not a function".into()),
    }
}

/// `.length` (UTF-16 code units for strings, element count for arrays,
/// undefined otherwise).
fn length(p_value: &Value) -> Option<f64> {
    match p_value {
        Value::String(s) => Some(s.encode_utf16().count() as f64),
        Value::Array(a) => Some(a.len() as f64),
        Value::Object(m) => m.get("length").map(|l| droneengage_server_common::util::js_number(Some(l))),
        _ => None,
    }
}

fn exceeds(p_value: Option<&Value>, p_max: usize) -> bool {
    match p_value.filter(|v| !v.is_null()) {
        Some(v) => length(v).map(|l| l > p_max as f64).unwrap_or(false),
        None => false,
    }
}

/// hlp_string.fn_isAlphanumeric (Err for a non-string: `str.match`).
pub fn alphanumeric(p_value: Option<&Value>) -> Js<bool> {
    is_alphanumeric(p_value)
}

/// fn_isAlphanumericSentence
pub fn alphanumeric_sentence(p_value: Option<&Value>) -> Js<bool> {
    match p_value {
        None | Some(Value::Null) => Ok(false),
        Some(Value::String(s)) => Ok(is_alphanumeric_sentence(s)),
        Some(_) => Err("str.match is not a function".into()),
    }
}

/// fn_isValidAccountName: alphanumeric (throws for non-strings) or email.
pub fn valid_account_name(p_value: Option<&Value>) -> Js<bool> {
    Ok(alphanumeric(p_value)? || is_email(p_value))
}

fn invalid_login_id(p_value: Option<&Value>) -> Js<bool> {
    if js_nullish(p_value) {
        return Ok(true);
    }
    Ok(exceeds(p_value, ACCOUNT_NAME_MAX_LENGTH) || !valid_account_name(p_value)?)
}

fn invalid_alphanumeric(p_value: Option<&Value>, p_max: usize) -> Js<bool> {
    if js_nullish(p_value) {
        return Ok(true);
    }
    Ok(!alphanumeric(p_value)? || exceeds(p_value, p_max))
}

/// The fields normalizeLoginFields returns (None = undefined).
#[derive(Clone, Debug)]
pub struct LoginFields {
    pub account_name: Option<Value>,
    pub access_code: Option<Value>,
    pub actor_type: Option<Value>,
    pub group: Option<Value>,
    pub app: Option<Value>,
    pub extra: Option<Value>,
}

/// normalizeLoginFields (trims the account name and access code).
pub fn normalize_login_fields(p_fields: LoginFields) -> Js<LoginFields> {
    Ok(LoginFields {
        account_name: trim(p_fields.account_name.as_ref())?,
        access_code: trim(p_fields.access_code.as_ref())?,
        ..p_fields
    })
}

/// validateLoginRequest
pub fn validate_login_request(p_f: &LoginFields) -> Js<bool> {
    let v_account = trim(p_f.account_name.as_ref())?;
    let v_code = trim(p_f.access_code.as_ref())?;
    if js_nullish(p_f.actor_type.as_ref()) || p_f.actor_type.as_ref().and_then(length) != Some(1.0) {
        return Ok(false);
    }
    if invalid_login_id(v_account.as_ref())? {
        return Ok(false);
    }
    if invalid_alphanumeric(v_code.as_ref(), ACCESSCODE_MAX_LENGTH)? {
        return Ok(false);
    }
    if invalid_alphanumeric(p_f.group.as_ref(), ACCESSCODE_MAX_LENGTH)? {
        return Ok(false);
    }
    if invalid_alphanumeric(p_f.app.as_ref(), ACCESSCODE_MAX_LENGTH)? {
        return Ok(false);
    }
    if js_nullish(p_f.extra.as_ref()) || !alphanumeric_sentence(p_f.extra.as_ref())? {
        return Ok(false);
    }
    Ok(true)
}

/// validateAccountOperation (its caller passes no recovery code).
pub fn validate_account_operation(
    p_sub: Option<&Value>,
    p_account: Option<&Value>,
    p_permission: Option<&Value>,
    p_code: Option<&Value>,
) -> Js<bool> {
    if js_nullish(p_sub) || exceeds(p_sub, 3) {
        return Ok(false);
    }
    if js_nullish(p_account) && js_nullish(p_code) {
        return Ok(false);
    }
    let v_account = trim(p_account)?;
    if !js_nullish(v_account.as_ref())
        && (exceeds(v_account.as_ref(), ACCOUNT_NAME_MAX_LENGTH) || !valid_account_name(v_account.as_ref())?)
    {
        return Ok(false);
    }
    if !matches!(p_permission, Some(Value::String(_))) {
        return Ok(false);
    }
    let v_code = trim(p_code)?;
    if !js_nullish(v_code.as_ref()) && !alphanumeric(v_code.as_ref())? {
        return Ok(false);
    }
    Ok(true)
}

fn alnum_string(p_value: Option<&Value>) -> bool {
    matches!(p_value, Some(v @ Value::String(_)) if is_alphanumeric(Some(v)) == Ok(true))
}

/// validateAgentMetadata
pub fn validate_agent_metadata(p_app: Option<&Value>, p_extra: Option<&Value>) -> Js<bool> {
    if !alnum_string(p_app) {
        return Ok(false);
    }
    if js_nullish(p_extra) || !alphanumeric_sentence(p_extra)? {
        return Ok(false);
    }
    Ok(true)
}

/// validateHardwareOperation
pub fn validate_hardware_operation(
    p_session: Option<&Value>,
    p_sub: Option<&Value>,
    p_hw_id: Option<&Value>,
    p_hw_type: Option<&Value>,
) -> bool {
    alnum_string(p_session) && alnum_string(p_sub) && alnum_string(p_hw_id) && alnum_string(p_hw_type)
}

/// validateSessionID
pub fn validate_session_id(p_session: Option<&Value>) -> Js<bool> {
    Ok(!js_nullish(p_session) && alphanumeric(p_session)? && !exceeds(p_session, SESSION_MAX_LENGTH))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fields(acc: Value, pwd: Value, gr: Value, ex: Value) -> LoginFields {
        LoginFields {
            account_name: Some(acc),
            access_code: Some(pwd),
            actor_type: Some(json!("g")),
            group: Some(gr),
            app: Some(json!("de")),
            extra: Some(ex),
        }
    }

    #[test]
    fn login_requests() {
        let f = normalize_login_fields(fields(json!(" a@b.io "), json!("abc1"), json!("1"), json!("x (y)"))).unwrap();
        assert_eq!(f.account_name, Some(json!("a@b.io")));
        assert_eq!(validate_login_request(&f), Ok(true));
        let f = fields(json!("a@b.io"), json!("abc1"), json!(1), json!("x"));
        assert!(validate_login_request(&f).is_err(), "a numeric group reaches str.match");
        assert!(normalize_login_fields(fields(json!(5), json!("a"), json!("1"), json!("x"))).is_err());
        let f = fields(json!("a@b.io"), json!("abc1"), json!("1"), json!("x!"));
        assert_eq!(validate_login_request(&f), Ok(false));
    }

    #[test]
    fn account_operations() {
        let ok = |s: Value, a: Option<Value>, p: Value, c: Option<Value>| {
            validate_account_operation(Some(&s), a.as_ref(), Some(&p), c.as_ref())
        };
        assert_eq!(ok(json!("c"), Some(json!("a@b.io")), json!("0x1"), None), Ok(true));
        assert_eq!(ok(json!("cccc"), Some(json!("a@b.io")), json!("0x1"), None), Ok(false));
        assert_eq!(ok(json!(1234), Some(json!("a@b.io")), json!("0x1"), None), Ok(true), "a number has no length");
        assert_eq!(ok(json!("c"), None, json!("0x1"), None), Ok(false));
        assert_eq!(ok(json!("c"), Some(json!("a@b.io")), json!(1), None), Ok(false));
        assert_eq!(ok(json!("g"), None, json!("0x1"), Some(json!("abc"))), Ok(true));
        assert!(ok(json!("g"), Some(json!(5)), json!("0x1"), None).is_err());
    }
}
