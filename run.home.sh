#!/bin/bash


ROOTDIR=$PWD


echo "node \"$ROOTDIR/andruav_authenticator/server.js\"  --config=server.home.config"
node "$ROOTDIR/andruav_authenticator/server.js"  --config=server.home.config


