import { BackgroundBrowser } from './background-browser.mjs';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME='https://www.xiaohongshu.com/explore';
const ensure=(ok,message)=>{if(!ok)throw new Error(message)};
export function noteUrl(value) {
  const match=String(value??'').match(/https?:\/\/[^\s<>]+/);
  ensure(match,'需要小红书笔记链接');
  const u=new URL(match[0]);
  ensure(!u.username&&!u.password&&!u.port,'链接格式不支持');
  if(['xhslink.com','xhslink.cn'].includes(u.hostname)){u.protocol='https:';return u.href;}
  ensure(['www.xiaohongshu.com','xiaohongshu.com'].includes(u.hostname),'仅支持小红书链接');
  const id=/^\/(?:explore|search_result|discovery\/item)\/([a-f\d]{24})(?:\/|$)/i.exec(u.pathname)?.[1]
    ?? /^\/user\/profile\/[a-f\d]{24}\/([a-f\d]{24})$/i.exec(u.pathname)?.[1];
  ensure(id,'需要具体笔记链接');
  const out=new URL('/explore/'+id,'https://www.xiaohongshu.com');
  for(const key of ['xsec_token','xsec_source'])if(u.searchParams.has(key))out.searchParams.set(key,u.searchParams.get(key));
  return out.href;
}
export function parsePopularity(value){
 const m=String(value??'').trim().replaceAll(',','').match(/^(\d+(?:\.\d+)?)(万|千|[wk])?\+?$/i);
 return m?Math.round(Number(m[1])*({万:10000,千:1000,w:10000,k:1000}[m[2]?.toLowerCase()]??1)):null;
}
const baseScript=`
const popularity=${parsePopularity.toString()};
const metrics=root=>({likes:popularity(root.querySelector('.like-wrapper .count')?.innerText),favorites:popularity(root.querySelector('.collect-wrapper .count')?.innerText)});

if(location.origin!=='https://www.xiaohongshu.com')throw new Error('当前页面不是小红书');
const visible=e=>!!e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
const me=[...document.querySelectorAll('a[href*="/user/profile/"]')].find(e=>e.innerText.trim()==='我');
const text=document.body.innerText;
const blocked=/请完成安全验证|访问过于频繁|账号行为异常|请拖动滑块/.test(text);
const meta={url:location.href,account:me?.pathname,blocked,login:!!me};
`;
export const extractScript=(mode,limit=5)=>`(()=>{${baseScript}
const mode=${JSON.stringify(mode)};
if(mode==='status')return meta;
if(mode==='read'){
const title=document.querySelector('#detail-title')?.innerText??'';
const body=document.querySelector('#detail-desc')?.innerText??'';
const currentId=location.pathname.split('/').pop();
const noteState=Object.values((typeof window!=='undefined'?window.__INITIAL_STATE__:null)?.note?.noteDetailMap??{}).map(x=>x.note).find(n=>n?.noteId===currentId);
const meaningful=body.replace(/#[^\\s#]+/g,'').trim();
return {...meta,...metrics(document),title,publishedAt:noteState?.time??null,images:(noteState?.imageList??[]).map(i=>i.urlDefault||i.infoList?.find(x=>x.imageScene==='WB_DFT')?.url).filter(Boolean).slice(0,18),text:body.slice(0,6000),author:document.querySelector('#noteContainer a.name')?.innerText??'',date:document.querySelector('#noteContainer .bottom-left .date')?.innerText??'',media:document.querySelector('#noteContainer video')?'video':'image-or-text',scope:'仅页面文字，未读取图片内容、视频画面或音轨',shareable:!!title.trim(),recommendationReady:meaningful.length>=60,evidence:meaningful.length>=60?'已读取描述文字；只能引用文字明确提供的内容':'文字过少或只有标签：可按标题和标签介绍主题并分享链接，不代表不能推荐；不能声称看过视频或编造视频内动作、组数和次数',ready:!!document.querySelector('#detail-desc')};
}
if(mode==='ask'){
const e=[...document.querySelectorAll('.ai-message')].at(-1);
return {...meta,text:e?.querySelector('.xhs-ai-md-container')?.innerText?.slice(0,7000)??'',complete:e?.classList.contains('ai-message-finished')??false,scope:'小红书点点 AI 回答，原笔记尚未核实'};
}
let root=document;
if(mode==='favorites'||mode==='likes'){
 const label=mode==='favorites'?'收藏':'点赞';
 // Panels remain mounted offscreen; geometry can lag the selected tab.
 // Verify both tab identity and route, then map ordered top-level panels.
 const tabs=[...document.querySelectorAll('.reds-tab-item.sub-tab-list')];
 const active=tabs.filter(e=>e.classList.contains('active'));
 const labels=tabs.map(e=>e.innerText.trim());
 const panels=[...document.querySelectorAll('.feeds-tab-container .tab-content-item')];
 const route=new URL(location.href).searchParams;
 const expected=mode==='favorites'?'fav':'liked';
 if(labels.join('|')!=='笔记|收藏|点赞'||active.length!==1||active[0].innerText.trim()!==label||panels.length!==tabs.length||
    (route.has('tab')&&route.get('tab')!==expected)||
    (mode==='favorites'&&route.has('subTab')&&route.get('subTab')!=='note'))return {...meta,ready:false,notes:[]};
 root=panels[labels.indexOf(label)];
}
const notes=[...root.querySelectorAll('section.note-item')].slice(0,mode==='search'?20:${limit}).map(e=>({...metrics(e),id:e.getAttribute('data-note-id'),title:e.querySelector('.title')?.innerText??'',url:e.querySelector('a.cover')?.href??'',author:e.querySelector('.author .name')?.innerText??''})).filter(n=>n.url);
if(mode==='search')notes.sort((a,b)=>(b.likes??-1)-(a.likes??-1)||(b.favorites??-1)-(a.favorites??-1));
return {...meta,ready:notes.length>0,notes:notes.slice(0,${limit}),ranking:mode==='search'?'最多20条已加载候选按可见点赞数优先；收藏缺失为null，详情读取后比较；不是全站最高热度':null,scope:'当前列表前${limit}条，非完整收藏/点赞清单'};
})()`;

export class XhsBrowser {
  constructor({root,config,runCommand,startBrowser=ensureBrowser}){this.root=root;this.config=config;this.runCommand=runCommand;this.startBrowser=startBrowser;mkdirSync(root,{recursive:true});}
  authorize(peer){ensure(this.config?.ownerPeer&&peer===this.config.ownerPeer,'小红书浏览器只向绑定的微信拥有者开放');}
  async ensureConnected(signal){
    if(this.runCommand)return; // deterministic browser fixture
    const port=this.config.port??9222;
    ensure(Number.isInteger(port)&&port>0&&port<65536,'小红书浏览器端口无效');
    let initiallyOffline;
    const probe=async()=>{let ok=false;try{const r=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1500)]):AbortSignal.timeout(1500)});const j=await r.json();ok=r.ok&&typeof j.webSocketDebuggerUrl==='string'}catch{}initiallyOffline??=!ok;return ok};
    await this.startBrowser(this.config,signal,{probe});
    this.minimizeNewWindow=initiallyOffline;
  }
  async command(args,signal){
    signal?.throwIfAborted();
    if(this.runCommand)return this.runCommand(args,signal);
    this.background??=new BackgroundBrowser(this.config.port??9222);
    return this.background.command(args,signal);
  }
  async locked(fn,signal){
    ensure(!this.busy,'小红书正在处理上一项请求，请稍后再试');this.busy=true;
    const path=join(this.root,'xhs-browser.lock');let handle;
    try{
      try{handle=openSync(path,'wx');}catch(e){
        if(e.code!=='EEXIST')throw e;
        // Never steal a live worker's tab. Recovery is only for a confirmed dead process.
        const owner=JSON.parse(readFileSync(path,'utf8'));let dead=false;
        try{process.kill(owner.pid,0)}catch(err){dead=err.code==='ESRCH'}
        ensure(dead,'小红书被另一个进程占用');unlinkSync(path);handle=openSync(path,'wx');
      }
      writeFileSync(handle,JSON.stringify({pid:process.pid,at:Date.now()}));
      const timeout=AbortSignal.timeout(120000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
      await this.ensureConnected(combined);
      // Reuse only our own target. Closing it per call flashes/restarts an otherwise empty Chrome.
      const tabs=(await this.command(['tab','list'],combined)).tabs;
      if(!this.ownedTarget||!tabs.some(t=>t.targetId===this.ownedTarget)){
        this.background?.close();this.background=null;this.ownedTarget=null;
        const tab=await this.command(['tab','new',HOME],combined);
        ensure(tab.targetId&&!tabs.some(t=>t.targetId===tab.targetId),'无法确认新标签页归属');
        this.ownedTarget=tab.targetId;
        if(this.minimizeNewWindow&&this.background){
          const {windowId}=await this.background.send('Browser.getWindowForTarget',{targetId:this.ownedTarget},combined);
          await this.background.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}},combined);
          this.minimizeNewWindow=false;
        }
      }
      return await fn(combined);
    }finally{
      if(handle!==undefined){closeSync(handle);unlinkSync(path)}this.busy=false;
    }
  }
  close(){this.background?.close();this.background=null;this.ownedTarget=null;}
  async extract(mode,signal,limit=5){
    const data=await this.command(['eval','-b',Buffer.from(extractScript(mode,limit)).toString('base64')],signal);
    const result=data.result;
    ensure(result&&!result.blocked,'小红书要求验证或限制访问，请在专用 Chrome 中处理后再试');
    ensure(result.login,'小红书登录失效，请在专用 Chrome 中登录');
    ensure(result.account===this.config.profilePath,'小红书登录账号变了，请先恢复绑定账号');
    return {...result,fetchedAt:new Date().toISOString(),untrustedContent:true};
  }
  async waitReady(mode,signal,limit=5){
    const until=Date.now()+(mode==='ask'?45000:16000);let result;
    do{
      result=await this.extract(mode,signal,limit);
      if(mode==='ask'?result.complete:result.ready)return result;
      await new Promise((resolve,reject)=>{const timer=setTimeout(done,600);function done(){signal?.removeEventListener('abort',abort);resolve()}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason)}signal?.addEventListener('abort',abort,{once:true})});
    }while(Date.now()<until);
    if(mode==='ask'&&result.text)return {...result,complete:false};
    throw new Error('页面未加载出可读内容，可能为空、网络慢或页面结构变化；没有读取成功');
  }
  async perform(peer,action,data={},signal){
    this.authorize(peer);
    ensure(['status','feed','search','read','favorites','likes','ask'].includes(action),'不支持的小红书操作');
    if(['search','ask'].includes(action))ensure(typeof data.query==='string'&&data.query.trim()&&data.query.length<=200,'搜索词须为1–200字');
    const readUrl=action==='read'?noteUrl(data.url):null;
    const limit=data.limit??(action==='search'?12:5);
    ensure(Number.isInteger(limit)&&limit>=1&&limit<=20,'limit须为1–20的整数；只返回当前已加载候选，不保证数量');
    return this.locked(async s=>{
      // Navigate only the owned tab; account check precedes any query submitted to the website.
      const current=(await this.command(['get','url'],s)).url;
      if(!current?.startsWith('https://www.xiaohongshu.com/'))await this.command(['open',HOME],s);
      await this.extract('status',s);
      if(action==='status')return {...await this.extract('status',s),connected:true};
      if(action==='feed')await this.command(['open',HOME],s);
      else if(action==='search'||action==='ask'){
        const mode=action==='ask'?'ai':'notes';
        await this.command(['xhs-search-mode',mode],s);
        await this.command(['find','role','textbox','fill',data.query],s);
        await this.command(['xhs-search-submit',mode],s);
      }else if(action==='read')await this.command(['open',readUrl],s);
      else if(action==='favorites'||action==='likes'){
        const u=new URL(this.config.profilePath,'https://www.xiaohongshu.com');u.searchParams.set('tab',action==='favorites'?'fav':'liked');
        if(action==='favorites')u.searchParams.set('subTab','note');
        await this.command(['open',u.href],s);
      }
      return this.waitReady(action,s,limit);
    },signal);
  }
}
import {ensureBrowser} from './browser-start.mjs';
