"use strict";

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
// Optional: Uncomment for password hashing
// const bcrypt = require('bcrypt');

const info_field = 'db_info';

class db_user {
    constructor(database_file) {
        // Initialize LowDB with JSONFile adapter
        // Handle both absolute and relative paths
        const file = path.isAbsolute(database_file) 
            ? database_file 
            : path.join(__dirname, '..', database_file);
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
            return;
        }

        // Validate required fields (sid, AccessCode, prm) to match data structure
        if (!user_data.sid || !user_data.AccessCode || !user_data.prm) {
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

        this.db.data.logins[user_email] = {
            LoginID: loginID,
            TeamID: teamID,
            LoginName: user_email,
            AccessCode: user_data.AccessCode,
            Permissions: permissions,
            IsAdmin: user_data.isadmin
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
            return;
        }

        // Validate required fields (sid, AccessCode, prm) to match data structure
        if (!user_data.sid || !user_data.AccessCode || !user_data.prm) {
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

        this.db.data.logins[user_email] = {
            ...existingLogin,
            TeamID: teamID,
            LoginName: user_email,
            AccessCode: user_data.AccessCode,
            Permissions: permissions,
            IsAdmin: user_data.isadmin
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
            isadmin: login.IsAdmin
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
                    isadmin: login.IsAdmin
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
                isadmin: login.IsAdmin
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
            if (login.AccessCode === accesscode) {
                // Convert internal structure to public API shape
                return { 
                    sid: login.TeamID,
                    AccessCode: login.AccessCode,
                    prm: login.Permissions,
                    isadmin: login.IsAdmin,
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
            if (login.TeamID === sid) {
                // Convert internal structure to public API shape
                users[email] = {
                    sid: login.TeamID,
                    AccessCode: login.AccessCode,
                    prm: login.Permissions,
                    isadmin: login.IsAdmin
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
}

module.exports = {
    db_user
};