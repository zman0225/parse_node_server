#!/bin/sh
mkdir ../ssl
sudo openssl genrsa -des3 -out ../ssl/server.key 1024
sudo openssl req -new -key ../ssl/server.key -out ../ssl/server.csr
sudo cp ../ssl/server.key ../ssl/server.key.org
sudo openssl rsa -in ../ssl/server.key.org -out ../ssl/server.key
sudo openssl x509 -req -days 365 -in ../ssl/server.csr -signkey ../ssl/server.key -out ../ssl/server.crt
