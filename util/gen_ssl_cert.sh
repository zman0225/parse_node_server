#!/bin/sh
mkdir ../ssl
sudo openssl req -new -x509 -days 365 -nodes -out ../ssl/cert.pem -keyout ../ssl/cert.pem