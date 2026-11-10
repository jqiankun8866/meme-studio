// Derived retrieval labels: keep visual facts intact; do not re-annotate the library.
export const intentFamilies=Object.freeze({
 '轻松接梗':['调侃','自嘲','装傻','撒娇','求饶','吐槽'],
 '慵懒陪伴':['摆烂','表达状态','等待'],
 '友好接话':['回应','认同','共鸣'],
 '支持打气':['鼓励','安慰','赞赏','祝福'],
 '开心庆祝':['庆祝','赞赏','惊叹'],
 '好奇围观':['疑惑','围观','惊叹'],
 '亲近惦记':['亲昵','惦记','撒娇'],
});
export function familiesFor(intents){return Object.entries(intentFamilies).filter(([,group])=>intents.some(i=>group.includes(i))).map(([name])=>name)}
export function relatedIntents(intent){return new Set(Object.values(intentFamilies).filter(group=>group.includes(intent)).flat())}
export function creativeCandidate(semantic){
 return semantic.styles.some(s=>['抽象','搞怪','沙雕'].includes(s))||/反差|谐音|抽象|借喻|反话|恶搞/.test(semantic.meaning+' '+semantic.when);
}
