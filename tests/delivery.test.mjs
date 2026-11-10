import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Studio} from '../src/studio.mjs';
import {createPanel} from '../src/server.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const base={usable:true,confidence:.9,text:'收到',meaning:'答应处理任务',when:'确认收到',intents:['回应'],emotions:['平静'],styles:['可爱'],scenes:['工作'],intensity:1,target:'对方',avoid:[],keywords:[]};
const ctx=(turn='1',extra={})=>({session:'test:user',turn,intents:['回应'],scenes:['工作'],target:'对方',...extra});
async function setup(t){const dir=mkdtempSync(join(tmpdir(),'meme-delivery-'));const s=new Studio({dataDir:dir});t.after(async()=>{await s.close();rmSync(dir,{recursive:true,force:true})});return s}
async function add(s,name,patch={}){const r=await s.importImage({base64:Buffer.concat([png,Buffer.from(name)]).toString('base64')});s.annotate(r.id,{...base,...patch});return r.id}
test('ten conversation intents use semantic candidates; no source preference',async t=>{
 const s=await setup(t);
 const scenarios=[['谢谢','回应'],['辛苦了','感谢'],['累了','安慰'],['完成了','庆祝'],['好厉害','赞赏'],['发呆','共鸣'],['少花token（笑）','调侃'],['晚安','告别'],['早上好','问候'],['整理计划','鼓励']];
 for(const [name,intent] of scenarios)await add(s,name,{intents:[intent],meaning:name});
 for(const [name,intent] of scenarios){const r=s.delivery.select(ctx(name,{intents:[intent],playful:intent==='调侃'}));assert.equal(r.action,'review');assert.ok(r.candidates[0].semantic.intents.includes(intent),name);assert.ok(r.candidates.length<=6)}
 assert.equal(s.delivery.settings().frequency,'every');
});
test('receipts are idempotent, sessions isolated, repeat penalty applies only to success',async t=>{
 const s=await setup(t);await add(s,'one');await add(s,'two');const r=s.delivery.select(ctx()),id=r.candidates[0].id;
 assert.equal(s.delivery.select(ctx()).deliveryId,r.deliveryId);
 assert.throws(()=>s.delivery.receipt({...ctx(),deliveryId:r.deliveryId,imageId:id,status:'sent'}),/消息编号/);
 s.delivery.receipt({...ctx(),deliveryId:r.deliveryId,imageId:id,status:'sent',messageId:'msg1'});
 assert.equal(s.delivery.select(ctx()).reason,'already-sent');assert.notEqual(s.delivery.select(ctx('2')).candidates[0].id,id);
 assert.equal(s.delivery.select(ctx('1',{session:'another:user'})).action,'review');
 assert.equal(s.delivery.receipt({...ctx(),deliveryId:r.deliveryId,status:'failed'}).status,'sent');
});
test('soft recall allows related and abstract without exact tags, respects hard exclusions',async t=>{
 const s=await setup(t);await add(s,'abstract',{intents:['装傻'],styles:['抽象'],meaning:'装傻卖萌',target:'无明确对象'});
 assert.equal(s.delivery.select(ctx('a',{intents:['邀请'],playful:true})).candidates[0].match,'creative');
 assert.equal(s.delivery.select(ctx('b',{intents:['邀请'],playful:false})).reason,'no-suitable-image');
 assert.equal(s.delivery.select(ctx('c',{intents:['装傻'],playful:true,avoid:['真实痛苦']})).reason,'no-suitable-image');
 await add(s,'comfort',{intents:['鼓励'],styles:['温柔'],meaning:'加油'});
 assert.equal(s.delivery.select(ctx('d',{intents:['安慰']})).candidates[0].match,'related');
});
test('deleted, unreviewed, conflicting target and avoided context do not leak into selection',async t=>{
 const s=await setup(t);const id=await add(s,'deleted');unlinkSync(s.memeCandidates().find(i=>i.sha256===id).path);
 await add(s,'wrong target',{target:'自己'});await add(s,'avoid',{avoid:['正式事务']});await add(s,'pending',{confidence:.6});
 assert.equal(s.delivery.select(ctx('a',{avoid:['正式事务']})).reason,'no-suitable-image');
});
test('frequency controls, persistence, image-only, unknown and bounded retries',async t=>{
 const s=await setup(t);await add(s,'one');s.delivery.configure({frequency:'requested'});
 assert.equal(s.delivery.select(ctx()).reason,'request-only');s.delivery.configure({frequency:'natural'});
 assert.equal(s.delivery.select(ctx()).reason,'not-needed');const r=s.delivery.select(ctx('m',{memeOnly:true}));assert.equal(r.textMode,'image-only');
 s.delivery.receipt({...ctx('m'),deliveryId:r.deliveryId,status:'unknown'});assert.equal(s.delivery.select(ctx('m')).reason,'delivery-unknown');
 s.delivery.configure({frequency:'every'});for(let n=0;n<2;n++){const f=s.delivery.select(ctx('fail'));s.delivery.receipt({...ctx('fail'),deliveryId:f.deliveryId,status:'failed'})}
 assert.equal(s.delivery.select(ctx('fail')).reason,'retry-limit');s.delivery.configure({enabled:false});assert.equal(s.delivery.select(ctx('off')).reason,'disabled');
 const reopened=new Studio({dataDir:s.dataDir});assert.equal(reopened.delivery.settings().enabled,false);await reopened.close();
 assert.throws(()=>s.delivery.configure({frequency:'always'}));assert.throws(()=>s.delivery.select(ctx('bad',{intents:['不存在']})));
});
test('HTTP delivery settings/select/receipt roundtrip with mock host success',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'delivery-http-'));const p=await createPanel({dataDir:dir,port:0});t.after(async()=>{await p.close();rmSync(dir,{recursive:true,force:true})});await add(p.studio,'http');
 const html=await (await fetch(p.origin+'/')).text();assert.ok(html.includes('<option value="抽象">抽象</option>'));assert.ok(html.includes('<option value="温柔">温柔</option>'));
 const contract=await (await fetch(p.origin+'/api/contract',{headers:{Authorization:'Bearer '+p.token}})).json();assert.equal(contract.channelIndependent,true);assert.ok(contract.acceptance.includes('不调用发送工具'));assert.ok(contract.rules.includes('意图'));
 const post=async(path,data)=>{const r=await fetch(p.origin+'/api/delivery/'+path,{method:'POST',headers:{Authorization:'Bearer '+p.token,'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json()};
 await post('settings',{frequency:'every',style:'温柔'});const r=await post('select',ctx());assert.equal(r.action,'review');
 const image=await fetch(p.origin+'/api/image/'+r.candidates[0].id,{headers:{Authorization:'Bearer '+p.token}});assert.equal(image.status,200);
 const receipt=await post('receipt',{...ctx(),deliveryId:r.deliveryId,imageId:r.candidates[0].id,status:'sent',messageId:'mock-host-message'});assert.equal(receipt.status,'sent');
 assert.equal((await post('select',ctx())).reason,'already-sent');
});
