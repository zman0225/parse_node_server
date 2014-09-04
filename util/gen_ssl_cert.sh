#!/bin/sh
mkdir ../ssl
# sudo openssl genrsa -des3 -out ../ssl/www.api.grid.social.key 1024
# sudo openssl req -new -key ../ssl/www.api.grid.social.key -out ../ssl/www.api.grid.social.csr
sudo openssl req -new -x509 -days 365 -nodes -out ../ssl/cert.pem -keyout ../ssl/key.pem
