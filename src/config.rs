//! Server configuration (js_serverConfig.js): droneengage_server_common's
//! loader with `$$HASH$$` handling and this server's environment overrides.

pub use droneengage_server_common::config::*;

use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use droneengage_server_common::util::{js_interp, js_truthy};

fn terminal_enabled(p_cfg: &mut Map<String, Value>, p_value: &str) {
    p_cfg.insert("webadmin_terminal_enabled".into(), Value::Bool(p_value == "true" || p_value == "1"));
}

fn debug_logging(p_cfg: &mut Map<String, Value>, p_value: &str) {
    p_cfg.insert("debug_logging".into(), Value::Bool(p_value == "true" || p_value == "1"));
}

/// js_serverConfig.js's envOverrides.
pub const ENV_OVERRIDES: [(&str, EnvOverride); 3] = [
    ("de_auth_servers_status_guid", EnvOverride::Key("servers_admin_url_guid")),
    ("de_auth_webadmin_terminal_enabled", EnvOverride::Transform(terminal_enabled)),
    ("de_auth_debug_logging", EnvOverride::Transform(debug_logging)),
];

/// Loads the authentication server's configuration.
pub fn load(
    p_base_dir: &Path,
    p_file_name: &str,
    p_env: &dyn Fn(&str) -> Option<String>,
    p_log: &dyn Fn(&str),
) -> Result<Config, ConfigError> {
    Config::load_with(
        p_base_dir,
        p_file_name,
        &LoadOptions { env: p_env, log: p_log, overrides: &ENV_OVERRIDES, hash_handling: true },
    )
}

/// The shared, read-only configuration (`global.m_serverconfig.m_configuration`).
#[derive(Clone)]
pub struct Cfg(Arc<Config>);

impl Cfg {
    pub fn new(p_config: Config) -> Cfg {
        Cfg(Arc::new(p_config))
    }

    /// A configuration from an object, rooted at the current directory (tests).
    pub fn from_value(p_value: Value) -> Cfg {
        Cfg::new(Config::from_value(p_value, std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))))
    }

    pub fn config(&self) -> &Config {
        &self.0
    }

    pub fn get(&self, p_key: &str) -> Option<&Value> {
        self.0.get(p_key)
    }

    /// `hasOwnProperty(key)`
    pub fn has(&self, p_key: &str) -> bool {
        self.0.raw().as_object().map(|m| m.contains_key(p_key)).unwrap_or(false)
    }

    pub fn is_true(&self, p_key: &str) -> bool {
        self.0.is_true(p_key)
    }

    pub fn is_false(&self, p_key: &str) -> bool {
        self.0.is_false(p_key)
    }

    pub fn truthy(&self, p_key: &str) -> bool {
        js_truthy(self.get(p_key))
    }

    /// `String(cfg[key])` for a truthy value.
    pub fn text(&self, p_key: &str) -> Option<String> {
        self.get(p_key).filter(|v| js_truthy(Some(v))).map(|v| js_interp(Some(v)))
    }

    /// `${cfg[key]}` (undefined when missing).
    pub fn interp(&self, p_key: &str) -> String {
        js_interp(self.get(p_key))
    }

    /// `account_storage_type.toLowerCase()` ('' when not a string; startup
    /// refuses such a configuration).
    pub fn storage_type(&self) -> String {
        match self.get("account_storage_type") {
            Some(Value::String(s)) => s.to_lowercase(),
            _ => String::new(),
        }
    }

    /// servers_admin_url_guid when set (truthy).
    pub fn admin_guid(&self) -> Option<String> {
        self.text("servers_admin_url_guid")
    }

    /// `path.resolve(repoRoot, p)`; absolute paths stay as they are.
    pub fn resolve(&self, p_path: &str) -> PathBuf {
        if Path::new(p_path).is_absolute() {
            return PathBuf::from(p_path);
        }
        self.0.resolve(p_path)
    }

    pub fn root(&self) -> &Path {
        self.0.base_dir()
    }
}
