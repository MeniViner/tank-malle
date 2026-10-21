import {mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {startDeviceServer} from './care-device.mjs';
// Test certificates stay ignored. Browser automation tolerates this dedicated
// self-signed fixture; this does not establish physical-device trust.
const dir=resolve('.care-device/unified/https');mkdirSync(dir,{recursive:true});const key=dir+'/key.pem',cert=dir+'/cert.pem';
if(!existsSync(cert))execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
execFileSync('node_modules/.bin/vite',['build','--mode','care-test','--outDir','.care-device/unified/https-dist'],{stdio:'inherit',env:{...process.env,VITE_CARE_DEVICE_ORIGIN:'https://127.0.0.1:5448'}});
const server=startDeviceServer({origin:'https://127.0.0.1:5448',key,cert,authPort:9098,firestorePort:8088},resolve('.care-device/unified/https-dist'));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit()));
