// Only direct settings utterances qualify; quoted/negated examples are not commands.
export function parseMemePreference(text){
 if(typeof text!=='string')return null;
 let s=text.trim().replace(/[。！!，,～~]+$/g,'');
 if(s.length>48||/[“”"「」『』：:]/.test(s))return null;
 let scope='persistent';
 const temporary=/^(这次|本次|这一轮|这条消息|这条回复|暂时)[，,\s]*/;
 if(temporary.test(s)){scope='turn';s=s.replace(temporary,'')}
 else s=s.replace(/^(以后|今后|接下来都|一直)[，,\s]*/,'');
 s=s.replace(/^(请|麻烦你|你可以|你能不能)[，,\s]*/,'');
 if(/^(别|不要|不用|停止|不许|不)(再)?(发|发表情|发点|发送|用|使用)?(表情包|表情|配图)(了|啦|哦|吧)?$/.test(s)||/^(纯文字|只发文字|关闭主动配图)$/.test(s))return {meme:'off',scope};
 if(/^(少发(点|一些)?表情包|表情包少(一)?点|少发表情包|低频表情|表情低频)$/.test(s))return {meme:'low',scope};
 if(/^(多发(点|一些)?表情包|表情包多(一)?点|多发表情包|高频表情|表情高频|(可以|恢复|允许)(发|使用)?(表情包|表情|配图))$/.test(s))return {meme:'high',scope};
 return null;
}
