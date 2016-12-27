'use strict';

var sip = require('sip');
module.exports = function(self, rq, flow, cb) {
    cb(true);
    sip.send(sip.makeResponse(rq, 400, '400 Bad Request'));
};