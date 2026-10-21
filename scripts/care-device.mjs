import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function validateDeviceConfig(config) {
  const url=new URL(config.origin);
  const privateHost=/^(127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname);
  if(!privateHost || url.protocol!=='https:' || url.origin!==config.origin || !url.port || Number(url.port)<1024 || !config.cert || !config.key) throw new Error('Use an exact private IPv4 HTTPS origin with a non-privileged port and trusted local TLS files');
  return url;
}
export function emulatorPort(path) {
  const url=new URL(path,'https://local.invalid');
  const decoded=decodeURIComponent(url.pathname+url.search);
  if (/projects\/(?!demo-tankmaleh(?:[/&]|$))/.test(decoded)) return -1;
  if (/^\/(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com)\//.test(url.pathname) || url.pathname.startsWith('/emulator/auth/')) return 9099;
  if (/^\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel$/.test(url.pathname) || url.pathname.startsWith('/v1/projects/demo-tankmaleh/databases/')) return 8080;
  if (/^\/(emulator|v1|google\.|identitytoolkit|securetoken)/.test(url.pathname)) return -1;
  return null;
}
export function startDeviceServer(config, root=resolve('.care-device/dist')) {
  const url=validateDeviceConfig(config);
  const server=createServer({cert:readFileSync(config.cert),key:readFileSync(config.key)},(req,res)=>{
    res.setHeader('Content-Security-Policy',"connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'");
    res.setHeader('Permissions-Policy','camera=(self), microphone=()');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==url.host || (req.headers.origin && req.headers.origin!==url.origin)) {res.writeHead(403);res.end();return;}
    let port;try{port=emulatorPort(req.url??'/');}catch{port=-1;}
    if(port===-1){res.writeHead(403);res.end();return;}
    if(port){
      port=port===9099?(config.authPort??9099):(config.firestorePort??8080);
      if(![9096,9098,9099,8080,8086,8088].includes(port)){res.writeHead(403);res.end();return;}
      const proxy=request({agent:false,hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:{...req.headers,connection:'close',host:`127.0.0.1:${port}`}},upstream=>{
        const headers={...upstream.headers};delete headers['access-control-allow-origin'];delete headers['content-security-policy'];
        res.writeHead(upstream.statusCode??502,{...headers,'cache-control':'no-store'});upstream.pipe(res);
      });proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    try {
      const pathname=decodeURIComponent(new URL(req.url,url.origin).pathname);
      let file=resolve(root,'.'+pathname);
      if(file!==root && !file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      try {if(!statSync(file).isFile())file=resolve(root,'index.html');}catch{file=resolve(root,'index.html');}
      const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[extname(file)]??'application/octet-stream';
      res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
    }catch{res.writeHead(400);res.end();}
  });
  server.listen(Number(url.port),url.hostname,()=>console.log(`Demo-only device preview: ${url.origin} (Auth/Firestore forwarded to loopback)`));
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const config=JSON.parse(readFileSync(resolve(process.argv[2]??'.care-device/config.json'),'utf8'));
  validateDeviceConfig(config);
  const demo=Object.fromEntries(readFileSync('.env.care','utf8').split(/\r?\n/).filter(line=>/^VITE_\w+=/.test(line)).map(line=>line.split('=')));
  if(demo.VITE_FIREBASE_PROJECT_ID!=='demo-tankmaleh' || demo.VITE_USE_EMULATORS!=='1' || demo.VITE_LOCAL_CARE!=='1')throw new Error('Invalid demo configuration');
  const result=spawnSync('npx',['--no-install','vite','build','--mode','care','--outDir','.care-device/dist'],{stdio:'inherit',env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('VITE_'))),...demo,VITE_CARE_DEVICE_ORIGIN:config.origin}});
  if(result.status!==0)process.exit(result.status??1);
  startDeviceServer(config);
}
