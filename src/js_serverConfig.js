/*************************************************************************************
 * 
 *   A N D R U A V -  Server Configuration File      JAVASCRIPT  LIB
 * 
 *   Author: Mohammad S. Hefny
 * 
 *   Date:   08 Sep 2016
 * 
 * 
 * 
 */

"use strict";

const common = require("droneengage_server_common");
const path = require("path");

module.exports = common.create({
    configDir: path.join(__dirname, '..'),
    enableHashHandling: true,
    envOverrides: {
        'de_auth_servers_status_guid': 'servers_admin_url_guid',
        'de_auth_webadmin_terminal_enabled': (cfg, val) => {
            cfg.webadmin_terminal_enabled = (val === 'true' || val === '1');
        },
        'de_auth_debug_logging': (cfg, val) => {
            cfg.debug_logging = (val === 'true' || val === '1');
        }
    }
});
