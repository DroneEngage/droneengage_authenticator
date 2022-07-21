#!/bin/bash

#docker run -it  -v  $PWD:/home/node --entrypoint /bin/bash andruav_auth:1.1
docker stop local_andruav_auth
docker rm local_andruav_auth 

# until  `/usr/bin/docker inspect -f {{.State.Running}} local_andruav_auth` ==true $
#     do  sleep 0.1;
# done;


docker run -d \
  --name local_andruav_auth \
  --restart always \
  --network docker_nw \
  --hostname local_andruav_auth \
  --ip 173.17.0.14 \
  -p 19408:19408 \
  -p 19001:19001 \
andruav_auth:1.1

