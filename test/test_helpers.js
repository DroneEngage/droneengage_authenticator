"use strict";

function setupTestGlobals(configOverrides = {}) {
    global.c_CONSTANTS = require("../src/js_constants");
    global.m_serverconfig = require("../src/js_serverConfig.js");
    global.m_serverconfig.init("server.config");

    Object.assign(global.m_serverconfig.m_configuration, configOverrides);
}

module.exports = {
    setupTestGlobals,
};
