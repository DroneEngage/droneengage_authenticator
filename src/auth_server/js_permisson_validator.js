"use strict";

const AndruavMessageTypes = {

    CONST_ALLOW_GCS           : 0x00000001,
    CONST_ALLOW_UNIT          : 0x00000010,
    CONST_ALLOW_GCS_CONTROL   : 0x00000100,
    CONST_ALLOW_GCS_VIDEO     : 0x00001000,

    // Account-type bits (top of the 32-bit mask).
    // Bit 31: account may be used as a GCS login.
    // Bit 30: account may be used as a unit login.
    // Bit 29: view-only mode; only chat is actionable (no control/planning/mutation).
    //         A view-mode account has bit 29 set AND no category/action bits
    //         (bits 0-25).  A full-control account (0xffffffff) has bit 29 set
    //         but also has category bits, so it is NOT view-mode.
    CONST_ALLOW_GCS_LOGIN     : 0x80000000,
    CONST_ALLOW_UNIT_LOGIN    : 0x40000000,
    CONST_ALLOW_VIEW_MODE     : 0x20000000,

    // Category/action permission bits (bits 0-25).  When all are zero and
    // the view-mode bit is set, the account is a read-only view-mode GCS.
    CONST_CATEGORY_ACTION_MASK: 0x03ffffff,

    // Message-category permission bits (bits 16-25).
    CONST_ALLOW_SWARM         : 0x00010000,
    CONST_ALLOW_TRACKING      : 0x00020000,
    CONST_ALLOW_GEOFENCE      : 0x00040000,
    CONST_ALLOW_SOUND         : 0x00080000,
    CONST_ALLOW_SDR           : 0x00100000,
    CONST_ALLOW_GPIO          : 0x00200000,
    CONST_ALLOW_TELNET        : 0x00400000,
    CONST_ALLOW_P2P           : 0x00800000,
    CONST_ALLOW_CHAT          : 0x01000000,
    CONST_ALLOW_CONFIG        : 0x02000000
}


function fn_convertPermissiontoInt(p_permission) {
    let per_value;
    try {
        if (p_permission == null) return 0xffffffff;

        if (typeof p_permission === 'string') {
            per_value = parseInt(p_permission, 16);
        } else if (typeof p_permission === 'number') {
            per_value = p_permission;
        }

        return per_value;
    } catch {
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

    return  ((per_value & p_flags) >>> 0) === (p_flags >>> 0)
}


module.exports =
{
    fn_validatePermission: fn_validatePermission,
    fn_convertPermissiontoInt: fn_convertPermissiontoInt,
    AndruavMessageTypes: AndruavMessageTypes
}