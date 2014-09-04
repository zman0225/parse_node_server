/*jslint node: true, es5: true, nomen: true, regexp: true, indent: 2*/
"use strict";

require("./datakit").run({
	"port":80,
  "secret": "c821a09ebf01e090a46b6bbe8b21bcb36eb5b432265a51a76739c20472908989",
  "salt": "cfgsalt",
  'allowDestroy': true,
  'allowDrop': true,
  'productionMode':false,
  'push_key':"./push_development_ssl/key.pem",
  'push_cert':"./push_development_ssl/cert.pem",
   // 'push_key':"./push_production_ssl/key.pem",
   // 'push_cert':"./push_production_ssl/cert.pem",
});