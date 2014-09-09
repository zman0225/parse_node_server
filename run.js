/*jslint node: true, es5: true, nomen: true, regexp: true, indent: 2*/
"use strict";

require("./grid").run({
  "developmentPort":8000,
	"port":433,
  "secret": "c821a09ebf01e090a46b6bbe8b21bcb36eb5b432265a51a76739c20472908989",
  "salt": "5eWIYXeepr0Gvy7wwPKPTQ0aW+wIjbRjjCCLfNRo2AI=",
  'allowDestroy': true,
  'allowDrop': true,
  'productionMode':false,
  'mongoURI':'mongodb://localhost:27017/grid',
  'push_key':"./push_development_ssl/key.pem",
  'push_cert':"./push_development_ssl/cert.pem",
  'ca':'./ssl/ca.ca-bundle',
  "key":"./ssl/server.key",
  "cert":"./ssl/server.crt"
   // 'push_key':"./push_production_ssl/key.pem",
   // 'push_cert':"./push_production_ssl/cert.pem",

});
