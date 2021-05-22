'use strict';

let sip = require('sip');

sip._userAgent = 'Softphone 1.0';
sip._allowMethods = ['INVITE', 'ACK', 'CANCEL', 'BYE', 'REGISTER', 'INFO', 'MESSAGE', 'UPDATE', 'OPTIONS'];
module.exports = function(rq, flow, cb) {
    // Генерация sip сообщений
    this.emit(rq, flow);

    // Если есть кастомный обработчик на метод, вызываем его
    if (this[rq.method]) {
        cb(true);
        return this[rq.method].call(this, rq, flow);
    }

    if (sip._allowMethods.indexOf(rq.method) != -1) {
        return cb(false);
    }
    cb(true);

    sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));

};
