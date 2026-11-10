import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const action=process.argv[2]??'state';
const get=new Set(['contract','state','catalog','pending','schema','dependencies']);
const post=new Set(['delivery/settings','delivery/select','delivery/receipt','libraries/connect','libraries/disconnect','settings','annotate','annotate-pending','collect','browser']);
if(!get.has(action)&&!post.has(action))throw Error('不支持的动作');
const access=JSON.parse(readFileSync(join(process.env.MEME_STUDIO_DATA??join(homedir(),'.meme-studio'),'panel-access.json'),'utf8'));
const u=new URL(access.origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)throw Error('控制台地址无效');
let data;if(post.has(action)){let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>100000)throw Error('输入过长')}data=JSON.parse(raw||'{}')}
const r=await fetch(new URL('/api/'+action,u),{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+access.token,...data===undefined?{}:{'Content-Type':'application/json'}},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(120000)});
const result=await r.json();if(!r.ok){console.error(JSON.stringify(result));process.exitCode=1}else console.log(JSON.stringify(result));
