const JSONdb = require('simple-json-db');
const hlp_string = require ('../helpers/hlp_string');


"use strict"

const info_field = 'db_info';

class db_user {

    constructor(database_file)
    {
        this.db = new JSONdb(database_file);
        if (this.db.has (info_field) ===false)
        {
            var info = {
                SID: 0
            }
        }
        this.db.set(info_field, info);
    }

    /**
    * add or update
    */
    fn_add_record(access_code, user_data) {

        if (user_data==null) return ;
        user_data.isadmin = false;
        if (user_data.hasOwnProperty('acc')=== false) return ;
                
        if (access_code == info_field) return ;
        
        this.db.set(access_code, user_data);
    }


    fn_get_keys()
    {
        var keys =  Object.keys(this.db.storage);
        return keys.filter(x => x !== info_field);
    }

    fn_delete_record (key)
    {
        if (key == info_field) return ;
        
        this.db.delete(key.acc);
    }

    fn_get_record(key)
    {
        return this.db.get(key);
    }

    fn_get_all_users()
    {
        const keys = this.fn_get_keys();
        const len = keys.length;
        var users = {};
        for (var i=0 ; i< len ; ++i)
        {
            if (fn_get_record(keys[i]).isadmin===false)
            {
                users[keys[i]] = fn_get_record(keys[i]);
            }
        }

        return users;
    }

    fn_get_user_by_accesscode(accesscode)
    {
        const keys = this.fn_get_keys();
        const len = keys.length;
        for (var i=0 ; i< len ; ++i)
        {
            const rec = this.db.get(keys[i]);
            if (( rec != null) &&(rec.pwd == accesscode))
            {
                rec.acc = keys[i];
                return rec;
            }
        }

        return null;
    }

    fn_sync_to_disk()
    {
        this.db.sync();
    }
}






module.exports = {
    db_user
};