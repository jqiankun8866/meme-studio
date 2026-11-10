import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,realpathSync,statSync,readdirSync,unlinkSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const bundled=fileURLToPath(new URL('../../assets/memes/basic/',import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const stateFile=workspace=>join(workspace,'.assistant','basic-meme-pack.json');
function readState(workspace){const file=stateFile(workspace);return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};}
function saveState(workspace,data){mkdirSync(join(workspace,'.assistant'),{recursive:true});writeFileSync(stateFile(workspace),JSON.stringify(data),{mode:0o600});}
export function disableBasicMemePack(workspace){saveState(workspace,{installed:true,disabled:true});}
export function ensureMemeLibrary(workspace,source=bundled){
 const root=join(workspace,'memes','assistant-basic-v1'),state=readState(workspace);
 if(state.disabled)return null;
 const incoming=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
 if(state.installed&&(!existsSync(join(root,'manifest.json'))||state.packVersion===incoming.version))return existsSync(join(root,'manifest.json'))?root:null;
 // Adopt an older installation without restoring files the user removed.
 if(existsSync(join(root,'manifest.json'))&&JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).version===incoming.version){saveState(workspace,{installed:true,disabled:false,packVersion:incoming.version});return root;}
 if(!existsSync(join(source,'manifest.json')))return null;
 const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
 const files=manifest.items.map(item=>{
  if(!/^[a-z0-9-]+\.png$/.test(item.file))throw Error('表情资源文件名无效');
  const bytes=readFileSync(join(source,item.file));if(digest(bytes)!==item.sha256)throw Error('表情资源校验失败');return item.file;
 });
 mkdirSync(root,{recursive:true});
 for(const [file,sha] of Object.entries(manifest.legacyFiles??{})){if(/^[a-z0-9-]+\.png$/.test(file)&&existsSync(join(root,file))&&digest(readFileSync(join(root,file)))===sha)unlinkSync(join(root,file));}
 for(const file of [...files,'manifest.json','ATTRIBUTION.md'])copyFileSync(join(source,file),join(root,file));
 saveState(workspace,{installed:true,disabled:false,packVersion:manifest.version});return root;
}
function safeImage(root,file,sha){
 const canonical=realpathSync(root),candidate=join(root,file);
 if(!existsSync(candidate))return null;
 const path=realpathSync(candidate),rel=relative(canonical,path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))return null;
 const info=statSync(path);if(!info.isFile()||info.size>8*1024*1024)return null;
 const bytes=readFileSync(path),hash=digest(bytes);if(sha&&hash!==sha)return null;
 return {path,sha256:hash};
}
export function listMemes(root){
 if(!root||!existsSync(join(root,'manifest.json')))return [];
 const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
 return (manifest.items??[]).flatMap(item=>{
  if(item.systemOnly||!/^[a-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/.test(item.file??'')||typeof item.sha256!=='string')return [];
  const verified=safeImage(root,item.file,item.sha256);if(!verified)return [];
  return [{...item,...verified,tags:Array.isArray(item.tags)?item.tags.filter(t=>typeof t==='string'):[],license:item.license??manifest.license}];
 });
}
// The user's existing character pack has category folders rather than an items manifest.
export function listCharacterMemes(root){
 const base=join(root,'memes');if(!existsSync(base))return [];
 const labels={like:['比心','喜欢','感谢'],happy:['开心','收到','好的'],sad:['难过'],sleep:['晚安'],angry:['生气'],surprise:['惊讶'],awkward:['尴尬'],thinking:['思考']};
 const items=[];
 for(const dir of readdirSync(base,{withFileTypes:true})){
  if(!dir.isDirectory()||dir.isSymbolicLink())continue;
  for(const f of readdirSync(join(base,dir.name),{withFileTypes:true})){
   if(!f.isFile()||!(/\.(png|jpe?g|gif|webp)$/i.test(f.name)))continue;
   const file=join('memes',dir.name,f.name),verified=safeImage(root,file);if(!verified)continue;
   items.push({...verified,id:'character-'+verified.sha256,file,title:f.name.replace(/\.[^.]+$/,''),tags:[...(labels[dir.name]??[]),'大肥鱼'],origin:'character',collectedAt:0});
  }
 }
 return items;
}
export function searchMemes(root,query){
 if(typeof query!=='string'||!query.trim()||query.length>100)throw Error('请提供1–100字的表情关键词');
 const q=query.trim().toLowerCase();
 const results=listMemes(root).map(item=>({...item,score:[item.title??'',...item.tags].reduce((score,t)=>Math.max(score,q===t.toLowerCase()?3:q.includes(t.toLowerCase())?2:t.toLowerCase().includes(q)?1:0),0)}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
 return {results,message:'选择贴合语境的一张，用 wechat_send_file 发送真实图片；搜索成功不代表已经发送。'};
}
