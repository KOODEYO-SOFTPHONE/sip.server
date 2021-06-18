const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const packageDef = protoLoader.loadSync("api.proto", {});
const grpcObject = grpc.loadPackageDefinition(packageDef);
const Package =  grpcObject.ApiPackage;
const client = new Package.Api("localhost:40000", grpc.credentials.createInsecure());

if(process.argv.length >= 4) {
    client.addAccount({
        name: process.argv[2],
        password: process.argv[3]
    }, (err, response) => {
        console.log(response)
    })
} else {
    client.removeAccount({ name: process.argv[2] }, (err, response) => {
        console.log(response)
    });
}