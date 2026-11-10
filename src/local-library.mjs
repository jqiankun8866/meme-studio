import {readdirSync,readFileSync,statSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {imageExt} from './assistant/received-memes.mjs';

export class LocalLibrary {
 constructor(){this.cache=new Map()}
 scan(directory,{limit=5000}={}){
  const root=realpathSync(resolve(directory));
  if(!statSync(root).isDirectory())throw Error('请选择图库文件夹');
  const items=[],errors=[];let visited=0,limited=false;
  const walk=folder=>{
   for(const entry of readdirSync(folder,{withFileTypes:true})){
    if(++visited>20000||items.length>=limit){limited=true;return}
    const path=join(folder,entry.name);
    try{
     if(entry.isSymbolicLink()||lstatSync(path).isSymbolicLink())continue;
     const actual=realpathSync(path),rel=relative(root,actual);
     if(rel.startsWith('..')||isAbsolute(rel))continue;
     if(entry.isDirectory()){walk(actual);if(limited)return;continue}
     if(!entry.isFile()||!/^\.(png|jpe?g|gif|webp)$/i.test(extname(path)))continue;
     const stat=statSync(actual);if(stat.size>8*1024*1024||stat.size<9)continue;
     const key=stat.size+':'+stat.mtimeMs;let item=this.cache.get(actual);
     if(item?.key!==key){const data=readFileSync(actual);imageExt(data);const sha256=createHash('sha256').update(data).digest('hex');item={key,id:sha256,sha256,path:actual,title:entry.name,tags:[],source:'本机已有图库'};this.cache.set(actual,item)}
     const {key:_,...value}=item;items.push(value);
    }catch{errors.push(relative(root,path))}
   }
  };walk(root);
  return {items,limited,errors};
 }
}
