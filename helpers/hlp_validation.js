"use strict";

/**
 * Validation helper functions
 * These functions replace the prototype pollution from hlp_string.js
 */

/**
 * Replace all occurrences of a string
 * @param {string} str - The string to process
 * @param {string} search - The string to search for
 * @param {string} replacement - The replacement string
 * @returns {string} - The processed string
 */
function replaceAll(str, search, replacement) {
    if (str == null) return str;
    return str.replace(new RegExp(search, 'g'), replacement);
}

/**
 * Protect string from SQL injection by removing SQL comment markers
 * @param {string} str - The string to process
 * @returns {string} - The processed string
 */
function protectedFromInjection(str) {
    if (str == null) return str;
    return str.replace(new RegExp("--", 'g'), " ");
}

/**
 * Replace character at specific index
 * @param {string} str - The string to process
 * @param {number} index - The index to replace
 * @param {string} replaceBy - The replacement character
 * @returns {string|null} - The processed string or null if invalid
 */
function replaceByIndex(str, index, replaceBy) {
    if (str == null) return null;
    if (index == null) return null;
    if (str.length < index) return null;
    return str.substr(0, index) + replaceBy + str.substr(index + 1);
}

/**
 * Check if string contains only letters and numbers
 * @param {string} str - The string to validate
 * @returns {boolean} - True if alphanumeric
 */
function isAlphanumeric(str) {
    if (str == null) return false;
    return (str.match(/^[_a-z0-9]+$/i) != null);
}

/**
 * Check if string matches version format (e.g., 5a.0.0)
 * @param {string} str - The string to validate
 * @returns {boolean} - True if version format
 */
function isVersionFormat(str) {
    if (str == null) return false;
    return (str.match(/([a-z0-9]+\.)([a-z0-9]+\.)([a-z0-9])+$/i) != null);
}

/**
 * Check if string is alphanumeric sentence (e.g., "This is a 5 Sample")
 * @param {string} str - The string to validate
 * @returns {boolean} - True if alphanumeric sentence
 */
function isAlphanumericSentence(str) {
    if (str == null) return false;
    return (str.match(/^[A-Za-z0-9( )]+$/i) != null);
}

/**
 * Check if string contains both letters AND numbers
 * @param {string} str - The string to validate
 * @returns {boolean} - True if contains both letters and numbers
 */
function isOnlyAlphanumeric(str) {
    if (str == null) return false;
    return (str.match(/((^[0-9]+[a-z]+)|(^[a-z]+[0-9]+))+[0-9a-z]+$/i) != null);
}

/**
 * Check if string is a valid email address
 * @param {string} str - The string to validate
 * @returns {boolean} - True if valid email
 */
function isEmail(str) {
    if (str == null) return false;
    return (str.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,4})+$/i) != null);
}

module.exports = {
    replaceAll,
    protectedFromInjection,
    replaceByIndex,
    isAlphanumeric,
    isVersionFormat,
    isAlphanumericSentence,
    isOnlyAlphanumeric,
    isEmail
};
