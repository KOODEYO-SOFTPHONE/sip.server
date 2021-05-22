let logger = require('./logger');
let eventEmitter = require('events').EventEmitter;
let fs = require('fs');

let getUsers = function(param, cb) {
    cb('Error connect to database', {});
};

function getCertificate(keyPath, crtPath) {
    let key = '';
    let cert = '';

    if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
        key = fs.readFileSync(keyPath); 
        cert = fs.readFileSync(crtPath);
    } else {
        logger.sipServer('Not found SSL Certificate ' + keyPath + ' ' + crtPath);
    }

    return { 
        key: key,
        cert: cert
    };
}

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

        let sip = this.sip = require('sip');
        let proxy = require('sip/proxy');
        let digest = require('sip/digest');
        let os = require('os');
        let util = require('./util');

        this._accounts = sip._accounts = {}; // сюда будем писать абонентов из базы

        if (settings && settings.accounts) {
            this._accounts = sip._accounts = settings.accounts; // accounts
        }
        if (settings && settings.client_id) {
            this._client_id = sip._client_id = settings.client_id; // client_id
        }
        if (settings && settings.client_secret) {
            this._client_secret = sip._client_secret = settings.client_secret; // client_secret
        }

        sip._registry = new(require('./cache')); // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных

        sip._registry.onChange = (list) => {
            list = list || [];
            this.emit('updateRegistryList', list);
        }

        this._registry = sip._registry;

        // содержит методы
        // .set('key',ttl/*ms*/,'value') //ttl - время жизни в mc
        // .get('key', calback)          //calback(err,result)
        // .remove('key')

        let rules = []; //правила обработки sip сообщений

        // eventsProcessing(); // подписка и обработка событий, запуск SIP сервера

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
                    logger.sipServer('для ' + rq.method + ' от "' + rq.headers.from.uri + '" сработало правило "' + rules[i - 1]._name + '"');
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
                logger.sipServer(e);
                logger.trace(e.stack);
                proxy.send(sip.makeResponse(rq, 500, "Server Internal Error"));
            }
        }

        this.ProxyStart = ProxyStart;

        /**
         * запуск SIP сервера
         * @method ProxyStart
         * @private
         */
        function ProxyStart(settings) {
            //logger.trace(Array.isArray(sip._accounts));

             // Порты по умолчанию для SIP сервера
            let udpPort = (settings && settings.sipServerPort)             ? settings.sipServerPort : 5060;

            let tcpPort = (settings && settings.tcp && settings.tcp.port)  ? settings.tcp.port      : 5061;

            let tlsPort = (settings && settings.tls && settings.tls.port)  ? settings.tls.port      : 5062;
            let tlsKey  = (settings && settings.tls && settings.tls.key)   ? settings.tls.key       : '';
            let tlsCert = (settings && settings.tls && settings.tls.cert)  ? settings.tls.cert      : '';
            if ( (tlsKey && (typeof tlsKey) == 'string') && (tlsCert && (typeof tlsCert) == 'string') ) {
                let tls = getCertificate(tlsKey, tlsCert);
                tlsKey = tls['key'];
                tlsCert = tls['cert'];
            }

            let wsPort  = (settings && settings.ws && settings.ws.port)    ? settings.ws.port       : 8506;
            let wssPort = (settings && settings.wss && settings.wss.port)   ? settings.wss.port    : 8507;
            let wssKey  = (settings && settings.wss && settings.wss.key)    ? settings.wss.key        : '';
            let wssCert = (settings && settings.wss && settings.wss.cert)   ? settings.wss.cert       : '';
            
            if ((wssKey && (typeof wssKey) == 'string') && (wssCert && (typeof wssCert) == 'string') ) {
                let wss = getCertificate(wssKey, wssCert);
                wssKey = wss['key'];
                wssCert = wss['cert'];
            }

            sip._realm = require('ip').address();
            logger.sipServer('starting server ...');
            logger.sipServer('UDP port: ' + udpPort);
            logger.sipServer('TCP port: ' + tcpPort);
            logger.sipServer('TLS port: ' + tlsPort);
            logger.sipServer('WS  port: '  + wsPort);
            logger.sipServer('WSS port: '  + wssPort);
            
            let options = {
                udp: {
                    port: udpPort
                },
                tcp: {
                    port: tcpPort
                },
                tls: {
                    port: tlsPort,
                    key: tlsKey,
                    cert: tlsCert
                },
                ws: {
                    port: wsPort
                },
                wss: {
                    port: wssPort,
                    key: wssKey,
                    cert: wssCert
                },
                ws_path: '/sip',
                logger: {
                    recv: function(msg, remote) {
                        if(process.env.NODE_ENV !== 'production') {
                            logger.sipServer('RECV from ' + remote.protocol + ' ' + remote.address + ':' + remote.port + '\n' + sip.stringify(msg), 'sip');
                        }
                        // посылаем сообщение, когда встретится метод 'CANCEL', т.к. этот метод не отдаётся обработчику событий-методов

                        // TODO: перенести сюда код функции makeMsgCancel из модуля processing, а лучше, наверное, вызвать метод sip._detail (из 700.js)
                        // if (msg.method === 'CANCEL' && app) {
                        //    msg = makeMsgCancel(msg);
                        //    app.emit('callEvent', msg);
                        //}
                    },
                    send: function(msg, target) {
                        if(process.env.NODE_ENV !== 'production') {
                            logger.sipServer('SEND to ' + target.protocol + ' ' + target.address + ':' + target.port + '\n' + sip.stringify(msg), 'sip');
                        }
                    },
                    error: function(e) {
                        if(process.env.NODE_ENV !== 'production') {
                            logger.sipServer(e.stack, 'sip');
                        }
                    }
                }
            };

            proxy.start(options, onRequest); // end proxy.start ...

            sip._port = udpPort;

            logger.sipServer('Server started on ' + sip._realm + ':' + sip._port); // Simple proxy server with registrar function.

            loadRules(); // загрузка правил обработки SIP
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
            logger.sipServer('rulesName.length: ', rulesName.length);
            if (!rulesName.length)
                return;
            rulesName.sort();
            rulesName.forEach(function(ruleName) {
                try {
                    let rule = require(rulesPath + '/' + ruleName);
                    if (rule instanceof Function) {
                        rule._name = ruleName.replace('.js', '');
                        rules.push(rule);
                        logger.sipServer('Rule "' + ruleName + '" is loaded');
                    } else {
                        logger.sipServer('Rule "' + ruleName + '" is invalid!');
                    }
                } catch (e) {
                    logger.sipServer('Rule "' + ruleName + '" is invalid! ' + e);
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
            // ProxyStart();

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

    stop() {
        this.sip.stop();
    }

    get registry() {
        return this._registry;
    }
}

function waterlineStorage() {
    logger.sipServer('dbstorage runs...');

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
        logger.sipServer('dbstorage.Users requested: ' + JSON.stringify(param));

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
