const v_pjson = require('./package.json');

global.c_CONSTANTS      = require ("./js_constants");
global.Colors           = require ("./helpers/js_colors.js").Colors;
global.m_serverconfig   = require ('./js_serverConfig.js'); 
global.m_authServer     = require ('./auth_server/js_auth_server');

var v_configFileName = global.m_serverconfig.getFileName();

process.on('SIGINT', function(err) {
    if (global.m_logger) global.m_logger.Warn('SIGINT.');
    process.exit(err ? 1 : 0);
 });

 
/**
 * launch express server. core of everything
 */
function fn_startExpressServer ()
{
    //to view es6 capabilities see http://node.green/
    //node v8-options es6 module syntax currently under development (2016/06/25)
    const v_path              = require('path');
    const v_express           = require('express');
    const v_ejsLayouts        = require('express-ejs-layouts');
    const v_cookieParser      = require('cookie-parser');
    const v_bodyParser        = require('body-parser');
    const c_router            = require('./routes/js_router');
    const c_cors              = require('cors')
    const c_helmet            = require('helmet')



    //setup
    const c_app      = v_express();
    c_app.use(c_helmet())

    // Please check this for more details:
    // https://www.html5rocks.com/en/tutorials/security/content-security-policy/
    c_app.use(c_helmet.contentSecurityPolicy({
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'none'"],
          scriptSrc: ["'none'"],
          upgradeInsecureRequests: true,
          workerSrc: false
        }
      }))


    //settings
    c_app.set('port', global.m_serverconfig.m_configuration.server_port);
    c_app.set('views', v_path.join(__dirname, 'views'));
    
    //view engine & main template
    c_app.set('view engine', 'ejs');
    c_app.set('layout', 'template');
    c_app.use(v_ejsLayouts);
    c_app.use(c_cors())

    //middleware
    c_app.use(v_bodyParser.json());
    c_app.use(v_bodyParser.urlencoded({ extended: false }));
    c_app.use(v_cookieParser());

    //router
    c_router.fn_create(c_app);

    var v_https = require('https');
    var v_fs = require('fs');
    console.log (global.Colors.Log + "READING " + global.m_serverconfig.m_configuration.ssl_key_file + global.Colors.Reset);
    var v_keyFile = v_fs.readFileSync(v_path.join(__dirname, global.m_serverconfig.m_configuration.ssl_key_file));
    console.log (global.Colors.Log + "READING " + global.m_serverconfig.m_configuration.ssl_cert_file + global.Colors.Reset);
    var v_certFile = v_fs.readFileSync(v_path.join(__dirname, global.m_serverconfig.m_configuration.ssl_cert_file));
    var v_options = {
        key: v_keyFile,
        cert: v_certFile
    };


    // start listening
    v_https.createServer(v_options, c_app).listen(c_app.get('port'));


    console.log (global.Colors.Success + "[OK] Web Server Started" + global.Colors.Reset);

}


function fn_displayHelp ()
{
    console.log ("==============================================");
    console.log (global.Colors.Bright + "Andruav Authentication Server version " +  JSON.stringify(v_pjson.version) + global.Colors.Reset);
    console.log ("----------------------------------");
    console.log ("--config=config_filename config file ");
    console.log ("-h help ");
    console.log ("-v version");
    console.log ("==============================================");
}


function fn_displayInfo ()
{
    console.log ("==============================================");
    console.log (global.Colors.Bright + "Andruav Authentication Server version " +  JSON.stringify(v_pjson.version) + global.Colors.Reset);
    console.log ("----------------------------------");
    console.log ("Server Name  " + global.Colors.BSuccess + global.m_serverconfig.m_configuration.server_id + global.Colors.Reset);
    console.log ("listening on ip: " + global.Colors.BSuccess +  global.m_serverconfig.m_configuration.server_ip + " port: " + global.m_serverconfig.m_configuration.server_port + global.Colors.Reset);
    console.log ("S2S WS ip: "  + global.Colors.BSuccess +  global.m_serverconfig.m_configuration.s2s_ws_listening_ip  + " port: " + global.m_serverconfig.m_configuration.s2s_ws_listening_port + global.Colors.Reset);
    
    if (global.m_serverconfig.m_configuration.enableLog!==true)
    {
        console.log ("logging is " + global.Colors.FgYellow + 'disabled' + global.Colors.Reset);
    }
    else
    {

        global.m_logger         = require ('node-file-logger');

        const options = {
            timeZone: global.m_serverconfig.m_configuration.log_timeZone==null?'GMT':global.m_serverconfig.m_configuration.log_timeZone,      
            folderPath: global.m_serverconfig.m_configuration.log_directory==null?'./log':global.m_serverconfig.m_configuration.log_directory,      
            dateBasedFileNaming: true,
            // Required only if dateBasedFileNaming is set to false
            fileName: 'All_Logs',   
            // Required only if dateBasedFileNaming is set to true
            fileNamePrefix: 'Logs_',
            fileNameSuffix: '',
            fileNameExtension: '.log',     
            
            dateFormat: 'YYYY-MM-DD',
            timeFormat: 'HH:mm:ss.SSS',
            // Allowed values - debug, prod, prod-trace (Details below)
            // prod: Only 'warn', 'info', 'error' and 'fatal' messages are logged. 'debug' and 'trace' messages are not logged.
            logLevel: global.m_serverconfig.m_configuration.log_detailed==true?'debug':'prod',
            // If set to false then messages are logged to console as well
            onlyFileLogging: true 
          };
        
        global.m_logger.SetUserOptions(options); 

        console.log ("logging is " + global.Colors.FgYellow + 'enabled' + global.Colors.Reset);
    }
    console.log ("Datetime: %s", new Date());
    console.log ("==============================================");

    if (global.m_logger) global.m_logger.Info('System Started.');
}

function fn_parseArgs()
{
    const c_args = require ('./helpers/hlp_args.js');
    var cmds = c_args.getArgs();
    if (cmds.hasOwnProperty('h') || cmds.hasOwnProperty('help'))
    {

        fn_displayHelp();
        
        process.exit(0);
    }

    if (cmds.hasOwnProperty('v') || cmds.hasOwnProperty('version'))
    {

        console.log ("Andruav Authentication Server version: " + JSON.stringify(v_pjson.version));
        
        process.exit(0);
    }


    if (cmds.hasOwnProperty('config') )
    {
        v_configFileName = cmds.config;
    }


}



/**
 * start parsing input and lauch app.
 */
function fn_start ()
{
    // parse input arguments
    fn_parseArgs();

    // load server configuration
    global.m_serverconfig.init(v_configFileName);
  

    // display info
    fn_displayInfo();


    // start auth server 
    global.m_authServer.fn_startServer ();

    // load express server
	fn_startExpressServer();

}


fn_start();






