(()=>{
PAGES.claude=async(el,fresh)=>{
 let s=null;try{const r=await fetch('/claude/state'+(fresh?'?fresh=1':''));if(!r.ok)throw 0;s=await r.json()}catch(e){}
 if(!el.isConnected||tab!=='claude')return;
 if(!s){el.innerHTML='<div class="empty">Could not read Claude information.</div>';return}
 const cards='<div class="cards">'
  +card('Claude Code',s.installed?'installed':'not installed','',[s.installed?esc(s.path):'Install it from <a href="https://claude.com/product/claude-code" target="_blank" rel="noopener">claude.com/product/claude-code</a>, then run <code>claude</code> once to sign in.'])
  +card('Sign-in',s.signedIn?'signed in':'not signed in','',[s.signedIn?(s.plan?'Plan: '+esc(s.plan):'Plan not shown'):'Run <code>claude</code> in a terminal and log in.','Read from files on this PC, nothing was sent anywhere.'])
  +card('Usage','Claude site','',['Claude does not report usage to this panel. Open your usage page:','<a class="pill" target="_blank" rel="noopener" href="'+esc(s.usageUrl)+'">Open claude.ai usage</a>'])
  +card('Used by this panel',s.enabled?'on':'off','',[s.enabled?'Tasks can be sent to Claude.':'Claude is turned on in Setup or the Orchestrator tab. Until then it only shows history here.'])
  +'</div>';
 const list=Array.isArray(s.sessions)?s.sessions:[];
 const body=s.error?'<div class="empty">Could not read sessions: '+esc(s.error)+'</div>':!list.length?'<div class="empty">'+(s.enabled?'No Claude sessions found.':'No Claude sessions found, and Claude is off in Setup.')+'</div>':window.sessTable('claude',list);
 const keep=el.querySelector('.cl')?el.scrollTop:0;
 el.innerHTML=cards+'<div class="sess cl"><div class="hl">Sessions, newest first</div>'+body+'</div>';
 const reload=()=>PAGES.claude(el,true);window.sessReload=reload;
 el.querySelector('.cl').onclick=e=>window.sessClick(e,'claude',list,reload);
 el.scrollTop=keep}
})();
