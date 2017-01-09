'use strict';

let log4js = require('log4js');
log4js.configure('./logger.json', { reloadSecs: 300 });
let logger = log4js.getLogger('sip_server');

let sipTest = require('sip');
let proxyTest = require('sip/proxy');
let digestTest = require('sip/digest');

let settings = {
    accounts: {
        6: {
            user: '6',
            password: '6'
        }
    },
    sip: {
        INVITE: (rq, flow) => {
            logger.trace('On Event INVITE');
            logger.trace(data);
        },
        ACK: (rq, flow) => {
            logger.trace('On Event ACK');
            logger.trace(data);
        },
        CANCEL: (rq, flow) => {
            logger.trace('On Event CANCEL');
            logger.trace(data);
        },
        BYE: (rq, flow) => {
            logger.trace('On Event BYE');
            logger.trace(data);
        },
        INFO: function(rq, flow) {
            logger.trace('On Event INFO');
            logger.trace(data);
        },
        MESSAGE: function(rq, flow) {
            logger.trace('On Event MESSAGE');
            logger.trace(data);
        },
        UPDATE: function(rq, flow) {
            logger.trace('On Event UPDATE');
            logger.trace(data);
        },
        REGISTER: function(rq, flow) {
            function isGuest(user) {
                return !!(user[0] == '_');
            }
            let user = sipTest.parseUri(rq.headers.to.uri).user;

            if (this._accounts[user]) {
                let data = this._accounts[user];

                if (!(isGuest(user) || (data && data.password))) { // we don't know this user and answer with a challenge to hide this fact 
                    let rs = digestTest.challenge({ realm: sipTest._realm }, sipTest.makeResponse(rq, 401, 'Authentication Required'));
                    proxyTest.send(rs);
                } else {
                    let rinstance = sipTest._getRinstance(rq.headers.contact && rq.headers.contact[0]);

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
                            let route_uri = sipTest.encodeFlowUri(flow);
                            route_uri.params.lr = null;
                            binding.route = [{ uri: route_uri }];
                            binding.user = { uri: rq.headers.to.uri };
                        }
                        sipTest._registry.set(sipTest._contactPrefix + user + rinstance,
                            expires || 1, //ttl  1ms == remove,
                            binding
                        );
                    };

                    function auth(err, session) {
                        session = session || { realm: sipTest._realm };
                        if (!isGuest(user) && !(digestTest.authenticateRequest(session, rq, { user: user, password: data.password }))) {
                            let rs = digestTest.challenge(session, sipTest.makeResponse(rq, 401, 'Authentication Required'));
                            sipTest._registry.set(sipTest._sessionPrefix + user + rinstance, sipTest._sessionTimeout, session);
                            proxyTest.send(rs);
                        } else {
                            //получаем текущий контакт и регистрируемся
                            sipTest._registry.get(sipTest._contactPrefix + user + rinstance, register);

                            let rs = sipTest.makeResponse(rq, 200, 'OK');
                            rs.headers.contact = rq.headers.contact;
                            rs.headers.to.tag = Math.floor(Math.random() * 1e6);
                            // Notice  _proxy.send_ not sipTest.send
                            proxyTest.send(rs);
                        }
                    };
                    //получаем текущую сессию пользователя и авторизуемся
                    sipTest._registry.get(sipTest._sessionPrefix + user + rinstance, auth);
                }
            };
            return true
        }
    }
};

let sipServerModule = require('../index.js');
let sipServer = new sipServerModule.SipServer(settings);

sipServer.on('INVITE', (data) => {
    logger.trace('Event Emitter INVITE ', data);
});
sipServer.on('ACK', (data) => {
    logger.trace('Event Emitter ON ACK ', data);
});
sipServer.on('CANCEL', (data) => {
    logger.trace('Event Emitter ON CANCEL ', data);
});
sipServer.on('BYE', (data) => {
    logger.trace('Event Emitter ON BYE ', data);
});
sipServer.on('INFO', (data) => {
    logger.trace('Event Emitter ON INFO ', data);
});
sipServer.on('MESSAGE', (data) => {
    logger.trace('Event Emitter ON MESSAGE ', data);
});
sipServer.on('UPDATE', (data) => {
    logger.trace('Event Emitter ON UPDATE ', data);
});
sipServer.on('REGISTER', (data) => {
    logger.trace('Event Emitter ON REGISTER ', data);
});

console.log('**********************************');

console.log('[get] accounts: ', sipServer.accounts);
sipServer.addAccount('7', {
    user: '7',
    password: '7'
});

console.log('[set] accounts: ', sipServer.accounts);
sipServer.removeAccount('7');
console.log('[remove] accounts: ', sipServer.accounts);


console.log('*************************');

console.log('[start] registry: ', sipServer.registry);

sipServer.registry.set('7', 60000, {
    name: '7',
    password: '7'
});

sipServer.registry.get('7', (err, data) => {
    console.log(data);
    sipServer.registry.remove('6');
});