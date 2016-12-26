/**
 * @module modules
 */


// описание событий == begin ==

/**
 * Запрос текущих контактных данных contacts
 * @method app.request<sip.getContacts>
 *
 * @param {String} 'sip.getContacts' - тип данных запроса
 * @param {} param - передаваемые параметры (по умолчанию передаётся пустой объект)
 * @param {Function} resultFn(err,res) - параметр запроса, содержащий передаваемые данные
 *
 * @return {Function} <b> resultFn(err,res) </b> - возращаемая функция, где <br />
 * <b> err </b> - возвращаемая ошибка или <i> null </i>, если ошибок нет, <br />
 * <b> res </b> - возвращаемый массив объектов, где <br />
 *
 * <b><u> каждый объект имеет такой формат: <br /> </u></b>
 * <b> {login: <i><значение></i>, regDateTime: <i><значение></i>, expires: <i><значение></i>, expiresTime: <i><значение></i>} </b>, где <br />
 * <b> login </b> {String} - <i> номер абонента </i> <br />
 * <b> regDateTime </b> {Number} - <i> время регистрации абонента на SIP сервере </i> <br />
 * <b> expires </b> {Number} - <i> время, через которое абонент должен подтвердить свою регистрацию </i>
 * <b> expiresTime </b> {Number} - <i> время, в которое абонент должен подтвердить свою регистрацию </i>
 *
 * @example
 *     app.request('sip.getContacts',{}, function (err, res)
 *     {
 *          if (err)
 *          {
 *              logger.debug(err);
 *              return false;
 *          }
 *          logger.debug(res);
 *     });
 */

/**
 * Событие типа sip.chgContacts генерируется если было изменение контактных данных contacts
 * @event sip.chgContacts
 */

/**
 * Событие типа sip.message генерируется для отладки
 * @event sip.message
 * @param {} <param> - параметр события, содержащий передаваемые данные
 */

// описание событий == end ==


/**
 * Создает экземпляр SipServer
 * @class SipServer
 * @constructor
 * @param {Object} app Объект events.EventEmitter
 */
function sip_server(app) {
    this.app = app;

    // Simple proxy server with registrar function.

    // require('look').start(3000, '127.0.0.1');

    // переменные для логгирования
    var cfgPath = '../../config';
    var log4js = require('log4js');
    log4js.configure(cfgPath + '/logger.json', { reloadSecs: 300 });
    var logger = log4js.getLogger('console');
    var sip_logger = log4js.getLogger('sip');


    var sip = require('sip');
    var proxy = require('sip/proxy');
    var digest = require('sip/digest');
    // var util = require('sys');
    var os = require('os');
    var util = require('../../lib/util');

    // объявление переменных для считывания ini файла
    var fs = require('fs');
    var ini = require('ini');

    // получаем путь к базе (параметр URL)
    var dbURL = ini.parse(fs.readFileSync(cfgPath + '/db.ini', 'utf-8')).URL;

    // подключение к БД MongoDB
    //var Schema = require('jugglingdb').Schema;
    //var schema = new Schema('mongodb', {url: 'mongodb://127.0.0.1/komunikator2'});
    var jugglingdb = require('jugglingdb');
    var schema = new jugglingdb.Schema('mongodb', { url: dbURL });
    //var schema = new Schema('mongodb', {host: 'localhost', port: 27017, database: 'komunikator2', username: 'admin', password: 'admin'});
    //var schema = new Schema('mongodb', {url: 'mongodb://admin:admin@127.0.0.1:27017/komunikator2'});

    //Определяем схему (таблицу или по терминологии MongoDB - коллецию)
    var accounts = schema.define('accounts', {
        login: String,
        password: String
    });

    // accounts.create({ login: '3', password: '3' });
    // accounts.create({ login: '4', password: '4' });


    //logger.debug(' ============== jugglingdb: ==================');
    //logger.debug(jugglingdb);
    // logger.debug(' ============== schema: ==================');
    // logger.debug(schema.name, schema.settings);
    //logger.debug(' ============== accounts: ==================');
    //logger.debug(accounts);

    var registry = {}; // сюда будем писать абонентов из базы
    var contacts = {}; // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных

    // для чтения всех записей из коллекции accounts, используем callback функцию all модуля jugglingdb
    accounts.all(function(err, result) {
        // logger.debug(' ============== dbURL: =================');
        // logger.debug(dbURL);

        logger.debug(' ============== result (from BD): =================');
        logger.debug(result);

        /*  result - это массив объектов.
            jugglingdb в result кроме наших данных из базы пишет в объект ещё свои данные.
            Чтобы получить из result только свои объекты и их свойства, надо использовать метод toObject из jugglingdb.
            Так как result это массив объектов, то ко всему result применить метод toObject нельзя, а надо применять
            к строке-объекту, то есть result[i].toObject присвоить какой-либо переменной и использовать везде уже
            эту переменную.
        */

        registry = {}; // каждый раз при запросе информации об абонентах из базы очищаем объект, чтобы не было неактуальных данных

        // формируем объект registry для проверки авторизации абонентов
        for (var i = 0, len = result.length; i < len; i++) {
            var srcObjfromBD = {}; // переменная для получения из массива result только того объекта, который был считан из базы
            srcObjfromBD = result[i].toObject(); // получаем из каждой (i-ой) строки нужный объект

            // logger.debug(' ============== result[i]: ==================');
            // logger.debug(srcObjfromBD); // Вывести значение каждого элемента массива

            // в начале каждой итерации для ключа логина создаём пустой объект-значение,
            // чтобы потом заполнить его данными об абоненте (пока только пароль и id этой записи в документе БД)
            registry[srcObjfromBD.login] = {};

            // logger.debug(' ============= Object.keys: ===============');
            // logger.debug(Object.keys(srcObjfromBD).length);

            for (var key in srcObjfromBD) {
                // отфильтровывает свойства, принадлежащие не самому объекту, а его прототипу
                // по идее, если использована конструкция srcObjfromBD = result[i].toObject(), то чужих свойств
                // быть не должно, но пока на всякий случай оставил
                if (!srcObjfromBD.hasOwnProperty(key)) continue;

                // Вывести название и значение каждого свойства объекта
                // logger.debug(key+': ' + srcObjfromBD[key]);
                // logger.debug('==== key: =====');
                // logger.debug(key);

                // пропуск ключа login и заполнение в объекте registry объекта-значение данными
                // о логине ({ключ1: значение1, ключ2: значение2, ...})
                if (key !== 'login') {
                    registry[srcObjfromBD.login][key] = srcObjfromBD[key];

                    // logger.debug(' ============== registry[]: ==================');
                    // logger.debug(registry);
                }
            }
        }

        logger.debug(' ============== registry: ==================');
        logger.debug(registry);
        //ProxyStart();
    });

    ProxyStart();

    /**
     * удаляется регистрация абонента из объекта contacts
     * @method delContactFromContacts
     * @private
     *
     * @param {String} userlogin - имя(логин) удаляемого абонента
     *
     * @return {Boolean} true - регистрация абонента удалилась, false - регистрация абонента не удалилась
     */
    function delContactFromContacts(userlogin) {
        // если существует такой абонент, то
        if (contacts[userlogin]) {
            delete(contacts[userlogin]); // удаляем регистрацию абонента

            logger.debug(' ========== delContactFromContacts: contacts: ==========');
            logger.debug(contacts);

            emitEvents(1); // посылаем уведомление об изменении объекта contacts (в данном месте об удалении контакта)
            return true;
        }
        return false;
    }

    /**
     * проверка окончания времени регистрации (expires) абонента
     * @method isExpiresOver
     * @private
     *
     * @param {String} user - имя(логин) проверяемого абонента
     *
     * @return {Boolean} true - регистрация закончилась, false - регистрация не закончилась
     */
    function isExpiresOver(user) {
        var data2 = new Date(); // создаётся объект даты (получаем новую дату при запросе абонента)
        var data2mSec = parseInt(data2.valueOf()); // перевод новой даты в число миллисекунд

        logger.debug(' ================== data2mSec: ', data2mSec);

        logger.debug(' ============== user: ==================');
        logger.debug(user);

        // если существует такой абонент и у него существует свойство expiresTime, то
        if (contacts[user] && contacts[user].expiresTime) {
            logger.debug(' ============== expiresTime: ==================');
            logger.debug(contacts[user].expiresTime);

            /*  сравниваем contacts[user]['expiresTime'] и data2mSec.
                Если data2mSec < contacts[user]['expiresTime'], то регистрация абонента актуальна.
                Если data2mSec > contacts[user]['expiresTime'], то регистрация абонента неактуальна, и его надо удалить из объекта contacts.
            */
            if (data2mSec > contacts[user].expiresTime) {
                return true;
            }
        }

        return false;
    }

    /**
     * проверка окончания регистрации абонента и удаление его регистрации в случае окончания
     * @method delExpiresOver
     * @private
     *
     * @param {String} _user - имя(логин) абонента
     */
    function delExpiresOver(_user) {
        return function() {
            if (isExpiresOver(_user)) // если регистрация абонента закончилась, а он её не подтвердил, то
            {
                logger.debug(' ========== isExpiresOver: true ==========');

                delContactFromContacts(_user); // удаляем регистрацию абонента по истечении времени регистрации
            }

            logger.debug(' ========== _user: ==========');
            logger.debug(_user);
            logger.debug(' ========== expiresTime contacts: ==========');
            logger.debug(contacts);
        };
    }

    /**
     * проверка окончания регистрации абонента при обращении к нему и удаление его регистрации в случае окончания
     * @method delExpiresOver2
     * @private
     *
     * @param {String} user - имя(логин) абонента
     */
    function delExpiresOver2(user) {
        if (isExpiresOver(user)) // если регистрация абонента закончилась, а он её не подтвердил, то
        {
            delContactFromContacts(user); // удаляем регистрацию абонента по истечении времени регистрации
        }

        logger.debug(' ========== delExpiresOver2 - expiresTime contacts: ==========');
        logger.debug(contacts);
    }

    /**
     * выбор генерируемого события (содержит все генерируемые в модуле события)
     * @method emitEvents
     * @private
     *
     * @param {Number} num - номер, по которому выбирается генерируемоe событие
     * @param {Array/Object/String/Number} param - передаваемые с событием данные (по умолчанию пустая строка)
     *
     * @return {Array/Object/String/Number} param - возвращает переданные в функцию данные
     */
    function emitEvents(num, param) {
        if (param === undefined) param = ''; // если не указан параметр, устанавливаем значение по умолчанию
        switch (num) {
            case 1:
                app.emit('sip.chgContacts', '');
                break;

            case 2:
                app.emit('sip.message', 'Ура! Заработало!!!');
                break;

            case 3:
                app.request('web.getContacts', { requestTimeout: 5000 }, function(err, data1) {
                    logger.debug('err request web.getContacts: ==========================');
                    logger.debug(err);
                    if (!err) {
                        logger.debug(' SIP (web.getContacts): ');
                        logger.debug(data1);
                    }
                });
                break;
        }
        return param;
    }

    /**
     * обработка событий и запросов в том случае, если загрузились модули системы
     * @method eventsProcessing
     * @private
     */
    function eventsProcessing() {
        logger.debug('====================== events!!! ');

        app.once('sys.appReady', function(message) {
            // если загрузились все модули системы, то
            // подписываемся на нужные события и отправляем нужные

            logger.info('===================== sys.appReady ====================');
            logger.info(message + '  :SIP');

            app.on('sys.message', function(message) {
                logger.info(message + ': SIP');
            });

            app.on('sip.message', function(message) {
                logger.info(message + ': SIP');
            });

            app.on('sip.chgContacts', function(message) {
                logger.info(message + ': SIP');
                logger.debug(message);
            });

            //app.emit('sip.message', 'Ура! Заработало!!!');
            emitEvents(2);

            // подготовка и возврат контактных данных по запросу типа 'sip.getContacts'
            app.onRequest('sip.getContacts', function(param, cb) {
                logger.debug('======================= .onRequest {contacts}: ');
                logger.debug(contacts);

                var res = []; // подготавливаемый массив объектов из данных объекта contacts

                // формирование массива объектов res из данных объекта contacts
                for (var key in contacts) {
                    res[res.length] = { 'login': key, 'regDateTime': util.formatDate(new Date(contacts[key].regDateTime)), 'expires': parseInt(contacts[key].expires), 'expiresTime': util.formatDate(new Date(contacts[key].expiresTime)) };
                }

                logger.debug('===================== res:');
                logger.debug(res);
                logger.debug('===================== param:');
                logger.debug(param);
                cb(null, res);
            });

            app.request('sip.getContacts', { requestTimeout: 5000 }, function(err, data) {
                logger.debug('err request sip.getContacts: ==========================');
                logger.debug(err);
                if (!err) {
                    logger.debug(' SIP (sip.getContacts): ');
                    logger.debug(data);
                }
            });

        }); // app.once('sys.appReady' ...
        logger.debug('events!!! ======================');
    }


    /*
    function checkExpires()
    {
      logger.debug('-------------------------------------');
      for (var key in contacts)
      {
        // logger.debug('key - '+key);
        delExpiresOver(key);
      }
      logger.debug('++++++++++++++++++++++++++++++++++++++');
    };

    var ID = setInterval(function(){checkExpires()}, 121000); // вторым параметром обозначается нужная задержка
    */


    /**
     * запуск SIP сервера
     * @method ProxyStart
     * @private
     */
    function ProxyStart() {

        //logger.debug(Array.isArray(registry));

        //var contacts = {}; // объект для хранения реально подключившихся пользователей, а не всех зарегистрированных
        var realm = os.hostname();

        logger.info('starting server ...');

        proxy.start({
            port: 5062,
            logger: {
                recv: function(msg, remote) {
                    sip_logger.info('RECV from ' + remote.protocol + ' ' + remote.address + ':' + remote.port + '\n' + sip.stringify(msg));
                },
                send: function(msg, target) {
                    sip_logger.info('SEND to ' + target.protocol + ' ' + target.address + ':' + target.port + '\n' + sip.stringify(msg));
                },
                error: function(e) {
                    sip_logger.error(e.stack);
                }
            }
        }, function(rq) {
            if (rq.method === 'REGISTER') { // добавить проверку на существование свойства rq.headers.to.uri).user (?)
                var userlogin = sip.parseUri(rq.headers.to.uri).user;

                logger.debug(' ================== metod: ' + rq.method); // показывает какой метод SIP вызван

                logger.debug(' ============== userlogin: ==================');
                logger.debug(userlogin);

                var userinfo = registry[userlogin];
                logger.debug(' ============== userinfo: ==================');
                logger.debug(userinfo);
                if (!userinfo) { // если пользователь не известен
                    var session = { realm: realm };

                    logger.debug(' ============== session: ==================');
                    logger.debug(session);

                    proxy.send(digest.challenge({ realm: realm }, sip.makeResponse(rq, 401, 'Authentication Required')));
                } else {
                    userinfo.session = userinfo.session || { realm: realm };
                    if (!digest.authenticateRequest(userinfo.session, rq, { user: userlogin, password: userinfo.password })) {
                        proxy.send(digest.challenge(userinfo.session, sip.makeResponse(rq, 401, 'Authentication Required')));
                    } else {
                        userinfo.contact = rq.headers.contact;

                        /*
                            Прежде чем записать свойство значение expiresTime, надо проверить существует ли оно:
                            если expires = undefined, то удаляем абонента из contacts, т.к. абонент отключился
                            от сервера, но при этом послал запрос REGISTER;
                            если expires <> undefined, то вычисляем дату и время "протухания" подключения и пишем его в contacts
                        */
                        if ((rq.headers.expires === undefined)) {
                            // logger.debug('=================== account legal off (rq.headers.expires): ================');
                            // logger.debug(rq.headers.expires);

                            // если есть абонент и свойство TimerID
                            if (contacts[userlogin] && contacts[userlogin].TimerID) {
                                // абонент отменил регистрацию, поэтому,
                                clearTimeout(contacts[userlogin].TimerID); // прежде чем удалить регистрацию, отменяем ранее определённый таймер для этого абонента
                            }
                            delContactFromContacts(userlogin); // удаляем регистрацию абонента по инициативе абонента
                        } else {
                            // logger.debug(' ========== contacts (before registration): ==========');
                            // logger.debug(contacts);
                            // logger.debug(' ========== expires (before registration): ==========');
                            // logger.debug(rq.headers.expires);

                            // вычисление времени "протухания" регистрирующегося контакта и запись этого времени в contacts
                            var data = new Date(); // создаётся объект даты (data.valueOf() получает миллисекунды)
                            var dataMSec = parseInt(data.valueOf()); // получаем миллисекунды, прошедшие с 1.01.1970 в часовом поясе UTC
                            // получаем дату и время "протухания" абонента
                            // expires умножаем на 1000, чтобы получить миллисекунды
                            var data1 = dataMSec + parseInt(rq.headers.expires) * 1000;

                            /*
                                если свойство regDateTime есть в объекте contacts[userlogin], значит абонент не снялся с регистрации,
                                а подвердил регистрацию до истечения времени, отведённого на подтверждение регистрации, тогда в этом
                                случае обновляем все свойства, кроме regDateTime.
                                А иначе обновляем все свойства объекта contacts[userlogin]
                            */

                            // если есть свойство regDateTime в contacts[userlogin], значит происходит перерегистрация,
                            // и поэтому время регистрации не обновляем, а берём из текущего свойства объекта contacts[userlogin]
                            if (contacts[userlogin] && contacts[userlogin].regDateTime) {
                                dataMSec = contacts[userlogin].regDateTime;
                            }

                            // пишем в объект пока только свойство expiresTime, чтобы было что проверить в функции isExpiresOver
                            // которая вызывается при вызове setTimeout
                            contacts[userlogin] = { expiresTime: data1 };

                            // вызываем функцию setTimeout с временем задержки равным rq.headers.expires + 1
                            var curTimerID = setTimeout(delExpiresOver(userlogin), (parseInt(rq.headers.expires) + 1) * 1000); // вторым параметром обозначается нужная задержка. Умножаем на 1000 для приведения к миллисекундам по синтаксису

                            // теперь пишем в объект все нужные свойства
                            contacts[userlogin] = { contact: rq.headers.contact, regDateTime: dataMSec, expires: rq.headers.expires, expiresTime: data1, TimerID: curTimerID };

                            // contacts[userlogin] = {contact: rq.headers.contact, expiresTime: data1};

                            // посылаем уведомление об изменении объекта contacts (в данном месте о добавлении контакта)
                            emitEvents(1);
                        }

                        // запрашиваем список контактов с веб-сервера при успешном подключении абонента к SIP серверу
                        emitEvents(3);

                        logger.debug(' ========== contacts: ==========');
                        logger.debug(contacts);
                        logger.debug(' ========== expires: ==========');
                        logger.debug(rq.headers.expires);

                        logger.debug(' ================== data1: ', data1);

                        rq.version = '2.0';
                        var rs = sip.makeResponse(rq, 200, 'Ok');
                        rs.headers.contact = rq.headers.contact;
                        rs.headers.to.tag = Math.floor(Math.random() * 1e6);
                        proxy.send(rs);
                    }
                }

                // Notice  _proxy.send_ not sip.send
                // proxy.send(rs);
            } else {

                logger.debug(' !!!!!!!!!!!!!!!!!!!!!!!!!!!!!! ');

                var user = sip.parseUri(rq.uri).user;

                logger.debug(' ================== metod: ' + rq.method); // показывает какой метод SIP вызван
                // logger.debug(' ================== user: '+user+', тип - '+typeof(user));

                // надо будет (?) добавить возврат как прошло удаление и прошло ли вообще
                delExpiresOver2(user); // при попытке вызвать абонента проверяем его время "протухания" и удаляем, если проверка успешная


                // if (contacts[user] && Array.isArray(contacts[user]) && contacts[user].length > 0)
                if (contacts[user] && Array.isArray(contacts[user].contact) && contacts[user].contact.length > 0) {
                    rq.uri = contacts[user].contact[0].uri;

                    proxy.send(sip.makeResponse(rq, 100, 'Trying'));

                    proxy.send(rq);

                } else {
                    proxy.send(sip.makeResponse(rq, 404, 'Not Found'));
                }
            }
        });

        eventsProcessing(); // подписка и обработка событий

        logger.info('Server started'); // Simple proxy server with registrar function.


    } // end ProxyStart

} // end sip_server




module.exports = sip_server;

if (!module.parent)
    new module.exports();