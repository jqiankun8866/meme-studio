import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configuredVision} from '../src/vision-adapter.mjs';
const setup=t=>{const dir=mkdtempSync(join(tmpdir(),'vision-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir};
test('visual adapter sends actual image and parses structured output',async t=>{
 const dir=setup(t);assert.equal(configuredVision(dir),undefined);
 writeFileSync(join(dir,'vision.json'),JSON.stringify({endpoint:'https://example.invalid/v1/chat/completions',model:'vision-test',apiKeyEnv:'TEST_KEY'}));
 const analyze=configuredVision(dir,{env:{TEST_KEY:'fixture-secret'},fetchImpl:async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-secret');
  const body=JSON.parse(options.body);assert.equal(body.model,'vision-test');
  assert.match(body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
  return new Response(JSON.stringify({choices:[{message:{content:'```json\n{"usable":false,"confidence":0.8,"meaning":"图片不清楚"}\n```'}}]}));
 }});
 const result=await analyze({data:Buffer.from([137,80,78,71,13,10,26,10,0]),signal:new AbortController().signal});assert.equal(result.usable,false);
});
test('auth errors are redacted and invalid remote plaintext endpoints rejected',async t=>{
 const dir=setup(t),file=join(dir,'vision.json');
 writeFileSync(file,JSON.stringify({endpoint:'http://remote.invalid/chat',model:'test',apiKey:'secret'}));
 assert.throws(()=>configuredVision(dir),/HTTPS/);
 writeFileSync(file,JSON.stringify({endpoint:'https://remote.invalid/chat',model:'test',apiKey:'secret'}));
 const analyze=configuredVision(dir,{fetchImpl:async()=>new Response('private server response',{status:401})});
 await assert.rejects(analyze({data:Buffer.from([137,80,78,71,13,10,26,10,0]),signal:new AbortController().signal}),e=>e.code==='AUTH_ERROR'&&!e.message.includes('private'));
});
