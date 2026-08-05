"use strict";

// AndruaveMessageID

const CONST_TYPE_AndruavMessage_ID = 1004;
const CONST_TYPE_AndruavMessage_RemoteExecute = 1005;
const CONST_TYPE_AndruavMessage_Telemetry = 1007;
const CONST_TYPE_AndruavMessage_Error = 1008;
const CONST_TYPE_AndruavMessage_FlightControl = 1010;
const CONST_TYPE_AndruavMessage_VideoFrame = 1014;
const CONST_TYPE_AndruavMessage_IMG = 1006;
const CONST_TYPE_AndruavMessage_GPS = 1002;
const CONST_TYPE_AndruavMessage_POW = 1003;
const CONST_TYPE_AndruavMessage_CameraList = 1012; // RX: {"tg":"GCS1","sd":"zxcv","ty":"c","gr":"1","cm":"i","mt":1012,"ms":"{\"E\":2,\"P\":0,\"I\":\"zxcv\"}"}
const CONST_TYPE_AndruavMessage_IMU = 1013;
const CONST_TYPE_AndruavMessage_BinaryIMU = 1013;
const CONST_TYPE_AndruavMessage_IMUStatistics = 1016;
const CONST_TYPE_AndruavMessage_DroneReport = 1020;
const CONST_TYPE_AndruavMessage_HomeLocation = 1022;
const CONST_TYPE_AndruavMessage_GeoFence = 1023;
const CONST_TYPE_AndruavMessage_ExternalGeoFence = 1024;
const CONST_TYPE_AndruavMessage_GEOFenceHit = 1025;
const CONST_TYPE_AndruavMessage_WayPoints = 1027;
const CONST_TYPE_AndruavMessage_ExternalCommand_WayPoints = 1028;
const CONST_TYPE_AndruavMessage_GeoFenceAttachStatus = 1029;
const CONST_TYPE_AndruavMessage_Arm = 1030;
const CONST_TYPE_AndruavMessage_ChangeAltitude = 1031;
const CONST_TYPE_AndruavMessage_Land = 1032;
const CONST_TYPE_AndruavMessage_DoYAW = 1035;
const CONST_TYPE_AndruavMessage_Signaling = 1021;
const CONST_TYPE_AndruavMessage_GuidedPoint = 1033;
const CONST_TYPE_AndruavMessage_CirclePoint = 1034;
const CONST_TYPE_AndruavMessage_NAV_INFO = 1036;
const CONST_TYPE_AndruavMessage_DistinationLocation = 1037;
const CONST_TYPE_AndruavMessage_ChangeSpeed = 1040;
const CONST_TYPE_AndruavMessage_Ctrl_Camera = 1041;
// CODEBLOCK_START
const CONST_TYPE_AndruavMessage_TrackingTarget = 1042;
const CONST_TYPE_AndruavMessage_TrackingTargetLocation = 1043;
const CONST_TYPE_AndruavMessage_TargetLost = 1044;
// CODEBLOCK_END
const CONST_TYPE_AndruavMessage_GimbalCtrl = 1045;
const CONST_TYPE_AndruavMessage_UploadWayPoints = 1046;
const CONST_TYPE_AndruavMessage_RemoteControlSettings = 1047;
const CONST_TYPE_AndruavMessage_SetHomeLocation = 1048;
const CONST_TYPE_AndruavMessage_CameraZoom = 1049;
const CONST_TYPE_AndruavMessage_CameraSwitch = 1050;
const CONST_TYPE_AndruavMessage_CameraFlash = 1051;
const CONST_TYPE_AndruavMessage_RemoteControl2 = 1052;
const CONST_TYPE_AndruavMessage_SensorsStatus = 1053;
// CODEBLOCK_START
const CONST_TYPE_AndruavMessage_FollowHim_Request = 1054;
const CONST_TYPE_AndruavMessage_FollowMe_Guided = 1055;
const CONST_TYPE_AndruavMessage_MakeSwarm = 1056;
const CONST_TYPE_AndruavMessage_SwarmReport = 1057;
const CONST_TYPE_AndruavMessage_UpdateSwarm = 1058;
// CODEBLOCK_END

const CONST_TYPE_AndruavMessage_CommSignalsStatus   = 1059;
const CONST_TYPE_AndruavMessage_Sync_EventFire      = 1061;
const CONST_TYPE_AndruavMessage_SearchTargetList    = 1062;
const CONST_TYPE_AndruavMessage_UdpProxy_Info       = 1071
const CONST_TYPE_AndruavMessage_Unit_Name           = 1072


// Binary Messages
const CONST_TYPE_AndruavMessage_LightTelemetry      = 2022;

// new Andruav Messages 2019
const CONST_TYPE_AndruavMessage_ServoChannel        = 6001;
const CONST_TYPE_AndruavBinaryMessage_ServoOutput   = 6501;
const CONST_TYPE_AndruavBinaryMessage_Mavlink       = 6502;

// System Messages
const CONST_TYPE_AndruavSystem_LoadTasks            = 9001;
const CONST_TYPE_AndruavSystem_SaveTasks            = 9002;
const CONST_TYPE_AndruavSystem_DeleteTasks          = 9003;
const CONST_TYPE_AndruavSystem_DisableTasks         = 9004;
const CONST_TYPE_AndruavSystem_LogoutCommServer     = 9006;
const CONST_TYPE_AndruavSystem_ConnectedCommServer  = 9007;

let message_names = {
    1002: "GPS",
    1003: "POW",
    1004: "ID",
    1005: "Remote Execute",
    1006: "Image",
    1008: "Message",
    1012: "CameraList",
    1021: "Signaling",
    1022: "Home Location",
    1027: "WayPoints",
    1036: "NAV_INFO",
    1049: "Camera Zoom",
    1050: "Camera Switch",
    1051: "Camera Flash",
    1013: "BinaryIMU",
    1016: "IMUStatistics",
    1052: "RemoteControl2",
    1071: "UdpProxy_Info",
    6001: "ServoChannel",
    6501: "ServoOutput",
    6502: "Mavlink"
};

