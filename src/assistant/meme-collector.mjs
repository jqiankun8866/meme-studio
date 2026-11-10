import {mkdirSync,readFileSync,writeFileSync,existsSync,renameSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ocrScript} from './meme-ocr-script.mjs';
const exec=promisify(execFile),check=(v,m)=>{if(!v)throw Error(m)};
export const hash=b=>createHash('sha256').update(b).digest('hex');
export function imageUrl(value){const u=new URL(value);check(['http:','https:'].includes(u.protocol)&&/^sns-webpic[-a-z0-9]*\.xhscdn\.com$/.test(u.hostname)&&!u.username&&!u.password&&!u.port,'不是小红书正文图片地址');u.protocol='https:';return u.href;}
export async function downloadImage(url,signal){const r=await fetch(imageUrl(url),{redirect:'error',headers:{Referer:'https://www.xiaohongshu.com/'},signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(15000)])});check(r.ok&&r.headers.get('content-type')?.startsWith('image/'),'图片下载失败');const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>8*1024*1024)throw Error('图片超过8MB');chunks.push(c)}check(size>100,'图片为空');return Buffer.concat(chunks);}
export async function localOcr(bytes,{root,signal}){
 check(process.platform==='win32','本机文字识别目前需Windows');
 const tmp=mkdtempSync(join(resolve(root),'scan-'));
 try{const input=join(tmp,'source'),png=join(tmp,'input.png'),output=join(tmp,'output.png'),script=join(tmp,'ocr.ps1');writeFileSync(input,bytes);writeFileSync(script,'\ufeff'+ocrScript);
 const bundled=join(root,'..','..','tools','ffmpeg','bin','ffmpeg.exe');
 try{const converted=await exec(existsSync(bundled)?bundled:'ffmpeg',['-v','error','-i',input,'-frames:v','1','-vf','scale=1024:1024:force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','png','pipe:1'],{windowsHide:true,timeout:20000,signal,encoding:'buffer',maxBuffer:16*1024*1024});writeFileSync(png,converted.stdout)}catch(e){if(signal?.aborted)throw e;throw Error('图片解码失败：'+String(e.stderr||e.code||'unknown').replaceAll(input,'[input]').trim().slice(0,450))}
 const result=await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-InputPath',png,'-OutputPath',output],{windowsHide:true,encoding:'utf8',timeout:20000,signal});
 return {...JSON.parse(result.stdout.trim()),bytes:readFileSync(output)};
 }finally{rmSync(tmp,{recursive:true,force:true})}
}
export class MemeCollector{
 constructor(service,{now=Date.now,download=downloadImage,ocr=localOcr}={}){this.service=service;this.db=service.engine.db;this.now=now;this.download=download;this.ocr=ocr;this.root=join(service.root,'..','memes','xhs-collected');mkdirSync(this.root,{recursive:true});this.abort=new AbortController();this.db.exec(`CREATE TABLE IF NOT EXISTS meme_collection(peer TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meme_collected(hash TEXT PRIMARY KEY,peer TEXT NOT NULL,data TEXT NOT NULL);`);}
 owner(peer){this.service.xhs.owner(peer);}
 settings(peer){const row=this.db.prepare('SELECT data FROM meme_collection WHERE peer=?').get(peer);return row?{prompt:'',...JSON.parse(row.data)}:{enabled:false,intervalHours:84,prompt:'',nextDue:null,revision:0,last:null};}
 save(peer,p){this.db.prepare('INSERT OR REPLACE INTO meme_collection VALUES(?,?)').run(peer,JSON.stringify(p));}
 inventory(peer){
  this.owner(peer);const items=this.db.prepare('SELECT data FROM meme_collected WHERE peer=?').all(peer).map(r=>JSON.parse(r.data));
  const available=items.filter(i=>/^[a-f0-9]{64}\.png$/.test(i.file)&&existsSync(join(this.root,i.file)));
  return {scope:'当前用户的小红书表情图库',recorded:items.length,available:available.length,missing:items.length-available.length,
   recent:available.sort((a,b)=>b.collectedAt-a.collectedAt).slice(0,5).map(i=>({title:i.title,path:join(this.root,i.file),source:i.source,collectedAt:i.collectedAt,hasText:i.hasText}))};
 }
 async call(peer,action,data={},signal){this.owner(peer);if(action==='get')return {...this.settings(peer),folder:this.root,library:this.inventory(peer)};
 if(action==='run'){check(Object.keys(data).length===0,'立即采集不接受额外参数');const result=await this.run(peer,signal);return {...result,folder:this.root,library:this.inventory(peer)}};if(action==='open'){const cmd=process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open';await new Promise((resolve,reject)=>{const child=execFile(cmd,[join(this.root,'..')],{windowsHide:false});child.once('spawn',resolve);child.once('error',reject)});return {requested:true,folder:join(this.root,'..')}}
 check(action==='set','不支持此操作');check(Object.keys(data).every(k=>['enabled','intervalHours','prompt'].includes(k)),'未知设置');const old=this.settings(peer),p={...old,...data};check(typeof p.prompt==='string'&&p.prompt.length<=100,'采集方向最多100字');p.prompt=p.prompt.trim();check(typeof p.enabled==='boolean'&&Number.isInteger(p.intervalHours)&&p.intervalHours>=1&&p.intervalHours<=720,'频率须为1–720小时');if(p.enabled)check(process.platform==='win32','自动采集目前需Windows本机文字识别');p.revision++;p.nextDue=p.enabled?this.now()+p.intervalHours*3600000:null;this.save(peer,p);if(!p.enabled)this.active?.abort();return {...p,folder:this.root};}
 start(){this.timer=setInterval(()=>void this.tick().catch(this.service.onError),15000);this.timer.unref?.();}
 async stop(){clearInterval(this.timer);this.abort.abort();this.active?.abort();await this.running?.catch(()=>{});}
 async tick(){const peer=this.service.xhs.config?.ownerPeer;if(!peer||this.running||this.abort.signal.aborted)return;const p=this.settings(peer);if(!p.enabled||!p.nextDue||p.nextDue>this.now())return;this.save(peer,{...p,nextDue:this.now()+p.intervalHours*3600000,last:{state:'running',at:this.now()}});return this.run(peer);}
 async run(peer,externalSignal){check(!this.running,'采集正在运行');this.owner(peer);this.active=new AbortController();const signal=AbortSignal.any([this.abort.signal,this.active.signal,...externalSignal?[externalSignal]:[]]);this.save(peer,{...this.settings(peer),last:{state:'running',at:this.now()}});this.running=this.collect(peer,signal);try{const result=await this.running;const p=this.settings(peer);this.save(peer,{...p,last:{state:'done',at:this.now(),...result}});return result}catch(e){const p=this.settings(peer);this.save(peer,{...p,last:{state:signal.aborted?'stopped':'failed',at:this.now(),error:String(e.message).slice(0,200)}});throw e}finally{this.running=null;this.active=null}}
 async collect(peer,signal){
 const revision=this.settings(peer).revision;const checkpoint=()=>{signal.throwIfAborted();check(this.settings(peer).revision===revision,'采集设置已更改，本轮停止')};
 const browser=this.service.xhs.browser;checkpoint();const direction=this.settings(peer).prompt.trim();const query=direction?(direction.includes('表情包')?direction:direction+' 表情包'):'表情包';const list=await browser.perform(peer,'search',{query},signal);const notes=[];
 for(const n of list.notes.slice(0,5)){checkpoint();const r=await browser.perform(peer,'read',{url:n.url},signal);if(r.media!=='video'&&r.images?.length&&Number.isFinite(r.publishedAt)&&this.now()-r.publishedAt<=30*86400000&&this.now()>=r.publishedAt)notes.push({...r,likes:n.likes??0});}
 notes.sort((a,b)=>b.likes-a.likes||b.publishedAt-a.publishedAt);let scanned=0,duplicates=0;const candidates=[];
 for(const note of notes){for(const url of note.images.slice(0,8)){if(scanned>=12)break;checkpoint();scanned++;const raw=await this.download(url,signal),sourceHash=hash(raw);if(this.db.prepare('SELECT 1 FROM meme_collected WHERE hash=?').get(sourceHash)){duplicates++;continue}const result=await this.ocr(raw,{root:this.root,signal});const text=result.text.replace(/\s+/g,'').trim();if(result.width<120||result.height<120||result.width/result.height>2.8||result.height/result.width>2.8||text.length>100||/二维码|扫码|加微信|加群|购买|下单|公众号|私信领取|https?:|www\./i.test(text))continue;candidates.push({sourceHash,text,bytes:result.bytes,note});}if(scanned>=12)break;}
 candidates.sort((a,b)=>Number(!!b.text)-Number(!!a.text));let added=0;
 for(const c of candidates.slice(0,5)){checkpoint();const digest=hash(c.bytes);if(this.db.prepare('SELECT 1 FROM meme_collected WHERE json_extract(data,\'$.sha256\')=?').get(digest)){duplicates++;continue}const file=digest+'.png';const item={id:digest,file,sha256:digest,title:c.text||c.note.title,tags:[c.text||'表情包','表情包'],source:c.note.url,noteTitle:c.note.title,publishedAt:c.note.publishedAt,collectedAt:this.now(),hasText:!!c.text,license:'来源作者所有；仅本机个人使用，未获得再分发授权'};writeFileSync(join(this.root,file+'.tmp'),c.bytes);renameSync(join(this.root,file+'.tmp'),join(this.root,file));this.db.prepare('INSERT OR IGNORE INTO meme_collected VALUES(?,?,?)').run(c.sourceHash,peer,JSON.stringify(item));added++;}
 this.sync();void this.service.memeSemantics?.tick().catch(this.service.onError);return {added,scanned,duplicates,recentNotes:notes.length,query};
 }
 sync(){const items=this.db.prepare('SELECT data FROM meme_collected').all().map(r=>JSON.parse(r.data)).filter(i=>existsSync(join(this.root,i.file)));const path=join(this.root,'manifest.json');writeFileSync(path+'.tmp',JSON.stringify({license:'本机个人图库；素材归原作者所有',items},null,2));renameSync(path+'.tmp',path);return items;}
}
