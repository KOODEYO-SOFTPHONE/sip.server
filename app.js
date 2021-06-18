process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
let path = require('path');
let fs = require('fs');
let sipServerModule = require('.');

let certs = {
    cert: path.join(__dirname, 'server_localhost.crt'),
    key: path.join(__dirname, 'server_localhost.key')
};

let settings = {
    hostname: 'softphone.koodeyo.com',
    udp: {
        port: 5060
    },
    tcp: {
        port: 5061
    },
    tls: {
        port: 5062,
        ...certs
    },
    ws: {
        port: 8506
    },
    wss: {
        port: 8507,
        ...certs
    }
};

let sslTls = getCertificate(settings.tls.key, settings.tls.cert);
settings['tls']['key'] = sslTls['key'];
settings['tls']['cert'] = sslTls['cert'];

let sslWss = getCertificate(settings.wss.key, settings.wss.cert);
settings['wss']['key'] = sslWss['key'];
settings['wss']['cert'] = sslWss['cert'];

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

const grpc = require("grpc");
const protoLoader = require("@grpc/proto-loader")
const packageDef = protoLoader.loadSync("api.proto", {});
const Logger = require('./logger');
const grpcObject = grpc.loadPackageDefinition(packageDef);
const sipServer = new sipServerModule.SipServer(settings);
const server = new grpc.Server();
const port = process.env.PORT || 40000;
const Package = grpcObject.ApiPackage;

server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), () => {
    server.start();
    sipServer.ProxyStart(settings);
    Logger.Api(`Server running on`, port);
});

server.addService(Package.Api.service, {
    'addAccount': function (call, callback) {
        if(call.request.user && call.request.password) {
            let account = sipServer.accounts[call.request.user];
            if(account) return callback(null, { message: 'Account exists' });

            sipServer.addAccount(call.request.user, {
                user: call.request.user,
                password: call.request.password
            }); 

            Logger.Api(`Added account ${call.request.user}`);
        }
        callback(null, { message: 'success' });
    },

    'removeAccount': function (call, callback) {
        if(call.request.user) {
            sipServer.removeAccount(call.request.user);
            Logger.Api(`Removed account ${call.request.user}`);
        }
        callback(null, { message: 'success' });
    },

    'removeRegistry': function (call, callback) {
        if(call.request.user) {
            sipServer.registry.remove(call.request.user);
            Logger.Api(`Removed account ${call.request.user} from registry`);
        }
        callback(null, { message: 'success' });
    },

    'getAccounts': function (call, callback) {
        callback(null, {
            "data": sipServer.getAccounts() 
        });
    },

    'streamAccounts': function (call, callback) {
        sipServer.getAccounts().forEach((account) => call.write(account));
        call.end();
    },
});