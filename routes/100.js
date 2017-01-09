'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');
let digest = require('sip/digest');
sip._accounts = sip._accounts || {}; //auth data 
sip._registry = sip._registry || {}; //current status

sip._contactPrefix = 'sip:contact:';
sip._sessionPrefix = 'sip:session:';
sip._sessionTimeout = 30000; //время жизни сессии авторизации (30 sec) 

let log4js = require('log4js');
log4js.configure('./logger.json', { reloadSecs: 300 });
let logger = log4js.getLogger('sip_server');

// rinstance - for multi contacts
//{"uri":"sip:122@172.17.2.82:60452;rinstance=fdbedfe4930e59d7"}
//{"uri":"sip:3@172.17.2.82:7169","params":{"+sip.instance":"\"<urn:uuid:399BFBC0-5F5E-A6E8-AAAC-64FBEF2792C8>\""}}
sip._getRinstance = function(contact) {
    if (!(contact && contact.uri))
        return '';
    let match = contact.uri.match(/rinstance=([^;]+);?/);
    if (!match && contact.params && contact.params['+sip.instance'])
        return ':' + contact.params['+sip.instance'].replace(/[^A-Za-z^0-9]/g, '');
    return match ? ':' + match[1] : ':' + (sip.parseUri(contact.uri) && (sip.parseUri(contact.uri).host + sip.parseUri(contact.uri).port)).replace(/\./g, '');
};

module.exports = function(rq, flow, cb) {
    if (rq.method !== 'REGISTER')
        return cb(false);
    cb(true);

    function isGuest(user) {
        return !!(user[0] == '_');
    }
    let user = sip.parseUri(rq.headers.to.uri).user;

    module.exports.getUsers({ name: user }, function(err, data) {
        if (!(isGuest(user) || (data && data.password))) { // we don't know this user and answer with a challenge to hide this fact 
            let rs = digest.challenge({ realm: sip._realm }, sip.makeResponse(rq, 401, 'Authentication Required'));
            proxy.send(rs);
        } else {
            let rinstance = sip._getRinstance(rq.headers.contact && rq.headers.contact[0]);

            function register(err, contact) {
                let now = new Date().getTime();
                let expires = parseInt(rq.headers.expires) * 1000 || 0;
                contact = rq.headers.contact && rq.headers.contact[0];
                contact.uri = 'sip:' + user + '@' + flow.address + ':' + flow.port; //real address

                let ob = !!(contact && contact.params['reg-id'] && contact.params['+sip.instance']);
                let binding = {
                    regDateTime: (contact && contact.regDateTime) ? contact.regDateTime : now,
                    expiresTime: now + expires,
                    expires: expires,
                    contact: contact,
                    ob: ob
                };
                if (ob) {
                    let route_uri = sip.encodeFlowUri(flow);
                    route_uri.params.lr = null;
                    binding.route = [{ uri: route_uri }];
                    binding.user = { uri: rq.headers.to.uri };
                }
                sip._registry.set(sip._contactPrefix + user + rinstance,
                    expires || 1, //ttl  1ms == remove,
                    binding
                );
            };

            function auth(err, session) {
                session = session || { realm: sip._realm };
                if (!isGuest(user) && !(digest.authenticateRequest(session, rq, { user: user, password: data.password }))) {
                    let rs = digest.challenge(session, sip.makeResponse(rq, 401, 'Authentication Required'));
                    sip._registry.set(sip._sessionPrefix + user + rinstance, sip._sessionTimeout, session);
                    proxy.send(rs);
                } else {
                    //получаем текущий контакт и регистрируемся
                    sip._registry.get(sip._contactPrefix + user + rinstance, register);

                    let rs = sip.makeResponse(rq, 200, 'OK');
                    rs.headers.contact = rq.headers.contact;
                    rs.headers.to.tag = Math.floor(Math.random() * 1e6);
                    // Notice  _proxy.send_ not sip.send
                    proxy.send(rs);
                }
            };
            //получаем текущую сессию пользователя и авторизуемся
            sip._registry.get(sip._sessionPrefix + user + rinstance, auth);
        }
    });
    return true
}