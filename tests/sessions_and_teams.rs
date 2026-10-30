//! Login cards, password hashing and team verification
//! (js_session_manager, js_password_hashing, js_team_verify tests).

mod common;
use common::*;
use de_auth_server::accounts::TeamParams;
use de_auth_server::sessions;
use droneengage_server_common::password;
use serde_json::json;

#[test]
fn login_cards_from_the_file_store() {
    let env = file_mode();
    let (v_code, _) = env.create("user@x.com", "0xffffffff");
    let v_card = env.login("user@x.com", &v_code);
    assert_eq!(e(&v_card), json!(0));
    assert!(v_card["m_session_id"].as_str().unwrap().len() > 32);
    assert_eq!(v_card["b"], json!("testgroup"));
    assert!(sessions::is_gcs_login(&v_card) && sessions::is_unit_login(&v_card) && !sessions::is_view_mode(&v_card));
    let v_bad = env.login("user@x.com", "wrong");
    assert_eq!(v_bad, json!({ "em": "Account Not Found.", "e": 2 }));
    assert_eq!(e(&env.login("nobody@x.com", "x")), json!(2));
}

#[test]
fn access_codes_are_hashed_and_legacy_codes_upgrade() {
    let v_hash = password::hash("secret1").unwrap();
    assert!(password::is_hashed(&v_hash) && password::verify("secret1", &v_hash) && !password::verify("x", &v_hash));
    assert!(password::verify("legacy", "legacy"), "legacy plaintext still verifies");

    let env = file_mode();
    let (v_code, _) = env.create("h@x.com", "0xffffffff");
    let v_stored = env.record("h@x.com").unwrap()["AccessCode"].as_str().unwrap().to_string();
    assert!(password::is_hashed(&v_stored) && v_stored != v_code);

    // a legacy plaintext login is re-hashed on login
    env.auth
        .accounts
        .fdb("x")
        .unwrap()
        .add_record(&json!("old@x.com"), &json!({ "sid": 9, "AccessCode": "$2b$10$placeholderplaceholderplaceholderplaceholderplaceho", "prm": "0x1" }))
        .unwrap();
    let v_path = env.dir.path().join("db_users.json");
    let mut v_data: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&v_path).unwrap()).unwrap();
    v_data["logins"]["old@x.com"]["AccessCode"] = json!("plain1");
    std::fs::write(&v_path, v_data.to_string()).unwrap();
    let env2 = {
        let mut env2 = file_mode();
        env2.auth.accounts.file = Some(std::sync::Mutex::new(de_auth_server::filedb::FileDb::open(&v_path)));
        env2
    };
    let v_card = env2.login("old@x.com", "plain1");
    assert_eq!(e(&v_card), json!(0));
    assert!(password::is_hashed(env2.record("old@x.com").unwrap()["AccessCode"].as_str().unwrap()));
}

#[test]
fn verify_team_user() {
    let env = file_mode();
    let (v_code, _) = env.create("admin@x.com", "0xffffffff");
    let v_card = env.login("admin@x.com", &v_code);
    let p = |t: &str, c: Option<&str>| TeamParams {
        target: Some(json!(t)),
        permission: None,
        access_code: c.map(|c| json!(c)),
        is_admin: None,
    };
    let a = &env.auth.accounts;
    let r = a
        .team_user_operation(
            &json!("atu"),
            &v_card,
            &TeamParams { permission: Some(json!("0x00000010")), ..p("m@x.com", Some("mcode1")) },
        )
        .unwrap();
    assert_eq!(e(&r), json!(0));
    assert_eq!(e(&a.team_user_operation(&json!("vtu"), &v_card, &p("m@x.com", Some("mcode1"))).unwrap()), json!(0));
    assert_eq!(e(&a.team_user_operation(&json!("vtu"), &v_card, &p("m@x.com", Some("bad"))).unwrap()), json!(2));
    assert_eq!(e(&a.team_user_operation(&json!("vtu"), &v_card, &p("m@x.com", None)).unwrap()), json!(1));
    assert_eq!(e(&a.team_user_operation(&json!("vtu"), &v_card, &p("zz@x.com", Some("x"))).unwrap()), json!(2));
    let (v_other, _) = env.create("other@x.com", "0xffffffff");
    let v_other_card = env.login("other@x.com", &v_other);
    assert_eq!(
        e(&a.team_user_operation(&json!("vtu"), &v_other_card, &p("m@x.com", Some("mcode1"))).unwrap()),
        json!(2),
        "another team"
    );
    let mut v_member = v_card.clone();
    v_member["m_isadmin"] = json!(false);
    assert_eq!(e(&a.team_user_operation(&json!("vtu"), &v_member, &p("m@x.com", Some("mcode1"))).unwrap()), json!(6));
    let r = reply(
        env.auth
            .account_operation(
                Some(&json!("vtu")),
                None,
                Some(&json!("0x1")),
                Some(&json!("mcode1")),
                None,
                Some(&json!("m@x.com")),
                None,
                false,
                None,
            )
            .unwrap(),
    );
    assert_eq!(r, json!({ "em": "Session not found.", "e": 7, "scm": "vtu" }));
}
