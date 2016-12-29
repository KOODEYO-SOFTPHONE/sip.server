'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let log4js = require('log4js');
log4js.configure('./logger.json', { reloadSecs: 300 });
let logger = log4js.getLogger('sip_server');
let eventEmitter = require('events').EventEmitter;
let getUsers = function(param, cb) {
    cb('Error connect to database', {});
};
let fs = require('fs');

module.exports = {
    getUsers: getUsers
};

class SipServer extends eventEmitter {
    constructor(settings) {
        super();

        for (let key in settings['sip']) {
            //logger.trace('settings[sip][' + key + '] = ' + settings['sip'][key]);
            this[key] = settings['sip'][key];
        }

        let sip = require('sip');
        let proxy = require('sip/proxy');
        let digest = require('sip/digest');
        let os = require('os');
        let util = require('./util');

        let _port = 5062; // порты по умолчанию для SIP сервера, если не придёт из модуля _config 
        let _ws_port = 5062;

        sip._accounts = {}; // сюда будем писать абонентов из базы
        this._accounts = {};

        if (settings.accounts) {
            sip._accounts = settings.accounts; // accounts
            this._accounts = settings.accounts;
        }

        sip._registry = new(require('./cache')); // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
        // содержит методы
        // .set('key',ttl/*ms*/,'value') //ttl - время жизни в mc
        // .get('key', calback)          //calback(err,result)
        // .remove('key')                

        let rules = []; //правила обработки sip сообщений

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
            //rules = rules || [];
            let i = 0;

            function work(stop) { // stop - (true/false) продолжить выполенние следующего правила или нет
                if (i && stop) {
                    logger.debug('для ' + rq.method + ' от "' + rq.headers.from.uri + '" сработало правило "' + rules[i - 1]._name + '"');
                }
                if (stop)
                    return;
                let rule;
                if (rule = rules[i++])
                    rule(this, rq, flow, work); //запускаем правила асинхронно
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
            let config = {
                rulesPath: './routes'
            };

            let rulesPath = config['rulesPath'] || __dirname + '/routes';
            let rulesName = require('./util').getFiles(rulesPath, false);
            logger.debug('rulesName.length: ', rulesName.length);
            if (!rulesName.length)
                return;
            rulesName.sort();
            rulesName.forEach(function(ruleName) {
                try {
                    let rule = require(rulesPath + '/' + ruleName);
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
         * преобразует данные из базы и заполняет ими объект sip._accounts
         * @method fillRegistry
         * @private
         *
         * @param {Array} result считанные из базы данные
         */
        function fillRegistry(result) {
            sip._accounts = {}; // каждый раз при запросе информации об абонентах из базы очищаем объект, чтобы не было неактуальных данных

            // формируем объект sip._accounts для проверки авторизации абонентов
            for (let i = 0, len = result.length; i < len; i++) {
                let srcObjfromBD = {}; // переменная для получения из массива result только того объекта, который был считан из базы
                srcObjfromBD = result[i].toObject(); // получаем из каждой (i-ой) строки нужный объект

                // logger.trace(' ============== result[i]: ==================');
                // logger.trace(srcObjfromBD); // Вывести значение каждого элемента массива

                // в начале каждой итерации для ключа логина создаём пустой объект-значение,
                // чтобы потом заполнить его данными об абоненте (пока только пароль и id этой записи в документе БД)
                sip._accounts[srcObjfromBD.login] = {};

                for (let key in srcObjfromBD) { // проходим по всем свойствам объекта srcObjfromBD = result[i].toObject()
                    // отфильтровывает свойства, принадлежащие не самому объекту, а его прототипу
                    // по идее, если использована конструкция srcObjfromBD = result[i].toObject(), то чужих свойств
                    // быть не должно, но пока на всякий случай оставил
                    if (!srcObjfromBD.hasOwnProperty(key))
                        continue;

                    // Вывести название и значение каждого свойства объекта
                    // logger.trace(key+': ' + srcObjfromBD[key]);
                    // logger.trace('==== key: =====');
                    // logger.trace(key);

                    // пропуск ключа login и заполнение в объекте sip._accounts объекта-значение данными
                    // о логине ({ключ1: значение1, ключ2: значение2, ...})
                    if (key !== 'login') {
                        sip._accounts[srcObjfromBD.login][key] = srcObjfromBD[key];
                    }
                } // end for (let key in ...
            } // end for (let i = 0, len = ...

            // logger.trace(' ============== sip._accounts: ==================');
            // logger.trace(sip._accounts);

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
                    /*
                    app.request('web.getContacts', { requestTimeout: 5000 }, function(err, data1) {
                        logger.trace('err request web.getContacts: ==========================');
                        logger.trace(err);
                        if (!err) {
                            logger.trace(' SIP (web.getContacts): ');
                            logger.trace(data1);
                        }
                    });
                    break;
                    */
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
                            // преобразуем данные из базы и заполняем ими объект sip._accounts
                            fillRegistry(data);

                            // logger.trace('sip.getAccounts: \n sip._accounts = ' + out.inspect(sip._accounts, opts));
                            logger.trace('sip.getAccounts:');
                            logger.trace('sip._accounts = ');
                            logger.trace(sip._accounts);
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
            ProxyStart();

        }

        /**
         * запуск SIP сервера
         * @method ProxyStart
         * @private
         */
        function ProxyStart() {

            //logger.trace(Array.isArray(sip._accounts));

            //let sip._registry = {}; // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
            sip._realm = require('ip').address();
            logger.info('starting server ...');
            logger.info('SIP порт: ' + _port);

            _ws_port ? logger.info('WebSocket started on port: ' + _ws_port) :
                logger.info('WebSocket doesn\'t connect');

            let options = {
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
            };

            // Подключение сертификата
            let keyPath = __dirname + '/' + 'server_localhost.key';
            let crtPath = __dirname + '/' + 'server_localhost.crt';

            if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
                options['tls'] = {
                    key: fs.readFileSync(keyPath),
                    cert: fs.readFileSync(crtPath)
                };
            }

            proxy.start(options, onRequest); // end proxy.start ...

            sip._port = _port;

            logger.info('Server started on ' + sip._realm + ':' + sip._port); // Simple proxy server with registrar function.

            loadRules(); // загрузка правил обработки SIP
            // app.on('callEvent',function(msg){logger.info(msg)});

            emitEvents('sip.serverStart'); // генерация сообщения типа 'sip.serverStart'

        } // end ProxyStart
    }
}

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
            console.log('On Event INVITE');
            console.log(data);
        },
        ACK: (rq, flow) => {
            console.log('On Event ACK');
            console.log(data);
        },
        CANCEL: (rq, flow) => {
            console.log('On Event CANCEL');
            console.log(data);
        },
        BYE: (rq, flow) => {
            console.log('On Event BYE');
            console.log(data);
        },
        INFO: (rq, flow) => {
            console.log('On Event INFO');
            console.log(data);
        },
        MESSAGE: (rq, flow) => {
            console.log('On Event MESSAGE');
            console.log(data);
        },
        UPDATE: (rq, flow) => {
            console.log('On Event UPDATE');
            console.log(data);
        },
        REGISTER: (rq, flow) => {
            console.log('On Event REGISTER');

            console.log('rq');
            console.log(rq);

            console.log('flow');
            console.log(flow);

            function isGuest(user) {
                return !!(user[0] == '_');
            }
            let user = sipTest.parseUri(rq.headers.to.uri).user;

            if (module.exports.SipServer._accounts[user]) {
                let data = module.exports.SipServer._accounts[user];
                //module.exports.getUsers({ name: user }, function(err, data) {

                //logger.trace('err:' + err);
                logger.trace('data:' + JSON.stringify(data));
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

//let settings = {};

let sipServer = new SipServer(settings);
module.exports.SipServer = sipServer;

sipServer.on('INVITE', (data) => {
    console.log('Event Emitter INVITE ', data);
});
sipServer.on('ACK', (data) => {
    console.log('Event Emitter ON ACK ', data);
});
sipServer.on('CANCEL', (data) => {
    console.log('Event Emitter ON CANCEL ', data);
});
sipServer.on('BYE', (data) => {
    console.log('Event Emitter ON BYE ', data);
});
sipServer.on('INFO', (data) => {
    console.log('Event Emitter ON INFO ', data);
});
sipServer.on('MESSAGE', (data) => {
    console.log('Event Emitter ON MESSAGE ', data);
});
sipServer.on('UPDATE', (data) => {
    console.log('Event Emitter ON UPDATE ', data);
});
sipServer.on('REGISTER', (data) => {
    console.log('Event Emitter ON REGISTER ', data);
});

function waterlineStorage() {
    logger.debug('dbstorage runs...');

    let Waterline = require('waterline');
    let orm = new Waterline();
    let diskAdapter = require('sails-disk');
    let config = {
        adapters: {
            'default': diskAdapter,
            disk: diskAdapter
        },
        connections: {
            myLocalDisk: {
                adapter: 'disk'
            }
        },
        defaults: {
            migrate: 'alter'
        }
    };

    let Users = Waterline.Collection.extend({
        identity: 'users',
        connection: 'myLocalDisk',
        attributes: {
            name: 'string',
            password: 'string'
        }
    });

    orm.loadCollection(Users);

    let models;

    orm.initialize(config, function(err, mod) {
        if (err) throw err;
        models = mod;
    });

    module.exports.getUsers = function(param, cb) {
        logger.debug('dbstorage.Users requested: ' + JSON.stringify(param));

        if (models) {
            models.collections.users.findOne(param, function(err, data) {
                if (err) return cb(err, {});
                cb(null, data);
            });
        } else {
            cb('Error connect to database', {});
        }
    };

}

waterlineStorage();