//! ALTCHA proof-of-work captcha (js_altcha_guard.js over altcha-lib):
//! challenges for GET /w/cc and single-use verification of the solved
//! payload (`cp`) on the public account commands. Initialised on first use.

use base64::Engine;
use hmac::{Hmac, Mac};
use rand::Rng;
use serde_json::{json, Value};
use sha2::{Digest, Sha256, Sha384, Sha512};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::config::Cfg;
use droneengage_server_common::util::{js_interp, js_parse, now_ms};

const CHALLENGE_TTL_DEFAULT_SEC: i64 = 300;
const MAX_NUMBER_DEFAULT: i64 = 100000;
const REPLAY_RETENTION_MS: i64 = 30 * 60 * 1000;
const MAX_PAYLOAD_LENGTH: usize = 8192;

struct Settings {
    enabled: bool,
    secret: String,
    max_number: Value,
    ttl_ms: i64,
}

pub struct Altcha {
    m_cfg: Cfg,
    m_settings: Mutex<Option<Settings>>,
    m_used: Mutex<HashMap<String, i64>>,
}

/// `Number.isInteger(v)`
fn js_integer(p_value: Option<&Value>) -> Option<f64> {
    let f = p_value?.as_f64()?;
    (f.fract() == 0.0).then_some(f)
}

/// The payload's algorithm: SHA-1 is left out, since a payload can only
/// verify with the HMAC this server made with SHA-256.
fn hash_hex(p_alg: &str, p_data: &str) -> Option<String> {
    Some(match p_alg.to_ascii_uppercase().as_str() {
        "SHA-256" => hex::encode(Sha256::digest(p_data.as_bytes())),
        "SHA-384" => hex::encode(Sha384::digest(p_data.as_bytes())),
        "SHA-512" => hex::encode(Sha512::digest(p_data.as_bytes())),
        _ => return None,
    })
}

fn hmac_hex(p_alg: &str, p_data: &str, p_key: &str) -> Option<String> {
    Some(match p_alg.to_ascii_uppercase().as_str() {
        "SHA-256" => {
            let mut m = Hmac::<Sha256>::new_from_slice(p_key.as_bytes()).ok()?;
            m.update(p_data.as_bytes());
            hex::encode(m.finalize().into_bytes())
        }
        "SHA-384" => {
            let mut m = Hmac::<Sha384>::new_from_slice(p_key.as_bytes()).ok()?;
            m.update(p_data.as_bytes());
            hex::encode(m.finalize().into_bytes())
        }
        "SHA-512" => {
            let mut m = Hmac::<Sha512>::new_from_slice(p_key.as_bytes()).ok()?;
            m.update(p_data.as_bytes());
            hex::encode(m.finalize().into_bytes())
        }
        _ => return None,
    })
}

/// atob: forgiving base64 to a "binary string" (one char per byte).
fn atob(p_text: &str) -> Option<String> {
    let v: String = p_text.chars().filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\x0c' | '\r')).collect();
    let v = if v.len().is_multiple_of(4) { v.trim_end_matches('=').to_string() } else { v };
    if v.len() % 4 == 1 || !v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/') {
        return None;
    }
    let v_bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(v.as_bytes())
        .or_else(|_| {
            base64::engine::GeneralPurpose::new(
                &base64::alphabet::STANDARD,
                base64::engine::GeneralPurposeConfig::new()
                    .with_decode_allow_trailing_bits(true)
                    .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone),
            )
            .decode(v.as_bytes())
        })
        .ok()?;
    Some(v_bytes.iter().map(|b| *b as char).collect())
}

/// URLSearchParams(salt.split('?')[1]).get(name)
fn salt_param(p_salt: &str, p_name: &str) -> Option<String> {
    let v_query = p_salt.split('?').nth(1)?;
    for v_pair in v_query.split('&') {
        let (k, v) = v_pair.split_once('=').unwrap_or((v_pair, ""));
        let k = droneengage_server_common::web::http::percent_decode(&k.replace('+', " ")).unwrap_or_default();
        if k == p_name {
            return Some(
                droneengage_server_common::web::http::percent_decode(&v.replace('+', " ")).unwrap_or_default(),
            );
        }
    }
    None
}

impl Altcha {
    pub fn new(p_cfg: Cfg) -> Altcha {
        Altcha { m_cfg: p_cfg, m_settings: Mutex::new(None), m_used: Mutex::new(HashMap::new()) }
    }

    /// fn_init (once)
    fn settings(&self) -> std::sync::MutexGuard<'_, Option<Settings>> {
        let mut g = self.m_settings.lock().unwrap();
        if g.is_none() {
            let v_enabled = !self.m_cfg.is_false("altcha_enabled");
            if !v_enabled {
                println!("ALTCHA: disabled by config (altcha_enabled=false)");
                *g = Some(Settings {
                    enabled: false,
                    secret: String::new(),
                    max_number: json!(MAX_NUMBER_DEFAULT),
                    ttl_ms: 0,
                });
                return g;
            }
            let v_max = match js_integer(self.m_cfg.get("altcha_max_number")) {
                Some(_) => self.m_cfg.get("altcha_max_number").cloned().unwrap(),
                None => json!(MAX_NUMBER_DEFAULT),
            };
            let v_ttl =
                js_integer(self.m_cfg.get("altcha_ttl_sec")).unwrap_or(CHALLENGE_TTL_DEFAULT_SEC as f64) * 1000.0;
            let v_secret = match self.m_cfg.text("altcha_hmac_secret") {
                Some(s) => s,
                None => {
                    let v: [u8; 32] = rand::thread_rng().gen();
                    hex::encode(v)
                }
            };
            if !self.m_cfg.truthy("altcha_hmac_secret") {
                println!("ALTCHA: no altcha_hmac_secret configured — using ephemeral per-boot secret");
            }
            println!("ALTCHA: enabled — challenge endpoint /w{}", crate::constants::CAPTCHA_CHALLENGE);
            *g = Some(Settings { enabled: true, secret: v_secret, max_number: v_max, ttl_ms: v_ttl as i64 });
        }
        g
    }

    pub fn is_enabled(&self) -> bool {
        self.settings().as_ref().map(|s| s.enabled).unwrap_or(false)
    }

    /// fn_issueChallenge: None when the guard is disabled.
    pub fn issue_challenge(&self) -> Option<Value> {
        let g = self.settings();
        let s = g.as_ref()?;
        if !s.enabled {
            return None;
        }
        let v_salt_bytes: [u8; 12] = rand::thread_rng().gen();
        let v_expires = (now_ms() + s.ttl_ms).div_euclid(1000);
        let v_salt = format!("{}?expires={}&", hex::encode(v_salt_bytes), v_expires);
        // randomInt(max): floor(random * (max + 1))
        let v_max = s.max_number.as_f64().unwrap_or(MAX_NUMBER_DEFAULT as f64);
        let v_number = (rand::thread_rng().gen::<f64>() * (v_max + 1.0)).floor();
        let v_challenge =
            hash_hex("SHA-256", &format!("{}{}", v_salt, droneengage_server_common::util::js_number_fmt(v_number)))?;
        let v_signature = hmac_hex("SHA-256", &v_challenge, &s.secret)?;
        Some(json!({
            "algorithm": "SHA-256",
            "challenge": v_challenge,
            "maxnumber": s.max_number,
            "salt": v_salt,
            "signature": v_signature,
        }))
    }

    /// verifySolution(payload, secret, checkExpires=true)
    fn verify_solution(p_payload: &str, p_secret: &str) -> bool {
        let Some(v_text) = atob(p_payload) else { return false };
        let Some(v) = js_parse(&v_text) else { return false };
        let v_salt = v.get("salt");
        let v_params_salt = match v_salt {
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        };
        let v_expires = salt_param(&v_params_salt, "expires").or_else(|| salt_param(&v_params_salt, "expire"));
        if let Some(e) = v_expires.filter(|e| !e.is_empty()) {
            let v_digits: String = e.trim_start().chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
            match v_digits.parse::<i64>() {
                Ok(n) if n.checked_mul(1000).map(|ms| ms >= now_ms()).unwrap_or(false) => {}
                _ => return false,
            }
        }
        let v_alg = match v.get("algorithm") {
            Some(Value::String(a)) if !a.is_empty() => a.clone(),
            None | Some(Value::Null) => "SHA-256".into(),
            Some(Value::String(_)) => "SHA-256".into(),
            Some(Value::Bool(false)) => "SHA-256".into(),
            Some(Value::Number(n)) if n.as_f64() == Some(0.0) => "SHA-256".into(),
            Some(other) => js_interp(Some(other)),
        };
        // salt: a falsy salt is replaced by random bytes, a non-string throws
        let mut v_salt_text = match v_salt {
            Some(Value::String(s)) if !s.is_empty() => s.clone(),
            None | Some(Value::Null) | Some(Value::Bool(false)) => return false,
            Some(Value::String(_)) => return false,
            Some(Value::Number(n)) if n.as_f64() == Some(0.0) => return false,
            Some(_) => return false,
        };
        if !v_salt_text.ends_with('&') {
            v_salt_text.push('&');
        }
        let Some(v_number) = v.get("number") else { return false };
        let v_concat = format!("{}{}", v_salt_text, js_interp(Some(v_number)));
        let Some(v_challenge) = hash_hex(&v_alg, &v_concat) else { return false };
        let Some(v_signature) = hmac_hex(&v_alg, &v_challenge, p_secret) else { return false };
        v.get("challenge") == Some(&json!(v_challenge)) && v.get("signature") == Some(&json!(v_signature))
    }

    /// fn_verifyPayload: valid, fresh and not seen before (true when the
    /// guard is disabled).
    pub fn verify_payload(&self, p_payload: Option<&Value>) -> bool {
        let v_secret = {
            let g = self.settings();
            let Some(s) = g.as_ref() else { return false };
            if !s.enabled {
                return true;
            }
            s.secret.clone()
        };
        let v_payload = match p_payload {
            Some(Value::String(s)) if !s.is_empty() && s.encode_utf16().count() <= MAX_PAYLOAD_LENGTH => s,
            _ => return false,
        };
        if !Self::verify_solution(v_payload, &v_secret) {
            return false;
        }
        // Buffer.from(base64).toString('utf8'): lenient decoding
        let v_bytes = lenient_base64(v_payload);
        let Some(v_decoded) = js_parse(&String::from_utf8_lossy(&v_bytes)) else { return false };
        let v_key = js_interp(v_decoded.get("challenge"));
        let mut v_used = self.m_used.lock().unwrap();
        let v_now = now_ms();
        v_used.retain(|_, e| *e >= v_now);
        if v_used.contains_key(&v_key) {
            return false;
        }
        v_used.insert(v_key, v_now + REPLAY_RETENTION_MS);
        true
    }
}

/// Buffer.from(text, 'base64'): skips characters outside the alphabet and
/// stops at the first '='.
fn lenient_base64(p_text: &str) -> Vec<u8> {
    let v: String = p_text
        .split('=')
        .next()
        .unwrap_or("")
        .chars()
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '/')
        .collect();
    let v = if v.len() % 4 == 1 { &v[..v.len() - 1] } else { &v[..] };
    base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone),
    )
    .decode(v.as_bytes())
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solve(p_challenge: &Value) -> String {
        let v_salt = p_challenge["salt"].as_str().unwrap();
        let v_target = p_challenge["challenge"].as_str().unwrap();
        for n in 0..=10_000 {
            if hash_hex("SHA-256", &format!("{}{}", v_salt, n)).unwrap() == v_target {
                let v = json!({"algorithm": "SHA-256", "challenge": v_target, "number": n, "salt": v_salt, "signature": p_challenge["signature"]});
                return base64::engine::general_purpose::STANDARD
                    .encode(droneengage_server_common::util::js_stringify(&v));
            }
        }
        panic!("unsolved");
    }

    #[test]
    fn challenge_verify_replay() {
        let a = Altcha::new(Cfg::from_value(json!({"altcha_max_number": 1000, "altcha_hmac_secret": "s3cret"})));
        let c = a.issue_challenge().unwrap();
        let v_keys: Vec<&String> = c.as_object().unwrap().keys().collect();
        assert_eq!(v_keys, ["algorithm", "challenge", "maxnumber", "salt", "signature"]);
        assert!(c["salt"].as_str().unwrap().ends_with('&'));
        let p = solve(&c);
        assert!(a.verify_payload(Some(&json!(p))));
        assert!(!a.verify_payload(Some(&json!(p))), "single use");
        assert!(!a.verify_payload(Some(&json!("bm9wZQ=="))));
        assert!(!a.verify_payload(Some(&json!(5))));
        let off = Altcha::new(Cfg::from_value(json!({"altcha_enabled": false})));
        assert!(off.issue_challenge().is_none());
        assert!(off.verify_payload(None));
    }
}
