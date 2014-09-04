#!/bin/bash

#setup ssl 
if [! -f ssl/key.cem | ! -f ssl/cert.cem]; then
	#statements
	echo "SSL PEMs/folder not found, generating new key/cert"
	cd util
	./gen_ssl_cert.sh
	cd ..
fi

sudo pm2 startup ubuntu
sudo pm2 start processes.json
sudo pm2 save
