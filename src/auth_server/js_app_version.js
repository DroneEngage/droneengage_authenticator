"use strict";

const c_CONSTANTS = require("../js_constants");
const { getConfiguration } = require("./js_config");

function checkAppVersion(app, version) {
    const apps = JSON.parse(getConfiguration().APPVERSION);

    if (apps[app] == null) {
        console.log("unknown app " + app);
        return buildOldVersionReply();
    }

    if (version < apps[app]) {
        return buildOldVersionReply();
    }

    return null;
}

function buildOldVersionReply() {
    const reply = {};
    reply[c_CONSTANTS.CONST_ERROR.toString()] = c_CONSTANTS.CONST_ERROR_OLD_APP_VERSION;
    reply[c_CONSTANTS.CONST_ERROR_MSG.toString()] =
        "Please upgrade your Mobile App to latest version.";
    reply[c_CONSTANTS.CONST_COMMAND.toString()] = "v";
    return reply;
}

module.exports = {
    checkAppVersion,
    buildOldVersionReply,
};
