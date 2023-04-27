"use strict";
const hlp_db = require("../helpers/hlp_db.js");
const hlp_string = require("../helpers/hlp_string.js");
const v_users = require('../database/db_users');



var m_dbPool;


/**
 * Initalize database connection for database manager
 */
function fn_initialize()
{
    const fs = require('fs');

    if ((m_serverconfig.m_configuration.hasOwnProperty('use_single_account_mode') === true)
    && (m_serverconfig.m_configuration.use_single_account_mode === true)) {
        return ;
    } 

    if (m_serverconfig.m_configuration.hasOwnProperty('db_users') === true) {
        // users database
        global.db_users = new v_users.db_user(global.m_serverconfig.m_configuration.db_users);
        console.log ("Users Database File  " + global.Colors.BSuccess + global.m_serverconfig.m_configuration.db_users + global.Colors.Reset);
        if (!fs.existsSync(global.m_serverconfig.m_configuration.db_users)) { 
            console.log (global.Colors.Error +  "File Not Found"  + global.Colors.Reset);
        }
        return;
    }

    
    try
    {
        const c_mysql = require('mysql2');
        m_dbPool = c_mysql.createPool(
            {
                connectTimeout: 10000, // 3s
                connectionLimit: 18, //important
                queueLimit: 19,
                host: m_serverconfig.m_configuration.dbIP,
                user: m_serverconfig.m_configuration.dbuser,
                password: m_serverconfig.m_configuration.dbpassword,
                database: m_serverconfig.m_configuration.dbdatabase,
                debug: false
            });

            m_dbPool.getConnection( function (p_err,p_dbConnection)
            {
                if (p_err!= null)
                {
                    console.log ("[FATAL] database error.");
                    console.log (JSON.stringify(p_err));
                    process.exit(1);
                    //return ; //
                }

                console.log (global.Colors.Success + "[OK] Database is Connected." + global.Colors.Reset);
                p_dbConnection.release();
            });
    }
    catch (ex)
    {
        console.log ("[FATAL] database error.");
        console.log (JSON.stringify(ex));
        process.exit(1);
    }
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
                
            
    if ((p_accountName == null) || (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    if ((p_accessCode == null) || (!p_accessCode.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    
    const c_sql = "select account.Account_SID, account.Enabled, account.Instance_Limit, account_details.Permission from account_details, account WHERE account_details.PWD=? and account.Account_SID = account_details.Account_SID and account.Name=?";
    
    hlp_db.fn_genericSelect_w_Params (m_dbPool, c_sql,[p_accessCode.fn_protectedFromInjection(), p_accountName.fn_protectedFromInjection()],
    function (rows) {
        if ((rows == null) || (rows.length != 1))
        {  
            var c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            var c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_sid = rows[0]['Account_SID'];
                c_reply.m_data.m_permission = 'D1G1T3R4V5C6';
                c_reply.m_data.m_prm = rows[0]['Permission'];
                if (c_reply.m_data.m_prm == 'D1G1T3R4V5C6')
                { // backward compatibility to be deleted in the next version.
                    c_reply.m_data.m_prm ='0xffffffff'; 
                }
                c_reply.m_data.m_enabled = rows[0]['Enabled'];
                c_reply.m_data.m_instance_limit = rows[0]['Instance_Limit'];
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
                
            
    if ((p_accessCode == null) || (!p_accessCode.fn_isAlphanumeric()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            fn_callback(c_reply);
        }
        return ;
    }
    
    const c_sql = "select account.Name from account_details, account WHERE account_details.PWD=? and account.Account_SID = account_details.Account_SID ";
    console.log (c_sql);
    hlp_db.fn_genericSelect_w_Params (m_dbPool, c_sql,[p_accessCode.fn_protectedFromInjection()],
    function (rows) {
        if ((rows == null) || (rows.length != 1))
        {  
            var c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] =  "Account Not Found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            var c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "Account Not Found.";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_accountName = rows[0]['Name'];
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
    
    if ((p_accountName == null) || (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad Email";
            fn_callback(c_reply);
        }
        return ;
    }
    
    if ((p_newAccessCode == null) || (!p_newAccessCode.fn_isAlphanumeric()))
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
    
    const c_sql = "INSERT INTO `account_details`(`Account_SID`, `PWD`, `Permission`) select account.Account_SID, ?,? from account where account.Name=?";
    
    console.log ("prv_do_createSubLogin: " + c_sql);
    
    
    hlp_db.fn_genericInsert_w_Params (m_dbPool,c_sql, [p_newAccessCode.fn_protectedFromInjection(), p_permission.fn_protectedFromInjection(), p_accountName.fn_protectedFromInjection()],
		function () 
		{
            var c_reply = {};
                
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
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
    
    if ((p_accountName == null) || (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad Email";
            fn_callback(c_reply);
        }
        return ;
    }
    
    if ((p_newAccessCode == null) || (!p_newAccessCode.fn_isAlphanumeric()))
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
     
        var p_reply = {};
        var user_data = {
            'acc':p_accountName,
            'isadmin': false,
            'sid': 1
        };
        global.db_users.fn_add_record(p_newAccessCode,user_data);
        p_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
        fn_callback (c_reply);
            
        return ;

    }
    const c_sql = "INSERT INTO `account` (`Account_SID`, `Name`)  VALUES (NULL,?)";
    
    hlp_db.fn_genericInsert_w_Params (m_dbPool,c_sql, [p_accountName.fn_protectedFromInjection(), p_newAccessCode.fn_protectedFromInjection()],
		function () 
		{
			
			c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
            fn_callback (c_reply);
		},
		function (err)
		{
			if (err.errno == 1062)
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


function fn_deleteSubLogins (p_accountName, fn_callback)
{
    const c_reply = {};
    
    if ((p_accountName == null) || (!p_accountName.fn_isEmail()))
    {
        // null or not alphanumeric
        if (fn_callback != null)
        {
            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_INVALID_DATA;
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad Email";
            fn_callback(c_reply);
        }
        return ;
    }
    const c_sql = "DELETE FROM `account_details` WHERE `Account_SID` in ( select `Account_SID` FROM `account` WHERE `Name` LIKE ?)";
    
    hlp_db.fn_genericInsert_w_Params (m_dbPool,c_sql, [p_accountName.fn_protectedFromInjection()],
		function (err,res) 
		{
            if (res.affectedRows == 0)
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
		function (err,res)
		{
			if (err.errno == 1062)
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
    
    
    const c_sql = "select account_hw_info.SID, account_hw_info.HW_ID, account_hw_info.HW_Type, account_hw_info.register_time from account_hw_info  WHERE account_hw_info.Account_SID=? ";
    console.log ("REMOVE ME:" + c_sql);
    hlp_db.fn_genericSelect_w_Params (m_dbPool, c_sql,[p_accountSID],
    function (rows) {
        if ((rows == null) || (rows.length == 0))
        {  
            var c_reply = {};
            c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "No hardware is found.";
            c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_HARDWARE_NOT_FOUND;
            fn_callback (c_reply);
        }
        else
        {
            console.log (rows);
            var c_reply = {};
            if (rows.length == 0)
            {
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG] =  "No hardware is found";
                c_reply[global.c_CONSTANTS.CONST_ERROR] =  global.c_CONSTANTS.CONST_ERROR_ACCOUNT_NOT_FOUND;
            
            }
            else
            {
                c_reply.m_data = {};
                c_reply.m_data.m_hwID = {};
                    
                for (var i =0; i< rows.length; ++i)
                {
                    var c_obj = {};
                    c_obj.m_hwType = rows[i]['HW_Type'];
                    c_obj.m_registerTime = rows[i]['register_time'];
                    c_reply.m_data.m_hwID[rows[i]['HW_ID']] = c_obj;
                    
                }
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