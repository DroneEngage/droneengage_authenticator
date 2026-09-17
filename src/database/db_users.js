"use strict";

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
const hlp_password = require('droneengage_server_common').password;
const c_permission = require('../auth_server/js_permisson_validator.js');

const info_field = 'db_info';

class db_user {
    constructor(database_file) {
        // Initialize LowDB with JSONFile adapter
        // Handle both absolute and relative paths
        const file = path.isAbsolute(database_file) 
            ? database_file 
            : path.join(__dirname, '..', '..', database_file);
        const adapter = new JSONFile(file);
        
        // Read file synchronously to work with LowDB v7's async requirement
        let initialData = { 
            [info_field]: { TeamID: 0, LoginID: 0 }, 
            teams: {}, 
            logins: {} 
        };
        
        try {
            if (fs.existsSync(file)) {
                const content = fs.readFileSync(file, 'utf8');
                const parsed = JSON.parse(content);
                if (parsed && typeof parsed === 'object') {
                    initialData = parsed;
                }
            }
        } catch (err) {
            console.error('Failed to read DB file, using defaults:', err.message);
        }
        
        this.db = new Low(adapter, initialData);

        // Auto-migrate old flat-file format if detected
        try {
            this._migrate_if_needed();
        } catch (err) {
            console.error('Failed to migrate DB:', err);
        }
    }

    /**
     * Auto-migrate old flat-file format to new teams/logins structure
     * This ensures backward compatibility with existing db_users.db files
     */
    _migrate_if_needed() {
        // Check if already in new format (has teams and logins)
        if (this.db.data.teams && this.db.data.logins) {
            return;  // Already migrated, skip
        }
        
        // Check if old format exists (has 'users' field but not 'teams')
        if (this.db.data.users && !this.db.data.teams) {
            console.log('[INFO] Migrating old flat-file format to new teams/logins structure');
            
            const oldUsers = this.db.data.users;
            this.db.data.teams = {};
            this.db.data.logins = {};
            let maxTeamID = 0;
            let maxLoginID = 0;

            // Group users by sid (TeamID) to create teams
            const teamsBySid = {};
            for (const [email, user] of Object.entries(oldUsers)) {
                const sid = user.sid || 1;
                if (!teamsBySid[sid]) {
                    teamsBySid[sid] = {
                        TeamID: sid,
                        TeamName: email,  // Use first email as team name
                        Email: email,
                        InstanceLimit: 999,
                        Enabled: true
                    };
                    if (sid > maxTeamID) maxTeamID = sid;
                }
            }

            // Create teams
            for (const team of Object.values(teamsBySid)) {
                this.db.data.teams[team.TeamID] = team;
            }

            // Create logins
            for (const [email, user] of Object.entries(oldUsers)) {
                const sid = user.sid || 1;
                const loginID = maxLoginID + 1;
                maxLoginID = loginID;
                
                // Normalize permission literal
                let permissions = user.prm || '0xffffffff';
                if (permissions === 'D1G1T3R4V5C6') {
                    permissions = '0xffffffff';
                }
                permissions = c_permission.fn_convertPermissiontoInt(permissions);

                this.db.data.logins[email] = {
                    LoginID: loginID,
                    TeamID: sid,
                    LoginName: email,
                    AccessCode: user.AccessCode || user.pwd,
                    Permissions: permissions,
                    IsAdmin: user.isadmin || false
                };
            }

            // Update counters
            this.db.data[info_field].TeamID = maxTeamID;
            this.db.data[info_field].LoginID = maxLoginID;

            // Remove old users field
            delete this.db.data.users;

            // Write migrated data
            this.db.write().catch(err => console.error('Failed to write migrated DB:', err));
            console.log('[INFO] Migration completed');
        }
    }

    /**
     * Add or update a user record (async)
     * @param {string} user_email - Email as the user key
     * @param {object} user_data - User data { sid, AccessCode, prm, isadmin }
     * @returns {Promise<void>} - Resolves when record is added
     */
    async fn_add_record(user_email, user_data, fn_callback) {
        if (!user_data || user_email === info_field) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Invalid parameters.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Validate required fields (sid, AccessCode, prm) to match data structure
        if (!user_data.sid || !user_data.AccessCode || !user_data.prm) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Missing required fields (sid, AccessCode, or prm).";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Set default isadmin if not provided
        user_data.isadmin = user_data.isadmin ?? false;

        // Check if login already exists
        if (this.db.data.logins[user_email]) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Duplicate entry.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Ensure team exists (create if needed)
 const teamID = user_data.sid;
        if (!this.db.data.teams[teamID]) {
            this.db.data.teams[teamID] = {
                TeamID: teamID,
                TeamName: user_email,  // Use email as initial team name
                Email: user_email,
                InstanceLimit: 999,
                Enabled: true
            };
            if (teamID > this.db.data[info_field].TeamID) {
                this.db.data[info_field].TeamID = teamID;
            }
        }

        // Create login record
        const loginID = this.db.data[info_field].LoginID + 1;
        this.db.data[info_field].LoginID = loginID;

        // Normalize permission literal
        let permissions = user_data.prm;
        if (permissions === 'D1G1T3R4V5C6') {
            permissions = '0xffffffff';
        }
        permissions = c_permission.fn_convertPermissiontoInt(permissions);

        // SECURITY: hash the access code before storing it.
        const storedAccessCode = hlp_password.isHashed(user_data.AccessCode)
            ? user_data.AccessCode
            : hlp_password.hash(user_data.AccessCode);

        this.db.data.logins[user_email] = {
            LoginID: loginID,
            TeamID: teamID,
            LoginName: user_email,
            AccessCode: storedAccessCode,
            Permissions: permissions,
            IsAdmin: user_data.isadmin,
            Enabled: (user_data.enabled !== false)
        };

        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to write record:', err);
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Storage Error.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        let c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        c_reply[global.c_CONSTANTS.CONST_ACCOUNT_ID_PARAMETER.toString()] = teamID;
        c_reply[global.c_CONSTANTS.CONST_LOGIN_ID_PARAMETER.toString()] = loginID;
        if (fn_callback) fn_callback(c_reply);
    }


    /**
     * Add or update a user record (async)
     * @param {string} user_email - Email as the user key
     * @param {object} user_data - User data { sid, AccessCode, prm, isadmin }
     * @returns {Promise<void>} - Resolves when record is added
     */
    async fn_update_record(user_email, user_data, fn_callback) {
        if (!user_data || user_email === info_field) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Invalid parameters.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Validate required fields (sid, AccessCode, prm) to match data structure
        if (!user_data.sid || !user_data.AccessCode || !user_data.prm) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Missing required fields (sid, AccessCode, or prm).";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Set default isadmin if not provided
        user_data.isadmin = user_data.isadmin ?? false;

        if (!this.db.data.logins[user_email]) {
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Update login record (preserve LoginID and TeamID)
        const existingLogin = this.db.data.logins[user_email];
        const teamID = user_data.sid;

        // Normalize permission literal
        let permissions = user_data.prm;
        if (permissions === 'D1G1T3R4V5C6') {
            permissions = '0xffffffff';
        }
        permissions = c_permission.fn_convertPermissiontoInt(permissions);

        // SECURITY: hash the access code before storing it.
        const storedAccessCode = hlp_password.isHashed(user_data.AccessCode)
            ? user_data.AccessCode
            : hlp_password.hash(user_data.AccessCode);

        this.db.data.logins[user_email] = {
            ...existingLogin,
            TeamID: teamID,
            LoginName: user_email,
            AccessCode: storedAccessCode,
            Permissions: permissions,
            IsAdmin: user_data.isadmin,
            Enabled: (user_data.enabled === undefined) ? (existingLogin.Enabled !== false) : (user_data.enabled !== false)
        };

        // Ensure team exists
        if (!this.db.data.teams[teamID]) {
            this.db.data.teams[teamID] = {
                TeamID: teamID,
                TeamName: user_email,
                Email: user_email,
                InstanceLimit: 999,
                Enabled: true
            };
            if (teamID > this.db.data[info_field].TeamID) {
                this.db.data[info_field].TeamID = teamID;
            }
        }

        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to write record:', err);
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Storage Error.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        let c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        c_reply[global.c_CONSTANTS.CONST_ACCOUNT_ID_PARAMETER.toString()] = existingLogin.TeamID;
        c_reply[global.c_CONSTANTS.CONST_LOGIN_ID_PARAMETER.toString()] = existingLogin.LoginID;
        if (fn_callback) fn_callback(c_reply);
    }


    /**
     * Get all user keys (email addresses, excluding info_field)
     * @returns {string[]} - Array of user emails
     */
    fn_get_keys() {
        return Object.keys(this.db.data.logins);
    }

    /**
     * Delete a user record by email (async)
     * @param {string} key - Email of the user to delete
     * @returns {Promise<void>} - Resolves when record is deleted
     */
    async fn_delete_record(key) {
        if (key === info_field || !this.db.data.logins[key]) {
            return;
        }
        delete this.db.data.logins[key];
        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to delete record:', err);
        }
    }

    /**
     * Enable or disable a login (async). A disabled login is rejected at
     * login time with CONST_ERROR_ACCOUNT_DISABLED.
     * @param {string} user_email - Email/login name of the user
     * @param {boolean} p_enabled - true to enable, false to disable
     */
    async fn_set_login_enabled(user_email, p_enabled, fn_callback) {
        const c_reply = {};
        const login = this.db.data.logins[user_email];
        if (!login) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        login.Enabled = (p_enabled === true);

        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to write record:', err);
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "Storage Error.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        if (fn_callback) fn_callback(c_reply);
    }

    /**
     * Get a user record by email
     * @param {string} key - Email of the user
     * @returns {object|null} - The user record or null if not found
     */
    fn_get_record(key) {
        const login = this.db.data.logins[key];
        if (!login) return null;
        
        // Convert internal structure to public API shape
        return {
            sid: login.TeamID,
            AccessCode: login.AccessCode,
            prm: login.Permissions,
            isadmin: login.IsAdmin,
            enabled: (login.Enabled !== false)
        };
    }

    /**
     * Get all non-admin users
     * @returns {object} - Object of non-admin user records keyed by email
     */
    fn_get_all_users() {
        const users = {};
        for (const [email, login] of Object.entries(this.db.data.logins)) {
            if (login.IsAdmin === false) {
                // Convert internal structure to public API shape
                users[email] = {
                    sid: login.TeamID,
                    AccessCode: login.AccessCode,
                    prm: login.Permissions,
                    isadmin: login.IsAdmin,
                    enabled: (login.Enabled !== false)
                };
            }
        }
        return users;
    }

    /**
     * Get all users (including admins)
     * @returns {object} - Object of all user records keyed by email
     */
    fn_get_all_users_including_admins() {
        const users = {};
        for (const [email, login] of Object.entries(this.db.data.logins)) {
            // Convert internal structure to public API shape
            users[email] = {
                sid: login.TeamID,
                AccessCode: login.AccessCode,
                prm: login.Permissions,
                isadmin: login.IsAdmin,
                enabled: (login.Enabled !== false)
            };
        }
        return users;
    }

    /**
     * Get a user by password (access code) (async)
     * @param {string} accesscode - The password to match
     * @returns {Promise<object|null>} - User record with email as acc property or null
     */
    fn_get_user_by_accesscode(accesscode) {
        for (const [email, login] of Object.entries(this.db.data.logins)) {
            // SECURITY: verify against hashed (or legacy plaintext) stored code.
            if (hlp_password.verify(accesscode, login.AccessCode) === true) {
                // Convert internal structure to public API shape
                return {
                    sid: login.TeamID,
                    AccessCode: login.AccessCode,
                    prm: login.Permissions,
                    isadmin: login.IsAdmin,
                    enabled: (login.Enabled !== false),
                    acc: email
                };
            }
        }
        return null;
    }

    /**
     * Get users by account SID
     * @param {number} sid - The account SID
     * @returns {object} - Object of user records with matching SID
     */
    fn_get_users_by_sid(sid) {
        const users = {};
        for (const [email, login] of Object.entries(this.db.data.logins)) {
            if (String(login.TeamID) === String(sid)) {
                // Convert internal structure to public API shape
                users[email] = {
                    sid: login.TeamID,
                    AccessCode: login.AccessCode,
                    prm: login.Permissions,
                    isadmin: login.IsAdmin,
                    enabled: (login.Enabled !== false)
                };
            }
        }
        return users;
    }

    /**
     * Sync database to disk (async)
     * @returns {Promise<void>} - Resolves when synced
     */
    async fn_sync_to_disk() {
        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to sync to disk:', err);
        }
    }


    // ─── Team user administration (file mode) ──────────────────────────────
    // All methods below are scoped to a single TeamID.  The caller (account
    // manager) derives p_teamId from the authenticated session's login card,
    // so a client can never operate on another team's data.

    /**
     * Get read-only team info for a given TeamID.
     */
    fn_get_team_info(p_teamId) {
        const team = this.db.data.teams[p_teamId];
        if (!team) return null;
        return {
            TeamID: team.TeamID,
            TeamName: team.TeamName,
            Email: team.Email,
            InstanceLimit: team.InstanceLimit,
            Enabled: team.Enabled,
            CreatedAt: team.CreatedAt
        };
    }

    /**
     * List all logins belonging to a team.  AccessCode hashes are deliberately
     * omitted from the result.
     */
    fn_get_team_logins(p_teamId) {
        const result = [];
        for (const [email, login] of Object.entries(this.db.data.logins)) {
            if (String(login.TeamID) === String(p_teamId)) {
                result.push({
                    LoginID: login.LoginID,
                    LoginName: login.LoginName || email,
                    Permissions: login.Permissions,
                    IsAdmin: (login.IsAdmin === true),
                    Enabled: (login.Enabled !== false),
                    CreatedAt: login.CreatedAt
                });
            }
        }
        result.sort((a, b) => (a.LoginName || '').localeCompare(b.LoginName || ''));
        return result;
    }

    /**
     * Add a new login to a team.  Access code is hashed before storage.
     * Auto-generates an access code if none is provided.
     */
    async fn_add_team_login(p_teamId, p_loginName, p_accessCode, p_permissions, p_isAdmin, fn_callback) {
        const c_reply = {};

        if (!p_loginName || p_loginName === info_field) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Invalid login name.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Duplicate check
        if (this.db.data.logins[p_loginName]) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Duplicate login name.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        // Auto-generate access code if not provided
        let finalAccessCode = p_accessCode;
        if (!finalAccessCode || finalAccessCode.trim() === '') {
            const { v4: uuidv4 } = require('uuid');
            finalAccessCode = uuidv4().replaceAll('-', '').substr(0, 12);
        }

        const storedAccessCode = hlp_password.isHashed(finalAccessCode)
            ? finalAccessCode
            : hlp_password.hash(finalAccessCode);

        const loginID = this.db.data[info_field].LoginID + 1;
        this.db.data[info_field].LoginID = loginID;

        this.db.data.logins[p_loginName] = {
            LoginID: loginID,
            TeamID: p_teamId,
            LoginName: p_loginName,
            AccessCode: storedAccessCode,
            Permissions: c_permission.fn_convertPermissiontoInt(p_permissions),
            IsAdmin: (p_isAdmin === true),
            Enabled: true
        };

        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to write team login:', err);
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Storage error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
        c_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = finalAccessCode;
        c_reply[global.c_CONSTANTS.CONST_LOGIN_ID_PARAMETER.toString()] = loginID;
        if (fn_callback) fn_callback(c_reply);
    }

    /**
     * Update an existing login within a team.  Access code is only changed
     * if a new plaintext is provided (then hashed).  Returns the new plaintext
     * if regenerated, null otherwise.
     */
    async fn_update_team_login(p_teamId, p_loginName, p_accessCodeOrNull, p_permissions, p_isAdmin, fn_callback) {
        const c_reply = {};

        const existing = this.db.data.logins[p_loginName];
        if (!existing || existing.TeamID !== p_teamId) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Login not found in this team.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        let returnedAccessCode = null;
        if (p_accessCodeOrNull && p_accessCodeOrNull.trim() !== '') {
            const plaintext = p_accessCodeOrNull.trim();
            returnedAccessCode = plaintext;
            existing.AccessCode = hlp_password.isHashed(plaintext) ? plaintext : hlp_password.hash(plaintext);
        }
        existing.Permissions = c_permission.fn_convertPermissiontoInt(p_permissions);
        existing.IsAdmin = (p_isAdmin === true);

        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to update team login:', err);
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Storage error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
        if (returnedAccessCode) {
            c_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = returnedAccessCode;
        }
        if (fn_callback) fn_callback(c_reply);
    }

    /**
     * Delete a login from a team.
     */
    async fn_delete_team_login(p_teamId, p_loginName, fn_callback) {
        const c_reply = {};
        const existing = this.db.data.logins[p_loginName];
        if (!existing || existing.TeamID !== p_teamId) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Login not found in this team.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        delete this.db.data.logins[p_loginName];
        try {
            await this.db.write();
        } catch (err) {
            console.error('Failed to delete team login:', err);
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Storage error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }

        c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
        if (fn_callback) fn_callback(c_reply);
    }

    /**
     * Count the number of admin logins in a team (used to prevent deleting or
     * demoting the last admin).
     */
    fn_count_team_admins(p_teamId) {
        let count = 0;
        for (const login of Object.values(this.db.data.logins)) {
            if (login.TeamID === p_teamId && login.IsAdmin === true) {
                count++;
            }
        }
        return count;
    }
}

module.exports = {
    db_user
};