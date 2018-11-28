'use strict';

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

let fs = require('fs');
let sipServerModule = require('../index.js');
let settings = {
    accounts: {
        '1': {
            user: '1',
            password: '1'
        },
        '2': {
            user: '2',
            password: '2'
        },
        '3': {
            user: '3',
            password: '3'
        },
        '4': {
            user: '4',
            password: '4'
        },
        '5': {
            user: '5',
            password: '5'
        },
        '6': {
            user: '6',
            password: '6'
        },
        '7': {
            user: '7',
            password: '7'
        },
        '8': {
            user: '8',
            password: '8'
        },
        '9': {
            user: '9',
            password: '9'
        },
        'alice': {
            user: 'alice',
            password: 'alice'
        }
    },
    udp: {
        port: 5060
    },
    tcp: {
        port: 5061
    },
    tls: {
        port: 5062
    },
    ws: {
        port: 8506,
        wssport: 8507
    }
}

// Подключение сертификата если есть сертификаты
let keyPath = __dirname + '/../' + 'server_localhost.key';
let crtPath = __dirname + '/../' + 'server_localhost.crt';

if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
    let certKey = fs.readFileSync(keyPath);
    let certCrt = fs.readFileSync(crtPath);

    settings['tls']['key'] = settings['ws']['key'] = certKey;
    settings['tls']['cert'] = settings['ws']['cert'] = certCrt;
};

let sipServer = new sipServerModule.SipServer(settings);
sipServer.ProxyStart(settings);