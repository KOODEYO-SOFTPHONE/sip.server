'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');

let app; // объявляется объект app для вывода и отправки сообщений
let self; // объявляется объект self для логгирования по разным уровням

sip._maskContact = function(realUri, maskUri) {
    if (!realUri)
        return maskUri;
    let parts = realUri.split(';');
    let _uri = '';
    if (parts[1])
        _uri = realUri.replace(parts[0], '');
    realUri = maskUri + _uri;
    return realUri;
}

sip._detail = function(rq) {
    let from = sip.parseUri(rq.headers.from.uri).user; //+'@'+sip.parseUri(rq.headers.from.uri).host+':'+(sip.parseUri(rq.headers.from.uri).port*1 || 5060);
    let to = sip.parseUri(rq.headers.to.uri).user; //+'@'+sip.parseUri(rq.headers.to.uri).host+':'+(sip.parseUri(rq.headers.to.uri).port*1 || 5060);
    let res = {
        method: rq.method ? rq.method : rq.headers.cseq.method,
        type: rq.method ? 'request' : 'response',
        //from: rq.method ? from : to,
        //to: rq.method ? to : from,
        call_id: rq.headers['call-id'],
        time: Date.now()
    };
    if (rq.status && rq.reason) {
        res.status = rq.status;
        res.reason = rq.reason;
    }
    if (rq.method) {
        res.from = from;
        res.to = to;
    }
    if (rq.method === 'INFO')
        res.dtmf_info = rq.content.replace(/(\D+)/g, ' ').trim().replace(/ .+/, '');
    //'Signal=8\r\nDuration=250\r\n'
    return res;
};

module.exports = function(rq, flow, cb) {
    //основная обработка внутренних запросов
    //self = _self;
    //app = self.app;

    let user = sip.parseUri(rq.headers.to.uri).user;

    function work(err, contact) {
        rq._toContacts = contact;
        if (!contact)
            return cb(false);
        cb(true);
        contact = contact[0];
        if (contact.ob) {
            if (!rq.headers.to.params.tag) {
                let flow_uri = sip.encodeFlowUri(flow);
                flow_uri.params.lr = null;
                rq.headers.route = contact.route.concat(rq.headers.route || []);
                rq.headers['record-route'] = [{ uri: flow_uri }].concat(contact.route, rq.headers['record-route'] || []);
            } else
            if (rq.headers.route) {
                let furi = sip.encodeFlowUri(flow);
                if (rq.headers.route[0].hostname == furi.hostname && rq.headers.route[0].user == furi.user)
                    rq.headers.route.shift();
            }
        } else {
            if (rq.headers.route) {
                let furi = sip.encodeFlowUri(flow);
                if (rq.headers.route[0].hostname == furi.hostname)
                    rq.headers.route.shift();
            }
            //real contact
            rq.uri = contact.contact.uri;
        }

        //jssip incorrect uri hack
        if (flow.protocol && flow.protocol.toUpperCase() == 'WS' && (rq.method == 'ACK' || rq.method == 'BYE'))
            rq.uri = rq.headers.to.uri;

        //преобразование контактов запроса
        if (rq.headers.contact)
            rq.headers.contact[0].uri = sip._maskContact(rq.headers.contact[0].uri, rq.headers.from.uri);
        //self.app.emit('callEvent', sip._detail(rq));

        proxy.send(rq, function(rs) {
            //преобразование контактов ответа
            if (rs.headers.contact)
                rs.headers.contact[0].uri = sip._maskContact(rs.headers.contact[0].uri, rs.headers.from.uri);

            rs.headers.via.shift(); //defaultCallback

            //if (rs.status == 180 || rs.status >= 200)
                //self.app.emit('callEvent', sip._detail(rs));

            proxy.send(rs);
        });
    }

    if (rq._toContacts !== undefined)
        work(null, rq._toContacts);
    else
        sip._registry.get(sip._contactPrefix + user + '*', work);
};