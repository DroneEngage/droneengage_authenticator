/*
################RELEASE NOTES
Author: Mohammad Said Hefny mohammad.hefny@gmail.com

Created 23 Jul 2017

Last update 23 Jul 2017: 

*/

"use strict";

function fn_genericSelect (p_dbPool,p_sql,p_params, fn_successcallback,fn_errorcallback)
{
	//console.log (p_sql);
    p_dbPool.getConnection(function(p_err, p_dbConnection)
    {
        if (p_err)
        {
			if (fn_errorcallback != null) fn_errorcallback(p_err);
			
            return;
        }

        //console.log(p_sql);
       
        p_dbConnection.query(p_sql, p_params, function(p_err, rows)
        {

            if (p_err)
            {

                p_dbConnection.release();

                if (fn_errorcallback != null) fn_errorcallback(p_err);
                
                return;
            }
			else
			{
				
                p_dbConnection.release();
                
                if (fn_successcallback != null) fn_successcallback(rows);

                return ;
			}
            

        });


    });
}

function fn_genericSelect_w_Params (p_dbPool,p_sql,paramlist,fn_successcallback,fn_errorcallback)
{
    p_dbPool.getConnection(function(err, p_dbConnection)
    {
        if (err)
        {
			if (fn_errorcallback != null) fn_errorcallback(err);
			
            return;
        }

        //console.log(p_sql);
       
        p_dbConnection.query(p_sql, paramlist, function(err, rows)
        {

            if (err)
            {
                p_dbConnection.release();
                if (fn_errorcallback != null) fn_errorcallback(err);
                
                return;
            }
			else
			{
				p_dbConnection.release();
                if (fn_successcallback != null) fn_successcallback(rows);
				
				return ;
			}
            

        });


    });
}
function insertOrDelete (p_dbPool,p_sql,fn_successcallback,fn_errorcallback)
{
	
    p_dbPool.getConnection(function(err, p_dbConnection)
    {
        if (err)
        {
            if (fn_errorcallback != null) fn_errorcallback(err);
            p_dbConnection.release();
            return;
        }

        p_dbConnection.query(p_sql, function(err, rows)
        {
            if (err)
            {
                if (fn_errorcallback != null) fn_errorcallback(err);
                p_dbConnection.release();
                return;
            }
            else
            {
				if (fn_successcallback != null) fn_successcallback ();

                p_dbConnection.release();
                return ;
            }
        }); // end of update connection

    });
}


function fn_insertOrDelete_w_Params (dbPool,p_sql,paramlist,fn_successcallback,fn_errorcallback)
{
	
    dbPool.getConnection(function(err, dbConnection)
    {
        if (err)
        {
            if (fn_errorcallback != null) fn_errorcallback(err);
            dbConnection.release();
            return;
        }

        console.log (p_sql);
        console.log (paramlist);

        dbConnection.query(p_sql, paramlist, 
            function(err, res)
            {
                if (err)
                {
                    dbConnection.release();
                    if (fn_errorcallback != null) fn_errorcallback(err, res);
                    return;
                }
                else
                {
                    dbConnection.release();
                    if (fn_successcallback != null) fn_successcallback (null, res);
                    return ;
                }
            }); // end of update connection

    });
}

module.exports =
{
    fn_genericSelect:fn_genericSelect,
    fn_genericSelect_w_Params: fn_genericSelect_w_Params,
    fn_genericInsert_w_Params:fn_insertOrDelete_w_Params,
    fn_genericDelete_w_Params: fn_insertOrDelete_w_Params
}
