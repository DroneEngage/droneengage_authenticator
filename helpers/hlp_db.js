/*
################RELEASE NOTES
Author: Mohammad Said Hefny mohammad.hefny@gmail.com

Created 23 Jul 2017

Last update 23 Jul 2017: 
Updated for SQLite (sqlite3) support

*/

"use strict";

function fn_genericSelect (p_db,p_sql,p_params, fn_successcallback,fn_errorcallback)
{
	p_db.all(p_sql, p_params || [], function(err, rows) {
		if (err) {
			if (fn_errorcallback != null) fn_errorcallback(err);
			return;
		}
		if (fn_successcallback != null) fn_successcallback(rows);
	});
}

function fn_genericSelect_w_Params (p_db,p_sql,paramlist,fn_successcallback,fn_errorcallback)
{
	p_db.all(p_sql, paramlist, function(err, rows) {
		if (err) {
			if (fn_errorcallback != null) fn_errorcallback(err);
			return;
		}
		if (fn_successcallback != null) fn_successcallback(rows);
	});
}

function insertOrDelete (p_db,p_sql,fn_successcallback,fn_errorcallback)
{
	p_db.run(p_sql, function(err) {
		if (err) {
			if (fn_errorcallback != null) fn_errorcallback(err);
			return;
		}
		if (fn_successcallback != null) fn_successcallback();
	});
}

function fn_insertOrDelete_w_Params (p_db,p_sql,paramlist,fn_successcallback,fn_errorcallback)
{
	p_db.run(p_sql, paramlist, function(err, res) {
		if (err) {
			if (fn_errorcallback != null) fn_errorcallback(err, null);
			return;
		}
		if (fn_successcallback != null) fn_successcallback(null, res);
	});
}

module.exports =
{
    fn_genericSelect:fn_genericSelect,
    fn_genericSelect_w_Params: fn_genericSelect_w_Params,
    fn_genericInsert_w_Params:fn_insertOrDelete_w_Params,
    fn_genericDelete_w_Params: fn_insertOrDelete_w_Params
}
