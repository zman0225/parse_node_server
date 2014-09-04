#!/bin/bash

pm2 startup ubuntu
pm2 start run.js -i max --watch
pm2 save
