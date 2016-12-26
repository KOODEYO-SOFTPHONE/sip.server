var sip = require('sip');
var proxy = require('sip/proxy');
var digest = require('sip/digest');
sip._registry = sip._registry || {}; //auth data 
sip._contacts = sip._contacts || {}; //current status

sip._contactPrefix = 'sip:contact:';
sip._sessionPrefix = 'sip:session:';
sip._sessionTimeout = 30000; //время жизни сессии авторизации (30 sec) 

var log4js = require('log4js');
log4js.configure('./logger.json', { reloadSecs: 300 });
var logger = log4js.getLogger('sip_server');

var getUsers = function(param, cb) {
    cb('Error connect to database', {});
};

// rinstance - for multi contacts
//{"uri":"sip:122@172.17.2.82:60452;rinstance=fdbedfe4930e59d7"}
//{"uri":"sip:3@172.17.2.82:7169","params":{"+sip.instance":"\"<urn:uuid:399BFBC0-5F5E-A6E8-AAAC-64FBEF2792C8>\""}}
sip._getRinstance = function(contact) {
    if (!(contact && contact.uri))
        return '';
    var match = contact.uri.match(/rinstance=([^;]+);?/);
    if (!match && contact.params && contact.params['+sip.instance'])
        return ':' + contact.params['+sip.instance'].replace(/[^A-Za-z^0-9]/g, '');
    return match ? ':' + match[1] : ':' + (sip.parseUri(contact.uri) && (sip.parseUri(contact.uri).host + sip.parseUri(contact.uri).port)).replace(/\./g, '');
};

module.exports = function(self, rq, flow, cb) {
    if (rq.method !== 'REGISTER')
        return cb(false);
    cb(true);

    function isGuest(user) {
        //return /^guest/.test(user); 
        return !!(user[0] == '_');
    }
    var user = sip.parseUri(rq.headers.to.uri).user;

    //self.app.request('dbstorage.Users', {name:user}, function (err, data) {
    /*
    data = {
        user: '6',
        password: '6'
    };
    */

    getUsers({ name: user }, function(err, data) {
        if (!(isGuest(user) || (data && data.password))) { // we don't know this user and answer with a challenge to hide this fact 
            var rs = digest.challenge({ realm: sip._realm }, sip.makeResponse(rq, 401, 'Authentication Required'));
            proxy.send(rs);
        } else {
            var rinstance = sip._getRinstance(rq.headers.contact && rq.headers.contact[0]);

            function register(err, contact) {
                var now = new Date().getTime();
                var expires = parseInt(rq.headers.expires) * 1000 || 0;
                var contact = rq.headers.contact && rq.headers.contact[0];
                contact.uri = 'sip:' + user + '@' + flow.address + ':' + flow.port; //real address

                var ob = !!( /*flow.protocol && flow.protocol.toUpperCase() == 'WS' && */ contact && contact.params['reg-id'] && contact.params['+sip.instance']);
                var binding = {
                    regDateTime: (contact && contact.regDateTime) ? contact.regDateTime : now,
                    expiresTime: now + expires,
                    expires: expires,
                    contact: contact,
                    ob: ob
                };
                if (ob) {
                    var route_uri = sip.encodeFlowUri(flow);
                    route_uri.params.lr = null;
                    binding.route = [{ uri: route_uri }];
                    binding.user = { uri: rq.headers.to.uri };
                }
                sip._contacts.set(sip._contactPrefix + user + rinstance,
                    expires || 1, //ttl  1ms == remove,
                    binding
                );
                //self.app.emit('sip.chgContacts');
            };

            function auth(err, session) {
                session = session || { realm: sip._realm };
                if (!isGuest(user) && !(digest.authenticateRequest(session, rq, { user: user, password: data.password }))) {
                    var rs = digest.challenge(session, sip.makeResponse(rq, 401, 'Authentication Required'));
                    sip._contacts.set(sip._sessionPrefix + user + rinstance, sip._sessionTimeout, session);
                    proxy.send(rs);
                } else {
                    //получаем текущий контакт и регистрируемся
                    sip._contacts.get(sip._contactPrefix + user + rinstance, register);

                    var rs = sip.makeResponse(rq, 200, 'OK');
                    rs.headers.contact = rq.headers.contact;
                    rs.headers.to.tag = Math.floor(Math.random() * 1e6);
                    // Notice  _proxy.send_ not sip.send
                    proxy.send(rs);
                }
            };
            //получаем текущую сессию пользователя и авторизуемся
            sip._contacts.get(sip._sessionPrefix + user + rinstance, auth);
        }
    });
    return true;
};

function _dbstorage() {
    console.log('dbStorage function');
    logger.debug('dbstorage runs...');

    //////////////////////////////////////////////////////////////////
    // WATERLINE Storage
    //////////////////////////////////////////////////////////////////

    var Waterline = require('waterline');
    var orm = new Waterline();

    //////////////////////////////////////////////////////////////////
    // WATERLINE CONFIG
    //////////////////////////////////////////////////////////////////

    // Require any waterline compatible adapters here
    var diskAdapter = require('sails-disk');

    // Build A Config Object
    var config = {

        // Setup Adapters
        // Creates named adapters that have been required
        adapters: {
            'default': diskAdapter,
            disk: diskAdapter
        },

        // Build Connections Config
        // Setup connections using the named adapter configs
        connections: {
            myLocalDisk: {
                adapter: 'disk'
            }
        },
        defaults: {
            migrate: 'alter'
        }
    };

    //////////////////////////////////////////////////////////////////
    // WATERLINE MODELS
    //////////////////////////////////////////////////////////////////

    var Users = Waterline.Collection.extend({
        identity: 'users',
        connection: 'myLocalDisk',
        attributes: {
            name: 'string',
            password: 'string'
        }
    });

    // Load the Models into the ORM
    orm.loadCollection(Users);

    var models;

    // Start Waterline passing adapters in
    orm.initialize(config, function(err, mod) {
        if (err) throw err;
        models = mod;
    });



    getUsers = function(param, cb) {
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

    /*
    self.app.onRequest('dbstorage.Users', function(param, cb) {
        logger.debug('dbstorage.Users requested: ' + JSON.stringify(param));

        if (models) {
            models.collections.users.findOne(param, function(err, data) {
                if (err) return cb(err, {});
                cb(null, data);
            });
        } else {
            cb('Error connect to database', {});
        }
    });
    */
}

_dbstorage();