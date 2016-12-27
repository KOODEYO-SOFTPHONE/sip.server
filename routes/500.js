'use strict';

var sip = require('sip');
var proxy = require('sip/proxy');

module.exports = function(self, rq, flow, cb) {
    if (rq.headers.to.params.tag)
    //if (rq.method !== 'INVITE')
        return cb(false);

    var user = sip.parseUri(rq.headers.to.uri).user;

    function work(err, contact) {
        rq._toContacts = contact;
        if (contact && contact.length)
            return cb(false);
        cb(true);
        proxy.send(sip.makeResponse(rq, 404, 'User not Found'))
    };
    if (rq._toContacts !== undefined)
        work(null, rq._toContacts);
    else
        sip._contacts.get(sip._contactPrefix + user + '*', work);
}