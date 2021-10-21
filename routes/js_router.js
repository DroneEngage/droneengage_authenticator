
"use strict";

//var  v_favicon = require('express-favicon');
var v_express = require('express');
var v_router = v_express.Router();

function fn_errorPage (v_res)
{
    v_res.status(404);
    v_res.render('pages/404', { title: '404', message: 'This page does not exist.' });
}


function fn_create(app) {
    app.use (v_router);
    //app.use(favicon(__dirname + '/public/favicon.ico')); 

   app.use('/public', v_express.static('public'));

   app.use(global.c_CONSTANTS.CONST_WEB_FUNCTION,                  require('./js_router_web'));
   app.use(global.c_CONSTANTS.CONST_AGENT_FUNCTION,                require('./js_router_agent'));
   

   // else is error
   app.use((v_req, v_res, next) => {
        fn_errorPage(v_res);
    });
}


module.exports = {
    fn_create: fn_create,
    fn_errorPage: fn_errorPage,
    m_Router: v_router
};
