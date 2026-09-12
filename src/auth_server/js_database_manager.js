"use strict";
const path = require('path');
const hlp_db = require("../helpers/hlp_db.js");
const _common = require("droneengage_server_common");
const hlp_string = _common.helpers.strings;
const hlp_validation = _common.helpers.validation;
const hlp_password = _common.password;
const v_users = require('../database/db_users');
const c_permission = require("./js_permisson_validator.js");



let m_db;


/**
 * Initalize database connection for database manager
 */
function fn_initialize()
{
    const fs = require('fs');

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'single') {
        return ;
    } 

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'file') {
        if (m_serverconfig.m_configuration.hasOwnProperty('file_db') === true) {
            // users database
            global.db_users = new v_users.db_user(global.m_serverconfig.m_configuration.file_db);
            console.log ("Users Database File  " + global.Colors.BSuccess + global.m_serverconfig.m_configuration.file_db + global.Colors.Reset);
            if (!fs.existsSync(global.m_serverconfig.m_configuration.file_db)) {
                console.log (global.Colors.Warn +  "[WARN] Database file not found: " + global.m_serverconfig.m_configuration.file_db + " - will be created on first user registration" + global.Colors.Reset);
            } else {
                console.log (global.Colors.Success +  "[OK] Database file exists and loaded" + global.Colors.Reset);
            }
            return;
        }
    }

    if (m_serverconfig.m_configuration.account_storage_type.toLowerCase() === 'db') {
    
        try
        {
            const sqlite3 = require('sqlite3');
            const rawDbPath = m_serverconfig.m_configuration.dbdatabase || 'database/andruav.db';
            const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.resolve(__dirname, '..', '..', rawDbPath);
            
            // Ensure directory exists
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            
            m_db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.log ("[FATAL] database error.");
                    console.log (JSON.stringify(err));
                    process.exit(1);
                }
                m_db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
                    if (pragmaErr) {
                        console.log ("[WARN] Failed to enable foreign keys:", pragmaErr.message);
                    }
                    console.log (global.Colors.Success + "[OK] SQLite Database is Connected: " + dbPath + global.Colors.Reset);
                });
            });
            
            // Expose database connection globally for admin routes
            global.m_db = m_db;
        }
        catch (ex)
        {
            console.log ("[FATAL] database error.");
            console.log (JSON.stringify(ex));
            process.exit(1);
        }
        
        return ;
    }

    console.log (global.Colors.BError + "FATAL ERROR:" + global.Colors.FgYellow + " account_storage_type or file_db or db connection" +  global.Colors.Reset + " are not specified in config file. ");
    process.exit(0);
}

/**
 * Get AccountSID & Permissions for a given email & accesscode.
 * @param {*} p_accountName email or username
 * @param {*} p_accessCode alphanumeric strinf
 * @param {*} fn_callback 
 */
function fn_do_loginAccount (p_accountName, p_accessCode, fn_callback)
{
    const c_reply = {};
    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Database Error";
                
            
    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName)))
    {
        // null or not valid login name
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    if ((p_accessCode == null) || (!hlp_string.fn_isAlphanumeric(p_accessCode)))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    
    // SECURITY: AccessCode is now stored as a bcrypt hash, so we can no longer
    // filter by it in SQL. Select candidate rows by LoginName only, then verify
    // the supplied plaintext with bcrypt.compare in JS.
    const c_sql = "SELECT logins.LoginID, logins.AccessCode, logins.IsAdmin, teams.TeamID, teams.Enabled, teams.InstanceLimit, logins.Permissions FROM logins JOIN teams ON teams.TeamID = logins.TeamID WHERE logins.LoginName = ?";

    hlp_db.fn_genericSelect_w_Params (m_db, c_sql,[hlp_string.fn_protectedFromInjection(p_accountName)],
    function (rows) {
        const c_reply = {};
        if ((rows == null) || (rows.length === 0))
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
            return;
        }

        // Find the row whose stored AccessCode (hash or legacy plaintext)
        // matches the supplied credential.
        let matchedRow = null;
        for (let i = 0; i < rows.length; ++i) {
            if (hlp_password.verify(p_accessCode, rows[i]['AccessCode']) === true) {
                matchedRow = rows[i];
                break;
            }
        }

        if (matchedRow == null) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
            return;
        }

        // Lazy upgrade: if the stored value was a legacy plaintext code,
        // re-hash it and persist so future logins use bcrypt.compare.
        if (!hlp_password.isHashed(matchedRow['AccessCode'])) {
            const c_hash = hlp_password.hash(p_accessCode);
            const c_up = "UPDATE `logins` SET `AccessCode` = ? WHERE `LoginID` = ?";
            hlp_db.fn_genericInsert_w_Params(m_db, c_up,
                [c_hash, matchedRow['LoginID']],
                function () { /* best-effort upgrade */ },
                function (uerr) { console.error("[login] lazy hash upgrade failed:", uerr); });
        }

        c_reply.m_data = {};
        c_reply.m_data.m_sid = matchedRow['TeamID'];
        c_reply.m_data.m_permission = 'D1G1T3R4V5C6';
        let v_prm = matchedRow['Permissions'];
        if (v_prm == 'D1G1T3R4V5C6')
        { // backward compatibility to be deleted in the next version.
            v_prm ='0xffffffff';
        }
        c_reply.m_data.m_prm = c_permission.fn_convertPermissiontoInt(v_prm);
        c_reply.m_data.m_enabled = matchedRow['Enabled'];
        c_reply.m_data.m_instance_limit = matchedRow['InstanceLimit'];
        c_reply.m_isadmin = (matchedRow['IsAdmin'] === 1 || matchedRow['IsAdmin'] === true);
        if (c_reply.m_data.m_enabled == 0)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_DISABLED;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account is Disabled.";
        }
        else
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
        }

        fn_callback (c_reply);
        return ;
    },
    function (error)
    {
        var c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Server is Down.";
        c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback (c_reply);
    });
}


/**
 * Get Account Name Email using accesscode. AccessCode is retreived from SubLogins.
 * @param {*} p_accessCode alphanumeric strinf
 * @param {*} fn_callback 
 */
function fn_do_getAccountNameByAccessCode (p_accessCode, fn_callback)
{
    const c_reply = {};
    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Database Error";
                
            
    if ((p_accessCode == null) || (!hlp_string.fn_isAlphanumeric(p_accessCode)))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    
    // SECURITY: AccessCode is hashed, so we cannot filter by it in SQL.
    // Fetch all logins joined with their team name and verify in JS.
    // NOTE: This iterates all logins — acceptable for the expected number of
    // accounts in a DroneEngage deployment. If the account table grows very
    // large, consider an additional deterministic lookup index (e.g. HMAC).
    const c_sql = "SELECT logins.AccessCode, teams.TeamName FROM logins JOIN teams ON teams.TeamID = logins.TeamID";

    hlp_db.fn_genericSelect_w_Params (m_db, c_sql,[],
    function (rows) {
        const c_reply = {};
        if (rows == null || rows.length === 0)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
            return;
        }

        let matchedName = null;
        for (let i = 0; i < rows.length; ++i) {
            if (hlp_password.verify(p_accessCode, rows[i]['AccessCode']) === true) {
                matchedName = rows[i]['TeamName'];
                break;
            }
        }

        if (matchedName == null) {
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
            return;
        }

        c_reply.m_data = {};
        c_reply.m_data.m_accountName = matchedName;
        c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback (c_reply);
        return ;
    },
    function (error)
    {
        var c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Server is Down.";
        c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback (c_reply);
    });
}


function fn_createSubLogin(p_accountName, p_newAccessCode, p_permission, fn_callback, p_isAdmin)
{

    const c_reply = {};

    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName)))
    {
        // null or not valid login name
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad LoginName";
            fn_callback(c_reply);
        }
        return ;
    }
    
    if ((p_newAccessCode == null) || (!hlp_string.fn_isAlphanumeric(p_newAccessCode)))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad AccessCode";
            fn_callback(c_reply);
        }
        return ;
    }

    // Look up the team for this account name.
    const c_team_sql = "SELECT `TeamID` FROM `teams` WHERE `TeamName` = ?";
    hlp_db.fn_genericSelect_w_Params(m_db, c_team_sql, [hlp_string.fn_protectedFromInjection(p_accountName)],
        function(rows) {
            if (!rows || rows.length === 0) {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = "Account Not Found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                fn_callback(c_reply);
                return;
            }

            const v_teamId = rows[0]['TeamID'];
            const c_isAdmin = p_isAdmin !== false ? 1 : 0;
            const c_sql = "INSERT INTO `logins`(`TeamID`, `LoginName`, `AccessCode`, `Permissions`, `IsAdmin`) VALUES (?, ?, ?, ?, ?)";

            // SECURITY: hash the access code before storing it.
            const c_hashedAccessCode = hlp_password.hash(p_newAccessCode);

            hlp_db.fn_genericInsert_w_Params (m_db, c_sql, [v_teamId, hlp_string.fn_protectedFromInjection(p_accountName), c_hashedAccessCode, c_permission.fn_convertPermissiontoInt(p_permission), c_isAdmin],
                function (err,res)
                {
                    const c_reply = {};

                    if (res && res.changes == 0)
                    {
                        // account not found
                        c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Database Error.";
                        c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
                    }
                    else
                    {
                        c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                        c_reply[global.c_CONSTANTS.CONST_ACCOUNT_ID_PARAMETER.toString()] = v_teamId;
                        c_reply[global.c_CONSTANTS.CONST_LOGIN_ID_PARAMETER.toString()] = res ? res.lastID : null;
                    }
                    fn_callback (c_reply);
                },
                function (p_err)
                {
                    fn_callback (p_err);
                });
        },
        function (p_err)
        {
            fn_callback(p_err);
        });
}

/**
 * create a new main account and one sub account.
 * @param {*} p_accountName 
 * @param {*} fn_callback 
 */
function fn_createNewAccessCode (p_accountName, p_newAccessCode, fn_callback, p_loginCard, p_isAdmin)
{
    const c_reply = {};
    
    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName)))
    {
        // null or not valid login name
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad LoginName";
            fn_callback(c_reply);
        }
        return ;
    }
    
    if ((p_newAccessCode == null) || (!hlp_string.fn_isAlphanumeric(p_newAccessCode)))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad AccessCode";
            fn_callback(c_reply);
        }
        return ;
    }
    
    // local database is active only when there is a valid login.
    // cannot access local database from Global Account page.
    if ((p_loginCard!=null) && (m_serverconfig.m_configuration.hasOwnProperty('file_db') === true)) {
     
        const p_reply = {};
        const user_data = {
            'acc':p_accountName,
            'isadmin': p_isAdmin === true,
            'sid': 1
        };
        global.db_users.fn_add_record(p_newAccessCode,user_data);
        p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback (c_reply);
            
        return ;

    }
    const c_sql = "INSERT INTO `teams` (`TeamID`, `TeamName`)  VALUES (NULL, ?)";

    hlp_db.fn_genericInsert_w_Params (m_db, c_sql, [hlp_string.fn_protectedFromInjection(p_accountName)],
		function (err, res)
		{
			c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
            c_reply[global.c_CONSTANTS.CONST_ACCOUNT_ID_PARAMETER.toString()] = res ? res.lastID : null;
            fn_callback (c_reply);
		},
		function (err)
		{
			if (err && err.code === 'SQLITE_CONSTRAINT')
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Duplicate entry.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            }
            else
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Database Error.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            }
            
            fn_callback (c_reply);
            
		}); 
}


function fn_deleteSubLogins (p_accountName, p_permission, fn_callback)
{
    const c_reply = {};
    
    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName)))
    {
        // null or not valid login name
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad LoginName";
            fn_callback(c_reply);
        }
        return ;
    }
    const c_sql = "DELETE FROM `logins` WHERE `TeamID` in ( select `TeamID` FROM `teams` WHERE `TeamName` LIKE ?) and `Permissions` = ?";

    hlp_db.fn_genericInsert_w_Params (m_db,c_sql, [hlp_string.fn_protectedFromInjection(p_accountName), c_permission.fn_convertPermissiontoInt(p_permission)],
		function (err,res) 
		{
            // if (res.changes == 0)
            // {
            //     // account not found
            //     c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Database Error.";
            //     c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            // }
            // else
            // {
            //     c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
            // }
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
            fn_callback (c_reply);
		},
		function (err,res)
		{
			if (err && err.code === 'SQLITE_CONSTRAINT')
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Duplicate entry.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            }
            else
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Database Error.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            }
            
            fn_callback (c_reply);
            
		}); 
}


/**
 * Check retrieve list of hardware attached to an AccountSID
 * @param {*} p_accountSID 
 * @param {*} fn_callback 
 * @returns 
 */
function fn_do_getHardwareVerifyByAccountSID (p_accountSID, fn_callback)
{
    const c_reply = {};
    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Database Error";
                
            
    if ((p_accountSID == null) || (!typeof (p_accountSID)=='number'))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    
    
    const c_sql = "select team_hardware.HardwareSID, team_hardware.HardwareID, team_hardware.HardwareType, team_hardware.RegisteredAt from team_hardware  WHERE team_hardware.TeamID=? ";
    hlp_db.fn_genericSelect_w_Params (m_db, c_sql,[p_accountSID],
    function (rows) {
        if ((rows == null) || (rows.length == 0))
        {  
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "No hardware is found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_HARDWARE_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            const c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "No hardware is found";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_hwID = {};
                    
                for (let i =0; i< rows.length; ++i)
                {
                    const c_obj = {};
                    c_obj.m_hwType = rows[i]['HardwareType'];
                    c_obj.m_registerTime = rows[i]['RegisteredAt'];
                    c_reply.m_data.m_hwID[rows[i]['HardwareID']] = c_obj;
                    
                }
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;

            }
            
            fn_callback (c_reply);
        }

        return ;
    },
    function (error)
    {
        const c_reply = {};
        c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Server is Down.";
       c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
        fn_callback (c_reply);
    });
}
 

// ─── Team user administration (db/SQL mode) ──────────────────────────────────
// All functions below are scoped to a single TeamID.  The caller (account
// manager) derives p_teamId from the authenticated session's login card, so
// a client can never operate on another team's data.

/**
 * Get read-only team info for a given TeamID.
 */
function fn_getTeamInfo(p_teamId, fn_callback) {
    const c_sql = 'SELECT TeamID, TeamName, Email, InstanceLimit, Enabled, CreatedAt FROM teams WHERE TeamID = ?';
    hlp_db.fn_genericSelect_w_Params(m_db, c_sql, [p_teamId],
        function (rows) {
            const c_reply = {};
            if (!rows || rows.length === 0) {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Team not found.';
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            } else {
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
                c_reply.m_data = rows[0];
            }
            fn_callback(c_reply);
        },
        function (err) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        });
}

/**
 * List all logins belonging to a team.  AccessCode hashes are deliberately
 * omitted from the result set.
 */
function fn_getTeamLogins(p_teamId, fn_callback) {
    const c_sql = 'SELECT LoginID, LoginName, Permissions, IsAdmin, CreatedAt FROM logins WHERE TeamID = ? ORDER BY LoginName';
    hlp_db.fn_genericSelect_w_Params(m_db, c_sql, [p_teamId],
        function (rows) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
            c_reply.m_data = (rows || []).map(function (r) {
                return {
                    LoginID: r.LoginID,
                    LoginName: r.LoginName,
                    Permissions: c_permission.fn_convertPermissiontoInt(r.Permissions),
                    IsAdmin: (r.IsAdmin === 1 || r.IsAdmin === true),
                    CreatedAt: r.CreatedAt
                };
            });
            fn_callback(c_reply);
        },
        function (err) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        });
}

/**
 * Add a new login to a team.  Access code is hashed before storage.
 */
function fn_addTeamLogin(p_teamId, p_loginName, p_accessCode, p_permissions, p_isAdmin, fn_callback) {
    let finalAccessCode = p_accessCode;
    if (!finalAccessCode || finalAccessCode.trim() === '') {
        const { v4: uuidv4 } = require('uuid');
        finalAccessCode = uuidv4().replaceAll('-', '').substr(0, 12);
    }

    const c_hashedAccessCode = hlp_password.hash(finalAccessCode);
    const c_isAdmin = p_isAdmin ? 1 : 0;

    const c_sql = 'INSERT INTO logins (TeamID, LoginName, AccessCode, Permissions, IsAdmin) VALUES (?, ?, ?, ?, ?)';
    hlp_db.fn_genericInsert_w_Params(m_db, c_sql,
        [p_teamId, p_loginName, c_hashedAccessCode, c_permission.fn_convertPermissiontoInt(p_permissions), c_isAdmin],
        function (err, res) {
            const c_reply = {};
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Duplicate login name or access code.';
                } else {
                    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
                }
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            } else {
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
                c_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = finalAccessCode;
                c_reply[global.c_CONSTANTS.CONST_LOGIN_ID_PARAMETER.toString()] = res ? res.lastID : null;
            }
            fn_callback(c_reply);
        },
        function (err) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        });
}

/**
 * Update an existing login within a team.  Access code is only changed if
 * a new plaintext is provided (then hashed).
 */
function fn_updateTeamLogin(p_teamId, p_loginName, p_accessCodeOrNull, p_permissions, p_isAdmin, fn_callback) {
    const c_isAdmin = p_isAdmin ? 1 : 0;

    if (p_accessCodeOrNull && p_accessCodeOrNull.trim() !== '') {
        const c_hashedAccessCode = hlp_password.hash(p_accessCodeOrNull.trim());
        const c_sql = 'UPDATE logins SET AccessCode = ?, Permissions = ?, IsAdmin = ? WHERE TeamID = ? AND LoginName = ?';
        hlp_db.fn_genericInsert_w_Params(m_db, c_sql,
            [c_hashedAccessCode, c_permission.fn_convertPermissiontoInt(p_permissions), c_isAdmin, p_teamId, p_loginName],
            function (err, res) {
                const c_reply = {};
                if (!res || res.changes === 0) {
                    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Login not found in this team.';
                    c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                } else {
                    c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
                    c_reply[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = p_accessCodeOrNull.trim();
                }
                fn_callback(c_reply);
            },
            function (err) {
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
                fn_callback(c_reply);
            });
    } else {
        const c_sql = 'UPDATE logins SET Permissions = ?, IsAdmin = ? WHERE TeamID = ? AND LoginName = ?';
        hlp_db.fn_genericInsert_w_Params(m_db, c_sql,
            [c_permission.fn_convertPermissiontoInt(p_permissions), c_isAdmin, p_teamId, p_loginName],
            function (err, res) {
                const c_reply = {};
                if (!res || res.changes === 0) {
                    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Login not found in this team.';
                    c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
                } else {
                    c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
                }
                fn_callback(c_reply);
            },
            function (err) {
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
                fn_callback(c_reply);
            });
    }
}

/**
 * Delete a login from a team.
 */
function fn_deleteTeamLogin(p_teamId, p_loginName, fn_callback) {
    const c_sql = 'DELETE FROM logins WHERE TeamID = ? AND LoginName = ?';
    hlp_db.fn_genericInsert_w_Params(m_db, c_sql,
        [p_teamId, p_loginName],
        function (err, res) {
            const c_reply = {};
            if (!res || res.changes === 0) {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Login not found in this team.';
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            } else {
                c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
            }
            fn_callback(c_reply);
        },
        function (err) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        });
}

/**
 * Count the number of admin logins in a team.
 */
function fn_countTeamAdmins(p_teamId, fn_callback) {
    const c_sql = 'SELECT COUNT(*) as cnt FROM logins WHERE TeamID = ? AND IsAdmin = 1';
    hlp_db.fn_genericSelect_w_Params(m_db, c_sql, [p_teamId],
        function (rows) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_NON;
            c_reply.m_count = (rows && rows.length > 0) ? rows[0].cnt : 0;
            fn_callback(c_reply);
        },
        function (err) {
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] = 'Database error.';
            c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_DATA_DATABASE_ERROR;
            fn_callback(c_reply);
        });
}

/**
 * Look up the stored permission for an account by name (no access code
 * required). Used by the public regenerate path to preserve the existing
 * permission without enforcing ownership.
 * Callback: fn_callback(permissionString) — '0xffffffff' if not found.
 */
function fn_getAccountPermission(p_accountName, fn_callback) {
    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName))) {
        fn_callback('0xffffffff');
        return;
    }

    const c_sql = "SELECT Permissions FROM logins WHERE LoginName = ? LIMIT 1";
    hlp_db.fn_genericSelect_w_Params(m_db, c_sql, [hlp_string.fn_protectedFromInjection(p_accountName)],
        function (rows) {
            if (!rows || rows.length === 0) {
                fn_callback('0xffffffff');
                return;
            }
            let perm = rows[0]['Permissions'];
            if (perm == null || perm === 'D1G1T3R4V5C6') perm = '0xffffffff';
            fn_callback(c_permission.fn_convertPermissiontoInt(perm));
        },
        function () {
            fn_callback('0xffffffff');
        });
}

/**
 * Look up the IsAdmin flag for a login by LoginName.
 * Calls fn_callback(true|false); defaults to false on miss/error.
 */
function fn_getIsAdmin(p_accountName, fn_callback) {
    if ((p_accountName == null) || (!hlp_string.fn_isValidAccountName(p_accountName))) {
        fn_callback(false);
        return;
    }
    const c_sql = "SELECT IsAdmin FROM logins WHERE LoginName = ? LIMIT 1";
    hlp_db.fn_genericSelect_w_Params(m_db, c_sql, [hlp_string.fn_protectedFromInjection(p_accountName)],
        function (rows) {
            if (!rows || rows.length === 0) { fn_callback(false); return; }
            fn_callback(rows[0]['IsAdmin'] === 1 || rows[0]['IsAdmin'] === true);
        },
        function () { fn_callback(false); });
}

module.exports =
{
    fn_initialize: fn_initialize,
    fn_do_loginAccount: fn_do_loginAccount,
    fn_do_getAccountNameByAccessCode: fn_do_getAccountNameByAccessCode,
    fn_createNewAccessCode: fn_createNewAccessCode,
    fn_createSubLogin: fn_createSubLogin,
    fn_deleteSubLogins:fn_deleteSubLogins,
    fn_do_getHardwareVerifyByAccountSID: fn_do_getHardwareVerifyByAccountSID,
    fn_getTeamInfo: fn_getTeamInfo,
    fn_getTeamLogins: fn_getTeamLogins,
    fn_addTeamLogin: fn_addTeamLogin,
    fn_updateTeamLogin: fn_updateTeamLogin,
    fn_deleteTeamLogin: fn_deleteTeamLogin,
    fn_countTeamAdmins: fn_countTeamAdmins,
    fn_getAccountPermission: fn_getAccountPermission,
    fn_getIsAdmin: fn_getIsAdmin,
}