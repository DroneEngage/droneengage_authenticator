"use strict";

exports.CONST_AGENT_LOGIN_COMMAND           = '/al';   // verified
exports.CONST_AGENT_ACCOUNT_MANAGMENT       = '/aam';  // verified
exports.CONST_AGENT_HARDWARE_MANAGMENT      = '/ah';   // hardware management
exports.CONST_AGENT_COMMSERVER_COMMAND      = '/ac';
exports.CONST_AGENT_UPLOAD_COMMAND          = '/u';
exports.CONST_AGENT_QUERY_COMMAND           = '/aq';
exports.CONST_AGENT_LOGOUT_COMMAND          = '/ao';


exports.CONST_ANDROID_GCS_LOGIN_COMMAND           = '/gcsl';
exports.CONST_ANDROID_GCS_COMMSERVER_COMMAND      = '/gcsc';
exports.CONST_ANDROID_GCS_QUERY_COMMAND           = '/gcsq';
exports.CONST_ANDROID_GCS_LOGOUT_COMMAND          = '/gcso';


exports.CONST_WEB_LOGIN_COMMAND             = '/wl'; // verified
exports.CONST_WEB_COMMSERVER_COMMAND        = '/wc';
exports.CONST_ACCOUNT_MANAGMENT             = '/am'; // verified
exports.CONST_WEB_LOGOUT_COMMAND            = '/wo';

exports.CONST_UPLOADER_CHECK_TOKEN          = '/tk';


exports.CONST_WEB_FUNCTION                  =   '/w';       // verified
exports.CONST_AGENT_FUNCTION                =   '/agent';   // verified
exports.CONST_ANDROID_GCS_FUNCTION          =   '/gcs'
exports.CONST_UPLOADER_FUNCTION             =   '/up';




exports.CONST_ACCOUNT_NAME_PARAMETER                = 'acc';   // verified
exports.CONST_PERMISSION_PARAMETER                  = 'prm';   // verified
exports.CONST_ACCESS_CODE_PARAMETER                 = 'pwd';   // verified
exports.CONST_APP_NAME_PARAMETER                    = 'app';   // verified
exports.CONST_APP_GROUP_PARAMETER                   = 'gr';    // verified
exports.CONST_APP_VER_PARAMETER                     = 'ver';   // verified
exports.CONST_EXTRA_PARAMETER                       = 'ex';    // verified
////////////////EO-HTTP HEADER FIELDS

//Reply Fields used in talking to other modules.
exports.CONST_COMMAND                           ='cm';    // verified
exports.CONST_SUB_COMMAND                       ='scm';   // verified
//exports.CONST_SESSION_ID                        ='ssid';
exports.CONST_HARDWARE_ID                       ='hi';
exports.CONST_HARDWARE_TYPE                     ='ht';
exports.CONST_ACTOR_TYPE                        ='at';    // isGCS
exports.CONST_SESSION_ID                        ='sid';   // verified 
exports.CONST_PERMISSION                        ='per';   // verified 
exports.CONST_PERMISSION2                       ='prm';   // verified 
exports.CONST_TURN_SERVER_IP                    ='tip';   
exports.CONST_STUN_SERVER_IP                    ='tp';  
exports.CONST_COMM_SERVER                       ='cs';   // verified
exports.CONST_COMM_SERVER_IP                    ='ip';   // verified
exports.CONST_COMM_SERVER_PORT                  ='pr';   // verified
exports.CONST_COMM_SERVER_AUTH_KEY              ='sak';  // verified
exports.CONST_ERROR                             ='e';    // verified
exports.CONST_ERROR_MSG                         ='em';   // verified
exports.CONST_INSTANCE_LIMIT                    ='il';    
/////////////EO-Reply Fields


// SUB COMMANDS
exports.CONST_CMD_CREATE_ACCESSCODE   		    = 'c';
exports.CONST_CMD_REGENERATE_ACCESSCODE         = 'r';
exports.CONST_CMD_GET_ACCOUNT_NAME              = 'g';
exports.CONST_CMD_VERIFY_HARDWARE_BY_ID         = 'vh';

// Reply-Fields with COMM-Servers

exports.CONST_CS_CMD_INFO                       = 'a';
exports.CONST_CS_CMD_LOGIN_REQUEST              = 'b';
exports.CONST_CS_CMD_LOGOUT_REQUEST             = 'c';


exports.CONST_CS_ACCOUNT_ID                     = 'a';
exports.CONST_CS_GROUP_ID                       = 'b';
exports.CONST_CS_SENDER_ID                      = 'c';
exports.CONST_CS_ERROR                          = 'e';
exports.CONST_CS_LOGIN_TEMP_KEY                 = 'f';   
exports.CONST_CS_SERVER_PUBLIC_HOST             = 'g'; 
exports.CONST_CS_SERVER_PORT                    = 'h'; 
exports.CONST_CS_PARTY_NAME                     = 'i';
exports.CONST_CS_PARTY_DESCRIPTION              = 'j';
exports.CONST_CS_REQUEST_ID                     = 'r';


////////////EO-Reply with COMM-Servers


// Error numbers
exports.CONST_ERROR_NON                         = 0;   
exports.CONST_ERROR_INVALID_DATA                = 1;   
exports.CONST_ERROR_ACCOUNT_NOT_FOUND           = 2;   
exports.CONST_ERROR_DATA_DATABASE_ERROR         = 3;  
exports.CONST_ERROR_OLD_APP_VERSION             = 4; 
exports.CONST_ERROR_SERVER_NOT_AVAILABLE        = 5;  
exports.CONST_ERROR_NO_PERMISSION               = 6;  
exports.CONST_ERROR_SESSION_NOT_FOUND           = 7;  // a relogin might be required.
exports.CONST_ERROR_HARDWARE_NOT_FOUND          = 8;  
exports.CONST_ERROR_ACCOUNT_DISABLED            = 9;  
exports.CONST_ERROR_DATA_UNKNOWN_ERROR          = 999;  



// Validation
exports.CONST_ACCESSCODE_MAX_LENGTH             = 200;
exports.CONST_FINGERPRINT_MAX_LENGTH            = 200;
exports.CONST_SESSION_MAX_LENGTH                = 200;
exports.CONST_SENDERID_MAX_LENGTH               = 200;



exports.CONST_GCS = true;
exports.CONST_AGENT = false;


