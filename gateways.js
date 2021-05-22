'use strict';

//**************************************** gateways ****************************************
let digest, rq, sip, util, uuid;

sip = require('sip');
digest = require('sip/digest');
util = require('util');
uuid = require('uuid');

let app; // объявляется объект app для вывода и отправки сообщений
let self; // объявляется объект self для логгирования по разным уровням

//**************************************** Settings ****************************************
let gateways = {};
let currentTimers = [];
gateways.status = [];
gateways.parameter = {};

//**************************************** isCorrectGatewaySetting ****************************************
/**
 * Проверка на корректные данные настроек Шлюза
 * @method isCorrectGatewaySetting
 * @private
 *
 */
function isCorrectGatewaySetting(auth) {
    if (!auth) {
        self.debug('Gateway Not auth');
        return false;
    }

    if (!auth.user) {
        self.debug('Gateway auth.user');
        return (false);
    }

    if (!auth.password) {
        self.debug('Gateway Not password');
        return false;
    }

    if (!auth.host) {
        self.debug('Gateway Not host');
        return false;
    }

    if (!auth.domain && !auth.host) {
        self.debug('Gateway Not domain and host');
        return false;
    }

    return true;
};

//**************************************** sip._gateways.register ****************************************
/**
 * Регистрация одного шлюза
 * @method sip._gateways.register
 *
 * @param {Object} authorization - настройки шлюза
 * @param {Function} callback - функция
 *
 */
gateways.register = function(auth, cb, rq) {
    if (!isCorrectGatewaySetting(auth)) {
        return cb('Gateway isCorrectGatewaySetting false', false);
    }

    auth.port = auth.port || 5062;

    gateways.parameter.expires_default = gateways.parameter.expires_default || '60';
    gateways.parameter.user_agent = gateways.parameter.user_agent || "Kommunikator2";
    auth.expires = auth.expires || gateways.parameter.expires_default;

    let rq = rq || {
        method: 'REGISTER',
        uri: 'sip:' + auth.host + ':' + auth.port,
        headers: {
            to: {
                uri: 'sip:' + auth.user + '@' + (auth.domain || auth.host) + ':' + auth.port
            },
            from: {
                uri: 'sip:' + auth.user + '@' + (auth.domain || auth.host) + ':' + auth.port
            },
            cseq: {
                method: 'REGISTER',
                seq: 1
            },
            'user-agent': gateways.parameter.user_agent,
            expires: auth.expires,
            'call-id': uuid.v4(),
            contact: [{
                uri: 'sip:' + auth.user + '@' + auth.host + ':' + auth.port,
                params: {
                    expires: auth.expires
                }
            }]
        }
    };

    sip.send(rq, function(rs) {
        let context, e, _ref;
        let gateway = '"' + rq.headers.to.uri.replace(/^sip:/, '') + '"';

        try {
            if (rs.status === 401 || rs.status === 407) {
                self.trace('Gateway ' + gateway + ' Authorization start');
                rq.headers.via.pop();
                rq.headers.cseq.seq++;
                context = {};

                digest.signRequest(context, rq, rs, {
                    user: auth.user,
                    password: auth.password
                });

                sip.send(rq, function(rs) {
                    if (300 > (_ref = rs.status) && _ref >= 200) {
                        self.trace('Gateway ' + gateway + ' Authorization success');
                        cb(null, true, auth);
                    }

                    if (_ref >= 400) {
                        self.trace('Gateway ' + gateway + ' Authorization failed');
                        cb(rs, false, auth);
                    }
                });
            } else {
                if (300 > (_ref = rs.status) && _ref >= 200) {
                    cb(null, true, auth);
                }

                if (_ref >= 400) {
                    cb(rs, false, auth);
                }
            }
        } catch (_error) {
            e = _error;
            self.error('Gateway  ' + gateway + ' Error: ' + e);
            self.error('Gateway  ' + gateway + ' Error.stack: ' + e.stack);
            cb(rs, false, auth);
        }

    });
};

//**************************************** deletelAllTimers ****************************************
/**
 * Удаление всех таймеров
 * @method deletelAllTimers
 * @private
 *
 */

function deletelAllTimers() {
    if (Array.isArray(currentTimers) == false) {
        return self.trace('Gateways deletelAllTimers IsArray false');
    }

    if (!currentTimers.length) {
        return self.trace('Gateways deletelAllTimers Empty array');
    }

    self.trace('Gateways deletelAllTimers Count keys in timers on start = ' + currentTimers.length);

    while (currentTimers.length) {
        let deleteTimer = currentTimers.shift();
        clearInterval(deleteTimer);
    }

    self.trace('Gateways deletelAllTimers Count keys in timers after delete = ' + currentTimers.length);
};

//**************************************** startRegister ****************************************

/**
 * Регистрация всех шлюзов
 * @method startRegister
 * @private
 *
 * @param {Array} authorization - массив объектов, настройки шлюзов
 *
 */

function startRegister(auth) {
    auth = auth || {};
    auth.settings = auth.settings || [];

    if (Array.isArray(auth.settings) == false) {
        return self.trace('Gateways startRegister IsArray false');
    }

    deletelAllTimers();

    function cb(err, result, auth) {
        auth.port = auth.port || 5062;
        let gateway = '"' + auth.user + '@' + (auth.domain || auth.host) + auth.port + '"';

        if (err && err.status && err.reason) {
            self.trace('Gateway ' + gateway + ' startRegister  Err status: ' + util.inspect(err.status, { showHidden: true, depth: null }));
            self.trace('Gateway ' + gateway + ' startRegister  Err reason: ' + util.inspect(err.reason, { showHidden: true, depth: null }));
        }

        let isCorrectData = ((auth && auth.host) && (typeof result == 'boolean'));

        if (isCorrectData) {
            let _before = JSON.stringify(sip._gateways.status);

            //auth содержит ссылку на нужный шлюз в массиве gateways.status, поэтому вносим изменения прямо в него
            auth.status = result;
            self.debug('Gateway ' + gateway + ' Registration ' + (result ? 'success' : 'failed'));
            let _after = JSON.stringify(sip._gateways.status);

            if (_before !== _after) {
                //app.emit('sip.chgGatewaysStatus');
            }
        } else {
            if (!auth) {
                self.trace('Gateway ' + gateway + ' startRegister Not value auth');
            } else {
                if (!auth.host) {
                    self.trace('Gateway ' + gateway + ' startRegister Not value auth.host');
                }
            }

            if (typeof result != 'boolean') {
                self.trace('Gateway ' + gateway + ' startRegister Result Not boolean');
            }
        }
    };

    function _startRegister(authSetting) {
        if (!isCorrectGatewaySetting(authSetting)) {
            return false;
        }

        authSetting.port = authSetting.port || 5062;

        let gateway = '"' + authSetting.user + '@' + (authSetting.domain || authSetting.host) + ':' + authSetting.port + '"';

        if ((authSetting.active != true) && (authSetting.active != "true")) {
            return self.trace('Gateways ' + gateway + ' Registration disable');
        }

        self.trace('Gateways ' + gateway + ' Registration start');

        gateways.parameter.time_request = gateways.parameter.time_request || 12;
        let time = (authSetting.expires - gateways.parameter.time_request) * 1000; // Время для таймера в миллисекундах

        if (time < 1000) {
            time = 1000;
        }

        function _register(_auth) {
            return function() {
                gateways.register(_auth, cb);
            }
        };

        let timer = setInterval(_register(authSetting), time);

        currentTimers.push(timer);

        _register(authSetting)();
    };

    auth.settings.forEach(_startRegister);
};

//Присваивание объекта gateways к объекту sip
sip._gateways = gateways;


//Экспорт функции основному модулю sip.server
module.exports = function(newSelf) {
    self = newSelf;
    app = self.app;

    //Подписываемся на сообщение sip.chgGatewaysSettings которое вызывается в случае изменения настроек шлюзов.
    /*
    app.on('sip.chgGatewaysSettings', function () {

        //Запрос конфигурации для модуля gateways.
        app.request('gateways.getConfig', {}, function (err, data) {
            if (err) {
                self.error('Gateways ' + err);
                return self.warn('Gateways cannot get config');
            }

            data = data || {};

            //После загрузки настроек шлюзов копируем массив settings в gateways.status
            gateways.status    = data.settings || [];
            gateways.parameter = {};

            //settings будут в gateways.status
            delete gateways.parameter.settings;

            //Запуск регистрации всех шлюзов.
            startRegister(data);
        });
    });
    */
    /*
    //Подписываемся на сообщение об изменении статусов шлюзов
    app.on('sip.chgGatewaysStatus', function() {
        self.debug('event "sip.chgGatewaysStatus"');
        self.trace('sip._gateways.status:');
        self.trace(sip._gateways.status);
    });

    // подготовка и возврат контактных данных по запросу типа 'sip.getGateways'
    app.onRequest('sip.getGateways', function(param, cb) {
        let data = sip._gateways.status;
        cb(null, data);
    });
    */
    //Подписываемся на сообщение о запуске sip_server
    /*
    app.once('sip.serverStart', function() {
        app.emit('sip.chgGatewaysSettings');
    });
    */
};