(()=>{
const LABEL={running:'running (verified)',reported:'in progress',recent:'recent activity',idle:'idle',stopped:'stopped',finished:'done'},DOT={running:'live',reported:'idle',recent:'idle',idle:'idle',stopped:'err',finished:'done'};
const WHY={reported:'Active turn reported; process not directly confirmed.',running:'Its process is alive and active.',recent:'It wrote in the last 2 minutes.',idle:'No recent activity; session is idle or closed.',stopped:'Its Command Center task stopped or failed.',finished:'This run completed.'};
const dot=(s,why)=>'<span class="sdot '+(DOT[s]||'idle')+'" title="'+esc(why||WHY[s]||'')+'"></span>'+(LABEL[s]||'idle');
const last2=p=>String(p||'').split(/[\\/]/).filter(Boolean).slice(-2).join('/')||'?';
const stamp=t=>{const d=new Date(t);return isNaN(d)?'?':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const recent=ms=>ms?(Date.now()-ms<864e5?ago(ms):stamp(ms)):'?';
const minsStr=m=>m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m';
const opened=new Set(),expanded=new Set(),selected=new Set();let bulkBusy=false,showArch=false,sessionProvider='all',sessionState='all',sessionQuery='',sessionPage=0,teamFilter='all',teamSearch='',teamDraft='';
const SESSION_PAGE_SIZE=25,sessionKey=s=>JSON.stringify([s.provider,s.id]);
let cur=null,timer=0,token=0,lastRaw='',opener=null,lastList=null,lastTasks=null,lastExtras=null;

function steps(x){const key=x.provider+':'+x.id+':';
 return x.steps.map((s,i)=>{const k=key+i;
  if(s.k==='user')return '<div class="user">'+md(s.text)+'</div>';
  if(s.k==='text'){const t=s.text||'',long=(t.split('\n').length>6||t.length>600)&&!expanded.has(k);return '<div class="text'+(long?' long':'')+'" data-k="'+esc(k)+'">'+md(t)+'</div>'+(long?'<button type="button" class="text-expand" data-expand="'+esc(k)+'">Show more</button>':'')}
  return '<details class="tool" data-k="'+esc(k)+'"'+(opened.has(k)?' open':'')+'><summary><span class="tag '+kind(s.name||'')+'">'+esc(s.name)+'</span><span class="cmd">'+esc(s.input)+'</span></summary><pre>'+esc(s.output||'(no output yet)')+'</pre></details>'}).join('')||'<div class="empty">No messages yet.</div>'}

function render(x){cur.x=x;$('vact').hidden=false;$('varc').textContent=x.archived?'Unarchive':'Archive';const f=$('vfeed'),atBottom=f.scrollHeight-f.scrollTop-f.clientHeight<80,top=f.scrollTop,restoreFocus=keepFeedFocus(f);
 $('vtitle').textContent=x.title||x.id;
 $('vmeta').innerHTML=[esc(x.provider),x.model&&esc(x.model),'<span title="'+esc(x.cwd)+'">'+esc(last2(x.cwd))+'</span>',dot(x.live||'idle',x.liveWhy),'history read from disk, the panel cannot stop or message it','last activity '+esc(recent(x.mtime))].filter(Boolean).join(' · ');
 f.innerHTML=steps(x);
 f.scrollTop=($('vfollow').checked&&atBottom)?f.scrollHeight:top;restoreFocus()}

async function load(first){const t=token;let raw,ok;
 try{const r=await fetch('/session?p='+encodeURIComponent(cur.p)+'&id='+encodeURIComponent(cur.id));ok=r.ok;raw=await r.text()}catch(e){raw=null}
 if(t!==token)return;
 let x=null;try{x=JSON.parse(raw)}catch(e){}
 if(!ok||!x||x.error||!Array.isArray(x.steps)){
  if(first){$('vtitle').textContent='Session not found';$('vmeta').textContent='';$('vfeed').innerHTML='<div class="empty">'+esc(x?.error||'Could not load this session. It may have been removed.')+'</div>'}
  return}
 if(first||raw!==lastRaw){lastRaw=raw;render(x);if(first)$('vfeed').scrollTop=$('vfeed').scrollHeight}
 if(x.live==='running'||x.live==='reported'||x.live==='recent')timer=setTimeout(()=>load(false),4000)}

function close(){token++;clearTimeout(timer);cur=null;$('view').hidden=true;(opener?.isConnected?opener:document.querySelector('#tabs .on'))?.focus();opener=null}

window.openSession=(provider,id)=>{
 if($('view').hidden)opener=document.activeElement;
 token++;clearTimeout(timer);cur={p:provider,id};lastRaw='';$('vact').hidden=true;
 $('vtitle').textContent='Loading…';$('vmeta').textContent='';$('vfeed').innerHTML='<div class="empty">Loading…</div>';
 $('view').hidden=false;$('vclose').focus();load(true)};

const FILES={codex:1,claude:1,cursor:1},enc=encodeURIComponent;
window.sessAct=async(provider,id,a,title)=>{
 let body;
 if(a==='rename'){const n=prompt('New name for this session. Leave it empty to use the original name.',title);if(n===null)return false;body=JSON.stringify({name:n})}
 if(a==='delete'&&!confirm('Delete "'+title+'"?\n\n'+(provider==='codex'?'Hides this session or moves its transcript to the Command Center trash folder. Stop it first if it is still open.':FILES[provider]?'Moves this session to the Command Center trash folder. Stop it first if it is still open.':'Hides this session for good.')))return false;
 try{const r=await fetch('/session/meta?p='+enc(provider)+'&id='+enc(id)+'&a='+a,{method:'POST',body});const x=await r.json().catch(()=>({}));if(!r.ok){alert(x.error||'Could not do that.');return false}}catch(e){alert('Could not reach the panel.');return false}
 return true};
const vact=async a=>{const x=cur?.x;if(!x||!await window.sessAct(cur.p,cur.id,a,x.title||x.id))return;
 window.sessReload?.();if(a==='delete')return close();clearTimeout(timer);load(false)};
$('vren').onclick=()=>vact('rename');$('varc').onclick=()=>vact(cur?.x?.archived?'unarchive':'archive');$('vdel').onclick=()=>vact('delete');
const AGENT={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude',antigravity:'Antigravity'},RANK={running:0,reported:1,recent:2,stopped:3,idle:4,finished:5};
const fbLeftCell=s=>{
 if(s.provider!=='freebuff')return '';
 if(s.expiresAt&&s.expiresAt>Date.now()){const m=Math.max(0,Math.round((s.expiresAt-Date.now())/60000));return '<div class="fb-left'+(s.cliReusable?' is-reuse':'')+'">'+(s.cliReusable?'reusable · ':'')+minsStr(m)+' left in 1h</div>'}
 if(s.minsLeft!=null&&s.minsLeft>0)return '<div class="fb-left'+(s.cliReusable?' is-reuse':'')+'">'+(s.cliReusable?'reusable · ':'')+minsStr(s.minsLeft)+' left in 1h</div>';
 return s.hourOver?'<div class="fb-left is-over">hour ended</div>':'';
};
window.sessTable=list=>{
 const rows=list.filter(s=>s.id&&(!s.archived||showArch)).sort((a,b)=>(RANK[a.live]??4)-(RANK[b.live]??4)||b.mtime-a.mtime);
 return list.filter(s=>!s.id).map(s=>'<div class="'+(s.note?'pg-hint':'tk-warn')+'">'+esc(s.title)+'</div>').join('')
  +'<table class="ss" aria-label="Sessions"><thead><tr><th scope="col">Select</th><th>Agent</th><th>Doing</th><th>Folder</th><th>Last activity</th><th>State</th><th></th></tr></thead><tbody>'
  +rows.map(s=>'<tr class="srow'+(s.archived?' arch':'')+'" data-p="'+esc(s.provider)+'" data-id="'+esc(s.id)+'"><td><input type="checkbox" data-session-select aria-label="Select '+esc(s.title||s.id)+'"'+(selected.has(sessionKey(s))?' checked':'')+(s.archived||bulkBusy?' disabled':'')+'></td><td><span class="tk-badge p-'+esc(s.provider)+'">'+esc(AGENT[s.provider]||s.provider)+'</span></td><td class="st"><button type="button" class="session-open" data-session-open>'+esc(s.title||s.id)+'</button>'+(s.model?'<div class="m">'+esc(s.model)+'</div>':'')+'</td><td title="'+esc(s.cwd)+'">'+esc(last2(s.cwd))+'</td><td>'+esc(recent(s.mtime))+'</td><td class="sst">'+dot(s.live||'idle',s.liveWhy)+fbLeftCell(s)+'</td><td class="sact"><button class="pill" data-a="rename">Rename</button><button class="pill" data-a="'+(s.archived?'unarchive':'archive')+'">'+(s.archived?'Unarchive':'Archive')+'</button><button class="pill" data-a="delete">Delete</button></td></tr>').join('')+'</tbody></table>'};
window.sessClick=(e,list,reload)=>{
 if(e.target.closest('[data-session-select]'))return;
 if(e.target.closest('[data-tog]')){showArch=!showArch;sessionPage=0;reload();return}
 const r=e.target.closest('.srow');if(!r)return;
 const p=r.dataset.p,id=r.dataset.id,b=e.target.closest('[data-a]');
 if(!b){window.openSession(p,id);return}
 const s=list.find(x=>x.provider===p&&x.id===id);
 if(s)window.sessAct(p,id,b.dataset.a,s.title||id).then(ok=>ok&&reload())};

$('vclose').onclick=close;
$('view').onclick=e=>{if(e.target===$('view'))close()};
document.addEventListener('keydown',e=>{const view=$('view');if(view.hidden)return;if(e.key==='Escape'){close();return}if(e.key!=='Tab')return;const items=[...view.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.tabIndex!==-1&&x.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
$('vfeed').addEventListener('toggle',e=>{const k=e.target.dataset?.k;if(k)e.target.open?opened.add(k):opened.delete(k)},true);
$('vfeed').onclick=e=>{const b=e.target.closest('[data-expand]');if(b){const t=b.previousElementSibling;expanded.add(b.dataset.expand);t.classList.remove('long');t.tabIndex=-1;b.remove();t.focus({preventScroll:true})}};

function fbUsageStrip(fb,sp){
 const clis=sp?.clis||[];
 if(sessionProvider!=='freebuff'&&!(sessionProvider==='all'&&clis.length))return '';
 const t=fb?.today;
 const daily=t?.left?esc(t.left)+' / '+esc(t.limit)+' h left today'+(t.flashHours!=null?' · '+esc(t.flashHours)+' h Flash':''):fb?.error?esc(fb.error):'Reading daily hours…';
 const chips=clis.length?clis.map(c=>{
  const idle=!c.working?.length&&!c.queued?.length;
  const tag=c.pending?'starting':(idle?'reusable':'busy');
  const leftTxt=c.pending?'pending':minsStr(c.minsLeft??0)+' left';
  return '<span class="fb-cli-chip'+(idle&&!c.pending?' is-idle':'')+'" title="'+esc(c.working?.length?'Working: '+c.working.join(', '):'Idle and ready for next Freebuff task')+'"><span class="sdot '+(idle&&!c.pending?'live':'idle')+'"></span><b>'+esc(c.model||'Freebuff')+'</b> · '+esc(leftTxt)+' · '+tag+(c.pid?' (pid '+esc(c.pid)+')':'')+'</span>';
 }).join(''):'<span class="m">No active 1-hour Freebuff CLI right now.</span>';
 const nextWhy=sp?.why?'<div class="fb-why">'+esc(sp.why)+'</div>':'';
 return '<div class="fb-usage-strip"><div class="fb-usage-head"><div><b>Freebuff usage &amp; 1-hour session reuse</b><span>'+daily+' · '+clis.length+' / '+(sp?.max??'?')+' active CLIs</span></div><span class="fb-policy">Reuses active 1h CLIs until hour ends unless parallel work needs another</span></div><div class="fb-clis">'+chips+'</div>'+nextWhy+'</div>';
}

function teamViewHtml(feed){
 const raw=feed?.items||[];
 const q=teamSearch.trim().toLowerCase();
 const rows=raw.filter(x=>{
  if(teamFilter==='board'&&x.kind!=='board')return false;
  if(teamFilter==='tasks'&&x.kind==='board')return false;
  if(q&&![x.from,x.to,x.provider,x.title,x.text,x.taskId].some(v=>String(v||'').toLowerCase().includes(q)))return false;
  return true;
 });
 const cards=rows.length?rows.map(x=>{
  const badge='<span class="tk-badge p-'+esc(x.provider||'team')+'">'+esc(AGENT[x.provider]||x.provider||'team')+'</span>';
  const kindCls=x.kind==='board'?'k-board':x.kind==='dispatch'?'k-dispatch':'k-report';
  const statusPill=x.status?'<span class="team-status s-'+esc(x.status)+'">'+esc(x.status)+'</span>':'';
  const openBtn=x.sessionRef?'<button type="button" class="pill" data-open-session="'+esc(x.sessionRef.provider)+':'+esc(x.sessionRef.id)+'">Open session</button>':'';
  const ts=Date.parse(x.at||'');
  const t=String(x.text||''),long=t.length>500&&!expanded.has('team:'+x.id);
  return '<article class="team-msg '+kindCls+'"><header>'+badge+'<span class="team-route"><b>'+esc(x.from)+'</b> → <span>'+esc(x.to)+'</span></span>'+statusPill+(x.taskId?'<code>'+esc(x.taskId)+'</code>':'')+'<span class="team-at">'+(ts?esc(recent(ts)):'?')+'</span>'+openBtn+'</header>'
   +(x.title&&x.kind!=='board'?'<div class="team-title">'+esc(x.title)+'</div>':'')
   +'<div class="team-body'+(long?' long':'')+'">'+md(t)+'</div>'
   +(long?'<button type="button" class="pill team-more" data-team-expand="'+esc(x.id)+'">Show full message</button>':'')+'</article>';
 }).join(''):'<div class="empty">No team communication matches this filter.</div>';
 return '<div class="team-view">'
  +'<form id="team-form" class="team-compose"><input id="team-note" type="text" placeholder="Post a note to the team board (visible to Director and all active workers)…" value="'+esc(teamDraft)+'"><button type="submit" class="pill primary">Send to team</button></form>'
  +'<div class="team-toolbar"><div class="team-filters">'
   +[['all','All talk ('+raw.length+')'],['board','Team board'],['tasks','Dispatches & reports']].map(([id,lbl])=>'<button type="button" class="pill'+(teamFilter===id?' on':'')+'" data-team-filter="'+id+'">'+esc(lbl)+'</button>').join('')
  +'</div><input id="team-search" type="search" placeholder="Filter by agent, task id or text" value="'+esc(teamSearch)+'"><button type="button" class="pill" data-team-refresh="1">Refresh</button></div>'
  +'<div class="team-feed">'+cards+'</div></div>';
}

let gen=0,sessionComposing=false;
function renderSessions(el,list,tasks,extras){
 lastList=list;lastTasks=tasks;lastExtras=extras;
 const fbUsage=extras?.fbUsage||null,sp=extras?.spawn||null,feed=extras?.feed||null;
 const live=(list||[]).filter(s=>s.id&&!s.archived),n=k=>live.filter(s=>(s.live||'idle')===k).length,top=el.scrollTop,left=el.querySelector('.session-table-wrap')?.scrollLeft||0;
 const fe=document.activeElement,taskFocus=el.contains(fe)?fe.closest('[data-open-director]')?.dataset.taskId:null,providerFocus=el.contains(fe)?fe.closest('[data-session-provider]')?.dataset.sessionProvider:null,searching=fe?.id==='session-search'||fe?.id==='team-search',searchId=searching?fe.id:null,cursor=searching?fe.selectionStart:null,control=el.contains(fe)&&fe.id==='session-state'?fe.id:'',bulkFocus=el.contains(fe)&&fe.matches('[data-select-page]')?'page':el.contains(fe)&&fe.matches('[data-archive-selected]')?'archive':null,fr=el.contains(fe)&&fe.closest('.srow'),fk=fr&&[fr.dataset.p,fr.dataset.id,fe.dataset.a,fe.hasAttribute('data-session-open'),fe.hasAttribute('data-session-select')];
 const available=new Set((list||[]).filter(s=>s.id&&!s.archived).map(sessionKey));if(list)for(const k of selected)if(!available.has(k))selected.delete(k);
 const q=sessionQuery.trim().toLowerCase(),rows=(list||[]).filter(s=>s.id&&(showArch||!s.archived)&&(sessionProvider==='all'||s.provider===sessionProvider)&&(sessionState==='all'||(s.live||'idle')===sessionState)&&(!q||[s.title,s.id,s.cwd,s.model].some(v=>String(v||'').toLowerCase().includes(q)))).sort((a,b)=>(RANK[a.live]??4)-(RANK[b.live]??4)||b.mtime-a.mtime);
 const pages=Math.max(1,Math.ceil(rows.length/SESSION_PAGE_SIZE));sessionPage=Math.min(sessionPage,pages-1);const visible=rows.slice(sessionPage*SESSION_PAGE_SIZE,(sessionPage+1)*SESSION_PAGE_SIZE),arch=(list||[]).filter(s=>s.id&&s.archived).length;
 const tabs=[['all','All'],...Object.entries(AGENT),['team','Team']];
 el.innerHTML='<div class="pg sess-all"><div class="cc-pagehead"><div><div class="cc-eyebrow">WORKSPACE / ACTIVITY</div><h2>Sessions</h2><p class="cc-lead">Live and historical sessions linked to Command Center tasks, Freebuff hour reuse, and team communication.</p></div><div class="cc-count"><b>'+live.length+'</b><span>visible sessions</span></div></div>'
  +'<div class="session-summary"><div><b>'+n('running')+'</b><span>running (verified)</span></div><div><b>'+n('reported')+'</b><span>in progress</span></div><div><b>'+n('recent')+'</b><span>recent activity</span></div><div><b>'+n('idle')+'</b><span>idle</span></div><div><b>'+n('stopped')+'</b><span>stopped</span></div><div><b>'+n('finished')+'</b><span>done</span></div><p>Running means a live process was verified. Task completion and failures are synced directly from Command Center so no session is left unknown.</p></div>'
  +'<div class="session-current"><div><b>Command Center tasks running now</b><span>Live tasks managed by this panel</span></div>'+(!tasks?'<p>Could not load current tasks.</p>':tasks.length?tasks.map(t=>'<button type="button" class="session-task" data-open-director data-task-id="'+esc(t.id)+'"><span class="tk-badge p-'+esc(t.ranOn||t.provider)+'">'+esc(AGENT[t.ranOn||t.provider]||t.ranOn||t.provider)+'</span><span>'+esc(t.title||t.id)+'</span><small>'+esc(t.status)+'</small></button>').join(''):'<p>No Command Center tasks are running.</p>')+'</div>'
  +'<nav class="session-tabs" aria-label="Session providers">'+tabs.map(([id,label])=>'<button type="button" class="pill'+(sessionProvider===id?' on':'')+'" data-session-provider="'+esc(id)+'" aria-pressed="'+(sessionProvider===id)+'">'+esc(label)+'</button>').join('')+'</nav>'
  +fbUsageStrip(fbUsage,sp)
  +(sessionProvider==='team'?teamViewHtml(feed)
   :'<div class="session-toolbar"><label><span>Search</span><input id="session-search" type="search" placeholder="Title, model or folder" value="'+esc(sessionQuery)+'"></label><label><span>Activity</span><select id="session-state">'+[['all','All states'],['running','Running (verified)'],['reported','In progress'],['recent','Recent activity'],['idle','Idle'],['stopped','Stopped'],['finished','Done']].map(([id,label])=>'<option value="'+id+'"'+(sessionState===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(arch?'<button class="pill" data-tog="1">'+(showArch?'Hide':'Show')+' archived ('+arch+')</button>':'')+'</div>'
   +'<div class="session-bulk"><label><input type="checkbox" data-select-page'+(visible.some(s=>!s.archived)&&visible.filter(s=>!s.archived).every(s=>selected.has(sessionKey(s)))?' checked':'')+(bulkBusy||!visible.some(s=>!s.archived)?' disabled':'')+'> Select this page</label><button type="button" class="pill" data-archive-selected'+(bulkBusy||!list||!selected.size?' disabled':'')+'>'+(bulkBusy?'Archiving...':'Archive selected ('+selected.size+')')+'</button><button type="button" class="pill" data-clear-selection'+(bulkBusy||!selected.size?' disabled':'')+'>Clear selection</button><span>Selection includes all pages and filters.</span></div>'
   +(list===null?'<div class="empty">Could not load sessions.</div>':(list||[]).filter(s=>!s.id).map(s=>'<div class="'+(s.note?'pg-hint':'tk-warn')+'">'+esc(s.title)+'</div>').join('')+(visible.length?'<div class="session-scroll-hint">Scroll horizontally to see all session actions.</div><div class="session-table-wrap">'+window.sessTable(visible)+'</div>':'<div class="empty">No sessions match these filters.</div>'))
   +'<div class="archive-pager"><span>'+rows.length+' matching · page '+(sessionPage+1)+' of '+pages+'</span><button class="pill" data-session-page="prev"'+(sessionPage===0?' disabled':'')+'>Previous</button><button class="pill" data-session-page="next"'+(sessionPage+1>=pages?' disabled':'')+'>Next</button></div>')
  +'</div>';
 const root=el.firstChild,reload=()=>renderSessions(el,lastList,lastTasks,lastExtras);
 root.onsubmit=async e=>{
  if(e.target.id!=='team-form')return;
  e.preventDefault();
  const input=el.querySelector('#team-note'),wasFocused=document.activeElement===input;
  const txt=String(input?.value??teamDraft).trim();if(!txt)return;
  const r=await fetch('/board?from=you',{method:'POST',body:txt});
  if(r.ok){teamDraft='';if(input)input.value='';await PAGES.sessions(el,true);if(wasFocused)el.querySelector('#team-note')?.focus()}else alert('Could not post to team board.');
 };
 root.onclick=async e=>{
  if(e.target.closest('[data-archive-selected]')){if(bulkBusy||!selected.size)return;const chosen=(list||[]).filter(s=>selected.has(sessionKey(s))&&!s.archived);if(!chosen.length)return;if(!confirm('Archive '+chosen.length+' selected session'+(chosen.length===1?'':'s')+'?'))return;bulkBusy=true;gen++;reload();const failed=[];for(const s of chosen){try{const r=await fetch('/session/meta?p='+enc(s.provider)+'&id='+enc(s.id)+'&a=archive',{method:'POST'});if(!r.ok){const x=await r.json().catch(()=>({}));failed.push((s.title||s.id)+': '+(x.error||'Could not archive'))}else selected.delete(sessionKey(s))}catch{failed.push((s.title||s.id)+': Could not reach the panel')}}bulkBusy=false;if(tab==='sessions')await PAGES.sessions(el);if(failed.length)alert('Some sessions could not be archived:\n'+failed.join('\n'));return}
  if(bulkBusy)return;
  if(e.target.closest('[data-clear-selection]')){selected.clear();reload();return}
  if(e.target.closest('[data-open-director]')){setTab('director');return}
  const tf=e.target.closest('[data-team-filter]');if(tf){teamFilter=tf.dataset.teamFilter;reload();return}
  if(e.target.closest('[data-team-refresh]')){PAGES.sessions(el,true);return}
  const te=e.target.closest('[data-team-expand]');if(te){expanded.add('team:'+te.dataset.teamExpand);reload();return}
  const os=e.target.closest('[data-open-session]');if(os){const [p,...rest]=os.dataset.openSession.split(':');window.openSession(p,rest.join(':'));return}
  const provider=e.target.closest('[data-session-provider]');
  if(provider){const prev=sessionProvider;sessionProvider=provider.dataset.sessionProvider;sessionPage=0;reload();el.querySelector('[data-session-provider="'+CSS.escape(sessionProvider)+'"]')?.focus();if(sessionProvider==='team'&&prev!=='team'&&!feed)PAGES.sessions(el);return}
  const b=e.target.closest('[data-session-page]');if(b){sessionPage+=b.dataset.sessionPage==='next'?1:-1;return reload()}
  window.sessClick(e,list||[],()=>PAGES.sessions(el));
 };
 root.onchange=e=>{if(e.target.matches('[data-select-page]')){for(const s of visible.filter(s=>!s.archived))e.target.checked?selected.add(sessionKey(s)):selected.delete(sessionKey(s));reload();el.querySelector('[data-select-page]')?.focus({preventScroll:true});return}if(e.target.matches('[data-session-select]')){const row=e.target.closest('.srow'),s=visible.find(x=>x.id===row.dataset.id&&x.provider===row.dataset.p);if(s)e.target.checked?selected.add(sessionKey(s)):selected.delete(sessionKey(s));reload();el.querySelector('.srow[data-p="'+CSS.escape(row.dataset.p)+'"][data-id="'+CSS.escape(row.dataset.id)+'"] [data-session-select]')?.focus({preventScroll:true});return}if(e.target.id==='session-state')sessionState=e.target.value;else return;sessionPage=0;reload()};
 root.oninput=e=>{if(e.isComposing)return;if(e.target.id==='session-search'){sessionQuery=e.target.value;sessionPage=0;reload()}else if(e.target.id==='team-search'){teamSearch=e.target.value;reload()}else if(e.target.id==='team-note'){teamDraft=e.target.value}};
 root.addEventListener('compositionstart',e=>{if(e.target.id==='session-search'||e.target.id==='team-search')sessionComposing=true});
 root.addEventListener('compositionend',e=>{if(e.target.id==='session-search'){sessionComposing=false;sessionQuery=e.target.value;sessionPage=0;reload()}else if(e.target.id==='team-search'){sessionComposing=false;teamSearch=e.target.value;reload()}else if(e.target.id==='team-note'){teamDraft=e.target.value}});
 el.scrollTop=top;const wrap=el.querySelector('.session-table-wrap');if(wrap)wrap.scrollLeft=left;if(searchId){const x=el.querySelector('#'+searchId);x?.focus();if(cursor!=null)x?.setSelectionRange(cursor,cursor)}else if(control)el.querySelector('#'+control)?.focus({preventScroll:true});
 if(bulkFocus)el.querySelector(bulkFocus==='page'?'[data-select-page]':'[data-archive-selected]')?.focus({preventScroll:true});else if(taskFocus)el.querySelector('[data-task-id="'+CSS.escape(taskFocus)+'"]')?.focus({preventScroll:true});else if(providerFocus)el.querySelector('[data-session-provider="'+CSS.escape(providerFocus)+'"]')?.focus({preventScroll:true});
 if(fk){const t=el.querySelector('.srow[data-p="'+CSS.escape(fk[0])+'"][data-id="'+CSS.escape(fk[1])+'"]');(fk[2]?t?.querySelector('[data-a="'+CSS.escape(fk[2])+'"]'):fk[3]?t?.querySelector('[data-session-open]'):fk[4]?t?.querySelector('[data-session-select]'):null)?.focus({preventScroll:true})}}
PAGES.sessions=async(el,force=false)=>{
 const ae=document.activeElement;
 if(!force&&(bulkBusy||sessionComposing||(el.contains(ae)&&['SELECT','INPUT','TEXTAREA'].includes(ae.tagName))))return;
 const my=++gen;
 const getJ=u=>fetch(u).then(r=>r.ok?r.json():null).catch(()=>null);
 const [list,taskData,fbUsage,spawn,feed]=await Promise.all([
  getJ('/sessions'),
  getJ('/tasks?brief=1'),
  getJ('/usage?p=freebuff'),
  getJ('/spawn-check'),
  sessionProvider==='team'||!lastExtras?.feed?getJ('/team-feed'):Promise.resolve(lastExtras.feed),
 ]);
 const tasks=Array.isArray(taskData?.tasks)?taskData.tasks.filter(t=>t.status==='running'||t.status==='starting'):null;
 if(my!==gen||!el.isConnected||tab!=='sessions')return;
 window.sessReload=()=>PAGES.sessions(el,true);
 renderSessions(el,list,tasks,{fbUsage,spawn,feed});
};
setInterval(()=>{if(tab==='sessions')PAGES.sessions($('prov'))},10000);
})();
