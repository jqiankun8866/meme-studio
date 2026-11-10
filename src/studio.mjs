import {Delivery} from './delivery.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync,realpathSync,unlinkSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LocalLibrary} from './local-library.mjs';
import {MemeSemantics,validateMeaning,annotationPrompt,vocabulary} from './assistant/meme-semantics.mjs';
import {ReceivedMemes,imageExt} from './assistant/received-memes.mjs';
import {MemeCollector} from './assistant/meme-collector.mjs';
import {XhsBrowser,extractScript} from './assistant/xhs-browser.mjs';
const exec=promisify(execFile),peer='studio:local';
const check=(v,m)=>{if(!v)throw Error(m)};
const hash=b=>createHash('sha256').update(b).digest('hex');

export class Studio{
 constructor({dataDir,analyze,collectorOptions={},now=Date.now}={}){
  this.dataDir=resolve(dataDir);this.root=join(this.dataDir,'.assistant');this.now=now;this.errors=[];
  mkdirSync(this.root,{recursive:true});mkdirSync(join(this.dataDir,'media','inbound'),{recursive:true});
  this.db=new DatabaseSync(join(this.root,'studio.sqlite'));this.engine={db:this.db};
  this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS studio_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   `);
  this.delivery=new Delivery(this);
  this.onError=e=>{this.errors.push({at:this.now(),message:String(e.message).slice(0,220)});this.errors=this.errors.slice(-8)};
  mkdirSync(join(this.dataDir,'memes'),{recursive:true});this.localLibrary=new LocalLibrary();this.libraryStatus=[];
  this.received=new ReceivedMemes(this);
  const config=this.setting('browser',null);
  this.xhs={config,browser:config?new XhsBrowser({root:this.root,config}):null,owner:p=>check(p===peer&&this.xhs.config&&this.xhs.browser,'请先连接已登录的小红书专用Chrome')};
  this.senders=new Map([[peer,true]]);
  this.memeSemantics=new MemeSemantics(this,{analyze,now});
  this.collector=new MemeCollector(this,{now,...collectorOptions});
 }
 setting(key,fallback){const r=this.db.prepare('SELECT value FROM studio_settings WHERE key=?').get(key);return r?JSON.parse(r.value):fallback}
 saveSetting(key,value){this.db.prepare('INSERT OR REPLACE INTO studio_settings VALUES(?,?)').run(key,JSON.stringify(value))}
 connectLibrary({path}){
  check(typeof path==='string'&&isAbsolute(path),'请填写已有图库的完整路径');
  const directory=realpathSync(path);this.localLibrary.scan(directory,{limit:1});
  const roots=this.setting('libraries',[]);if(!roots.includes(directory))this.saveSetting('libraries',[...roots,directory]);
  return this.status();
 }
 disconnectLibrary({path}){this.saveSetting('libraries',this.setting('libraries',[]).filter(x=>x!==path));return this.status()}
 memeCandidates(){
  const owned=join(this.dataDir,'memes');
  const roots=[{path:owned,external:false},...this.setting('libraries',[]).map(path=>({path,external:true}))];
  const seen=new Set();this.libraryStatus=[];const items=[];
  const metadata=new Map([...this.db.prepare('SELECT data FROM meme_collected').all(),...this.db.prepare('SELECT data FROM meme_user_items WHERE peer=?').all(peer)].map(r=>JSON.parse(r.data)).map(i=>[i.sha256,i]));
  for(const root of roots){try{
   const scan=this.localLibrary.scan(root.path);this.libraryStatus.push({path:root.path,external:root.external,count:scan.items.length,limited:scan.limited,unreadable:scan.errors.length});
   for(const i of scan.items){if(seen.has(i.sha256))continue;seen.add(i.sha256);const meta=root.external?{}:(metadata.get(i.sha256)??{});items.push({...meta,...i,title:meta.title??i.title,source:meta.source??i.source,tags:meta.tags??i.tags,origin:root.external?'已有图库':relative(owned,i.path).startsWith('xhs-collected')?'小红书采集':'用户发送'})}
  }catch{this.libraryStatus.push({path:root.path,external:root.external,error:'图库不可访问，请检查路径或权限'})}}
  return items;
 }
 status(){
  return {version:'0.3.0',delivery:this.delivery.settings(),collection:this.collector.settings(peer),inventory:this.memeSemantics.inventory(peer),libraries:this.libraryStatus,folder:join(this.dataDir,'memes'),browser:{configured:!!this.xhs.config,port:this.xhs.config?.port??9222},vision:{connected:!!this.memeSemantics.analyze,worker:this.memeSemantics.worker()},errors:this.errors};
 }
 catalog(){return this.memeSemantics.catalog(peer).map(({path,...i})=>i)}
 image(id){check(/^[a-f0-9]{64}$/.test(id),'图片编号无效');const i=this.memeCandidates().find(i=>i.sha256===id);check(i,'图片不存在或已删除');const b=readFileSync(i.path);check(hash(b)===id,'图片已变化');return {bytes:b,type:{'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[imageExt(b)]}}
 async importImage({base64,title='用户表情',tags=[]}){
  check(typeof base64==='string'&&base64.length<12*1024*1024,'图片过大');const b=Buffer.from(base64,'base64');check(b.length>8&&b.length<=8*1024*1024,'图片须为8MB以内');imageExt(b);
  const path=join(this.dataDir,'media','inbound',hash(b));writeFileSync(path,b);
  try{const {imageId}=this.received.register(peer,path);return this.received.save(peer,{imageId,isMeme:true,title,tags})}finally{unlinkSync(path)}
 }
 annotate(id,meaning){
  const i=this.memeCandidates().find(i=>i.sha256===id);check(i,'图片已删除');const v=validateMeaning(meaning);
  this.db.prepare('INSERT OR REPLACE INTO meme_meanings VALUES(?,?,?,0)').run(id,JSON.stringify({...v,status:!v.usable?'rejected':v.confidence>=0.75?'ready':'pending',annotationSource:'host-or-user-review'}),this.now());
  return {saved:true};
 }
 async settings(data){
  check(data&&typeof data==='object'&&!Array.isArray(data),'设置格式无效');
  check(Object.keys(data).every(k=>['enabled','intervalHours','prompt'].includes(k)),'未知设置');
  if(data.enabled!==undefined||data.intervalHours!==undefined||data.prompt!==undefined){
   const patch={...this.collector.settings(peer),...data};
   check(typeof patch.prompt==='string'&&patch.prompt.length<=100,'采集方向最多100字');patch.prompt=patch.prompt.trim();
   check(typeof patch.enabled==='boolean'&&Number.isInteger(patch.intervalHours)&&patch.intervalHours>=1&&patch.intervalHours<=720,'采集频率须为1–720小时');
   // Disabling and adjusting a disabled plan must remain possible without a connection.
   if(patch.enabled)await this.collector.call(peer,'set',{enabled:patch.enabled,intervalHours:patch.intervalHours,prompt:patch.prompt});
   else {this.collector.active?.abort();this.collector.save(peer,{...this.collector.settings(peer),enabled:false,intervalHours:patch.intervalHours,prompt:patch.prompt,nextDue:null,revision:patch.revision+1});}
  }
  return this.status();
 }
 async bindBrowser(port=9222){
  check(Number.isInteger(port)&&port>1024&&port<65536,'端口无效');
  const config={port,ownerPeer:peer,userDataDir:join(this.dataDir,'browser-profile')};
  const browser=new XhsBrowser({root:this.root,config});
  try{
   const result=await browser.locked(async signal=>(await browser.command(['eval','-b',Buffer.from(extractScript('status')).toString('base64')],signal)).result);
   check(result?.login&&!result.blocked&&/^\/user\/profile\/[a-f\d]{24}$/i.test(result.account??''),'专用Chrome尚未登录或需要验证，请完成后再次连接');
   config.profilePath=result.account;
   await this.collector.stop();this.xhs.browser?.close();this.xhs={config,browser,owner:p=>check(p===peer,'用户不匹配')};
   this.saveSetting('browser',config);this.collector=new MemeCollector(this,{now:this.now});this.collector.start();return {connected:true};
  }catch(e){browser.close();throw e}
 }
 async collect(){return this.collector.call(peer,'run')}
 pending(){return this.memeSemantics.catalog(peer).filter(i=>!i.semantic||i.semantic.status==='pending').slice(0,20)}
 async annotatePending(){check(this.memeSemantics.analyze,'尚未连接视觉模型；可由宿主通过 pending/schema/annotate 完成标注');await this.memeSemantics.tick();return this.status()}
 async openFolder(){const folder=realpathSync(join(this.dataDir,'memes'));const rel=relative(realpathSync(this.dataDir),folder);check(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'图库路径异常');await new Promise((ok,fail)=>{const c=execFile(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',[folder],{windowsHide:true});c.once('spawn',ok);c.once('error',fail)});return {requested:true,folder}}
 async dependencies(){let ffmpeg=false;try{await exec('ffmpeg',['-version'],{windowsHide:true,timeout:4000});ffmpeg=true}catch{}return {node:process.versions.node,ffmpeg,windowsOcr:process.platform==='win32',note:'Windows OCR语言和真实采集需运行验证；模型通过宿主注入，不自带额度。'}}
 start(){this.collector.start();this.memeSemantics.start()}
 async close(){await this.collector.stop();await this.memeSemantics.stop();this.xhs.browser?.close();this.db.close()}
}
export {vocabulary,annotationPrompt};
