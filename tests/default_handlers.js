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

    //console.log('sipServer.registry: ', sipServer.registry);

    sipServer.registry.get('sip:contact:1*', (err, data) => {
        //console.log('registry 1 err: ', err);
        console.log('registry 1 data: ', data);
        console.log(' ');
    });

    sipServer.registry.get('sip:contact:alice*', (err, data) => {
        //console.log('registry alice err: ', err);
        console.log('registry alice data: ', data);
        console.log(' ');
    });
}, 3000);
*/