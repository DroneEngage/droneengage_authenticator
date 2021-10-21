"use strict";
const uuidv4 = require('uuidv4');
const hlp_string = require("../helpers/hlp_string.js");
const v_database_manager = require("./js_database_manager");
var email = require("emailjs/email");


var email_server;


/**
 * generates random string
 */
function fn_generateAccessCode() {
    return uuidv4.uuid().replaceAll('-','').substr(0, 12);
}

function fn_initialize ()
{
    email_server = email.server.connect(
        {
            host: "localhost",
            ssl: false
        });
}


/**
 * Send email to subscriber with subscription info.
 * @param {*} p_accountName destination email address
 * @param {*} p_accessCode access code
 * @param {*} fn_callback 
 */
function fn_sendSubscriptionEmail (p_accountName, p_accessCode, fn_callback)
{
    var v_msg = "Welcome to <span color='#0066FF'><strong>Andruav</strong></span><p>&nbsp;</p>\
												You are receiving this email because you activated your Andruav account, please use the code below and enter it in the app<p>\
												&nbsp;</p>The Code is: <span color=#003366><strong>" + p_accessCode + "</strong></span><span color=#FF0000><br><br><b>Did you know you can now view your live video stream online and manage your account at <a href='http://andruav.com/arcs/andruavweb.html'>Andruav Web Client</a>..</span>\
												<span color=#FF0000><br><br><b>IMPORTANT NOTICE:</b>&nbsp;Because flying regulations differ by country/state/region plan your flights in GlobalARC before you start using <a href='www.andruav.com'>andruav.com</a>.</span>";

    var v_msgText = "Welcome to Andruav.\r\nA unique way to communicate with your drones to unlimited distances.\r\nYou are receiving this email because you have just subscribed in Andruav.com\r\nYou are receiving this email because you activated your Anduav account, please use the code below and enter it in the app.\r\nThe Code is: " + p_accessCode + "\r\nDid you know you can now view your live video stream online and manage your account at www.andruav.com?"; + "\r\nIMPORTANT NOTICE: Because flying regulations differ by country/state/region plan your flights in GlobalARC before you start using Andruav.com";

	//https://github.com/eleith/emailjs
	email_server.send(
    {
        type: 'text/html',
        text: v_msgText,
        attachment: [
            {
                data: v_msg,
                alternative: true
            }
        ],
        from: "Andruav <no-reply@andruav.com>",
        to: p_accountName + "<" + p_accountName + ">",
        subject: "Andruav Account Account Created"
    }, function(p_error, message)
       {
           const c_reply = {};
           if (p_error)
           {
               console.log(p_error);

               c_reply [global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_DATA_UNKNOWN_ERROR;
               c_reply [global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Bad Email.";
               
           }
           else
           {
                c_reply [global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
           }
           
           fn_callback (c_reply);
       });
}

/**
 * 
 * @param {*} p_accountName 
 * @param {*} fn_callback 
 */
function fn_createAccessCode (p_accountName, fn_callback)
{

    var v_accessCode = fn_generateAccessCode();
    
    // Define a new account.
    v_database_manager.fn_createNewAccessCode (p_accountName, v_accessCode,
        function (p_reply)
        {
            
            if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
            {
                fn_callback (p_reply);
            }
            else
            {
                // Create sub login account that is used by andruav for actual login. 
                v_database_manager.fn_createSubLogin (p_accountName, v_accessCode, 'D1G1T3R4V5C6',
                    function (p_reply)
                    {
                        if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
                        {
                            fn_callback (p_reply);
                        }
                        else
                        {
                            if (global.m_serverconfig.m_configuration.ignoreEmail === false)
                            {   
                                // send email with access code.
                                fn_sendSubscriptionEmail (p_accountName, v_accessCode,
                                    function (p_reply)
                                    {
                                        
                                        p_reply [global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
                                        
                                        fn_callback (p_reply);
                                    });
                                    return ;
                            }
                            else
                            {
                                p_reply [global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER.toString()] = v_accessCode;
                                fn_callback (p_reply);
                            }
                        }
                    });
            }
        });
}


/**
 * Generates new access code.
 * This deletes all accout sub-logins, and create a new one.
 * @param {*} p_accountName 
 * @param {*} fn_callback 
 */
function fn_regenerateAccessCode (p_accountName, fn_callback)
{
    const v_accessCode = fn_generateAccessCode();
    
    // Define a new account.
    v_database_manager.fn_deleteSubLogins (p_accountName,
        function (p_reply)
        {
            
            if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
            {
                fn_callback (p_reply);
            }
            else
            {
                // Create sub login account that is used by andruav for actual login. 
                v_database_manager.fn_createSubLogin (p_accountName, v_accessCode, 'D1G1T3R4V5C6',
                    function (p_reply)
                    {
                        if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
                        {
                            fn_callback (p_reply);
                        }
                        else
                        {
                            if (global.m_serverconfig.m_configuration.ignoreEmail === false)
                            {   
                                // send email with access code.
                                fn_sendSubscriptionEmail (p_accountName, v_accessCode,
                                    function (p_reply)
                                    {
                                        fn_callback (p_reply);
                                    });
                                    return ;
                                
                            }
                            else
                            {
                                fn_callback (p_reply);
                            }
                        }
                    });
            }
        });        
            
}

/**
 * Retrieve user name or email using access code.
 * Please note that multiple access code may exist for the same username.
 * @param {*} p_accessCode 
 * @param {*} fn_callback 
 */
function fn_getAccountNameByAccessCode (p_accessCode, fn_callback)
{
    v_database_manager.fn_do_getAccountNameByAccessCode (p_accessCode,
        function (p_reply)
        {
            if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
            {
                fn_callback (p_reply);


            }
            else
            {
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                c_reply[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER.toString()] = p_reply.m_data.m_accountName;
                fn_callback (c_reply);
            }
        });
}


/**
 * Retrieves account associated hardware and compare given hardware gievn on and returns uccess if found valid.
 * @param {*} p_accountSID Account_SID
 * @param {*} p_hardwareID HardwareID
 * @param {*} p_hardwareType type: cpu, generated, ...etc.
 * @param {*} fn_callback call back to http response.
 */
function fn_do_verifyHardwareByAccountSID (p_accountSID, p_hardwareID, p_hardwareType, fn_callback)
{   
    v_database_manager.fn_do_getHardwareVerifyByAccountSID (p_accountSID,
        function (p_reply)
        {

            if (p_reply [global.c_CONSTANTS.CONST_ERROR.toString()] != global.c_CONSTANTS.CONST_ERROR_NON)
            {   
                /**
                 * exits if no validation is required however we still go to database as we may need to 
                 * store HW for future restrictions.
                 */
                if (global.m_serverconfig.m_configuration.skip_hardware_validation === true)
                {
                    // skip hardware validation
                    const c_reply = {};
                    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                            
                    fn_callback (c_reply);
                    return ;
                }
                
                // No Data or Error
                fn_callback (p_reply);
            }
            else
            {   // Data Found
                // Search if HW required exists in the return list.
                const m_hwIDKeys = Object.keys(p_reply.m_data.m_hwID);
                const m_len = m_hwIDKeys.length;
                
                if (global.m_serverconfig.m_configuration.skip_hardware_validation === true)
                {
                    // skip hardware validation
                    const c_reply = {};
                    c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                            
                    fn_callback (c_reply);
                    return ;
                }

                for (var i =0; i<m_len; ++i)
                {
                    const c_key = m_hwIDKeys[i];
                    if (c_key == p_hardwareID)
                    {
                        const c_hwCard = p_reply.m_data.m_hwID[c_key] ;
                        if (p_hardwareType == c_hwCard.m_hwType)
                        {
                            const c_reply = {};
                            c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_NON;
                            
                            fn_callback (c_reply);
                            return ;
                        }
                    }
                }
                const c_reply = {};
                c_reply[global.c_CONSTANTS.CONST_ERROR.toString()] = global.c_CONSTANTS.CONST_ERROR_HARDWARE_NOT_FOUND;
                c_reply[global.c_CONSTANTS.CONST_ERROR_MSG.toString()] = "Hardware not authorized";
                
                fn_callback (c_reply);
            }
        });
}

module.exports =
{
    fn_initialize: fn_initialize,
    fn_createAccessCode: fn_createAccessCode,
    fn_regenerateAccessCode: fn_regenerateAccessCode,
    fn_getAccountNameByAccessCode: fn_getAccountNameByAccessCode,
    fn_do_verifyHardwareByAccountSID: fn_do_verifyHardwareByAccountSID,
}