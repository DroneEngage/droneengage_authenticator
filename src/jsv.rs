//! JavaScript evaluation rules this server relies on beyond
//! droneengage_server_common::util: 32-bit integer conversion (the
//! permission bit tests), parseInt with radix 16, the abstract `>`
//! comparison, JavaScript object key order, and an ICU-like localeCompare.

use serde_json::{Map, Value};
use std::cmp::Ordering;

use droneengage_server_common::util::{js_number, js_to_string};

/// ToInt32
pub fn to_int32(p_value: f64) -> i32 {
    to_uint32(p_value) as i32
}

/// ToUint32 (`x >>> 0`)
pub fn to_uint32(p_value: f64) -> u32 {
    if !p_value.is_finite() {
        return 0;
    }
    let v = p_value.trunc().rem_euclid(4_294_967_296.0);
    v as u32
}

/// `parseInt(text, 16)`: an optional sign, an optional 0x prefix, then hex
/// digits up to the first non-digit. NaN when there are none.
pub fn parse_int16(p_text: &str) -> f64 {
    let t = p_text.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let (v_neg, t) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    let t = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")).unwrap_or(t);
    let v_digits: String = t.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    if v_digits.is_empty() {
        return f64::NAN;
    }
    let mut v = 0f64;
    for c in v_digits.chars() {
        v = v * 16.0 + c.to_digit(16).unwrap() as f64;
    }
    if v_neg {
        -v
    } else {
        v
    }
}

/// A JSON number for a double (non-finite values become null, as
/// JSON.stringify writes them).
pub fn num(p_value: f64) -> Value {
    if p_value.fract() == 0.0 && p_value.abs() < 9_007_199_254_740_992.0 {
        return Value::from(p_value as i64);
    }
    serde_json::Number::from_f64(p_value).map(Value::Number).unwrap_or(Value::Null)
}

/// `a > b` (abstract relational comparison) for JSON values.
pub fn js_gt(p_a: &Value, p_b: &Value) -> bool {
    if let (Value::String(a), Value::String(b)) = (p_a, p_b) {
        // UTF-16 code unit order
        return a.encode_utf16().cmp(b.encode_utf16()) == Ordering::Greater;
    }
    let (a, b) = (js_number(Some(p_a)), js_number(Some(p_b)));
    a > b
}

/// True for a canonical array index ("0", "17", not "017" or "4294967295").
fn array_index(p_key: &str) -> Option<u32> {
    if p_key.is_empty() || (p_key.len() > 1 && p_key.starts_with('0')) || !p_key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    p_key.parse::<u64>().ok().filter(|v| *v < 4_294_967_295).map(|v| v as u32)
}

/// Object.keys order: integer keys ascending, then the others in
/// insertion order.
pub fn js_keys(p_obj: &Map<String, Value>) -> Vec<String> {
    let mut v_ints: Vec<(u32, &String)> = p_obj.keys().filter_map(|k| array_index(k).map(|i| (i, k))).collect();
    v_ints.sort_by_key(|(i, _)| *i);
    let mut v_out: Vec<String> = v_ints.into_iter().map(|(_, k)| k.clone()).collect();
    v_out.extend(p_obj.keys().filter(|k| array_index(k).is_none()).cloned());
    v_out
}

/// A copy of p_value with every object's keys in JavaScript order (what
/// JSON.stringify of the JavaScript object would write).
pub fn js_ordered(p_value: &Value) -> Value {
    match p_value {
        Value::Object(m) => {
            let mut v_out = Map::new();
            for k in js_keys(m) {
                v_out.insert(k.clone(), js_ordered(&m[&k]));
            }
            Value::Object(v_out)
        }
        Value::Array(a) => Value::Array(a.iter().map(js_ordered).collect()),
        v => v.clone(),
    }
}

/// The primary/tertiary collation keys of ICU's root order (what
/// String.prototype.localeCompare uses), for the characters login names
/// contain: punctuation, then digits, then letters ignoring case;
/// lowercase before uppercase as a tie-break.
fn collation_key(p_text: &str) -> (Vec<(u8, u32)>, Vec<u8>) {
    const PUNCT: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
    let mut v_primary = Vec::new();
    let mut v_tertiary = Vec::new();
    for c in p_text.chars() {
        if c.is_whitespace() {
            v_primary.push((0, c as u32));
        } else if let Some(i) = PUNCT.find(c) {
            v_primary.push((1, i as u32));
        } else if c.is_ascii_digit() {
            v_primary.push((2, c as u32));
        } else if c.is_alphabetic() {
            let v_lower = c.to_lowercase().next().unwrap_or(c);
            v_primary.push((3, v_lower as u32));
            v_tertiary.push(u8::from(c.is_uppercase()));
        } else {
            v_primary.push((4, c as u32));
        }
    }
    (v_primary, v_tertiary)
}

/// `a.localeCompare(b)` (ICU root collation, approximately).
pub fn locale_compare(p_a: &str, p_b: &str) -> Ordering {
    let (a1, a3) = collation_key(p_a);
    let (b1, b3) = collation_key(p_b);
    a1.cmp(&b1).then(a3.cmp(&b3)).then_with(|| p_a.cmp(p_b))
}

/// `String(x)` with undefined.
pub fn s(p_value: Option<&Value>) -> String {
    match p_value {
        None => "undefined".into(),
        Some(v) => js_to_string(v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn conversions() {
        assert_eq!(parse_int16("0xffffffff"), 4294967295.0);
        assert_eq!(parse_int16("0x00001111"), 4369.0);
        assert_eq!(parse_int16("ff zz"), 255.0);
        assert!(parse_int16("zz").is_nan());
        assert_eq!(to_int32(4294967295.0), -1);
        assert_eq!(to_uint32(-1.0), 4294967295);
        assert!(js_gt(&json!("10"), &json!(9)));
        assert!(!js_gt(&json!("abc"), &json!(0)));
        assert!(js_gt(&json!("b"), &json!("a")));
    }

    #[test]
    fn key_order_like_javascript() {
        let v: Value = serde_json::from_str(r#"{"b":1,"10":2,"a":3,"2":4,"02":5}"#).unwrap();
        assert_eq!(serde_json::to_string(&js_ordered(&v)).unwrap(), r#"{"2":4,"10":2,"b":1,"a":3,"02":5}"#);
    }

    #[test]
    fn locale_compare_like_icu() {
        let mut v = vec!["b@x.com", "A@x.com", "a@x.com", "a.b@x.com", "a_b@x.com", "1@x.com"];
        v.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(v, ["1@x.com", "a_b@x.com", "a.b@x.com", "a@x.com", "A@x.com", "b@x.com"]);
    }
}
