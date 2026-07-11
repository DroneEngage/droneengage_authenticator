"use strict";
const hlp_db = require("../helpers/hlp_db.js");
const hlp_string = require("../helpers/hlp_string.js");
const hlp_validation = require("../helpers/hlp_validation.js");
const v_users = require('../database/db_users');



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
        if (m_serverconfig.m_configuration.hasOwnProperty('db_users') === true) {
            // users database
            global.db_users = new v_users.db_user(global.m_serverconfig.m_configuration.db_users);
            console.log ("Users Database File  " + global.Colors.BSuccess + global.m_serverconfig.m_configuration.db_users + global.Colors.Reset);
            if (!fs.existsSync(global.m_serverconfig.m_configuration.db_users)) {
                console.log (global.Colors.Warn +  "[WARN] Database file not found: " + global.m_serverconfig.m_configuration.db_users + " - will be created on first user registration" + global.Colors.Reset);
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
            const dbPath = m_serverconfig.m_configuration.dbdatabase || 'database/andruav.db';
            
            // Ensure directory exists
            const dbDir = require('path').dirname(dbPath);
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

    console.log (global.Colors.BError + "FATAL ERROR:" + global.Colors.FgYellow + " account_storage_type or db_users or db connection" +  global.Colors.Reset + " are not specified in config file. ");
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
    
    const c_sql = "select teams.TeamID, teams.Enabled, teams.InstanceLimit, logins.Permissions from logins, teams WHERE logins.AccessCode=? and teams.TeamID = logins.TeamID and logins.LoginName=?";
    
    hlp_db.fn_genericSelect_w_Params (m_db, c_sql,[hlp_string.fn_protectedFromInjection(p_accessCode), hlp_string.fn_protectedFromInjection(p_accountName)],
    function (rows) {
        if ((rows == null) || (rows.length != 1))
        {  
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            const c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_sid = rows[0]['TeamID'];
                c_reply.m_data.m_permission = 'D1G1T3R4V5C6';
                c_reply.m_data.m_prm = rows[0]['Permissions'];
                if (c_reply.m_data.m_prm == 'D1G1T3R4V5C6')
                { // backward compatibility to be deleted in the next version.
                    c_reply.m_data.m_prm ='0xffffffff'; 
                }
                c_reply.m_data.m_enabled = rows[0]['Enabled'];
                c_reply.m_data.m_instance_limit = rows[0]['InstanceLimit'];
                if (c_reply.m_data.m_enabled==0)
                {
                    c_reply[global.c_CONSTANTS.CONST_ERROR] = global.c_CONSTANTS.CONST_ERROR_ACCOUNT_DISABLED;
                    c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account is Disabled.";
                }
                else
                {
                    c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;
                }
            }
            
            fn_callback (c_reply);
        }

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
    
    const c_sql = "select teams.TeamName from logins, teams WHERE logins.AccessCode=? and teams.TeamID = logins.TeamID ";
    console.log (c_sql);
    hlp_db.fn_genericSelect_w_Params (m_db, c_sql,[hlp_string.fn_protectedFromInjection(p_accessCode)],
    function (rows) {
        if ((rows == null) || (rows.length != 1))
        {  
            const c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            const c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_accountName = rows[0]['TeamName'];
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_NON;

            }
            
            fn_callback (c_reply);
        }

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


function fn_createSubLogin(p_accountName, p_newAccessCode, p_permission, fn_callback)
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
    
    const c_sql = "INSERT INTO `logins`(`TeamID`, `AccessCode`, `Permissions`) select teams.TeamID, ?,? from teams where teams.TeamName=?";
    
    console.log ("prv_do_createSubLogin: " + c_sql);
    
    
    hlp_db.fn_genericInsert_w_Params (m_db,c_sql, [hlp_string.fn_protectedFromInjection(p_newAccessCode), hlp_string.fn_protectedFromInjection(p_permission), hlp_string.fn_protectedFromInjection(p_accountName)],
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
            }
            fn_callback (c_reply);
        },
        function (p_err)
        {
            fn_callback (p_err);
        });
}

/**
 * create a new main account and one sub account.
 * @param {*} p_accountName 
 * @param {*} fn_callback 
 */
function fn_createNewAccessCode (p_accountName, p_newAccessCode, fn_callback, p_loginCard)
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
    if ((p_loginCard!=null) && (m_serverconfig.m_configuration.hasOwnProperty('db_users') === true)) {
     
        const p_reply = {};
        const user_data = {
            'acc':p_accountName,
            'isadmin': false,
            'sid': 1
        };
        global.db_users.fn_add_record(p_newAccessCode,user_data);
        p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback (c_reply);
            
        return ;

    }
    const c_sql = "INSERT INTO `teams` (`TeamID`, `TeamName`)  VALUES (NULL,?)";
    
    hlp_db.fn_genericInsert_w_Params (m_db,c_sql, [hlp_string.fn_protectedFromInjection(p_accountName), hlp_string.fn_protectedFromInjection(p_newAccessCode)],
		function () 
		{
			
			c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
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
    const c_sql = "DELETE FROM `logins` WHERE `TeamID` in ( select `TeamID` FROM `teams` WHERE `TeamName` LIKE ?) and `Permissions` LIKE ?";
    
    hlp_db.fn_genericInsert_w_Params (m_db,c_sql, [hlp_string.fn_protectedFromInjection(p_accountName), hlp_string.fn_protectedFromInjection(p_permission)],
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
 
module.exports =
{
    fn_initialize: fn_initialize,
    fn_do_loginAccount: fn_do_loginAccount,
    fn_do_getAccountNameByAccessCode: fn_do_getAccountNameByAccessCode,
    fn_createNewAccessCode: fn_createNewAccessCode,
    fn_createSubLogin: fn_createSubLogin,
    fn_deleteSubLogins:fn_deleteSubLogins,
    fn_do_getHardwareVerifyByAccountSID: fn_do_getHardwareVerifyByAccountSID,
}