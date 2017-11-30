'use strict';

let sipServerModule = require('../index.js');
let settings = {
    accounts: {
        '1': {
            user: '1',
            password: '1'
        },
        'alice': {
            user: 'alice',
            password: 'alice'
        }
    }
}
let sipServer = new sipServerModule.SipServer(settings);
sipServer.ProxyStart();