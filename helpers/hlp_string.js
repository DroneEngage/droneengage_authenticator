"use strict";
var randomstring = require("randomstring");
const v_validation = require("./hlp_validation");

// Re-export validation functions for backward compatibility
exports.replaceAll = v_validation.replaceAll;
exports.fn_protectedFromInjection = v_validation.protectedFromInjection;
exports.replacebyIndex = v_validation.replaceByIndex;
exports.fn_isAlphanumeric = v_validation.isAlphanumeric;
exports.fn_isVersionFormat = v_validation.isVersionFormat;
exports.fn_isAlphanumericSentence = v_validation.isAlphanumericSentence;
exports.fn_isOnlyAlphanumeric = v_validation.isOnlyAlphanumeric;
exports.fn_isEmail = v_validation.isEmail;
exports.fn_isValidAccountName = v_validation.isEmail;

exports.generateRandomString = function (strLen)
{
    // https://github.com/klughammer/node-randomstring
    var id = randomstring.generate(
    {
        length: strLen,
        charset: 'alphanumeric'
    });
    return id;
}

exports.pad2 = function(number) {
    return (number < 10 ? '0' : '') + number;
}