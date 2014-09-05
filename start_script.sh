#!/bin/bash

#setup ssl 
if [ ! -f ssl/key.cem || ! -f ssl/cert.cem]; then
	#statements
	echo "SSL PEMs/folder not found, generating new key/cert"
	cd util
	./gen_ssl_cert.sh
	cd ..
fi

if [ ! -f log ]; then
	mkdir log
fi

sudo rm -rf node_modules
sudo npm cache clean
sudo npm install
sudo npm update

sudo pm2 startup ubuntu
sudo pm2 start processes.json
sleep 1
sudo pm2 save

sudo pm2-web --pm2.host foo.baz.com
