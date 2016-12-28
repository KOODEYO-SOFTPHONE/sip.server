'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');

// правила набора номера
sip._did = [
    { gatewayID: 1, regexp: '^0(\\d+)$' },
    { gatewayID: 1, regexp: '^(7\\d{10})$' },
    { gatewayID: 3, regexp: '^(\\w{3,})$' }
];

// звонок через шлюз
module.exports = function(self, rq, flow, cb) {

    let user = sip.parseUri(rq.uri).user;
    let host = sip.parseUri(rq.uri).host;
    let port = sip.parseUri(rq.uri).port;
    if (rq._toContacts !== undefined)
        work(null, rq._toContacts);
    else
        sip._contacts.get(sip._contactPrefix + user + '*', work);

    function work(err, contact) {
        rq._toContacts = contact;
        if (contact && contact.length)
            return cb(false);

        let gatewayID;

        if (sip._did && sip._did.length)
            sip._did.some(function(did) {
                let regex = new RegExp(did.regexp);
                if (regex.test(user)) {
                    user = user.replace(regex, '$1');

                    rq.headers.to.uri = 'sip:' + user + '@' + host + (port * 1 ? ':' + port * 1 : '');

                    gatewayID = did.gatewayID;
                    return true;
                }
            });
        let _gateways;

        if (!(
                gatewayID !== undefined &&
                sip._gateways &&
                sip._gateways.status &&
                (_gateways = sip._gateways.status[gatewayID])
            ))
            return cb(false);
        cb(true);

        let to_uri = rq.headers.to.uri;
        let from_uri = rq.headers.from.uri;

        if (rq.method === 'INVITE')
            self.debug('call uses gateway "' + _gateways.user + '@' + (_gateways.domain || _gateways.host) + '"');

        self.app.emit('callEvent', sip._detail(rq));

        rq.uri = 'sip:' + user + '@' + (_gateways.domain || _gateways.host);
        rq.headers.to.uri = rq.uri;
        rq.headers.from.uri = 'sip:' + _gateways.user + '@' + (_gateways.domain || _gateways.host);
        rq.headers['user-agent'] = (sip._gateways && sip._gateways.user_agent) || rq.headers['user-agent'];

        if (rq.headers.contact) {
            let contact_from = rq.headers.contact[0].uri.split(';');
            contact_from = contact_from[0];
            rq.headers.contact[0].uri = 'sip:' + _gateways.user + '@' + host + ':' + port;
        }
        //rq.headers.via.shift();
        proxy.send(rq, function(rs) {

            if (rs.headers.via[0].params &&
                rs.headers.via[0].params.received &&
                rs.headers.via[0].host !== rs.headers.via[0].params.received &&
                host !== rs.headers.via[0].params.received) {
                host = rs.headers.via[0].params.received;
                if (rs.headers.via[0].params.rport)
                    port = rs.headers.via[0].params.rport;
                self.debug('public ip:port ' + host + ':' + port);
                //console.log(rs.headers.via[0]);        
            }

            rs.headers.via.shift();

            function sendRes(rs) {

                //console.log(rs);
                if (rs.headers.contact) {
                    if (rs.status == 200 &&
                        rs.headers.cseq.method == 'INVITE') {

                        let contacts = {};
                        contacts[rq.headers.from.uri] = contact_from;
                        contacts[to_uri] = rs.headers.contact[0].uri;
                        sip._dialogs[sip._dialogID(rs)] = { contacts: contacts };

                        //for correct routing requests
                        if (rs.headers['record-route']) {
                            (rs.headers['record-route']).push({
                                uri: {
                                    schema: 'sip',
                                    host: sip._realm,
                                    port: sip._port,
                                    params: { lr: null },
                                    headers: {}
                                }
                            });

                        }
                    }
                    // for local contact
                    rs.headers.contact[0].uri = 'sip:' + sip.parseUri(rs.headers.contact[0].uri).user + '@' + sip._realm + ':' + sip._port;
                }
                rs.headers.from.uri = from_uri;
                rs.headers.to.uri = to_uri;

                proxy.send(rs);

                if (rs.status == 180 || rs.status >= 200)
                    self.app.emit('callEvent', sip._detail(rs));
            }

            if (rs.status === 401 || rs.status === 407) {
                require('sip/digest').signRequest({}, rq, rs, _gateways);
                rq.headers.via.shift();
                if (rq.headers.contact) {
                    //in case if detect public ip:port
                    rq.headers.contact[0].uri = 'sip:' + sip.parseUri(rq.headers.contact[0].uri).user + '@' + host + ':' + port;
                };
                proxy.send(rq, function(_rs) {
                    _rs.headers.via.shift();
                    sendRes(_rs);
                });
            } else
                sendRes(rs);
        });
    }
};