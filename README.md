# What is Andruav-Authenticator ?

Andruav-Authenticator is the authentication server responsible for registering users and vehicles and assign them to [communcation servers](https://github.com/HefnySco/andruav_server "communcation servers").

[Andruav and Drone-Engage](https://cloud.ardupilot.org "Andruav and Drone-Engage").


[![https://cloud.ardupilot.org/_images/rpizeroweight.jpeg](https://cloud.ardupilot.org/_images/rpizeroweight.jpeg "https://cloud.ardupilot.org/_images/rpizeroweight.jpeg")](https://cloud.ardupilot.org/_images/rpizeroweight.jpeg "https://cloud.ardupilot.org/_images/rpizeroweight.jpeg")



Please refer to [Cloud.Ardupilot.org](https://cloud.ardupilot.org/ "Cloud.Ardupilot.org")

[![Ardupilot Cloud EcoSystem](https://cloud.ardupilot.org/_static/ardupilot_logo.png "Ardupilot Cloud EcoSystem")](https://cloud.ardupilot.org "Ardupilot Cloud EcoSystem") **Drone Engage** is part of Ardupilot Cloud Eco System


## Sequence Diagram

```seq
DE_Communicator->Authenticator: Auth_request
Authenticator->Authenticator:Retrieve Data
Authenticator->Server: Allocate-Chat-Room
Server-->Authenticator: Chat-Room-Information
Authenticator->DE_Communicator: Connection Information
```


