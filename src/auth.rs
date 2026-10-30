//! The authentication operations both routers funnel through
//! (js_auth_server.js): login (card, permission gates, comm server login),
//! account operations with their authorization rules, the agent entry
//! points, hardware verification and logout.

use serde_json::{json, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

use crate::accounts::{Kind, TeamParams};
use crate::constants::*;
use crate::filedb::verify;
use crate::sessions::{is_gcs_login, is_unit_login, is_view_mode};
use crate::validator::{self, Js, LoginFields};
use crate::Auth;
use droneengage_server_common::util::{js_interp, js_strict_eq, js_to_string, js_truthy};

/// How an operation answers its caller.
pub enum Outcome {
    /// fn_callback(reply)
    Reply(Value),
    /// fn_error(): the router's "invalid request" reply
    Invalid,
    /// Replies that arrive later (comm server login); the first one counts.
    Pending(UnboundedReceiver<Value>),
    /// The JavaScript never calls back.
    Never,
}

fn permission_error(p_msg: &str) -> Value {
    json!({ ERROR: ERROR_NO_PERMISSION, ERROR_MSG: p_msg })
}

fn single_mode_error() -> Value {
    json!({
        ERROR: ERROR_NOT_SUPPORTED_SINGLE_MODE,
        ERROR_MSG: "Account create/regenerate is not supported in single-account mode."
    })
}

fn is_ok(p_reply: &Value) -> bool {
    js_strict_eq(p_reply.get(ERROR), Some(&json!(ERROR_NON)))
}

/// fn_verifyAccountOwnership's result.
struct Ownership {
    proven: bool,
    existing_permission: Option<Value>,
    error: Option<Value>,
}

impl Auth {
    /// fn_newLoginCard
    #[allow(clippy::too_many_arguments)]
    pub fn new_login_card(
        &self,
        p_account: Option<&Value>,
        p_code: Option<&Value>,
        p_actor: &str,
        p_group: Option<&Value>,
        p_app: Option<&Value>,
        p_extra: Option<&Value>,
        p_as_gcs: bool,
    ) -> Js<Outcome> {
        let v_fields = validator::normalize_login_fields(LoginFields {
            account_name: p_account.cloned(),
            access_code: p_code.cloned(),
            actor_type: Some(json!(p_actor)),
            group: p_group.cloned(),
            app: p_app.cloned(),
            extra: p_extra.cloned(),
        })?;
        if !validator::validate_login_request(&v_fields)? {
            return Ok(Outcome::Invalid);
        }
        let v_card = self.sessions.create_login_card(
            &self.accounts,
            v_fields.account_name.as_ref().unwrap_or(&Value::Null),
            v_fields.access_code.as_ref().unwrap_or(&Value::Null),
            &json!(p_actor),
            v_fields.group.as_ref().unwrap_or(&Value::Null),
        )?;
        let Some(mut v_card) = v_card else { return Ok(Outcome::Never) };
        if !js_strict_eq(v_card.get(ERROR), Some(&json!(0))) {
            return Ok(Outcome::Reply(v_card));
        }
        if p_as_gcs && !is_gcs_login(&v_card) {
            return Ok(Outcome::Reply(permission_error("No enough permission. This is not a GCS account.")));
        }
        if p_as_gcs && is_view_mode(&v_card) {
            let v_clamped = json!(0x80000000u32 | 0x20000000u32);
            v_card["m_data"]["m_prm"] = v_clamped.clone();
            let v_session = js_interp(v_card.get("m_session_id"));
            self.sessions.update(&v_session, |c| c["m_data"]["m_prm"] = v_clamped);
        }
        if !p_as_gcs && !is_unit_login(&v_card) {
            return Ok(Outcome::Reply(permission_error("No enough permission. This is not a GCS account.")));
        }
        let Some(v_server) = self.comm.select_server_for_account(&v_card)? else {
            return Ok(Outcome::Reply(json!({ ERROR: ERROR_SERVER_NOT_AVAILABLE, ERROR_MSG: "No available Server" })));
        };
        let (v_tx, v_rx) = unbounded_channel();
        self.comm.request_login(&self.sessions, &v_card, &v_server, v_tx);
        Ok(Outcome::Pending(v_rx))
    }

    /// fn_verifyAccountOwnership: a live session of the same account, the
    /// current access code, or the one-time recovery code.
    fn verify_ownership(
        &self,
        p_account: &Value,
        p_code: Option<&Value>,
        p_recovery: Option<&Value>,
        p_card: Option<&Value>,
    ) -> Js<Ownership> {
        if let Some(c) = p_card {
            if js_strict_eq(c.get("m_login_name"), Some(p_account)) {
                let v_prm = c.get("m_data").and_then(|d| d.get("m_prm"));
                return Ok(Ownership { proven: true, existing_permission: crate::perm::to_hex(v_prm), error: None });
            }
        }
        let v_fail = || Ownership {
            proven: false,
            existing_permission: None,
            error: Some(permission_error(
                "Wrong or missing access code or recovery code. Cannot regenerate account credential.",
            )),
        };
        let v_type = self.cfg.storage_type();
        let v_code = p_code.filter(|c| js_truthy(Some(c)));
        let v_recovery = p_recovery.filter(|c| js_truthy(Some(c)));
        match v_type.as_str() {
            "single" => Ok(Ownership { proven: false, existing_permission: None, error: Some(single_mode_error()) }),
            "file" => {
                let v_db = self.accounts.fdb("fn_get_record")?;
                let Some(v_record) = v_db.get_record(p_account)? else {
                    return Ok(Ownership {
                        proven: false,
                        existing_permission: None,
                        error: Some(json!({ ERROR: ERROR_ACCOUNT_NOT_FOUND, ERROR_MSG: "Account Not Found." })),
                    });
                };
                let v_stored =
                    v_record.get("AccessCode").filter(|v| js_truthy(Some(v))).or_else(|| v_record.get("pwd"));
                let v_prm = v_record.get("prm").cloned();
                if let Some(c) = v_code {
                    if verify(Some(&js_to_string(c)), v_stored) {
                        return Ok(Ownership { proven: true, existing_permission: v_prm, error: None });
                    }
                }
                let v_stored_recovery = v_db.get_recovery_code(p_account)?;
                if let (Some(r), Some(s)) = (v_recovery, v_stored_recovery.as_ref()) {
                    if verify(Some(&js_to_string(r)), Some(s)) {
                        return Ok(Ownership { proven: true, existing_permission: v_prm, error: None });
                    }
                }
                Ok(v_fail())
            }
            "db" => {
                if let Some(c) = v_code {
                    let v_reply = self.accounts.db_login(Some(p_account), Some(c))?;
                    if is_ok(&v_reply) {
                        let v_prm = v_reply["m_data"].get("m_prm").cloned();
                        return Ok(Ownership { proven: true, existing_permission: v_prm, error: None });
                    }
                }
                let Some(r) = v_recovery else { return Ok(v_fail()) };
                let v_hash = self.accounts.db_recovery_code(p_account);
                if !verify(Some(&js_to_string(r)), v_hash.as_ref()) {
                    return Ok(v_fail());
                }
                Ok(match self.accounts.db_account_permission(p_account)? {
                    Ok(p) => Ownership { proven: true, existing_permission: Some(p), error: None },
                    Err(e) => Ownership { proven: false, existing_permission: None, error: Some(e) },
                })
            }
            _ => Ok(Ownership {
                proven: false,
                existing_permission: None,
                error: Some(permission_error("Unsupported account storage type.")),
            }),
        }
    }

    /// fn_revokeAccountSessions: drops the account's other sessions after a
    /// credential rotation.
    fn revoke_account_sessions(&self, p_account: &Value, p_keep: Option<&Value>) {
        let mut v_revoked = 0;
        for c in self.sessions.by_account_name(p_account) {
            if p_keep.is_some() && js_strict_eq(c.get("m_session_id"), p_keep) {
                continue;
            }
            self.comm.remove_party(&c, Some("access_code_reset"));
            self.sessions.delete(&js_interp(c.get("m_session_id")));
            v_revoked += 1;
        }
        if v_revoked > 0 {
            println!(
                "[SECURITY] AccessCode regenerated for account '{}' — revoked {} active session(s).",
                js_interp(Some(p_account)),
                v_revoked
            );
        }
    }

    /// fn_accountOperation
    #[allow(clippy::too_many_arguments)]
    pub fn account_operation(
        &self,
        p_sub: Option<&Value>,
        p_account: Option<&Value>,
        p_permission: Option<&Value>,
        p_code: Option<&Value>,
        p_session: Option<&Value>,
        p_target: Option<&Value>,
        p_is_admin: Option<&Value>,
        p_agent_path: bool,
        p_recovery: Option<&Value>,
    ) -> Js<Outcome> {
        let v_sub_text = p_sub.and_then(Value::as_str).unwrap_or("\u{0}");
        if TEAM_ADMIN_COMMANDS.contains(&v_sub_text) {
            let v_sub = p_sub.cloned().unwrap();
            let Some(v_card) = self.sessions.by_session(p_session) else {
                return Ok(Outcome::Reply(json!({
                    ERROR_MSG: "Session not found.",
                    ERROR: ERROR_SESSION_NOT_FOUND,
                    SUB_COMMAND: v_sub
                })));
            };
            let v_params = TeamParams {
                target: p_target.filter(|t| js_truthy(Some(t))).or(p_account).cloned(),
                permission: p_permission.cloned(),
                access_code: p_code.cloned(),
                is_admin: p_is_admin.cloned(),
            };
            let mut v_reply = self.accounts.team_user_operation(&v_sub, &v_card, &v_params)?;
            v_reply[SUB_COMMAND] = v_sub;
            return Ok(Outcome::Reply(v_reply));
        }
        if !validator::validate_account_operation(p_sub, p_account, p_permission, p_code)? {
            return Ok(Outcome::Invalid);
        }
        let v_account = validator::trim(p_account)?.unwrap_or(Value::Null);
        let v_permission = json!(validator::js_trim(p_permission.and_then(Value::as_str).unwrap_or_default()));
        let v_code = validator::trim(p_code)?;
        let v_card = self.sessions.by_session(p_session);
        let v_single = matches!(self.accounts.kind(), Kind::Single);
        let v_with_sub = |p_reply: Option<Value>, p_sub: &str| -> Outcome {
            match p_reply {
                Some(mut r) => {
                    r[SUB_COMMAND] = json!(p_sub);
                    Outcome::Reply(r)
                }
                None => Outcome::Never,
            }
        };
        match v_sub_text {
            CMD_CREATE_ACCESSCODE => {
                if v_single {
                    return Ok(Outcome::Reply(single_mode_error()));
                }
                let v_effective = if js_truthy(Some(&v_permission)) { v_permission } else { json!("0xffffffff") };
                let v_reply =
                    self.accounts.create_access_code(&v_account, &v_effective, v_card.is_some(), !p_agent_path)?;
                Ok(v_with_sub(v_reply, CMD_CREATE_ACCESSCODE))
            }
            CMD_REGENERATE_ACCESSCODE => {
                if v_single {
                    return Ok(Outcome::Reply(single_mode_error()));
                }
                let v_recovery = validator::trim(p_recovery)?;
                let v_own = self.verify_ownership(&v_account, v_code.as_ref(), v_recovery.as_ref(), v_card.as_ref())?;
                if !v_own.proven {
                    return Ok(Outcome::Reply(
                        v_own.error.unwrap_or_else(|| permission_error("Ownership verification failed.")),
                    ));
                }
                let v_reply = self.accounts.regenerate_access_code(&v_account, v_own.existing_permission.as_ref())?;
                if let Some(r) = &v_reply {
                    if is_ok(r) {
                        let v_keep = v_card
                            .as_ref()
                            .filter(|c| js_strict_eq(c.get("m_login_name"), Some(&v_account)))
                            .and_then(|c| c.get("m_session_id"));
                        self.revoke_account_sessions(&v_account, v_keep);
                    }
                }
                Ok(v_with_sub(v_reply, CMD_REGENERATE_ACCESSCODE))
            }
            CMD_GET_ACCOUNT_NAME => {
                let v_reply = self.accounts.account_name_by_code(v_code.as_ref())?;
                Ok(v_with_sub(v_reply, CMD_GET_ACCOUNT_NAME))
            }
            _ => Ok(Outcome::Never),
        }
    }

    /// fn_accountOperationFromAgent: the self-service permission, no
    /// session, never an admin.
    pub fn account_operation_from_agent(
        &self,
        p_sub: Option<&Value>,
        p_account: Option<&Value>,
        p_code: Option<&Value>,
        p_app: Option<&Value>,
        p_extra: Option<&Value>,
        p_recovery: Option<&Value>,
    ) -> Js<Outcome> {
        if !validator::validate_agent_metadata(p_app, p_extra)? {
            return Ok(Outcome::Invalid);
        }
        self.account_operation(
            p_sub,
            p_account,
            Some(&json!(DEFAULT_SELF_SERVICE_PERMISSION)),
            p_code,
            None,
            None,
            None,
            true,
            p_recovery,
        )
    }

    /// fn_hardwareOperationFromAgent
    pub fn hardware_operation_from_agent(
        &self,
        p_sub: Option<&Value>,
        p_session: Option<&Value>,
        p_hw_id: Option<&Value>,
        p_hw_type: Option<&Value>,
    ) -> Js<Outcome> {
        if !validator::validate_hardware_operation(p_session, p_sub, p_hw_id, p_hw_type) {
            return Ok(Outcome::Invalid);
        }
        if p_sub.and_then(Value::as_str) != Some(CMD_VERIFY_HARDWARE_BY_ID) {
            return Ok(Outcome::Never);
        }
        let Some(v_card) = self.sessions.by_session(p_session) else {
            return Ok(Outcome::Reply(json!({ ERROR_MSG: "No hardware is found.", ERROR: ERROR_SESSION_NOT_FOUND })));
        };
        let v_sid = v_card.get("m_data").and_then(|d| d.get("m_sid"));
        Ok(Outcome::Reply(self.accounts.verify_hardware(v_sid, p_hw_id.unwrap(), p_hw_type.unwrap())))
    }

    /// fn_logout
    pub fn logout(&self, p_session: Option<&Value>) -> Js<Outcome> {
        if !validator::validate_session_id(p_session)? {
            return Ok(Outcome::Invalid);
        }
        let Some(v_card) = self.sessions.by_session(p_session) else { return Ok(Outcome::Invalid) };
        self.comm.remove_party(&v_card, None);
        self.sessions.delete(&js_interp(v_card.get("m_session_id")));
        Ok(Outcome::Reply(json!({ ERROR: ERROR_NON })))
    }
}
