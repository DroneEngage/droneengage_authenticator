//! The routers' per-IP rate limiter (router_security.test.js) and the S2S
//! challenge verification the listener uses (s2s_auth.test.js).

use de_auth_server::web::SlidingLimiter;
use droneengage_server_common::s2s_auth::{build_challenge, generate_nonce, parse_envelope, S2sAuth};
use serde_json::json;

#[test]
fn rate_limit_per_ip() {
    let v = SlidingLimiter::new(10);
    for _ in 0..10 {
        assert!(v.check("1.1.1.1"));
    }
    assert!(!v.check("1.1.1.1"), "the 11th request in the window is refused");
    assert!(v.check("2.2.2.2"), "other IPs are independent");
}

#[test]
fn s2s_challenge_and_verify() {
    let v_nonce = generate_nonce();
    assert_eq!(v_nonce.len(), 64);
    assert_ne!(v_nonce, generate_nonce());
    let v_env = parse_envelope(build_challenge(&v_nonce, None).as_bytes()).unwrap();
    assert_eq!(v_env, json!({ "s2s_auth": "challenge", "nonce": v_nonce }));
    assert!(parse_envelope(b"{\"c\":\"a\"}").is_none());
    assert!(parse_envelope(b"xyz").is_none());

    use ed25519_dalek::pkcs8::{spki::der::pem::LineEnding, EncodePrivateKey, EncodePublicKey};
    let v_dir = tempfile::tempdir().unwrap();
    let v_key = ed25519_dalek::SigningKey::generate(&mut rand::rngs::OsRng);
    std::fs::write(v_dir.path().join("priv.pem"), v_key.to_pkcs8_pem(LineEnding::LF).unwrap().as_bytes()).unwrap();
    std::fs::write(v_dir.path().join("pub.pem"), v_key.verifying_key().to_public_key_pem(LineEnding::LF).unwrap())
        .unwrap();
    let v_root = v_dir.path();
    let v_cfg = droneengage_server_common::config::Config::from_value(
        json!({ "s2s_trusted_server_keys": { "comm1": "pub.pem" } }),
        v_root,
    );
    let v_signer =
        droneengage_server_common::config::Config::from_value(json!({ "s2s_my_private_key": "priv.pem" }), v_root);
    let v_auth = S2sAuth::new(&v_cfg, None);
    let v_reply = S2sAuth::new(&v_signer, None).build_response(Some(&json!(v_nonce))).unwrap();
    let v_reply: serde_json::Value = serde_json::from_str(&v_reply).unwrap();
    assert!(v_auth.verify(&v_nonce, v_reply.get("sig"), Some(&json!("comm1"))));
    assert!(!v_auth.verify("other", v_reply.get("sig"), Some(&json!("comm1"))));
    assert!(!v_auth.verify(&v_nonce, v_reply.get("sig"), Some(&json!("unknown"))));
    assert!(!v_auth.verify(&v_nonce, None, Some(&json!("comm1"))));
}
