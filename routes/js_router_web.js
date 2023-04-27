"use strict";


var v_router = require('./js_router');
const hlp_string = require("../helpers/hlp_string.js");


v_router.m_Router.post(global.c_CONSTANTS.CONST_WEB_FUNCTION + global.c_CONSTANTS.CONST_WEB_LOGIN_COMMAND, function (v_req, v_response, v_next) {

    try
    {
        console.log ("debug ... " + global.c_CONSTANTS.CONST_WEB_LOGIN_COMMAND + " called");

        //https://github.com/expressjs/express/issues/3264
        Object.setPrototypeOf(v_req.body, {});
        
        // extract parameter values from header... no verification check here.
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_APP_GROUP_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_APP_NAME_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_APP_VER_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_EXTRA_PARAMETER) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_ACTOR_TYPE) === false)
        {
            v_req.body[global.c_CONSTANTS.CONST_ACTOR_TYPE] ='g';
            return;
        }

        // call server API
        var ret = global.m_authServer.fn_newLoginCard (
            v_req.body[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_ACTOR_TYPE],
            v_req.body[global.c_CONSTANTS.CONST_APP_GROUP_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_APP_NAME_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_APP_VER_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_EXTRA_PARAMETER],
            true,
            function (p_data)
            {

                // you cannot login as AGENT on this service .. something wrong ... a hacking attempt
                //if (p_data[global.c_CONSTANTS.CONST_ACTOR_TYPE.toString()] !== global.c_CONSTANTS.CONST_GCS)
                //{
                //    v_router.fn_errorPage (v_response);
                //}
                // MHEFNY LATER
                if (v_response.writableEnded === true) return;
                p_data[global.c_CONSTANTS.CONST_COMMAND.toString()] = global.c_CONSTANTS.CONST_WEB_LOGIN_COMMAND;
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


v_router.m_Router.post(global.c_CONSTANTS.CONST_WEB_FUNCTION + global.c_CONSTANTS.CONST_ACCOUNT_MANAGMENT , function (v_req, v_response, v_next) {

    try
    {
        console.log ("debug ... " + global.c_CONSTANTS.CONST_ACCOUNT_MANAGMENT + " called");

        //https://github.com/expressjs/express/issues/3264
        Object.setPrototypeOf(v_req.body, {});

        if (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_SUB_COMMAND) === false)
        {
            v_router.fn_errorPage (v_response);
            return;
        }
        if ((v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER) === false)
        && (v_req.body.hasOwnProperty (global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER) === false))
        {
            v_router.fn_errorPage (v_response);
            return;
        }

        
        global.m_authServer.fn_accountOperation(v_req.body[global.c_CONSTANTS.CONST_SUB_COMMAND],
            v_req.body[global.c_CONSTANTS.CONST_ACCOUNT_NAME_PARAMETER],
            v_req.body[global.c_CONSTANTS.CONST_ACCESS_CODE_PARAMETER],
            function (p_data)
            {
                if (v_response.writableEnded === true) return;
                
                p_data[global.c_CONSTANTS.CONST_COMMAND.toString()]   = global.c_CONSTANTS.CONST_ACCOUNT_MANAGMENT;
                v_response.write(JSON.stringify(p_data), function(err) { v_response.end(); });
                v_response.end();
                
            },
            function ()
            {
                v_router.fn_errorPage (v_response);
            },
            v_req.body[global.c_CONSTANTS.CONST_SESSION_ID]
        );
    }
    catch (ex)
    {
        v_router.fn_errorPage (v_response);
    }
});

module.exports = v_router.m_Router;