'use strict';

let sip = require('sip');
module.exports = function(rq, flow, cb) {
    cb(true);
    sip.send(sip.makeResponse(rq, 400, '400 Bad Request'));
};