var log4js = require('log4js');
log4js.configure('./logger.json', { reloadSecs: 300 });
var logger = log4js.getLogger('sip_server');

function SipServer() {
    logger.debug('SipServer start');
    var self = this;

    //_dbstorage(self);

    var sip = require('sip');
    var proxy = require('sip/proxy');
    var digest = require('sip/digest');

    // запуск регистрации и подключения шлюзов
    //require(__dirname + '/gateways.js')(self);
    var os = require('os');
    var util = require('./util');

    var _port = 5062; // порты по умолчанию для SIP сервера, если не придёт из модуля _config 
    var _ws_port;

    sip._registry = {}; // сюда будем писать абонентов из базы
    sip._contacts = new(require('./cache')); // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
    // содержит методы
    // .set('key',ttl/*ms*/,'value') //ttl - время жизни в mc
    // .get('key', calback)          //calback(err,result)
    // .remove('key')                

    var rules = []; //правила обработки sip сообщений

    eventsProcessing(); // подписка и обработка событий, запуск SIP сервера

    /**
     * обработка входящих sip сообщений
     * @method onRequest
     * @private
     *
     * @param {Object} rq - входящее сообщение, 
     * @param {Object} flow - объект содержщий протокол, адрес и порт узла с которого было получено сообщение 
     */
    function onRequest(rq, flow) {
        rules = rules || [];
        var i = 0;

        function work(stop) { // stop - (true/false) продолжить выполенние следующего правила или нет
            if (i && stop) {
                logger.debug('для ' + rq.method + ' от "' + rq.headers.from.uri + '" сработало правило "' + rules[i - 1]._name + '"');
            }
            if (stop)
                return;
            var rule;
            if (rule = rules[i++])
                rule(self, rq, flow, work); //запускаем правила асинхронно
        };
        try {
            work(false);
        } catch (e) {
            logger.error(e);
            logger.trace(e.stack);
            proxy.send(sip.makeResponse(rq, 500, "Server Internal Error"));
        }
    }

    /**
     * загрузка правил обработки сообщений
     * @method loadRules
     * @private
     */
    function loadRules() {
        rules = [];
        self._config = self._config || {};
        var rulesPath = self._config['rulesPath'] || __dirname + '/routes';
        var rulesName = require('./util').getFiles(rulesPath, false);
        logger.debug('rulesName.length: ', rulesName.length);
        if (!rulesName.length)
            return;
        rulesName.sort();
        rulesName.forEach(function(ruleName) {
            try {
                var rule = require(rulesPath + '/' + ruleName);
                if (rule instanceof Function) {
                    rule._name = ruleName.replace('.js', '');
                    rules.push(rule);
                    logger.debug('Rule "' + ruleName + '" is loaded');
                } else {
                    logger.error('Rule "' + ruleName + '" is invalid!');
                }
            } catch (e) {
                logger.error('Rule "' + ruleName + '" is invalid! ' + e);
            }
        });
    }

    /**
     * преобразует данные из базы и заполняет ими объект sip._registry
     * @method fillRegistry
     * @private
     *
     * @param {Array} result считанные из базы данные
     */
    function fillRegistry(result) {
        sip._registry = {}; // каждый раз при запросе информации об абонентах из базы очищаем объект, чтобы не было неактуальных данных

        // формируем объект sip._registry для проверки авторизации абонентов
        for (var i = 0, len = result.length; i < len; i++) {
            var srcObjfromBD = {}; // переменная для получения из массива result только того объекта, который был считан из базы
            srcObjfromBD = result[i].toObject(); // получаем из каждой (i-ой) строки нужный объект

            // logger.trace(' ============== result[i]: ==================');
            // logger.trace(srcObjfromBD); // Вывести значение каждого элемента массива

            // в начале каждой итерации для ключа логина создаём пустой объект-значение,
            // чтобы потом заполнить его данными об абоненте (пока только пароль и id этой записи в документе БД)
            sip._registry[srcObjfromBD.login] = {};

            for (var key in srcObjfromBD) { // проходим по всем свойствам объекта srcObjfromBD = result[i].toObject()
                // отфильтровывает свойства, принадлежащие не самому объекту, а его прототипу
                // по идее, если использована конструкция srcObjfromBD = result[i].toObject(), то чужих свойств
                // быть не должно, но пока на всякий случай оставил
                if (!srcObjfromBD.hasOwnProperty(key))
                    continue;

                // Вывести название и значение каждого свойства объекта
                // logger.trace(key+': ' + srcObjfromBD[key]);
                // logger.trace('==== key: =====');
                // logger.trace(key);

                // пропуск ключа login и заполнение в объекте sip._registry объекта-значение данными
                // о логине ({ключ1: значение1, ключ2: значение2, ...})
                if (key !== 'login') {
                    sip._registry[srcObjfromBD.login][key] = srcObjfromBD[key];
                }
            } // end for (var key in ...
        } // end for (var i = 0, len = ...

        // logger.trace(' ============== sip._registry: ==================');
        // logger.trace(sip._registry);

    } // end function fillRegistry(result)

    /**
     * выбор генерируемого события или запроса (содержит все генерируемые в модуле события и запросы)
     * @method emitEvents
     * @private
     *
     * @param {String} evnt - название, по которому выбирается генерируемоe событие
     */
    function emitEvents(evnt) {
        // if (param === undefined) param = ''; // если не указан параметр, устанавливаем значение по умолчанию

        switch (evnt) {
            case 'web.getContacts':
                app.request('web.getContacts', { requestTimeout: 5000 }, function(err, data1) {
                    logger.trace('err request web.getContacts: ==========================');
                    logger.trace(err);
                    if (!err) {
                        logger.trace(' SIP (web.getContacts): ');
                        logger.trace(data1);
                    }
                });
                break;

            case 'sip.getConfig':
                // выполняется запрос и получение конфигурации для sip_server
                /*
                app.request('sip.getConfig', {}, function(err, conf) {
                    if (!err) {
                        // logger.trace(' ===================== конфигурация: ');
                        // logger.trace(conf);
                        //
                        _port = conf.port;
                        _ws_port = conf.ws_port || null;

                        // logger.trace('SIP порт: ' + _port);

                    } else {
                        logger.error(' ==================== ошибка конфигурации: ');
                        logger.error(err);
                    }
                }); // app.request('sip.getConfig', ...
                */
                break;

            case 'sip.getAccounts':
                // запрос списка зарегистрированных абонентов
                /*
                app.request('sip.getAccounts', { requestTimeout: 5000 }, function(err, data) {
                    if (!err) {
                        // преобразуем данные из базы и заполняем ими объект sip._registry
                        fillRegistry(data);

                        // logger.trace('sip.getAccounts: \n sip._registry = ' + out.inspect(sip._registry, opts));
                        logger.trace('sip.getAccounts:');
                        logger.trace('sip._registry = ');
                        logger.trace(sip._registry);
                    } else {
                        // logger.error(' ==================== ошибка БД: ');
                        logger.error(err);
                    }
                }); // end app.request('sip.getAccounts' ...
                */
                break;

            case 'sip.serverStart':
                //app.emit('sip.serverStart');
                break;

        }

    } // end emitEvents(num)

    /**
     * обработка событий и запросов в том случае, если загрузились модули системы
     * @method eventsProcessing
     * @private
     */
    function eventsProcessing() {
        // app.on('sip.chgContacts', function (message)
        // {
        //     logger.trace(message + ': SIP');
        //     logger.trace(message);
        // });

        /*
        // подготовка и возврат контактных данных по запросу типа 'sip.getContacts'
        app.onRequest('sip.getContacts', function(param, cb) {
            // logger.trace('======================= .onRequest {sip._contacts}: ');
            // logger.trace(sip._contacts);


            sip._contacts.get(sip._contactPrefix + '*', work) //получаем все существующие контакты асинхронно

            function work(err, contacts) {
                contacts = contacts || [];

                var res = []; // подготавливаемый массив объектов из данных объекта sip._contacts

                // формирование массива объектов res из данных объекта sip._contacts
                //replace(new RegExp(sip._contactPrefix + ':([^:]+):?.*$'), '$1'
                contacts.forEach(function(contact, key) {
                    if (contact.expires)
                        res.push({
                            login:
                                (contact.user && contact.user.uri) ? sip.parseUri(contact.user.uri).user :
                                (contact.contact && contact.contact.uri) ? sip.parseUri(contact.contact.uri).user : key,
                            regDateTime: contact.regDateTime ? util.formatDate(new Date(contact.regDateTime)) : null,
                            expires: contact.expires !== undefined ? parseInt(contact.expires) : null,
                            expiresTime: contact.expiresTime ? util.formatDate(new Date(contact.expiresTime)) : null
                        });
                });

                // logger.trace('===================== res:');
                // logger.trace(res);
                // logger.trace('===================== param:');
                // logger.trace(param);
                cb(null, res);
            }
        }); // end app.onRequest('sip.getContacts'
        */

        emitEvents('sip.getConfig'); // запрос конфигурации
        emitEvents('sip.getAccounts'); // запрос списка зарегистрированных абонентов

        ProxyStart(); // запуск SIP сервера

    } // end eventsProcessing()

    /**
     * запуск SIP сервера
     * @method ProxyStart
     * @private
     */
    function ProxyStart() {

        //logger.trace(Array.isArray(sip._registry));

        //var sip._contacts = {}; // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
        sip._realm = require("ip").address();
        logger.info('starting server ...');
        logger.info('SIP порт: ' + _port);

        _ws_port ? logger.info('WebSocket started on port: ' + _ws_port) :
            logger.info('WebSocket doesn\'t connect');

        proxy.start({
            port: _port,
            ws_port: _ws_port,
            ws_path: '/sip',
            logger: {
                recv: function(msg, remote) {
                    logger.info('RECV from ' + remote.protocol + ' ' + remote.address + ':' + remote.port + '\n' + sip.stringify(msg), 'sip');

                    // посылаем сообщение, когда встретится метод 'CANCEL', т.к. этот метод не отдаётся обработчику событий-методов

                    // TODO: перенести сюда код функции makeMsgCancel из модуля processing, а лучше, наверное, вызвать метод sip._detail (из 700.js)
                    if (msg.method === 'CANCEL') {
                        // msg = makeMsgCancel(msg);
                        app.emit('callEvent', msg);
                    }
                },
                send: function(msg, target) {
                    logger.info('SEND to ' + target.protocol + ' ' + target.address + ':' + target.port + '\n' + sip.stringify(msg), 'sip');
                },
                error: function(e) {
                    logger.error(e.stack, 'sip');
                }
            }
        }, onRequest); // end proxy.start ...

        sip._port = _port;

        logger.info('Server started on ' + sip._realm + ':' + sip._port); // Simple proxy server with registrar function.

        loadRules(); // загрузка правил обработки SIP
        // app.on('callEvent',function(msg){logger.info(msg)});

        emitEvents('sip.serverStart'); // генерация сообщения типа 'sip.serverStart'

    } // end ProxyStart

} // end sip_server

module.exports = SipServer;

SipServer();