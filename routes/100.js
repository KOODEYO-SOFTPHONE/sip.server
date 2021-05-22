'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');
let digest = require('sip/digest');
var request = require("request");
let logger = require('../logger');
sip._accounts = sip._accounts || {}; //auth data
sip._registry = sip._registry || {}; //current status

sip._contactPrefix = 'sip:contact:';
sip._sessionPrefix = 'sip:session:';
sip._sessionTimeout = 30000; //время жизни сессии авторизации (30 sec)

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

    if (rq.headers.authorization && rq.headers.authorization[0] && rq.headers.authorization[0].scheme == "Bearer" && rq.headers.authorization[0].access_token && sip._client_id && sip._client_secret){
        request({
            headers: { 'Authorization': "Basic " + Buffer.from(sip._client_id + ':' + sip._client_secret).toString("base64") },
            url: "https://net.trusted.ru/idp/sso/oauth/check_token?token="+rq.headers.authorization[0].access_token,
            jar: true
        }, function (error, response, body) {
            if (error) {
                registerUser();
            } else {
                try{
                    var parsed_body = JSON.parse(body);
                    if (parsed_body.client_id) {
                        parsed_body.name = user;
                        registerUser(parsed_body)
                    } else {
                        registerUser();
                    }
                } catch (err) {
                    registerUser();
                }
            }
        });
    } else if (sip._accounts[user]) {
        registerUser(sip._accounts[user]);
    } else {
        module.parent.exports.getUsers({ name: user }, function(err, data) {
            registerUser(data);
        });
    } 

    function registerUser(data) {
        if (!(isGuest(user) || (data && (data.password || data.client_id)))) { // we don't know this user and answer with a challenge to hide this fact
            let rs = digest.challenge({ realm: sip._realm }, sip.makeResponse(rq, 401, 'Unauthorized'));
            proxy.send(rs);
        } else {
            let rinstance = sip._getRinstance(rq.headers.contact && rq.headers.contact[0]);

            function register(err, contact) {
                let now = new Date().getTime();
                let expires = ('expires' in rq.headers ? parseInt(rq.headers.expires) * 1000 : (parseInt(rq.headers.contact[0].params.expires) * 1000) ) || 0;
                contact = rq.headers.contact && rq.headers.contact[0];
                // contact.uri = 'sip:' + user + '@' + flow.address + ':' + flow.port; //real address
                contact.uri = sip.encodeFlowUri(flow); //real address
                contact.connection = 'sip:' + user + '@' + flow.address + ':' + flow.port + ';transport=' + flow.protocol.toLowerCase();

                //let ob = !!(contact && contact.params['reg-id'] && contact.params['+sip.instance']);
                let ob = false;

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
                if (!isGuest(user) && !(digest.authenticateRequest(session, rq, { user: user, password: data.password })) && !(data.client_id)) {
                    //let rs = digest.challenge(session, sip.makeResponse(rq, 407, 'Proxy Authentication Required'));
                    let rs = digest.challenge(session, sip.makeResponse(rq, 401, 'Unauthorized'));                                                  //if sip-server mode
                    if (rq.headers['user-agent'].match(/yate/i))
                        delete rs.headers[rs.status === 407 ? 'proxy-authenticate' : 'www-authenticate'][0].qop;
                    
                    sip._registry.set(sip._sessionPrefix + user + rinstance, sip._sessionTimeout, session);

                    try {
                        if (proxy.readyState === proxy.OPEN) {
                            proxy.send(rs);
                        }
                    } catch (e) {
                        logger.error(e);
                    }
                } else {
                    //получаем текущий контакт и регистрируемся
                    sip._registry.get(sip._contactPrefix + user + rinstance, register);

                    let rs = sip.makeResponse(rq, 200, 'OK');
                    rs.headers.contact = rq.headers.contact;
                    rs.headers.to.tag = Math.floor(Math.random() * 1e6);
                    // Notice  _proxy.send_ not sip.send

                    // console.log('Module 100.js rs: ', rs);
                    try {
                        proxy.send(rs);
                    } catch (err) {
                        console.error('Module 100.js Error: ', err);
                    }
                }
            };
            //получаем текущую сессию пользователя и авторизуемся
            sip._registry.get(sip._sessionPrefix + user + rinstance, auth);
        }
    }

    return true
}
