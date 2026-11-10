import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,unlinkSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Studio} from '../src/studio.mjs';
import {createPanel} from '../src/server.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const meaning={usable:true,confidence:.9,text:'',meaning:'一起开心',when:'分享开心',intents:['共鸣'],emotions:['开心'],styles:['可爱'],scenes:['日常闲聊'],intensity:1,target:'共同处境',avoid:[],keywords:[]};
const setup=t=>{const dir=mkdtempSync(join(tmpdir(),'meme-studio-'));const studio=new Studio({dataDir:dir});t.after(async()=>{await studio.close();rmSync(dir,{recursive:true,force:true})});return studio};
test('removed images are excluded and never restored on reopening',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'meme-delete-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let s=new Studio({dataDir:dir});const saved=await s.importImage({base64:png.toString('base64'),title:'fixture'});const i=s.memeCandidates()[0];unlinkSync(i.path);assert.equal(s.status().inventory.total,0);assert.throws(()=>s.image(saved.id));await s.close();s=new Studio({dataDir:dir});assert.equal(s.status().inventory.total,0);await s.close();
});
test('import deduplicates, validates bytes, annotation gates eligibility',async t=>{
 const s=setup(t);const bytes=Buffer.concat([png,Buffer.from('test-extra')]);const b64=bytes.toString('base64');const first=await s.importImage({base64:b64,title:'测试图'});assert.equal(first.saved,true);assert.equal((await s.importImage({base64:b64,title:'重复'})).duplicate,true);assert.equal(s.status().inventory.pending,1);await assert.rejects(s.importImage({base64:Buffer.from('not image').toString('base64')}));
 const m={usable:true,confidence:.9,text:'',meaning:'一起开心',when:'分享开心',intents:['共鸣'],emotions:['开心'],styles:['可爱'],scenes:['日常闲聊'],intensity:1,target:'共同处境',avoid:[],keywords:[]};s.annotate(first.id,m);assert.equal(s.catalog().find(x=>x.sha256===first.id).semantic.status,'ready');
});
test('collector schedule invokes adapter and cancellation stops future runs',async t=>{
 const s=setup(t);let calls=0;const now=Date.now();s.collector.now=()=>now;s.xhs.config={ownerPeer:'studio:local'};s.xhs.browser={perform:async()=>{calls++;return {notes:[]}},close(){}};
 s.collector.save('studio:local',{enabled:true,intervalHours:84,nextDue:now-1,revision:1});await s.collector.tick();assert.equal(calls,1);await s.collector.tick();assert.equal(calls,1);await s.settings({enabled:false});await s.collector.tick();assert.equal(calls,1);assert.equal(s.status().collection.enabled,false);
});
test('collector writes images, deduplicates, and leaves new images pending semantic review',async t=>{
 const s=setup(t);const now=s.now(),bytes=Buffer.concat([png,Buffer.from('collector-fixture')]);
 s.xhs.config={ownerPeer:'studio:local'};s.xhs.browser={perform:async(_p,action)=>action==='search'?{notes:[{url:'https://www.xiaohongshu.com/explore/example',likes:100}]}:{title:'测试表情',url:'https://www.xiaohongshu.com/explore/example',media:'image-or-text',publishedAt:now-1000,images:['https://sns-webpic-qc.xhscdn.com/test']},close(){}};
 s.collector.download=async()=>bytes;s.collector.ocr=async()=>({text:'谢谢',width:200,height:200,bytes});
 const a=await s.collect();assert.equal(a.added,1);assert.equal(s.status().inventory.pending,1);assert.equal(s.catalog().filter(i=>i.origin==='小红书采集').length,1);assert.equal(s.catalog()[0].title,'谢谢');assert.equal(s.catalog()[0].source,'https://www.xiaohongshu.com/explore/example');
 const b=await s.collect();assert.equal(b.added,0);assert.equal(b.duplicates,1);
});
test('HTTP auth, cross-origin rejection, persistence, and fixed static routes',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'meme-http-'));const panel=await createPanel({dataDir:dir,port:0});t.after(async()=>{await panel.close();rmSync(dir,{recursive:true,force:true})});
 assert.equal((await fetch(panel.origin+'/')).status,200);assert.equal((await fetch(panel.origin+'/api/state')).status,401);
 const headers={Authorization:'Bearer '+panel.token,'Content-Type':'application/json'};
 assert.equal((await fetch(panel.origin+'/api/settings',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status,403);
 const r=await fetch(panel.origin+'/api/settings',{method:'POST',headers,body:JSON.stringify({enabled:false,intervalHours:12})});assert.equal(r.status,200);assert.equal((await r.json()).collection.intervalHours,12);
 for(const endpoint of ['propose','receipt','test'])assert.equal((await fetch(panel.origin+'/api/'+endpoint,{method:'POST',headers,body:'{}'})).status,404);
 assert.equal((await fetch(panel.origin+'/api/image/../../private',{headers})).status,404);
 assert.equal((await fetch(panel.origin+'/api/image/'+'0'.repeat(64),{headers})).status,400);
});

test('fresh library and automatic annotation queue',async t=>{
 const s=setup(t);assert.equal(s.catalog().length,0);assert.equal(s.pending().length,0);
 const bytes=Buffer.concat([png,Buffer.from('auto-annotation')]);
 const item=await s.importImage({base64:bytes.toString('base64'),title:'新表情'});assert.equal(s.pending().length,1);
 await assert.rejects(s.annotatePending(),/尚未连接/);
 let calls=0;s.memeSemantics.analyze=async({data})=>{calls++;assert.deepEqual(data,bytes);return meaning};
 await s.annotatePending();assert.equal(calls,1);assert.equal(s.pending().length,0);
 assert.equal(s.catalog().find(i=>i.sha256===item.id).semantic.status,'ready');
 await s.annotatePending();assert.equal(calls,1);await assert.rejects(s.settings({frequency:'high'}),/未知设置/);
});

test('existing folders load without copying and survive restart; disconnect preserves files',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'existing-library-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=join(dir,'existing'),nested=join(source,'sub');mkdirSync(nested,{recursive:true});
 const picture=join(nested,'中文表情.png');writeFileSync(picture,png);writeFileSync(join(source,'duplicate.png'),png);writeFileSync(join(source,'fake.jpg'),'not image');
 let s=new Studio({dataDir:join(dir,'data')});assert.equal(s.catalog().length,0);
 s.connectLibrary({path:source});assert.equal(s.catalog().length,1);assert.equal(s.catalog()[0].origin,'已有图库');assert.ok(s.pending()[0].path.startsWith(source));
 s.annotate(s.catalog()[0].sha256,meaning);await s.close();
 s=new Studio({dataDir:join(dir,'data')});assert.equal(s.catalog().length,1);assert.equal(s.status().inventory.ready,1);
 s.disconnectLibrary({path:source});assert.equal(s.catalog().length,0);assert.deepEqual(readFileSync(picture),png);await s.close();
});

test('invalid schedule values rejected and enable disable persists',async t=>{
 const s=setup(t);s.xhs.config={ownerPeer:'studio:local'};s.xhs.browser={close(){}};
 for(const v of [0,721,1.5,'84'])await assert.rejects(s.settings({enabled:true,intervalHours:v}));
 await s.settings({enabled:true,intervalHours:1});assert.ok(s.status().collection.nextDue>s.now());
 await s.settings({enabled:false});assert.equal(s.status().collection.nextDue,null);
 assert.throws(()=>s.connectLibrary({path:'relative'}));
});
test('annotation batches capped, low confidence pending, quota pauses retries',async t=>{
 const s=setup(t);for(let n=0;n<5;n++)await s.importImage({base64:Buffer.concat([png,Buffer.from(String(n))]).toString('base64'),title:'fixture'});
 let calls=0;s.memeSemantics.analyze=async()=>{calls++;return {...meaning,confidence:.6}};
 await s.annotatePending();assert.equal(calls,3);assert.equal(s.status().inventory.pending,5);
 s.memeSemantics.analyze=async()=>{calls++;throw Object.assign(new Error('quota fixture'),{code:'ACCOUNT_QUOTA'})};
 await s.annotatePending();assert.equal(calls,4);assert.ok(s.status().vision.worker.blockedUntil>s.now());
 await s.annotatePending();assert.equal(calls,4);
});

test('prompt applies to manual and scheduled collection and survives reopening',async t=>{
 const s=setup(t);await s.settings({prompt:' 奶龙 '});assert.equal(s.status().collection.prompt,'奶龙');
 const queries=[];s.xhs.config={ownerPeer:'studio:local'};s.xhs.browser={perform:async(_p,_a,d)=>{queries.push(d.query);return {notes:[]}},close(){}};
 const manual=await s.collect();assert.equal(manual.query,'奶龙 表情包');
 const stored=s.collector.settings('studio:local');s.collector.save('studio:local',{...stored,enabled:true,nextDue:s.now()-1});await s.collector.tick();assert.deepEqual(queries,['奶龙 表情包','奶龙 表情包']);
 await s.settings({enabled:false,prompt:''});await s.collect();assert.equal(queries.at(-1),'表情包');
 await s.settings({prompt:'猫咪表情包'});await s.collect();assert.equal(queries.at(-1),'猫咪表情包');
 await assert.rejects(s.settings({prompt:'x'.repeat(101)}));await assert.rejects(s.settings({prompt:42}));
 const dir=s.dataDir;const second=new Studio({dataDir:dir});assert.equal(second.status().collection.prompt,'猫咪表情包');await second.close();
});
