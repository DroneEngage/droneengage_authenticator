#!/bin/bash 
docker image rm andruav_auth:1.1 -f 
docker build . -t andruav_auth:1.1
