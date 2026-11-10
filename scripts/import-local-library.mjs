// Run only while the studio is stopped. Import existing local files, never publish them.
import {parseArgs} from 'node:util';
import {homedir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,realpathSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Studio} from '../src/studio.mjs';
import {listCharacterMemes,listMemes} from '../src/assistant/meme-library.mjs';
const {values}=parseArgs({options:{character:{type:'string'},sent:{type:'string'},meanings:{type:'string'},data:{type:'string'}}});
if(!values.character&&!values.sent)throw Error('需要 --character 本地大肥鱼包目录 或 --sent 用户图库目录');
const data=resolve(values.data??join(homedir(),'.meme-studio'));
if(existsSync(join(data,'panel.lock'))){const pid=Number(readFileSync(join(data,'panel.lock'),'utf8'));let alive=true;try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')alive=false}if(alive)throw Error('请先停止独立控制台再导入，不能覆盖运行中数据')}
let characterCount=0,sentCount=0,annotations=0;
if(values.character){
 const source=realpathSync(values.character),metadata=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'));
 if(metadata.id!=='dafeiyu-001')throw Error('不是dafeiyu-001图库');
 const dest=join(data,'memes','dafeiyu-001');mkdirSync(dest,{recursive:true});
 const items=listCharacterMemes(source).map(i=>{const ext=i.path.split('.').at(-1).toLowerCase();const file=i.sha256+'.'+ext;copyFileSync(i.path,join(dest,file));return {id:i.sha256,file,sha256:i.sha256,title:i.title,tags:i.tags,origin:'character',source:'https://github.com/yyh-001/dsh-meme',sourceVersion:metadata.version,sourceFile:i.file,license:metadata.license??'unknown'}});
 writeFileSync(join(dest,'manifest.json'),JSON.stringify({id:metadata.id,name:metadata.name,license:metadata.license,source:'https://github.com/yyh-001/dsh-meme',items},null,2));characterCount=items.length;
 writeFileSync(join(dest,'ATTRIBUTION.md'),'来源：https://github.com/yyh-001/dsh-meme\n图库：dafeiyu-001 '+metadata.version+'\n原清单许可：'+metadata.license+'。仅从使用者已有本机图库复制，未确认公开再分发授权；不包含于项目发布包。\n');
}
const studio=new Studio({dataDir:data});
try{
 if(values.sent){
  for(const item of listMemes(resolve(values.sent))){const b=readFileSync(item.path);await studio.importImage({base64:b.toString('base64'),title:item.title??'用户发送的表情',tags:item.tags.slice(0,10)});sentCount++}
 }
 if(values.meanings){
  const db=new DatabaseSync(resolve(values.meanings),{readOnly:true});
  try{if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meme_meanings'").get())for(const item of studio.memeCandidates()){
   const row=db.prepare('SELECT data FROM meme_meanings WHERE hash=?').get(item.sha256);if(!row)continue;
   const m=JSON.parse(row.data);if(m.status!=='ready')continue;
   try{studio.annotate(item.sha256,m);annotations++}catch{}
  }}finally{db.close()}
 }
 console.log(JSON.stringify({character:characterCount,userSent:sentCount,annotations,inventory:studio.status().inventory}));
}finally{await studio.close()}
