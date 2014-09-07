/*jslint node: true, es5: true, nomen: true, regexp: true, indent: 2*/
"use strict";

/* @license
 * 
 * Copyright (c) 2012, Erik Aigner. All rights reserved.
 * 
 * Use of this software is only permitted in conjunction with the
 * DataKit iOS and Mac frameworks and implies conformance to the
 * DataKit frameworks' license terms.
 *
 */

var express = require('express');
var bodyParser = require('body-parser')
var https = require('https')
var assert = require('assert');
var mongo = require('mongodb');
var crypto = require('crypto');
var fs = require('fs');
var doSync = require('sync');
var uuid = require('node-uuid');
var apn = require('apn');
var app = {};
var apnConnection = {};

// private functions
var _conf = {};
var _db = {};
var _print = function(x,v){
var pad = '-'.repeat(80);
	console.log(pad);
	console.log(x);
	console.log(pad);
	console.log(v);
		console.log(pad);
console.log('\n');
}
var _def = function (v) {
  return (typeof v !== 'undefined');
};
var _exists = function (v) {
  return _def(v) && v !== null;
};
var _safe = function (v, d) {
  return _def(v) ? v : d;
};
var _m = function (m) {
  return exports[m];
};
var _secureMethod = function (m) {
  return function (req, res) {
    var s = req.header('x-datakit-secret', null);
    if (_exists(s) && s === _conf.secret) {
      return _m(m)(req, res);
    }
    res.header('WWW-Authenticate', 'datakit-secret');
    return res.status(401).send('');
  };
};
var _mkdirs = function (dirs, mode, cb) {
  var f = function next(e) {
    if (!e && dirs.length) {
      fs.mkdir(dirs.shift(), mode, next);
    } else {
      cb(e);
    }
  };
  f(null);
};
var _createRoutes = function (path) {
  var m = function (p) {
    return path + '/' + _safe(p, '');
  };
  app.get(m(), _m('info'));
  app.get(m('public/:key'), _m('getPublishedObject'));
  app.post(m('publish'), _secureMethod('publishObject'));
  app.post(m('save'), _m('saveObject'));
  app.post(m('delete'), _secureMethod('deleteObject'));
  app.post(m('refresh'), _secureMethod('refreshObject'));
  app.post(m('query'), _m('query'));
  app.post(m('index'), _secureMethod('index'));
  app.post(m('destroy'), _secureMethod('destroy'));
  app.post(m('drop'), _secureMethod('drop'));
  app.post(m('store'), _secureMethod('store'));
  app.post(m('unlink'), _secureMethod('unlink'));
  app.get(m('stream'), _secureMethod('stream'));
  app.post(m('exists'), _secureMethod('exists'));
};
var _parseMongoException = function (e) {
  if (!_exists(e)) {
    return null;
  }
  var lastErr = e.lastErrorObject;
  if (_exists(lastErr)) {
    return {'status': lastErr.code, 'message': lastErr.err};
  }
  return null;
};
var _e = function (res, snm, err) {
  var eo, me, stackLines, l;
  eo = {'status': snm[0], 'message': snm[1]};
  me = _parseMongoException(err);
  if (me !== null) {
    eo.err = me.message;
  } else if (_exists(err)) {
    eo.err = String(err.message);
    // stackLines = err.stack.split(/\n/g);
    // stackLines[1].replace(/at\s+\S*?([^\/]+):(\d+):(\d+)/g, function (a, f, l, c) {
    //   l = [f, l, c].join(":");
    //   console.error("error returned at", l);
    // });
  }
  return res.status(400).json(eo);
};
var _c = {
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  purple: '\u001b[34m',
  reset: '\u001b[0m'
};
var _DKDB = {
  PUBLIC_OBJECTS: 'datakit.pub',
  SEQENCE: 'datakit.seq'
};
var _ERR = {
  INVALID_PARAMS: [100, 'Invalid parameters'],
  OPERATION_FAILED: [101, 'Operation failed'],
  OPERATION_NOT_ALLOWED: [102, 'Operation not allowed'],
  DUPLICATE_KEY: [103, 'Duplicate key']
};
var _copyKeys = function (s, t) {
  var key;
  for (key in s) {
    if (s.hasOwnProperty(key)) {
      t[key] = s[key];
    }
  }
};
var _traverse = function (o, func) {
  var i;
  for (i in o) {
    if (o.hasOwnProperty(i)) {
      func.apply(o, [i, o[i]]);
      if (typeof (o[i]) === 'object') {
        _traverse(o[i], func);
      }
    }
  }
};
var _decodeDkObj = function (o) {
  _traverse(o, function (key, value) {
    if (key === 'dk:data') {
      this[key] = new Buffer(value, 'base64');
    }
    if (key === '$id') {
      this[key] = new mongo.ObjectID(value);
    }
  });
};
var _encodeDkObj = function (o) {
  _traverse(o, function (key, value) {
    if (key === 'dk:data') {
      this[key] = value.toString('base64');
    }
  });
};
var _generateNextSequenceNumber = function (entity) {
  var col, doc;
  col = _db.collection.sync(_db, _DKDB.SEQENCE);
  col.insert.sync(col, {'_id': entity, 'seq': new mongo.Long(0)});
  doc = col.findAndModify.sync(
    col,
    {'_id': entity},
    [],
    {'$inc': {'seq': 1}},
    {'new': true}
  );

  return doc.seq;
};
var _streamFileFromGridFS = function (req, res, fn) {
  doSync(function streamFileSync() {
    var gs, stream;
    if (!fn) {
      // HTTP: Not Found
      return res.status(404).send('');
    }

    // Open grid store
    gs = new mongo.GridStore(_db, fn, 'r');
    try {
      gs = gs.open.sync(gs);
    } catch (e) {
      console.log(e);
      // HTTP: Server Error
      return res.status(500).send('');
    }

    // Write head
    // HTTP: Partial Content
    console.log(fn, "=>", "content", gs.contentType, "len", gs.length);
    res.writeHead(200, {
      'Connection': 'close',
      'Content-Type': gs.contentType,
      'Content-Length': gs.length
    });

    stream = gs.stream(true);
    stream.on('data', function (data) {
      res.write(data);
    });
    stream.on('close', function () {
      res.end();
    });
  });
};
// prototypes
String.prototype.repeat = function (num) {
  var a = [];
  a.length = parseInt(num, 10) + 1;
  return a.join(this);
};
// exported functions
exports.run = function (c) {
  doSync(function runSync() {
    var pad, nl, buf, srv, db, parse;
    pad = '-'.repeat(80);
    nl = '\n';
    console.log(nl + pad + nl + 'DATAKIT' + nl + pad);
    _conf.mongoURI = _safe(c.mongoURI, 'mongodb://localhost:27017/datakit');
    _conf.path = _safe(c.path, '');
    _conf.developmentPort = _safe(c.developmentPort, process.env.PORT || 8000);
    _conf.port = _safe(c.port, process.env.PORT || 8000);
    _conf.secret = _safe(c.secret, null);
    _conf.salt = _safe(c.salt, "datakit");
    _conf.allowDestroy = _safe(c.allowDestroy, false);
    _conf.allowDrop = _safe(c.allowDrop, false);
    _conf.cert = _safe(c.cert, null);
    _conf.key = _safe(c.key, null);
    _conf.push_cert = _safe(c.push_cert,null);
    _conf.push_key = _safe(c.push_key,null);
    _conf.express = _safe(c.express, function (app) {});
    _conf.productionMode = _safe(c.productionMode,false);



    app = express();

    // Install the body parser

    app.use(bodyParser.json());

    if (_conf.secret === null) {
      buf = crypto.randomBytes.sync(crypto, 32);
      _conf.secret = buf.toString('hex');
      console.log(_c.red + 'WARN:\tNo secret found in config, generated new one.\n',
                  '\tCopy this secret to your DataKit iOS app and server config!\n\n',
                  _c.yellow,
                  '\t' + _conf.secret, nl, nl,
                  _c.red,
                  '\tTerminating process.',
                  _c.reset);
      process.exit(1);
    }
    if (_conf.secret.length !== 64) {
      console.log(_c.red, '\nSecret is not a hex string of length 64 (256 bytes), terminating process.\n', _c.reset);
      process.exit(2);
    }

    console.log('CONF:', JSON.stringify(_conf, undefined, 2), nl);

    // Create API routes
    _createRoutes(_conf.path);
    _conf.express(app);

    // Connect to DB and run
    try {
      _db = mongo.Db.connect.sync(mongo.Db, _conf.mongoURI, {});


      // collection.ensureIndex({"currentLocation":"2dsphere"});
      // collection.ensureIndex({"Location":"2dsphere"});
      // app.listen(_conf.port, function appListen() {
      //   console.log(_c.green + 'DataKit started on port', _conf.port, _c.reset);
      // });
    // if(_exists(conf.key)&&_exists(conf.cert)){
    //   https.createServer({
    //     'key': fs.readFileSync(_conf.key),
    //     'cert': fs.readFileSync(_conf.cert),
    //   }, app).listen(_conf.port);
    //       console.log(_c.green + 'DataKit started on port', _conf.port, _c.reset);

    // }else{
      
    // }

    var portToUse = _conf.productionMode?_conf.port:_conf.developmentPort;
    app.listen(portToUse, function appListen() {
        console.log(_c.green + 'DataKit started on port', portToUse, _c.reset);
      });
    
    } catch (e) {
      console.error(e);
    }

    //setup push notification
        console.log(nl + pad + nl + 'Push Setup' + nl + pad);
    var options = {};

    if (_exists(_conf.push_key)&&_exists(_conf.push_cert)){
      options = { "production": _conf.productionMode,"key":_conf.push_key,"cert":_conf.push_cert };
    }else{
      options = { "production": _conf.productionMode,"key":_conf.push_key,"cert":_conf.push_cert };
    }

    apnConnection = new apn.Connection(options);
    apnConnection.on('transmitted', function(notification, device) {
        console.log("Notification transmitted to:" + device.token.toString('hex'));
    });
    apnConnection.on('transmissionError', function(errCode, notification, device) {
      console.error("Notification caused error: " + errCode + " for device ", device, notification);
      if (errCode == 8) {
          console.log("A error code of 8 indicates that the device token is invalid. This could be for a number of reasons - are you using the correct environment? i.e. Production vs. Sandbox");
      }
    });

    //setup feedback
    var options = {
        "batchFeedback": true,
        "interval": 300
    };

    var feedback = new apn.Feedback(options);
    feedback.on("feedback", function(devices) {
        devices.forEach(function(item) {
            // Do something with item.device and item.time;
            console.log("failed to deliver to device "+item.device+" at time: "+item.time);
        });
    });

  });
};
exports.info = function (req, res) {
  return res.status(200).send('<h1>Welcome to Grid API.</h1><h4>Developer APIs coming soon!</h4>');
};
exports.getPublishedObject = function (req, res) {
  doSync(function publicSync() {
    var key, col, result, oid, fields;
    key = req.param('key', null);
    if (!_exists(key)) {
       return res.status(404).send('');
    }
    try {
      col = _db.collection.sync(_db, _DKDB.PUBLIC_OBJECTS);
      result = col.findOne.sync(col, {'_id': key});

      if (result.isFile) {
        return _streamFileFromGridFS(req, res, result.q);
      } else {
        oid = new mongo.ObjectID(result.q.oid);
        fields = result.q.fields;

        col = _db.collection.sync(_db, result.q.entity);
        result = col.findOne.sync(col, {'_id': oid}, fields);

        if (fields.length === 1) {
                		  console.log("index output is "+result[fields[0]]);

          return   res.status(200).send(result[fields[0]]);
        } else {
        		  console.log("index output is "+results);

          return res.status(200).json(result);
        }
      }
    } catch (e) {
      console.error(e);
    }

    return res.status(404).send('');
  });
};
exports.publishObject = function (req, res) {
  doSync(function publishObjectSync() {
    var entity, fn, isFile, oid, q, fields, query, idf, signature, shasum, key, col;
    entity = req.param('entity', null);
    oid = req.param('oid', null);
    fn = req.param('fileName', null);
    idf = null;
    isFile = false;
    if (_exists(fn)) {
      idf = "file:" + fn;
      isFile = true;
    } else if (_exists(entity) && _exists(oid)) {
      fields = req.param('fields', null);
      query = {
        'entity': entity,
        'oid': oid,
        'fields': []
      };
      if (fields !== null && fields.length > 0) {
        query.fields = fields;
      }
      idf = JSON.stringify(query);
    } else {
      return _e(res, _ERR.INVALID_PARAMS);
    }

    // Compute key
    signature = _conf.secret + _conf.salt + idf;
    shasum = crypto.createHash('sha256');
    shasum.update(signature);
    key = shasum.digest('hex');

    try {
      q = isFile ? fn : query;
      col = _db.collection.sync(_db, _DKDB.PUBLIC_OBJECTS);
      col.update.sync(col, {'_id': key}, {'$set': {'q': q, 'isFile': isFile}}, {'safe': true, 'upsert': true});
		console.log("publishObject output is ",key);
      return res.status(200).json({'key':key}); 
    } catch (e) {
      console.error(e);
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.saveObject = function (req, res) {
  doSync(function saveSync() {
    var i, entities, results, errors, ent, entity, oidStr, fset, funset, finc, fpush, fpushAll, faddToSet, fpop, fpullAll, oid, ts, collection, doc, isNew, opts, update, ats, key;
    entities = req.body;
    results = [];
    errors = [];
    for (i in entities) {
      _print("entity",entities[i]);
      if (entities.hasOwnProperty(i)) {
        ent = entities[i];
        entity = _safe(ent.entity, null);
        if (!_exists(entity)) {
          return _e(res, _ERR.INVALID_PARAMS);
        }
        oidStr = _safe(ent.oid, null);
        fset = _safe(ent.set, {});
        funset = _safe(ent.unset, null);
        finc = _safe(ent.inc, null);
        fpush = _safe(ent.push, null);
        fpushAll = _safe(ent.pushAll, null);
        faddToSet = _safe(ent.addToSet, null);
        fpop = _safe(ent.pop, null);
        fpullAll = _safe(ent.pullAll, null);
        oid = null;

        _decodeDkObj(fset);
        _decodeDkObj(fpush);
        _decodeDkObj(fpushAll);
        _decodeDkObj(faddToSet);
        _decodeDkObj(fpullAll);

        if (_exists(oidStr)) {
          oid = new mongo.ObjectID(oidStr);
          if (!_exists(oid)) {
            return _e(res, _ERR.INVALID_PARAMS);
          }
        }
        try {
          ts = parseInt((new Date().getTime()) / 1000, 10);
          collection = _db.collection.sync(_db, entity);
          isNew = (oid === null);

          // Automatically insert the update timestamp
          fset._updated = ts;

          // Insert new object
          if (isNew) {
            // Generate new sequence number         
            fset._seq = _generateNextSequenceNumber(entity);
            doc = collection.insert.sync(collection, fset);
            oid = doc[0]._id;
          }

          // Update instead if oid exists, or an operation needs to be executed
          // that requires an insert first.
          opts = {'upsert': true, 'new': true};
          update = {};
          if (_exists(fset) && !isNew) {
            update.$set = fset;
          }
          if (_exists(funset)) {
            update.$unset = funset;
          }
          if (_exists(finc)) {
            update.$inc = finc;
          }
          if (_exists(fpush)) {
            update.$push = fpush;
          }
          if (_exists(fpushAll)) {
            update.$pushAll = fpushAll;
          }
          if (_exists(faddToSet)) {
            ats = {};
            for (key in faddToSet) {
              if (faddToSet.hasOwnProperty(key)) {
                ats[key] = {'$each': faddToSet[key]};
              }
            }
            update.$addToSet = ats;
          }
          if (_exists(fpop)) {
            update.$pop = fpop;
          }
          if (_exists(fpullAll)) {
            update.$pullAll = fpullAll;
          }

          // Find and modify
          if (!isNew || (isNew && Object.keys(update).length > 0)) {
            doc = collection.findAndModify.sync(collection, {'_id': oid}, [], update, opts);
          }

          if (doc.length > 0) {
            doc = doc[0];
          }

          _encodeDkObj(doc);

          results.push(doc);
          if (entity==="Message"){
            doSync(function pushNotify(){
              var recipients = fset.messageRecipients;
              var recipientsObjectId = [];
              for (var i = recipients.length - 1; i >= 0; i--) {
                recipientsObjectId.push(new mongo.ObjectID(recipients[i]));
              };
              _print("pushing notification to ",recipientsObjectId);
              collection = _db.collection.sync(_db, "User");
              var cursor = collection.find.sync(collection,{'_id':{$in:recipientsObjectId}},{'userDeviceTokens':1,_id:0});
              var tokens = cursor.toArray.sync(cursor);
              var tokensToDeliver = [];

              var note = new apn.Notification();

              note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
              note.sound = "ping.aiff";
              switch(fset.messageType){
                case "Snap":
                  note.alert = "A New Snap!";
                  break;
                case "TextMessage":
                  note.alert = "A New Message!";
                  break;
                case "messageAnonymousClass":
                  note.alert = "A Secret Whisper!";
                  break;
                case "LocationClass":
                  note.alert = "A New Location!";
                  break;
                case "LocationRequestClass":
                  note.alert = "A New Where!";
                  break;       
              }
              
              var sender = _safe(fset.messageSenderName,fset.messageSender);
              note.payload = {'msgFrom': sender,'msgType':fset.messageType};
              for (var y in tokens) {
                if(tokens[y].hasOwnProperty('userDeviceTokens')){
                  for(var x in tokens[y].userDeviceTokens){
                    tokensToDeliver.push(tokens[y].userDeviceTokens[x]);
                  }
                }
              };

              console.log("Tokens are "+tokensToDeliver);

              var send = function(){   
                setTimeout(
                  function(){           
                    apnConnection.pushNotification(note, tokensToDeliver);
                  },1000);
              };

              send.sync(null);


            });
          }
        } catch (e) {
              console.log("saveObject error",e);

          errors.push(e);
        }
        
      }
    }
    if (errors.length > 0) {
      return _e(res, _ERR.OPERATION_FAILED, errors.pop());
    }
    console.log("saveObject results",results);
    return res.status(200).json(results);
  });
};
exports.deleteObject = function (req, res) {
  doSync(function deleteSync() {
    var entity, oidStr, oid, collection, result;
    entity = req.param('entity', null);
    oidStr = req.param('oid', null);
    if (!_exists(entity)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    if (!_exists(oidStr)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    oid = new mongo.ObjectID(oidStr);
    if (!_exists(oid)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    try {
      collection = _db.collection.sync(_db, entity);
      result = collection.remove.sync(collection, {'_id': oid}, {'safe': true});
      res.status(200).send('');
    } catch (e) {
      console.error(e);
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.refreshObject = function (req, res) {
  doSync(function refreshSync() {
    var entity, oidStr, oid, collection, result;
    entity = req.param('entity', null);
    oidStr = req.param('oid', null);
    if (!_exists(entity)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    if (!_exists(oidStr)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    oid = new mongo.ObjectID(oidStr);
    if (!_exists(oid)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    try {
      collection = _db.collection.sync(_db, entity);
      result = collection.findOne.sync(collection, {'_id': oid});
      if (!_exists(result)) {
        throw 'Could not find object';
      }

      _encodeDkObj(result);
      _print("refresh",result);
      res.status(200).json(result);
    } catch (e) {
      console.error(e);
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.query = function (req, res) {
  doSync(function querySync() {
  _print("query",JSON.stringify(req.body,null,4));
    var entity, doFindOne, doCount, query, opts, or, and, refIncl, fieldInclExcl, sort, skip, limit, mr, mrOpts, sortValues, order, results, cursor, collection, result, key, resultCount, i, j, field, dbRef, resolved;
    entity = req.param('entity', null);
    if (!_exists(entity)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    doFindOne = req.param('findOne', false);
    doCount = req.param('count', false);
    query = req.param('q', {});
    opts = {};
    or = req.param('or', null);
    and = req.param('and', null);
    refIncl = req.param('refIncl', []);
    fieldInclExcl = req.param('fieldInEx', null);
    sort = req.param('sort', null);
    skip = req.param('skip', null);
    limit = req.param('limit', null);
    mr = req.param('mr', null);

    if (_exists(or)) {
      query.$or = or;
    }
    if (_exists(and)) {
      query.$and = and;
    }
    if (_exists(sort)) {
      sortValues = [];
      for (key in sort) {
        if (sort.hasOwnProperty(key)) {
          order = (sort[key] === 1) ? 'asc' : 'desc';
          sortValues.push([key, order]);
        }
      }
      opts.sort = sortValues;
    }
    if (_exists(skip)) {
      opts.skip = parseInt(skip, 10);
    }
    if (_exists(limit)) {
      opts.limit = parseInt(limit, 10);
    }

    // replace oid strings with oid objects
    _traverse(query, function (key, value) {
      if (key === '_id') {
        this[key] = new mongo.ObjectID(value);
      }
    });
    _print("collection ent is",entity);

    try {
      // console.log('query', entity, '=>',
      //             JSON.stringify(query),
      //             JSON.stringify(fieldInclExcl),
      //             JSON.stringify(opts));

      collection = _db.collection.sync(_db, entity);
      if (mr !== null) {
        mrOpts = {
          'query': query,
          'out': {'inline': 1}
        };
        // if (_exists(opts.sort)) {
        //   mrOpts.sort = opts.sort;
        // }
        if (_exists(opts.limit)) {
          mrOpts.limit = opts.limit;
        }
        if (_exists(mr.context)) {
          mrOpts.scope = mr.context;
        }
        if (_exists(mr.finalize)) {
          mrOpts.finalize = mr.finalize;
        }
        results = collection.mapReduce.sync(
          collection,
          mr.map,
          mr.reduce,
          mrOpts
        );
        _print("query from map reduce",results)
      } else {
        if (doFindOne) {
          opts.limit = 1;
        }

        if (fieldInclExcl !== null) {
          cursor = collection.find.sync(collection, query, fieldInclExcl, opts);
        } else {
          cursor = collection.find.sync(collection, query, opts);
        }

        if (doCount) {
          results = cursor.count.sync(cursor);
        } else {
          results = cursor.toArray.sync(cursor);

          resultCount = Object.keys(results).length;

          if (resultCount > 1000) {
            console.log(_c.yellow + 'warning: query',
                        entity,
                        '->',
                        query,
                        'returned',
                        resultCount,
                        'results, may impact server performance negatively. try to optimize the query!',
                        _c.reset);
          }

          for (i in results) {
            if (results.hasOwnProperty(i)) {
              for (j in refIncl) {
                if (refIncl.hasOwnProperty(j)) {
                  result = results[i];
                  field = refIncl[j];
                  dbRef = result[field];
                  try {
                    resolved = _db.dereference.sync(_db, dbRef);
                    if (_def(resolved)) {
                      result[field] = resolved;
                    }
                  } catch (refErr) {
                    // stub, could not resolve reference
                  }
                }
              }
            }
          }
        }
      }
      _encodeDkObj(results);
      _print("query_results",results);
	  
      return res.status(200).json(results);
    } catch (e) {
      console.error(e);
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.index = function (req, res) {
  doSync(function indexSync() {
    var entity, key, unique, drop, opts, collection, cursor;
    entity = req.param('entity', null);
    key = req.param('key', null);
    unique = req.param('unique', false);
    drop = req.param('drop', false);

    if (!_exists(entity)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    if (!_exists(key)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    try {
      opts = {
        'safe': true,
        'unique': unique,
        'dropDups': drop
      };
      collection = _db.collection.sync(_db, entity);
      cursor = collection.ensureIndex.sync(collection, {key: 1}, opts);
      return res.status(200).send('');
    } catch (e) {
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.destroy = function (req, res) {
  doSync(function destroySync() {
    if (!_conf.allowDestroy) {
      return _e(res, _ERR.OPERATION_NOT_ALLOWED);
    }
    var entity, collection;
    entity = req.param('entity', null);
    if (!_exists(entity)) {
      return _e(res, _ERR.INVALID_PARAMS);
    }
    try {
      collection = _db.collection.sync(_db, entity);
      collection.drop.sync(collection);
      // _print("drop","dropped");
      return res.status(200).send('');
    } catch (e) {
      return _e(res, _ERR.OPERATION_FAILED, e);
    }
  });
};
exports.drop = function (req, res) {
  doSync(function dropSync() {
    if (_conf.allowDrop) {
      try {
        _db.dropDatabase.sync(_db);
        console.log("dropped database", _db.databaseName);
          return res.status(200).send('');
      } catch (e) {
        console.error(e);
        _e(res, _ERR.OPERATION_FAILED, e);
      }
    } else {
      _e(res, _ERR.OPERATION_NOT_ALLOWED);
    }
  });
};
exports.store = function (req, res) {
  doSync(function storeSync() {
    // Get filename and mode
    var fileName, store, bufs, onEnd, onClose, onCancel, isClosing, pendingWrites, tick, gs, exists;
    fileName = req.header('x-datakit-filename', null);

    // Generate filename if neccessary, else check for conflict
    if (fileName === null||!_def(fileName)) {
      fileName = uuid.v4();
    }
    console.log("storing file",fileName);

    store = null;
    bufs = [];
    onEnd = false;
    onClose = false;
    onCancel = false;
    isClosing = false;
    pendingWrites = 0;
    tick = function (data) {
      if (data && !(onClose || onCancel)) {
        bufs.push(data);
      }
      if (pendingWrites <= 0 && bufs.length === 0 && (onClose || onEnd || onCancel)) {
        if (!isClosing) {
          isClosing = true;
          store.close(function () {
            if (onClose) {
              console.log("connection closed, unlink file");
              // Remove the file if stream was closed prematurely
              mongo.GridStore.unlink(_db, fileName, function (err) {
                console.log("wtf");
                return res.status(400).send('');
              });
            } else if (onEnd) {
              res.writeHead(200, {
                'x-datakit-assigned-filename': fileName
              });
              res.end();
            }
            store = null;
          });
        }
      }
      if (store !== null && bufs.length > 0 && pendingWrites <= 0) {
        pendingWrites += 1;
        store.write(bufs.shift(), function (err, success) {
          if (err) {
            console.error('error: could not write chunk (', err, ')');
          }
          pendingWrites -= 1;
          tick();
        });
      }
    };

    // Register handlers
    req.on('end', function () {
      onEnd = true;
      tick(null);
    });
    req.on('close', function () {
      onClose = true;
      tick(null);
    });
    req.on('data', function (data) {
      tick(data);
    });

    // Check if file exists
    try {
      exists = mongo.GridStore.exist.sync(mongo.GridStore, _db, fileName);
      if (exists) {
        return _e(res, _ERR.DUPLICATE_KEY);
      }
    } catch (e) {
      console.error(e);
      return _e(res, _ERR.OPERATION_FAILED, e);
    }

    // Pipe to GridFS
    gs = new mongo.GridStore(_db, fileName, 'w+', {
      // Generally the chunk size doesn't matter much,
      // we just use a smaller chunk size to verify file
      // integrity when testing.
      'chunkSize': 1024 * 50
    });
    gs.open(function (err, s) {
      if (err) {
        console.log("ERROR:",err);
        bufs = [];
        onCancel = true;
        return _e(res, _ERR.OPERATION_FAILED, err);
      }
      store = s;
      tick();
    });
  });
};
exports.unlink = function (req, res) {
  doSync(function unlinkSync() {
    var files, i, gs, lastErr;
    files = req.param('files', []);
    gs = mongo.GridStore;
    lastErr = null;
    for (i = 0; i < files.length; i += 1) {
      try {
        gs.unlink.sync(gs, _db, files[i]);
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr !== null) {
      return _e(res, _ERR.OPERATION_FAILED, lastErr);
    }
    		console.log("unlinked ");

    return res.status(200).send('');
  });
};

exports.stream = function (req, res) {
  doSync(function streamSync() {
    _streamFileFromGridFS(req, res, req.header('x-datakit-filename', null));
  });
};

exports.exists = function (req, res) {
  doSync(function existsSync() {
    var fileName, gs, exists;
    fileName = req.param('fileName', null);
    if (fileName) {
      gs = mongo.GridStore;
      try {
        exists = gs.exist.sync(gs, _db, fileName);
        if (exists) {
          return res.status(200).send('');
        }
      } catch (e) {
        console.error(e);
        return _e(res, _ERR.OPERATION_FAILED, e);
      }
    }
    return _e(res, _ERR.DUPLICATE_KEY);
  });
};



