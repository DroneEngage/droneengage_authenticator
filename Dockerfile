# specify the node base image with your desired version node:<version>
FROM node:16

# replace this with your application's default port
EXPOSE 19408 19001

# Create app directory
WORKDIR /usr/src/app

# COPY package.json ./
# RUN npm install -g npm
# RUN npm install 
# COPY *.js  ./
# COPY ./ssl ./ssl/
# COPY ./auth_server ./auth_server/
# COPY ./helpers ./helpers/
# COPY server.config ./
CMD ["node", "server.js", "--config=server.docker.config"]





