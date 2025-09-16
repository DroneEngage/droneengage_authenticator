"use strict";

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
// Optional: Uncomment for password hashing
// const bcrypt = require('bcrypt');

const info_field = 'db_info';

class db_user {
    constructor(database_file) {
        // Initialize LowDB with JSONFile adapter
        const file = path.join(__dirname, '..', database_file);
        const adapter = new JSONFile(file);
        this.db = new Low(adapter, { [info_field]: { SID: 0 }, users: {} });

        // Synchronous read in constructor to match original behavior
        // Note: Use try-catch to handle potential errors
        try {
            this.db.read();
        } catch (err) {
            console.error('Failed to initialize DB:', err);
        }
    }

    /**
     * Add or update a user record (async)
     * @param {string} user_email - Email as the user key
     * @param {object} user_data - User data { sid, pwd, prm, isadmin }
     * @returns {Promise<void>} - Resolves when record is added
     */
    async fn_add_record(user_email, user_data, fn_callback) {
        if (!user_data || user_email === info_field) {
            return;
        }

        // Validate required fields (sid, pwd, prm) to match data structure
        if (!user_data.sid || !user_data.pwd || !user_data.prm) {
            return;
        }

        // Set default isadmin if not provided
        user_data.isadmin = user_data.isadmin ?? false;

        // Optional: Hash password (uncomment to enable)
        // user_data.pwd = await bcrypt.hash(user_data.pwd, 10);

        if (this.db.data.users[user_email]) {
            // record already exists
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Duplicate entry.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
            return;
        }
        
        this.db.data.users[user_email] = user_data;
        try {
            await this.db.write();
        } catch (err) {
            
            console.error('Failed to write record:', err);

            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Storage Error.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
        }


        let c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        if (fn_callback) fn_callback(c_reply);
            
    }


    /**
     * Add or update a user record (async)
     * @param {string} user_email - Email as the user key
     * @param {object} user_data - User data { sid, pwd, prm, isadmin }
     * @returns {Promise<void>} - Resolves when record is added
     */
    async fn_update_record(user_email, user_data, fn_callback) {
        if (!user_data || user_email === info_field) {
            return;
        }

        // Validate required fields (sid, pwd, prm) to match data structure
        if (!user_data.sid || !user_data.pwd || !user_data.prm) {
            return;
        }

        // Set default isadmin if not provided
        user_data.isadmin = user_data.isadmin ?? false;

        // Optional: Hash password (uncomment to enable)
        // user_data.pwd = await bcrypt.hash(user_data.pwd, 10);

        if (!this.db.data.users[user_email]) {
            // record already exists
            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            if (fn_callback) fn_callback(c_reply);
            return;
        }
        
        this.db.data.users[user_email] = user_data;
        try {
            await this.db.write();
        } catch (err) {
            
            console.error('Failed to write record:', err);

            let c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Storage Error.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            if (fn_callback) fn_callback(c_reply);
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
        return Object.keys(this.db.data.users);
    }

    /**
     * Delete a user record by email (async)
     * @param {string} key - Email of the user to delete
     * @returns {Promise<void>} - Resolves when record is deleted
     */
    async fn_delete_record(key) {
        if (key === info_field || !this.db.data.users[key]) {
            return;
        }
        delete this.db.data.users[key];
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
        return this.db.data.users[key] || null;
    }

    /**
     * Get all non-admin users
     * @returns {object} - Object of non-admin user records keyed by email
     */
    fn_get_all_users() {
        const users = {};
        for (const [email, user] of Object.entries(this.db.data.users)) {
            if (user.isadmin === false) {
                users[email] = user;
            }
        }
        return users;
    }

    /**
     * Get a user by password (access code) (async)
     * @param {string} accesscode - The password to match
     * @returns {Promise<object|null>} - User record with email as acc property or null
     */
    fn_get_user_by_accesscode(accesscode) {
        for (const [email, user] of Object.entries(this.db.data.users)) {
            // Optional: Uncomment for bcrypt comparison
            // if (await bcrypt.compare(accesscode, user.pwd)) {
            if (user.pwd === accesscode) {
                return { ...user, acc: email };
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
        for (const [email, user] of Object.entries(this.db.data.users)) {
            if (user.sid === sid) {
                users[email] = user;
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