import {existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {BackgroundBrowser} from './background-browser.mjs';
export async function ensureBrowser(config,signal,{probe,launch=launchChrome,minimize=minimizeNewBrowser,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 signal?.throwIfAborted();
 if(await probe())return;
 signal?.throwIfAborted();
 await launch(config);
 for(let i=0;i<40;i++){
  signal?.throwIfAborted();
  if(await probe()){await minimize(config,signal);return;}
  await wait(250);
 }
 throw Error('已尝试后台启动专用Chrome，但连接未就绪。请检查专用浏览器是否被其他进程占用；无需关闭日常浏览器。');
}
async function minimizeNewBrowser(config,signal){
 // Chrome may ignore --start-minimized on a fresh profile. Confirm via CDP
 // before starting page work; an already-running browser never reaches here.
 const browser=new BackgroundBrowser(config.port??9222);
 try{
  for(let i=0;i<40;i++){
   signal?.throwIfAborted();
   const {targetInfos}=await browser.send('Target.getTargets',{},signal);
   const targets=targetInfos.filter(t=>t.type==='page');
   if(targets.length){
    const windows=new Set();
    for(const target of targets){
     const {windowId}=await browser.send('Browser.getWindowForTarget',{targetId:target.targetId},signal);
     if(!windows.has(windowId)){await browser.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}},signal);windows.add(windowId);}
    }
    return;
   }
   await new Promise(ok=>setTimeout(ok,100));
  }
  throw Error('专用 Chrome 已启动，但未创建小红书首页，请重试');
 }finally{browser.close()}
}
export function launchChrome(config,{spawnProcess=spawn,platform=process.platform}={}){
 if(platform!=='win32')throw Error('自动启动目前仅支持Windows，请手动打开专用Chrome');
 const exe=[config.chromePath,process.env.CHROME_PATH,join(process.env.ProgramFiles??'C:/Program Files','Google/Chrome/Application/chrome.exe'),join(process.env['ProgramFiles(x86)']??'C:/Program Files (x86)','Google/Chrome/Application/chrome.exe'),join(homedir(),'AppData/Local/Google/Chrome/Application/chrome.exe')].find(p=>p&&existsSync(p));
 if(!exe)throw Error('未找到Chrome，请先安装Google Chrome，或配置chromePath');
 const profile=resolve(config.userDataDir??join(homedir(),'.dsh-assistant-browser/xhs'));
 if(profile.toLowerCase().includes('google\\chrome\\user data'))throw Error('请使用小红书专用浏览器目录，不能自动启动日常Chrome个人资料');
 mkdirSync(profile,{recursive:true});
 return new Promise((ok,fail)=>{
  // The startup tab remains visible when task tabs run in the background.
  // Give it a useful destination even if a later task fails or is cancelled.
  const child=spawnProcess(exe,[`--remote-debugging-port=${config.port??9222}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--start-minimized','https://www.xiaohongshu.com/explore'],{windowsHide:true,detached:true,stdio:'ignore'});
  child.once('error',fail);child.once('spawn',()=>{child.unref();ok()});
 });
}
