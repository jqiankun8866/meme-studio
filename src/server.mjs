import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Studio,vocabulary,annotationPrompt} from './studio.mjs';
import {configuredVision} from './vision-adapter.mjs';
const ui=fileURLToPath(new URL('../ui/',import.meta.url));
const constantEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('请求超过12MB');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
export async function createPanel({dataDir,port=17961,studioOptions={}}){
 mkdirSync(dataDir,{recursive:true});const lock=join(dataDir,'panel.lock');let handle;
 try{handle=openSync(lock,'wx')}catch(e){
  if(e.code!=='EEXIST')throw e;
  const pid=Number(readFileSync(lock,'utf8'));let dead=false;try{process.kill(pid,0)}catch(x){dead=x.code==='ESRCH'}
  if(!dead)throw Error('该数据目录已有控制台运行，请使用原来的启动地址');unlinkSync(lock);handle=openSync(lock,'wx');
 }
 writeFileSync(handle,String(process.pid));closeSync(handle);
 let studio;try{studio=new Studio({dataDir,analyze:configuredVision(dataDir),...studioOptions})}catch(e){unlinkSync(lock);throw e}
 const token=randomBytes(32).toString('hex');let origin;
 const server=createServer(async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==new URL(origin).host)return json({error:'Host不匹配'},403);
   if(req.headers.origin&&req.headers.origin!==origin)return json({error:'禁止跨站请求'},403);
   const u=new URL(req.url,origin);
   if(req.method==='GET'&&u.pathname==='/favicon.ico'){res.writeHead(204);return res.end()}
   if(req.method==='GET'&&['/','/app.js','/style.css','/mascot.png'].includes(u.pathname)){
    const file=u.pathname==='/'?'index.html':u.pathname.slice(1);res.setHeader('Content-Type',file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');const bytes=readFileSync(join(ui,file));return res.end(file==='index.html'?bytes.toString('utf8').replace('<!-- style-options -->',vocabulary.styles.map(v=>`<option value="${v}">${v}</option>`).join('')):bytes);
   }
   if(!constantEqual(req.headers.authorization??'','Bearer '+token))return json({error:'请从本次启动地址打开控制台'},401);
   if(req.method==='GET'){
    if(u.pathname==='/api/state')return json(studio.status());
    if(u.pathname==='/api/pending')return json({items:studio.pending()});
    if(u.pathname==='/api/catalog')return json({items:studio.catalog()});
    if(u.pathname==='/api/contract')return json({version:'1',channelIndependent:true,vocabulary,settings:studio.delivery.settings(),rules:readFileSync(new URL('../skills/meme-studio/references/delivery.md',import.meta.url),'utf8'),acceptance:readFileSync(new URL('../skills/meme-studio/references/model-check.md',import.meta.url),'utf8')});
    if(u.pathname==='/api/schema')return json({vocabulary,annotationPrompt});
    if(u.pathname==='/api/dependencies')return json(await studio.dependencies());
    if(u.pathname.startsWith('/api/image/')){const {bytes,type}=studio.image(u.pathname.split('/').at(-1));res.setHeader('Content-Type',type);return res.end(bytes)}
   }
   if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))return json({error:'需要JSON请求'},415);
    const data=await body(req);
    if(u.pathname==='/api/libraries/connect')return json(studio.connectLibrary(data));
    if(u.pathname==='/api/libraries/disconnect')return json(studio.disconnectLibrary(data));
    if(u.pathname==='/api/delivery/settings')return json(studio.delivery.configure(data));
    if(u.pathname==='/api/delivery/select')return json(studio.delivery.select(data));
    if(u.pathname==='/api/delivery/receipt')return json(studio.delivery.receipt(data));
    if(u.pathname==='/api/settings')return json(await studio.settings(data));
    if(u.pathname==='/api/import')return json(await studio.importImage(data));
    if(u.pathname==='/api/annotate-pending')return json(await studio.annotatePending());
    if(u.pathname==='/api/annotate')return json(studio.annotate(data.id,data.meaning));
    if(u.pathname==='/api/browser')return json(await studio.bindBrowser(data.port));
    if(u.pathname==='/api/open-folder')return json(await studio.openFolder());
    if(u.pathname==='/api/collect'){
     if(studio.collector.running)return json({error:'已经在采集'},409);
     studio.xhs.owner('studio:local');void studio.collect().catch(studio.onError);return json({started:true},202);
    }
   }
   json({error:'接口不存在'},404);
  }catch(e){json({error:String(e.message).slice(0,300)},400)}
 });
 try{await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok)})}catch(e){await studio.close();unlinkSync(lock);throw e}
 origin=`http://127.0.0.1:${server.address().port}`;studio.start();
 const url=origin+'/#token='+token;
 writeFileSync(join(dataDir,'panel-access.json'),JSON.stringify({url,origin,token,pid:process.pid}),{mode:0o600});
 return {studio,server,origin,token,url,close:async()=>{await studio.close();await new Promise(r=>server.close(r));unlinkSync(lock);if(existsSync(join(dataDir,'panel-access.json')))unlinkSync(join(dataDir,'panel-access.json'))}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const dataDir=resolve(process.env.MEME_STUDIO_DATA??join(homedir(),'.meme-studio'));
 const panel=await createPanel({dataDir,port:Number(process.env.MEME_STUDIO_PORT??17961)});
 console.log('表情工作室已启动。请打开：\n'+panel.url+'\n保持此窗口运行；按Ctrl+C停止。');
 for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>void panel.close().then(()=>process.exit(0)));
}
