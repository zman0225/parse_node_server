#!/bin/bash

sudo pm2 startup ubuntu
sudo pm2 start processes.json
sudo pm2 save
