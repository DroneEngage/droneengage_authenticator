"use strict";
const v_router = require('./js_router');

const C = global.c_CONSTANTS;
        

/**
 * Login Request by Agent
 */
v_router.m_Router.post(C.CONST_AGENT_FUNCTION + C.CONST_AGENT_LOGIN_COMMAND, function (v_req, v_response, v_next) {

    try
    {
        console.log ("debug ... " + C.CONST_AGENT_LOGIN_COMMAND + " called");

        //https://github.com/expressjs/express/issues/3264
        Object.setPrototypeOf(v_req.body, {});
        
        if (global.m_logger) global.m_logger.Info(C.CONST_AGENT_LOGIN_COMMAND,null,null,v_req.body);

        const c_body = v_req.body;
        // extract parameter values from header... no verification check here.
        if (c_body.hasOwnProperty (C.CONST_ACCOUNT_NAME_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_ACCESS_CODE_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_APP_GROUP_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_APP_NAME_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_APP_VER_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_EXTRA_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        
        

        // call server API
        // call server API
        var ret = global.m_authServer.fn_newLoginCard (
            c_body[C.CONST_ACCOUNT_NAME_PARAMETER],
            c_body[C.CONST_ACCESS_CODE_PARAMETER],
            'd',
            c_body[C.CONST_APP_GROUP_PARAMETER],
            c_body[C.CONST_APP_NAME_PARAMETER],
            c_body[C.CONST_APP_VER_PARAMETER],
            c_body[C.CONST_EXTRA_PARAMETER],
            false,
            function (p_data)
            {

                // you cannot login as AGENT on this service .. something wrong ... a hacking attempt
                //if (p_data[C.CONST_ACTOR_TYPE.toString()] !== C.CONST_GCS)
                //{
                //    v_router.fn_errorPage (v_response);
                //}
                // MHEFNY LATER

                p_data[C.CONST_COMMAND.toString()] = C.CONST_AGENT_LOGIN_COMMAND;
                v_response.write(JSON.stringify(p_data), function(err) { v_response.end(); });
                v_response.end();

                console.log ("debug ... fn_newLoginCard: " + JSON.stringify(p_data));
                
            },
            function ()
            {
                v_router.fn_errorPage (v_response);
            });
    }
    catch (ex)
    {
        v_router.fn_errorPage (v_response);
    }

});

v_router.m_Router.post(C.CONST_AGENT_FUNCTION + C.CONST_AGENT_ACCOUNT_MANAGMENT, function (v_req, v_response, v_next) {

    try
    {
        console.log ("debug ... " + C.CONST_AGENT_ACCOUNT_MANAGMENT + " called");

        //https://github.com/expressjs/express/issues/3264
        Object.setPrototypeOf(v_req.body, {});

        if (global.m_logger) global.m_logger.Info(C.CONST_AGENT_ACCOUNT_MANAGMENT,null,null,v_req.body);
        
        
        const c_body = v_req.body;
        if (c_body.hasOwnProperty (C.CONST_SUB_COMMAND) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if ((c_body.hasOwnProperty (C.CONST_ACCOUNT_NAME_PARAMETER) === false)
        && (c_body.hasOwnProperty (C.CONST_ACCESS_CODE_PARAMETER) === false))
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_APP_NAME_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_APP_VER_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_EXTRA_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        

        global.m_authServer.fn_accountOperationFromAgent(
            v_req.body[C.CONST_SUB_COMMAND],
            v_req.body[C.CONST_ACCOUNT_NAME_PARAMETER],
            v_req.body[C.CONST_ACCESS_CODE_PARAMETER],
            v_req.body[C.CONST_APP_NAME_PARAMETER],
            v_req.body[C.CONST_APP_VER_PARAMETER],
            v_req.body[C.CONST_EXTRA_PARAMETER],
            function (p_data)
            {
                p_data[C.CONST_COMMAND.toString()]   = C.CONST_ACCOUNT_MANAGMENT;
                v_response.write(JSON.stringify(p_data), function(err) 
                { 
                    v_response.end(); 
                });
                
            },
            function ()
            {
                v_router.fn_errorPage (v_response);
            }
        );
    }
    catch (ex)
    {
        v_router.fn_errorPage (v_response);
    }

});


/**
 * Verify my Hardware_ID
 */
v_router.m_Router.post(C.CONST_AGENT_FUNCTION + C.CONST_AGENT_HARDWARE_MANAGMENT, function (v_req, v_response, v_next) {

    try
    {
        console.log ("debug ... " + C.CONST_AGENT_HARDWARE_MANAGMENT + " called");

        //https://github.com/expressjs/express/issues/3264
        Object.setPrototypeOf(v_req.body, {});

        if (global.m_logger) global.m_logger.Info(C.CONST_AGENT_HARDWARE_MANAGMENT,null,null,v_req.body);
        
        
        const c_body = v_req.body;
        if (c_body.hasOwnProperty (C.CONST_SUB_COMMAND) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if ((c_body.hasOwnProperty (C.CONST_HARDWARE_ID) === false)
        && (c_body.hasOwnProperty (C.CONST_HARDWARE_TYPE) === false))
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (c_body.hasOwnProperty (C.CONST_SESSION_ID) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
                

        global.m_authServer.fn_hardwareOperationFromAgent(
            v_req.body[C.CONST_SUB_COMMAND],
            v_req.body[C.CONST_SESSION_ID],
            v_req.body[C.CONST_HARDWARE_ID],
            v_req.body[C.CONST_HARDWARE_TYPE],
            function (p_data)
            {
                p_data[C.CONST_COMMAND.toString()]   = C.CONST_AGENT_HARDWARE_MANAGMENT;
                v_response.write(JSON.stringify(p_data), function(err) 
                { 
                    v_response.end(); 
                });
                
            },
            function ()
            {
                v_router.fn_errorPage (v_response);
            }
        );
    }
    catch (ex)
    {
        v_router.fn_errorPage (v_response);
    }

});


module.exports = v_router.m_Router;