var sip = require('sip');

sip._userAgent = 'Komunikator 2.0';
sip._allowMethods = ['INVITE', 'ACK', 'CANCEL', 'BYE', 'REGISTER', 'INFO', 'MESSAGE', 'UPDATE'];
module.exports = function (self, rq, flow, cb) {
    if (sip._allowMethods.indexOf(rq.method) != -1)
        return cb(false);
    cb(true);

    sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));

};
