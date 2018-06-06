'use strict';

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
        'alice': {
            user: 'alice',
            password: 'alice'
        }
    }
}
let sipServer = new sipServerModule.SipServer(settings);
sipServer.ProxyStart();