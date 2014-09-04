#!/bin/bash

pm2 startup ubuntu
pm2 start processes.json
pm2 save
