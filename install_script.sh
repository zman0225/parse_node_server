#!/bin/bash

#install mongodb
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 7F0CEB10
echo 'deb http://downloads-distro.mongodb.org/repo/ubuntu-upstart dist 10gen' | sudo tee /etc/apt/sources.list.d/mongodb.list
sudo apt-get -y update
sudo apt-get -y install mongodb-org
sudo service mongod restart

#install pm2
sudo apt-get install build-essential
sudo apt-get install curl openssl libssl-dev
git clone https://github.com/joyent/node.git
cd node
git checkout v0.10.24
./configure
make
sudo make install
sudo npm install pm2@latest -g --unsafe-perm


