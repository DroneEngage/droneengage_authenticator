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


const c_commentStripper = require("./helpers/js_3rd_StripJsonComments.js");
const c_dumpError 		= require ("./dumperror.js");
const c_configFileName_default = "server.config";


var Me = this;
exports.m_configuration = null;
var m_configFileName = c_configFileName_default;
exports.getFileName = function ()
{
		return m_configFileName;
}

exports.init = function init (p_configFileName)
{

    const  path = require('path');
    const fs = require('fs');

	if (p_configFileName != null)
	{
		m_configFileName = p_configFileName;
	}
		
    try
    {
        var v_filestring = fs.readFileSync(path.join(__dirname,m_configFileName)).toString();			
    }
    catch (err)
    {
        console.log ('FATAL: could not find ' + m_configFileName);
        c_dumpError.dumperror(err);
        process.exit(1);
    }

    try
    {
        Me.m_configuration = JSON.parse(c_commentStripper(v_filestring));
    }
    catch (err)
    {
        console.log ('FATAL: Bad File Format ' + m_configFileName);
        c_dumpError.dumperror(err);
        process.exit(1);
    }
}
