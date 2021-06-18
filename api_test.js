const grpc = require('grpc');
const protoLoader = require('@grpc/proto-loader');
const packageDef = protoLoader.loadSync("api.proto", {});
const grpcObject = grpc.loadPackageDefinition(packageDef);
const Package =  grpcObject.ApiPackage;
const client = new Package.Api("localhost:40000", grpc.credentials.createInsecure());

if(process.argv.length >= 4) {
    client.addAccount({
        user: process.argv[2],
        password: process.argv[3]
    }, (err, response) => {
        console.log(response)
    })
} else {
    client.removeAccount({ user: process.argv[2] }, (err, response) => {
        console.log(response)
    });
}

client.getAccounts(null, (err, response) => {
    console.log(response)
});

const call = client.streamAccounts();

call.on("data", item => {
    console.log("received item from server " + JSON.stringify(item))
})

call.on("end", e => console.log("server done!"))