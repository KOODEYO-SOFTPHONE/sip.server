'use strict';

let sip = require('sip');
let proxy = require('sip/proxy');

sip._dialogs = {};
sip._dialogID = function(rq) {
    return rq.headers['call-id'];
    //return [rq.headers['call-id'], rq.headers.to.params.tag, rq.headers.from.params.tag].join(':');
    //??? on BYE 'to' and 'from' tags change places
};

// маршрутизация через шлюзы (используется sip._dialogs)
module.exports = function(self, rq, flow, cb) {

    // check if it's an in dialog request
    if (!rq.headers.to.params.tag)
        return cb(false);

    let id = sip._dialogID(rq);
    if (!sip._dialogs[id])
        return cb(false);

    let contact = sip._dialogs[id].contacts && sip._dialogs[id].contacts[rq.headers.to.uri];
    if (!contact)
        return cb(false);
    cb(true);

    rq.uri = contact; //real contact

    //for correct routing requests
    if (rq.headers.route)
        rq.headers.route.shift();

    function work(err, fromContact) {
        proxy.send(rq, function(rs) {

            rs.headers.via.shift(); //defaultCallback

            proxy.send(rs);

            if (sip._dialogs[id].contacts[rs.headers.to.uri])
                rs.headers.to.uri = sip._dialogs[id].contacts[rs.headers.to.uri];

            if (rs.status == 180 || rs.status >= 200)
                self.app.emit('callEvent', sip._detail(rs));

            if (rs.status == 200 && rs.headers.cseq.method == 'BYE')
                delete sip._dialogs[id];
        });

        //only for remote user        
        if (!fromContact && sip._dialogs[id].contacts[rq.headers.to.uri])
            rq.headers.to.uri = sip._dialogs[id].contacts[rq.headers.to.uri];

        self.app.emit('callEvent', sip._detail(rq));
    }

    let user = sip.parseUri(rq.headers.from.uri).user;
    sip._contacts.get(sip._contactPrefix + user + '*', work);
};