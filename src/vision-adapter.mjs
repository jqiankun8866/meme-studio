import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {annotationPrompt} from './assistant/meme-semantics.mjs';
import {imageExt} from './assistant/received-memes.mjs';

// Explicit local configuration only; never read another app's credentials.
export function configuredVision(dataDir,{fetchImpl=fetch,env=process.env}={}){
 const file=join(dataDir,'vision.json');
 if(!existsSync(file))return undefined;
 const config=JSON.parse(readFileSync(file,'utf8'));
 const url=new URL(config.endpoint);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('视觉模型地址需要 HTTPS 或本机 HTTP');
 if(url.username||url.password)throw Error('模型地址不能包含凭证');
 if(typeof config.model!=='string'||!config.model.trim())throw Error('vision.json 缺少 model');
 const key=config.apiKeyEnv?env[config.apiKeyEnv]:config.apiKey;
 if(typeof key!=='string'||!key)throw Error('视觉模型密钥未配置');
 return async({data,signal})=>{
  const mime={'.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[imageExt(data)];
  let response;
  try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),body:JSON.stringify({model:config.model,max_tokens:900,messages:[{role:'system',content:annotationPrompt},{role:'user',content:[{type:'text',text:'观察这张表情包，按约定输出 JSON 标注。'},{type:'image_url',image_url:{url:`data:${mime};base64,${data.toString('base64')}`}}]}]})})}
  catch(e){if(signal.aborted)throw e;throw Object.assign(new Error('视觉服务连接失败'),{code:'VISION_UNAVAILABLE'})}
  if(!response.ok){const code=response.status===429?'RATE_LIMIT':response.status===401||response.status===403?'AUTH_ERROR':response.status===402?'ACCOUNT_QUOTA':'MODEL_UNAVAILABLE';throw Object.assign(new Error('视觉服务请求失败：HTTP '+response.status),{code})}
  const result=await response.json();const content=result.choices?.[0]?.message?.content;
  if(typeof content!=='string')throw Error('视觉服务未返回文本标注');
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 };
}
