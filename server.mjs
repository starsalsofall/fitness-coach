import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {createWhoop,equalSecret} from './whoop.mjs';
// Some development shells disable TLS validation globally. Never inherit that for health-data requests.
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp(config={},options={}) {
  const whoop=options.whoop??createWhoop({...config,privateDir:config.privateDir??join(root,'private')});
  return createServer(async(req,res)=>{
    let url;
    try {
      // Only origin-form application paths are valid here. Parse failures must not
      // escape this async request listener and terminate the process.
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))throw new Error('Invalid request path');
      url=new URL(req.url,'http://localhost');
    }catch {
      res.writeHead(400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'请求地址无效'}));return;
    }
    const origin=req.headers.origin;
    const allowed=config.appOrigin&&origin===config.appOrigin;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(allowed){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(url.pathname.startsWith('/api/')) {
        if(req.method==='OPTIONS'){res.writeHead(allowed?204:403);res.end();return;}
        if(!config.pairToken||config.pairToken.length<32){json(503,{error:'WHOOP 同步服务尚未配置'});return;}
        if(!equalSecret(req.headers.authorization,`Bearer ${config.pairToken}`)){json(401,{error:'个人连接密钥无效'});return;}
        if(url.pathname==='/api/status'&&req.method==='GET'){json(200,await whoop.status());return;}
        if(url.pathname==='/api/authorize'&&req.method==='POST'){json(200,whoop.authorize());return;}
        if(url.pathname==='/api/snapshot'&&req.method==='GET'){json(200,await whoop.snapshot(url.searchParams.get('timezone')??'Asia/Shanghai'));return;}
        if(url.pathname==='/api/disconnect'&&req.method==='POST'){await whoop.disconnect();json(200,{ok:true});return;}
        json(404,{error:'接口不存在'});return;
      }
      if(url.pathname==='/oauth/callback'&&req.method==='GET'){await whoop.callback(url.searchParams);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('WHOOP 授权完成。请返回“每日动一动”，点击立即同步。');return;}
      const path=url.pathname==='/'?'/index.html':url.pathname;
      if(!['/index.html','/style.css','/core.js','/app.js','/quick-log.js','/weekly-plan.js','/coaching.js','/ui-shared.js','/nutrition-ui.js','/today-view.js','/weight-trends.js'].includes(path)||!['GET','HEAD'].includes(req.method)){json(404,{error:'页面不存在'});return;}
      const file=await readFile(join(root,'web',path.slice(1)));
      res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:file);
    }catch(e){json(502,{error:e.message});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.loadEnvFile){try{process.loadEnvFile(join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const env=process.env,port=Number(env.PORT??8787),host=env.HOST??'127.0.0.1';
  createApp({clientId:env.WHOOP_CLIENT_ID,clientSecret:env.WHOOP_CLIENT_SECRET,redirectUri:env.WHOOP_REDIRECT_URI,encryptionKey:env.TOKEN_ENCRYPTION_KEY,pairToken:env.PAIR_TOKEN,appOrigin:env.APP_ORIGIN,privateDir:env.PRIVATE_DIR??join(root,'private')}).listen(port,host,()=>console.log(`每日动一动预览：http://${host}:${port}`));
}
