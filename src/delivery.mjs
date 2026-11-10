import {randomUUID} from 'node:crypto';
import {vocabulary} from './assistant/meme-semantics.mjs';

const defaults={enabled:true,frequency:'every',style:'跟随聊天',avoidRepeat:true};
const groups=[['回应','认同','感谢'],['安慰','共鸣','鼓励','惦记'],['庆祝','赞赏','祝福','惊叹'],['调侃','吐槽','自嘲','摆烂','装傻'],['问候','告别','祝福'],['疑惑','惊叹','围观']];
const intersects=(a,b)=>a.some(x=>b.includes(x));
const check=(v,m)=>{if(!v)throw Error(m)};
const key=v=>typeof v==='string'&&v.length>0&&v.length<=160;
export class Delivery{
 constructor(studio){this.s=studio;this.db=studio.db;this.db.exec(`CREATE TABLE IF NOT EXISTS studio_deliveries(session TEXT NOT NULL,turn TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(session,turn));`)}
 settings(){return {...defaults,...this.s.setting('delivery',{})}}
 configure(p){
  check(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>k in defaults),'未知发送设置');
  const v={...this.settings(),...p};
  check(typeof v.enabled==='boolean'&&typeof v.avoidRepeat==='boolean'&&['every','natural','requested'].includes(v.frequency)&&['跟随聊天',...vocabulary.styles].includes(v.style),'发送设置无效');
  this.s.saveSetting('delivery',v);return v;
 }
 row(session,turn){const r=this.db.prepare('SELECT data FROM studio_deliveries WHERE session=? AND turn=?').get(session,turn);return r?JSON.parse(r.data):null}
 save(session,turn,v){this.db.prepare('INSERT OR REPLACE INTO studio_deliveries VALUES(?,?,?,?)').run(session,turn,JSON.stringify(v),this.s.now());this.db.prepare('DELETE FROM studio_deliveries WHERE updated < ?').run(this.s.now()-30*86400000)}
 select(c){
  check(c&&key(c.session)&&key(c.turn),'需要稳定的会话和轮次编号');
  for(const k of ['intents','emotions','styles','scenes','avoid'])check(Array.isArray(c[k]??[])&&(c[k]??[]).length<=8&&(c[k]??[]).every(x=>vocabulary[k].includes(x)),k+' 标签无效');
  check((c.intents??[]).length>0,'需要发送者想表达的意图');
  for(const k of ['requested','memeOnly','playful','natural'])if(c[k]!==undefined)check(typeof c[k]==='boolean',k+' 必须为布尔值');
  check(c.target===undefined||vocabulary.targets.includes(c.target),'表达对象无效');
  check(c.intensity===undefined||[1,2,3].includes(c.intensity),'表达强度无效');
  const p=this.settings(),old=this.row(c.session,c.turn);
  if(old?.status==='sent'||old?.status==='unknown')return {action:'skip',reason:old.status==='sent'?'already-sent':'delivery-unknown',deliveryId:old.deliveryId};
  if(old?.status==='skipped')return {action:'skip',reason:'host-skipped'};
  if(old?.status==='failed'&&old.attempts>=2)return {action:'skip',reason:'retry-limit'};
  if(!p.enabled)return {action:'skip',reason:'disabled'};
  if(p.frequency==='requested'&&!c.requested)return {action:'skip',reason:'request-only'};
  if(p.frequency==='natural'&&!c.requested&&!c.memeOnly&&!c.natural)return {action:'skip',reason:'not-needed'};
  const history=this.db.prepare('SELECT data FROM studio_deliveries WHERE session=? ORDER BY updated DESC LIMIT 20').all(c.session).map(r=>JSON.parse(r.data)).filter(r=>r.status==='sent');
  const recent=history.map(r=>r.imageId),flags=c.avoid??[],styles=p.style==='跟随聊天'?(c.styles??[]):[p.style];
  const serious=flags.some(x=>['真实痛苦','严肃健康','正式事务','冲突'].includes(x));
  const ranked=this.s.memeSemantics.catalog('studio:local').flatMap(i=>{
   const m=i.semantic;if(m?.status!=='ready'||!m.usable||intersects(m.avoid,flags))return [];
   if(serious&&intersects(m.styles,['阴阳怪气','毒舌','搞怪','抽象','沙雕']))return [];
   if(c.target&&m.target!==c.target&&m.target!=='无明确对象')return [];
   const exact=intersects(m.intents,c.intents),related=groups.some(g=>intersects(g,m.intents)&&intersects(g,c.intents));
   const creative=c.playful&&!serious&&intersects(m.styles,['抽象','搞怪','沙雕','俏皮'])&&!intersects(m.intents,['反对','拒绝','否认','警告','敷衍']);
   const universal=intersects(m.intents,['共鸣','安慰','鼓励','回应'])&&intersects(m.styles,['温柔','可爱','克制']);
   if(!exact&&!related&&!creative&&!universal)return [];
   const match=exact?'exact':related?'related':creative?'creative':'gentle';
   const score=(exact?60:related?40:creative?25:15)+ (intersects(m.emotions,c.emotions??[])?12:0)+(intersects(m.styles,styles)?8:0)+(intersects(m.scenes,c.scenes??[])?6:0)-Math.abs(m.intensity-(c.intensity??1))*4-(p.avoidRepeat&&recent.includes(i.sha256)?Math.max(5,35-recent.indexOf(i.sha256)*3):0);
   return [{id:i.sha256,path:i.path,match,score,semantic:m}];
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,6);
  if(!ranked.length)return {action:'skip',reason:'no-suitable-image',needsAnnotation:this.s.pending().length>0};
  // The host must check concrete text/meaning before choosing; tags only recall candidates.
  if(old?.status==='pending'&&old.expires>this.s.now())return {action:'review',deliveryId:old.deliveryId,candidates:ranked.filter(i=>old.ids.includes(i.id)),textMode:c.memeOnly?'image-only':'text-then-image'};
  const deliveryId=randomUUID();this.save(c.session,c.turn,{deliveryId,status:'pending',attempts:(old?.attempts??0)+1,ids:ranked.map(i=>i.id),expires:this.s.now()+10*60000});
  return {action:'review',deliveryId,candidates:ranked,textMode:c.memeOnly?'image-only':'text-then-image'};
 }
 receipt(r){
  check(r&&key(r.session)&&key(r.turn),'需要会话和轮次编号');
  const old=this.row(r.session,r.turn);check(old&&old.deliveryId===r.deliveryId,'选图记录不存在或已失效');
  check(['sent','failed','unknown','skipped'].includes(r.status),'发送状态无效');
  if(old.status==='sent'||old.status==='unknown')return {recorded:true,status:old.status,duplicate:true};
  check(old.expires>this.s.now(),'选图已过期，请重新选择');
  if(r.status==='sent'){check(old.ids.includes(r.imageId),'图片不在候选中');check(key(r.messageId),'成功回执需要宿主消息编号');}
  const v={...old,status:r.status,imageId:r.imageId??null,messageId:r.messageId??null};this.save(r.session,r.turn,v);return {recorded:true,status:v.status};
 }
}
