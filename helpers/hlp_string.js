"use strict";
var randomstring = require("randomstring");

//http://stackoverflow.com/questions/1144783/replacing-all-occurrences-of-a-string-in-javascript
String.prototype.replaceAll = function(search, replacement)
{
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

String.prototype.fn_protectedFromInjection = function()
{
    var target = this;
    return target.replace(new RegExp("--", 'g'), " ");
};


String.prototype.replacebyIndex = function (index,replaceBy)
{
    if (index == null) return null;
    if (this.length < index) return null;
    return this.substr(0, index) + replaceBy + s.substr(index + 1);
};


/**
 * contains letters or numbers
 */
String.prototype.fn_isAlphanumeric = function ()
{
    return (this.match(/^[_a-z0-9]+$/i) != null);
}


/**
 * example: 5a.0.0
 */
String.prototype.fn_isVersionFormat = function ()
{
    return (this.match(/([a-z0-9]+\.)([a-z0-9]+\.)([a-z0-9])+$/i) != null);
}


/**
 * example: This is a 5 Sample
 */
String.prototype.fn_isAlphanumericSentence = function ()
{
    return (this.match(/^[A-Za-z0-9( )]+$/i) != null);
}

/**
 * contains both letters AND numbers
 */
String.prototype.fn_isOnlyAlphanumeric = function ()
{
    return (this.match(/((^[0-9]+[a-z]+)|(^[a-z]+[0-9]+))+[0-9a-z]+$/i) != null);
}


/**
 * https://www.w3resource.com/javascript/form/email-validation.php
 */
String.prototype.fn_isEmail = function ()
{
    return (this.match(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,4})+$/i) != null);
}


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
   
    return (number < 10 ? '0' : '') + number
  
}