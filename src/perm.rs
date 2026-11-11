//! Permission values (js_permisson_validator.js): a hex string ("0xffffffff")
//! or a number, tested bit by bit with JavaScript's 32-bit `&`.

use serde_json::Value;

use crate::constants::{ALLOW_VIEW_MODE, CATEGORY_ACTION_MASK};
use crate::jsv::{num, parse_int16, to_int32, to_uint32};
use droneengage_server_common::util::{js_to_string, json_number_f64};

/// fn_convertPermissiontoInt: null/undefined -> 0xffffffff, a string as hex,
/// a number as u32 (`>>> 0`) - modules validate `p` as unsigned, so a
/// stored int32 pattern must go out non-negative; anything else is
/// undefined (None).
pub fn to_int(p_permission: Option<&Value>) -> Option<Value> {
    match p_permission {
        None | Some(Value::Null) => Some(Value::from(0xffffffffu32)),
        Some(Value::String(s)) => Some(num(parse_int16(s))),
        Some(Value::Number(n)) => Some(Value::from(to_uint32(json_number_f64(n)))),
        Some(_) => None,
    }
}

fn value_of(p_permission: Option<&Value>) -> f64 {
    match p_permission {
        Some(Value::String(s)) => parse_int16(s),
        Some(Value::Number(n)) => json_number_f64(n),
        _ => f64::NAN,
    }
}

/// fn_validatePermission: `((value & flags) >>> 0) === (flags >>> 0)`.
pub fn validate(p_permission: Option<&Value>, p_flags: u32) -> bool {
    if matches!(p_permission, None | Some(Value::Null)) {
        return false;
    }
    (to_int32(value_of(p_permission)) & (p_flags as i32)) as u32 == p_flags
}

/// fn_isViewMode's test: bit 29 set and no category/action bits.
pub fn is_view_mode(p_permission: Option<&Value>) -> bool {
    let p = to_uint32(value_of(to_int(p_permission).as_ref()));
    (p & ALLOW_VIEW_MODE) == ALLOW_VIEW_MODE && (p & CATEGORY_ACTION_MASK) == 0
}

/// fn_normalizePermissionToHex: `"0x" + (n >>> 0).toString(16)` for a
/// number, String(x) otherwise; None for null/undefined.
pub fn to_hex(p_permission: Option<&Value>) -> Option<Value> {
    match p_permission {
        None | Some(Value::Null) => None,
        Some(Value::Number(n)) => Some(Value::String(format!("0x{:x}", to_uint32(json_number_f64(n))))),
        Some(v) => Some(Value::String(js_to_string(v))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;
    use serde_json::json;

    #[test]
    fn bits_like_javascript() {
        assert_eq!(to_int(Some(&json!("0xffffffff"))), Some(json!(4294967295u32)));
        assert_eq!(to_int(None), Some(json!(4294967295u32)));
        assert_eq!(to_int(Some(&json!(-2080374785i64))), Some(json!(2214592511u32)));
        assert_eq!(to_int(Some(&json!(true))), None);
        assert!(to_int(Some(&json!("zz"))).unwrap().is_null(), "NaN");
        assert!(validate(Some(&json!(4294967295u32)), ALLOW_GCS_LOGIN));
        assert!(!validate(Some(&json!("0x00001111")), ALLOW_GCS_LOGIN));
        assert!(validate(Some(&json!("0x00001111")), ALLOW_UNIT));
        assert!(!validate(Some(&json!(true)), ALLOW_UNIT));
        assert!(is_view_mode(Some(&json!(0xa0000000u32))));
        assert!(!is_view_mode(Some(&json!(0xffffffffu32))));
        assert_eq!(to_hex(Some(&json!(4294967295u32))), Some(json!("0xffffffff")));
        assert_eq!(to_hex(Some(&json!(-1))), Some(json!("0xffffffff")));
    }
}
