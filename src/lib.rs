//! DroneEngage authentication server, ported from the Node.js server.
//!
//! Each module names the JavaScript module it replaces; the behaviour,
//! replies and console output follow it, except where a module documents a
//! difference.
pub mod accounts;
pub mod altcha;
pub mod auth;
pub mod cli;
pub mod comm;
pub mod config;
pub mod constants;
pub mod filedb;
pub mod jsv;
pub mod perm;
pub mod s2s;
pub mod sessions;
pub mod sqldb;
pub mod validator;
pub mod web;

pub use droneengage_server_common::{colors, logger, util};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The server state the JavaScript keeps in module globals.
pub struct Auth {
    pub cfg: config::Cfg,
    pub accounts: accounts::Accounts,
    pub sessions: sessions::Sessions,
    pub comm: comm::CommManager,
    pub altcha: altcha::Altcha,
    pub logger: Option<logger::FileLogger>,
}

impl Auth {
    /// The state over an opened account store (no logger).
    pub fn new(p_accounts: accounts::Accounts) -> Auth {
        let v_cfg = p_accounts.cfg.clone();
        Auth {
            altcha: altcha::Altcha::new(v_cfg.clone()),
            cfg: v_cfg,
            accounts: p_accounts,
            sessions: Default::default(),
            comm: Default::default(),
            logger: None,
        }
    }
}
