'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');

//Запрос от незарегистрированного пользователя
module.exports = function(self, rq, flow, cb) {
    let user = sip.parseUri(rq.headers.from.uri).user;

    function work(err, contact) {
        if (contact && contact.length)
            return cb(false);
        cb(true);
        proxy.send(sip.makeResponse(rq, 403, 'Caller Not Registered '));
    };

    sip._contacts.get(sip._contactPrefix + user + '*', work);
};