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
        port: 8506
    },
    wss: {
        port: 8507,
        key: 'server_localhost.key',
        cert: 'server_localhost.crt'
    }
}

// Чтение сертификатов сертификата
settings['tls']['key'] = getCertificate(settings.tls.key);
settings['tls']['cert'] = getCertificate(settings.tls.cert);

settings['wss']['key'] = getCertificate(settings.tls.key);
settings['wss']['cert'] = getCertificate(settings.tls.cert);

function getCertificate(keyPath, crtPath) {
    let key = '';
    let cert = '';

    if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
        key = fs.readFileSync(keyPath); 
        cert = fs.readFileSync(crtPath);
    }

    return { 
        key: key,
        cert: cert
    };
}

let sipServer = new sipServerModule.SipServer(settings);
sipServer.ProxyStart(settings);