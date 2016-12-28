'use strict';

let sip = require('sip');

sip._userAgent = 'Komunikator 2.0';
sip._allowMethods = ['INVITE', 'ACK', 'CANCEL', 'BYE', 'REGISTER', 'INFO', 'MESSAGE', 'UPDATE'];
module.exports = function(self, rq, flow, cb) {
    // Генерация sip сообщений
    module.parent.exports.SipServer.emit(rq, flow);

    // Если есть кастомный обработчик на метод, вызываем его
    if (module.parent.exports.SipServer[rq.method]) {
        cb(true);
        return module.parent.exports.SipServer[rq.method](rq, flow);
    }

    if (sip._allowMethods.indexOf(rq.method) != -1) {
        return cb(false);
    }
    cb(true);

    sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));

};