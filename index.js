'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let log4js = require('log4js');
log4js.configure(__dirname + '/logger.json', { reloadSecs: 300 });
let logger = log4js.getLogger('sip_server');
let eventEmitter = require('events').EventEmitter;
let getUsers = function(param, cb) {
    cb('Error connect to database', {});
};
let fs = require('fs');

module.exports = {
    getUsers: getUsers
};

module.exports.SipServer = class SipServer extends eventEmitter {
    constructor(settings) {
        super();

        let self = this;
        if (settings) {
            for (let key in settings['sip']) {
                this[key] = settings['sip'][key];
            }
        }

        let sip = require('sip');
        let proxy = require('sip/proxy');
        let digest = require('sip/digest');
        let os = require('os');
        let util = require('./util');

        let _port = 5062; // порты по умолчанию для SIP сервера, если не придёт из модуля _config 
        let _ws_port = 8506;

        this._accounts = sip._accounts = {}; // сюда будем писать абонентов из базы

        if (settings && settings.accounts) {
            this._accounts = sip._accounts = settings.accounts; // accounts
        }

        sip._registry = new(require('./cache')); // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
        this._registry = sip._registry;
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
                    rule.call(self, rq, flow, work); //запускаем правила асинхронно
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
                rulesPath: __dirname + '/routes'
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

        }

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
        }
    }

    get accounts() {
        return this._accounts;
    }

    addAccount(name, account) {
        if (name && account) {
            this._accounts[name] = account;
        }
    }

    removeAccount(account) {
        if (this._accounts[account]) {
            delete this._accounts[account];
        }
    }

    get registry() {
        return this._registry;
    }
}

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