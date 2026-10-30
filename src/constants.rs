//! Protocol constants (js_constants.js).

pub const AGENT_LOGIN_COMMAND: &str = "/al";
pub const AGENT_ACCOUNT_MANAGMENT: &str = "/aam";
pub const AGENT_HARDWARE_MANAGMENT: &str = "/ah";
pub const WEB_LOGIN_COMMAND: &str = "/wl";
pub const ACCOUNT_MANAGMENT: &str = "/am";
pub const WEB_LOGOUT_COMMAND: &str = "/wo";
pub const CAPTCHA_CHALLENGE: &str = "/cc";

pub const WEB_FUNCTION: &str = "/w";
pub const AGENT_FUNCTION: &str = "/agent";
pub const ADMIN_FUNCTION: &str = "/admin";

// request fields
pub const ACCOUNT_NAME_PARAMETER: &str = "acc";
pub const PERMISSION_PARAMETER: &str = "prm";
pub const ACCESS_CODE_PARAMETER: &str = "pwd";
pub const ACCOUNT_ID_PARAMETER: &str = "aid";
pub const LOGIN_ID_PARAMETER: &str = "lid";
pub const TARGET_LOGIN_PARAMETER: &str = "tln";
pub const IS_ADMIN_PARAMETER: &str = "isadmin";
pub const RECOVERY_CODE_PARAMETER: &str = "rc";
pub const CAPTCHA_PAYLOAD_PARAMETER: &str = "cp";
pub const APP_NAME_PARAMETER: &str = "app";
pub const APP_GROUP_PARAMETER: &str = "gr";
pub const EXTRA_PARAMETER: &str = "ex";

// reply fields
pub const COMMAND: &str = "cm";
pub const SUB_COMMAND: &str = "scm";
pub const HARDWARE_ID: &str = "hi";
pub const HARDWARE_TYPE: &str = "ht";
pub const ACTOR_TYPE: &str = "at";
pub const SESSION_ID: &str = "sid";
pub const PERMISSION: &str = "per";
pub const PERMISSION2: &str = "prm";
pub const COMM_SERVER: &str = "cs";
pub const ERROR: &str = "e";
pub const ERROR_MSG: &str = "em";
pub const INSTANCE_LIMIT: &str = "il";

// sub commands
pub const CMD_CREATE_ACCESSCODE: &str = "c";
pub const CMD_REGENERATE_ACCESSCODE: &str = "r";
pub const CMD_GET_ACCOUNT_NAME: &str = "g";
pub const CMD_VERIFY_HARDWARE_BY_ID: &str = "vh";
pub const CMD_LIST_TEAM_USERS: &str = "ltu";
pub const CMD_ADD_TEAM_USER: &str = "atu";
pub const CMD_UPDATE_TEAM_USER: &str = "utu";
pub const CMD_DELETE_TEAM_USER: &str = "dtu";
pub const CMD_GET_TEAM_INFO: &str = "gti";
pub const CMD_VERIFY_TEAM_USER: &str = "vtu";

/// The team-admin sub commands (the session is the credential).
pub const TEAM_ADMIN_COMMANDS: [&str; 6] = [
    CMD_LIST_TEAM_USERS,
    CMD_ADD_TEAM_USER,
    CMD_UPDATE_TEAM_USER,
    CMD_DELETE_TEAM_USER,
    CMD_GET_TEAM_INFO,
    CMD_VERIFY_TEAM_USER,
];

// comm server commands
pub const CS_CMD_INFO: &str = "a";
pub const CS_CMD_LOGIN_REQUEST: &str = "b";
pub const CS_CMD_LOGOUT_REQUEST: &str = "c";
pub const CS_CMD_STORAGE_STATUS: &str = "d";
pub const CS_CMD_QUERY_UDP_PROXIES: &str = "e";
pub const CS_CMD_REPORT_UDP_PROXIES: &str = "f";
pub const CS_CMD_SET_UDP_PROXY_STATE: &str = "g";
pub const CS_CMD_SET_UNIT_TRAFFIC_STATE: &str = "h";
pub const CS_CMD_REPORT_BLOCKED_UNITS: &str = "i";
pub const CS_CMD_UDP_RELAY_STATUS: &str = "j";

pub const CS_ACCOUNT_ID: &str = "a";
pub const CS_GROUP_ID: &str = "b";
pub const CS_SENDER_ID: &str = "s";
pub const CS_ERROR: &str = "e";
pub const CS_LOGIN_TEMP_KEY: &str = "f";
pub const CS_SERVER_PUBLIC_HOST: &str = "g";
pub const CS_SERVER_PORT: &str = "h";
pub const CS_REQUEST_ID: &str = "r";

// error numbers
pub const ERROR_NON: i64 = 0;
pub const ERROR_INVALID_DATA: i64 = 1;
pub const ERROR_ACCOUNT_NOT_FOUND: i64 = 2;
pub const ERROR_DATA_DATABASE_ERROR: i64 = 3;
pub const ERROR_SERVER_NOT_AVAILABLE: i64 = 5;
pub const ERROR_NO_PERMISSION: i64 = 6;
pub const ERROR_SESSION_NOT_FOUND: i64 = 7;
pub const ERROR_HARDWARE_NOT_FOUND: i64 = 8;
pub const ERROR_ACCOUNT_DISABLED: i64 = 9;
pub const ERROR_NOT_FOUND: i64 = 10;
pub const ERROR_NOT_SUPPORTED_SINGLE_MODE: i64 = 11;
pub const ERROR_UNKNOWN: i64 = 999;

/// Agent-created accounts get this permission (no GCS login bit).
pub const DEFAULT_SELF_SERVICE_PERMISSION: &str = "0x00001111";

pub const ACCOUNT_NAME_MAX_LENGTH: usize = 255;
pub const ACCESSCODE_MAX_LENGTH: usize = 200;
pub const SESSION_MAX_LENGTH: usize = 200;

// permission bits (js_permisson_validator.js)
pub const ALLOW_GCS: u32 = 0x00000001;
pub const ALLOW_UNIT: u32 = 0x00000010;
pub const ALLOW_GCS_LOGIN: u32 = 0x80000000;
pub const ALLOW_UNIT_LOGIN: u32 = 0x40000000;
pub const ALLOW_VIEW_MODE: u32 = 0x20000000;
pub const CATEGORY_ACTION_MASK: u32 = 0x03ffffff;
