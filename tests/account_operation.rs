//! Account create / regenerate / lookup authorization (js_account_operation.test.js).

mod common;
use common::*;
use serde_json::json;

const FULL: u32 = 0xffffffff;

#[test]
fn file_create_defaults_and_duplicates() {
    let env = file_mode();
    let r = env.op("c", Some("new1@x.com"), None, None, None, None);
    assert_eq!(e(&r), json!(0));
    assert_eq!(env.record("new1@x.com").unwrap()["prm"], json!(FULL), "anonymous create gets full control");
    let r = env.op("c", Some("new2@x.com"), Some("0xffffffff"), None, None, None);
    assert_eq!(e(&r), json!(0));
    assert_eq!(env.record("new2@x.com").unwrap()["isadmin"], json!(true), "the web sign-up is the team admin");
    let r = env.op("c", Some("new1@x.com"), None, None, None, None);
    assert_ne!(e(&r), json!(0), "duplicate account name is rejected");
}

#[test]
fn file_regenerate_needs_proof_and_keeps_the_grant() {
    let env = file_mode();
    let (v_code, v_recovery) = env.create("acc@x.com", "0x00001111");
    let r = env.op("r", Some("acc@x.com"), Some("0xffffffff"), Some(&v_code), None, None);
    assert_eq!(e(&r), json!(0));
    assert_eq!(env.record("acc@x.com").unwrap()["prm"], json!(0x1111), "existing permission preserved");
    let v_new = r["pwd"].as_str().unwrap().to_string();

    let r = env.op("r", Some("acc@x.com"), None, Some("wrongcode"), None, None);
    assert_eq!(e(&r), json!(6), "wrong access code and no other proof");
    assert!(r.get("pwd").is_none());
    let r = env.op("r", Some("acc@x.com"), None, None, None, None);
    assert_eq!(e(&r), json!(6), "anonymous regenerate is rejected");

    // the recovery code issued by the regenerate above
    let v_rc = env.op("r", Some("acc@x.com"), None, Some(&v_new), None, None)["rc"].as_str().unwrap().to_string();
    let r = env.op("r", Some("acc@x.com"), None, None, None, Some(&v_rc));
    assert_eq!(e(&r), json!(0), "recovery code proves ownership");
    let r = env.op("r", Some("acc@x.com"), None, None, None, Some(&v_rc));
    assert_eq!(e(&r), json!(6), "a used recovery code is dead");
    let r = env.op("r", Some("acc@x.com"), None, None, None, Some(&v_recovery));
    assert_eq!(e(&r), json!(6), "a rotated recovery code is dead");

    let v_db = env.auth.accounts.fdb("x").unwrap();
    let v_stored = v_db.data()["logins"]["acc@x.com"]["RecoveryCode"].as_str().unwrap().to_string();
    assert!(v_stored.starts_with("$2"), "recovery code stored hashed");
}

#[test]
fn file_regenerate_with_session_revokes_other_sessions() {
    let env = file_mode();
    let (v_code, _) = env.create("own@x.com", "0xffffffff");
    let v_keep = env.login("own@x.com", &v_code);
    let v_other = env.login("own@x.com", &v_code);
    let v_keep_id = v_keep["m_session_id"].as_str().unwrap();
    let r = env.op("r", Some("own@x.com"), None, None, Some(v_keep_id), None);
    assert_eq!(e(&r), json!(0), "a live session of the account is proof");
    assert!(env.auth.sessions.by_session(Some(&json!(v_keep_id))).is_some(), "the proving session is kept");
    assert!(env.auth.sessions.by_session(v_other.get("m_session_id")).is_none(), "other sessions are revoked");

    let (v_code2, _) = env.create("b@x.com", "0xffffffff");
    let v_b = env.login("b@x.com", &v_code2);
    let r = env.op("r", Some("own@x.com"), None, None, v_b["m_session_id"].as_str(), None);
    assert_eq!(e(&r), json!(6), "a session of another account is no proof");
}

#[test]
fn get_account_name() {
    let env = file_mode();
    let (v_code, _) = env.create("g@x.com", "0xffffffff");
    let r = env.op("g", None, None, Some(&v_code), None, None);
    assert_eq!(r, json!({ "acc": "g@x.com", "e": 0, "scm": "g" }));
}

#[test]
fn agent_path() {
    let env = file_mode();
    let r = env.agent_op("c", Some("veh@x.com"), None, None);
    assert_eq!(e(&r), json!(0));
    let v_rec = env.record("veh@x.com").unwrap();
    assert_eq!(v_rec["prm"], json!(0x1111), "agent create clamps to the self-service permission");
    assert_eq!(v_rec["isadmin"], json!(false));
    let v_code = r["pwd"].as_str().unwrap().to_string();
    assert_eq!(e(&env.agent_op("r", Some("veh@x.com"), Some("nope"), None)), json!(6));
    let r = env.agent_op("r", Some("veh@x.com"), Some(&v_code), None);
    assert_eq!(e(&r), json!(0));
    assert_eq!(env.record("veh@x.com").unwrap()["prm"], json!(0x1111));
    let r = env.agent_op("r", Some("veh@x.com"), None, r["rc"].as_str());
    assert_eq!(e(&r), json!(0), "agent regenerate with the recovery code");
}

#[test]
fn single_mode_prompts() {
    let env = single_mode();
    assert_eq!(e(&env.op("c", Some("x@x.com"), None, None, None, None)), json!(11));
    assert_eq!(e(&env.op("r", Some("x@x.com"), None, Some("abc"), None, None)), json!(11));
    let r = env.op("g", None, None, Some("singlecode"), None, None);
    assert_eq!(r, json!({ "acc": "single@x.com", "e": 0, "scm": "g" }));
}

#[test]
fn db_regenerate_fails_closed_without_a_grant() {
    let env = db_mode();
    let v_db = env.auth.accounts.db.clone().unwrap();
    v_db.run("INSERT INTO teams (TeamName) VALUES (?)", &[json!("db_noperm@x.com")]).unwrap();
    let v_hash = droneengage_server_common::password::hash("deadbeefdeadbeef").unwrap();
    v_db.run("UPDATE teams SET RecoveryCode = ? WHERE TeamName = ?", &[json!(v_hash), json!("db_noperm@x.com")])
        .unwrap();
    let r = env.op("r", Some("db_noperm@x.com"), Some("0xffffffff"), None, None, Some("deadbeefdeadbeef"));
    assert_ne!(e(&r), json!(0));
    assert!(r.get("pwd").is_none(), "no access code disclosed");
    let v_rows = v_db.all("SELECT LoginID FROM logins", &[]).unwrap();
    assert!(v_rows.is_empty(), "no login minted");
}

#[test]
fn db_regenerate_rotates_non_admin_logins() {
    let env = db_mode();
    let (v_code, _) = env.create("db_rotate@x.com", "0x00001111");
    let v_db = env.auth.accounts.db.clone().unwrap();
    let v_team = v_db.get("SELECT TeamID FROM teams WHERE TeamName = ?", &[json!("db_rotate@x.com")]).unwrap().unwrap()
        ["TeamID"]
        .clone();
    let v_card = json!({ "m_data": { "m_sid": v_team }, "m_isadmin": true, "m_login_name": "db_rotate@x.com" });
    for (n, c, p, a) in
        [("member1@x.com", "membercode1", "0x00002222", false), ("member2@x.com", "membercode2", "0x00003333", true)]
    {
        let v_params = de_auth_server::accounts::TeamParams {
            target: Some(json!(n)),
            permission: Some(json!(p)),
            access_code: Some(json!(c)),
            is_admin: Some(json!(a)),
        };
        let r = env.auth.accounts.team_user_operation(&json!("atu"), &v_card, &v_params).unwrap();
        assert_eq!(e(&r), json!(0));
    }
    let r = env.op("r", Some("db_rotate@x.com"), Some("0xffffffff"), Some(&v_code), None, None);
    assert_eq!(e(&r), json!(0));
    let mut v_names: Vec<String> = v_db
        .all("SELECT LoginName FROM logins WHERE TeamID = ?", &[v_team])
        .unwrap()
        .iter()
        .map(|r| r["LoginName"].as_str().unwrap().to_string())
        .collect();
    v_names.sort();
    assert_eq!(v_names, ["db_rotate@x.com", "member2@x.com"]);
    assert_ne!(e(&env.login("db_rotate@x.com", &v_code)), json!(0), "the old code is dead");
    assert_eq!(e(&env.login("db_rotate@x.com", r["pwd"].as_str().unwrap())), json!(0));
}
