"use strict";

const path = require("path");

function setupTestGlobals(configOverrides = {}) {
    require(path.join(__dirname, "../helpers/hlp_string.js"));

    global.c_CONSTANTS = require("../js_constants");
    global.m_serverconfig = require("../js_serverConfig.js");
    global.m_serverconfig.init("server.config");

    Object.assign(global.m_serverconfig.m_configuration, configOverrides);
}

module.exports = {
    setupTestGlobals,
};
