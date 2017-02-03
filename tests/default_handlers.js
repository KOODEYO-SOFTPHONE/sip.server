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
/*
setInterval(function() {
    console.log(' ');

    console.log('sipServer.registry: ', sipServer.registry);

    sipServer.registry.get('1', (err, data) => {
        console.log('registry 1: ', data);
    });

    sipServer.registry.get('alice', (err, data) => {
        console.log('registry alice: ', data);
    });
}, 3000);
*/