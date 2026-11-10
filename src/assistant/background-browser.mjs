/** Narrow CDP transport for XHS. Never activates a tab or brings a window forward. */
export class BackgroundBrowser {
  constructor(port=9222){this.port=port;this.sequence=0;this.pending=new Map();this.target=null;this.session=null;}
  async connect(signal){
    if(this.socket?.readyState===1)return;
    const response=await fetch(`http://127.0.0.1:${this.port}/json/version`,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(3000)]):AbortSignal.timeout(3000)});
    const {webSocketDebuggerUrl}=await response.json();const url=new URL(webSocketDebuggerUrl);
    if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||Number(url.port)!==this.port)throw Error('浏览器调试地址无效');
    const socket=new WebSocket(url);this.socket=socket;
    socket.addEventListener('message',event=>{const data=JSON.parse(event.data);const request=this.pending.get(data.id);if(!request)return;data.error?request.reject(Error(data.error.message)):request.resolve(data.result);});
    socket.addEventListener('close',()=>{for(const request of [...this.pending.values()])request.reject(Error('浏览器连接已断开'));});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>fail(Error('浏览器连接超时')),5000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)};
      const fail=e=>{cleanup();socket.close();reject(e)};
      const abort=()=>fail(signal.reason);
      socket.addEventListener('open',()=>{cleanup();resolve()},{once:true});
      socket.addEventListener('error',()=>fail(Error('浏览器连接失败')),{once:true});
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
    if(this.target)this.session=(await this.send('Target.attachToTarget',{targetId:this.target,flatten:true},signal)).sessionId;
  }
  async send(method,params={},signal,sessionId){
    signal?.throwIfAborted();await this.connect(signal);const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id)};
      const abort=()=>{cleanup();reject(signal.reason)};
      const timer=setTimeout(()=>{cleanup();reject(Error(`浏览器操作超时：${method}`))},15000);
      this.pending.set(id,{resolve:v=>{cleanup();resolve(v)},reject:e=>{cleanup();reject(e)}});
      signal?.addEventListener('abort',abort,{once:true});
      try{this.socket.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}))}catch(e){cleanup();reject(e)}
    });
  }
  async evaluate(expression,signal){
    if(!this.session)throw Error('没有任务专用标签页');
    const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},signal,this.session);
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result?.value;
  }
  async navigate(url,signal){
    const result=await this.send('Page.navigate',{url},signal,this.session);
    if(result.errorText)throw Error(result.errorText);
    return this.waitForPage(url,signal,result.loaderId);
  }
  async waitForPage(url,signal,loaderId){
    // Navigation is complete enough to inspect DOM; never request UI activation.
    const end=Date.now()+15000;
    while(Date.now()<end){
      signal?.throwIfAborted();
      try{const tree=await this.send('Page.getFrameTree',{},signal,this.session);if((!loaderId||tree.frameTree.frame.loaderId===loaderId)&&await this.evaluate(`location.href !== 'about:blank' && document.readyState !== 'loading'`,signal))return {url};}catch(e){if(!/context|navigat/i.test(e.message))throw e;}
      await new Promise(r=>setTimeout(r,150));
    }
    throw Error('页面加载超时');
  }
  async command(args,signal){
    if(args[0]==='xhs-search-mode'){
      const ai=args[1]==='ai';
      const expression=`(()=>{const es=[...document.querySelectorAll('button.wendian-btn')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[aria-hidden="true"],[inert]'));if(!es.length)return false;if(es.length!==1)throw Error('问点点选项不唯一');const e=es[0];if(e.classList.contains('wendian-btn--active')===${ai})return true;e.click();return false;})()`;
      const end=Date.now()+8000;
      do{if(await this.evaluate(expression,signal))return {ai};await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);
      throw Error('无法确认问点点选项状态，未提交搜索');
    }
    if(args[0]==='tab'&&args[1]==='list'){
      const r=await this.send('Target.getTargets',{},signal);return {tabs:r.targetInfos.filter(t=>t.type==='page').map(t=>({targetId:t.targetId,url:t.url}))};
    }
    if(args[0]==='tab'&&args[1]==='new'){
      if(this.target)throw Error('已有任务标签页');
      const {targetId}=await this.send('Target.createTarget',{url:args[2],background:true},signal);
      this.target=targetId;
      try{this.session=(await this.send('Target.attachToTarget',{targetId,flatten:true},signal)).sessionId;await this.waitForPage(args[2],signal);return {targetId};}
      catch(e){try{await this.send('Target.closeTarget',{targetId},AbortSignal.timeout(5000))}finally{this.target=null;this.session=null}throw e;}
    }
    if(args[0]==='tab'&&args[1]==='close'){
      if(!this.target||args[2]!==this.target)throw Error('只允许关闭当前任务创建的标签页');
      const targetId=this.target;
      const closed=await this.send('Target.closeTarget',{targetId},signal);
      if(closed.success===false)throw Error('任务标签页关闭失败');
      const end=Date.now()+3000;
      while(true){
        const targets=await this.send('Target.getTargets',{},signal);
        if(!targets.targetInfos.some(t=>t.targetId===targetId))break;
        if(Date.now()>=end)throw Error('任务标签页关闭状态未确认');
        await new Promise(r=>setTimeout(r,100));
      }
      this.target=null;this.session=null;return {};
    }
    if(args[0]==='get'&&args[1]==='url')return {url:await this.evaluate('location.href',signal)};
    if(args[0]==='open')return this.navigate(args[1],signal);
    if(args[0]==='eval'&&args[1]==='-b')return {result:await this.evaluate(Buffer.from(args[2],'base64').toString('utf8'),signal)};
    if(args[0]==='find'&&args[1]==='role'&&args[2]==='textbox'&&args[3]==='fill'){
      const expression=`(()=>{const els=[...document.querySelectorAll('textarea[name="aiSearchTextarea"]')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[aria-hidden="true"],[inert]')&&!e.disabled&&Number(getComputedStyle(e).opacity)>0.05);if(!els.length)return false;if(els.length!==1)throw Error('可见聊天输入框不唯一，未提交');const e=els[0];e.focus();e.select();return true;})()`;
      const end=Date.now()+8000;
      do{if(await this.evaluate(expression,signal)){await this.send('Input.insertText',{text:args[4]},signal,this.session);return {};}await new Promise(r=>setTimeout(r,200));}while(Date.now()<end);
      throw Error('点点聊天输入框尚未就绪，未提交');
    }
    if(args[0]==='xhs-search-submit'){
      if(args[1]==='notes'){
        const query=await this.evaluate(`(()=>{const es=[...document.querySelectorAll('textarea[name="aiSearchTextarea"]')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[aria-hidden="true"],[inert]')&&Number(getComputedStyle(e).opacity)>0.05);if(es.length!==1)throw Error('搜索输入框不唯一');return es[0].value;})()`,signal);
        if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('搜索词无效');
        // Use the existing public result route for ordinary searches. This
        // avoids website UI submit side effects while retaining the owned tab.
        const url=new URL('https://www.xiaohongshu.com/search_result_ai');url.searchParams.set('keyword',encodeURIComponent(query));url.searchParams.set('source','web_explore_feed');
        return this.navigate(url.href,signal);
      }
      await this.evaluate(`(()=>{const es=[...document.querySelectorAll('.submit-button')].filter(e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&!e.closest('[aria-hidden="true"],[inert]')&&Number(getComputedStyle(e).opacity)>0.05);if(es.length!==1)throw Error('发送按钮不唯一，未提交');es[0].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));})()`,signal);
      const end=Date.now()+8000;
      const submitted=`Boolean(document.querySelector('.ai-message')) || location.pathname==='/ai_chat' || location.pathname==='/ai_chat_tab'`;
      while(!await this.evaluate(submitted,signal)){
        if(Date.now()>=end)throw Error('未确认搜索已提交，停止等待；不会自动重复提交');
        await new Promise(r=>setTimeout(r,200));
      }
      return {};
    }
    if(args[0]==='press'&&args[1]==='Enter'){
      for(const type of ['keyDown','keyUp'])await this.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13},signal,this.session);return {};
    }
    throw Error('后台浏览器不支持此操作');
  }
  close(){this.socket?.close();this.socket=null;}
}
