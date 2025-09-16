"use strict";

const AndruavMessageTypes = {

    CONST_ALLOW_GCS           : 0x00000001,
    CONST_ALLOW_UNIT          : 0x00000010,
    CONST_ALLOW_GCS_CONTROL   : 0x00000100,
    CONST_ALLOW_GCS_VIDEO     : 0x00001000
}


function fn_convertPermissiontoInt (p_permission)
{
    let per_value;
    try
    {
        if (p_permission == null) return 0xffffffff; // backward compatibility and for simplicity

        if (typeof p_permission === 'string')
        {
            per_value = parseInt(p_permission,16); // convert from hex string to number
        }
        else if (typeof p_permission === number)
        {
            per_value = c_per;
        }

        return per_value;
    }
    catch 
    {
        return 0;
    }
}

function fn_validatePermission (p_permission, p_flags)
{
    let per_value;
    
    if (p_permission == null) return false; // no permisisons

    if (typeof p_permission === 'string')
    {
        per_value = parseInt(p_permission,16); // convert from hex string to number
    }
    else if (typeof p_permission === 'number')
    {
        per_value = p_permission;
    }

    return  ((per_value & p_flags) === p_flags)
}


module.exports =
{
    fn_validatePermission: fn_validatePermission,
    fn_convertPermissiontoInt: fn_convertPermissiontoInt,
    AndruavMessageTypes: AndruavMessageTypes
}