(()=>{
const LABEL={running:'running (verified)',recent:'recent activity',unknown:'unknown',finished:'finished'},DOT={running:'live',recent:'idle',unknown:'done',finished:'done'};
const WHY={running:'Its process is alive and it wrote in the last 2 minutes.',recent:'It wrote in the last 2 minutes. The panel cannot confirm a process is running it.',unknown:'No recent writes and no completion mark. It may be running, paused or closed.',finished:'The transcript shows this run completed.'};
const dot=(s,why)=>'<span class="sdot '+(DOT[s]||'done')+'" title="'+esc(why||WHY[s]||'')+'"></span>'+(LABEL[s]||'unknown');
const last2=p=>String(p||'').split(/[\\/]/).filter(Boolean).slice(-2).join('/')||'?';
const stamp=t=>{const d=new Date(t);return isNaN(d)?'?':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const recent=ms=>ms?(Date.now()-ms<864e5?ago(ms):stamp(ms)):'?';
const opened=new Set(),expanded=new Set();let showArch=false,sessionProvider='all',sessionState='all',sessionQuery='',sessionPage=0;
const SESSION_PAGE_SIZE=25;
let cur=null,timer=0,token=0,lastRaw='',opener=null;

function steps(x){const key=x.provider+':'+x.id+':';
 return x.steps.map((s,i)=>{const k=key+i;
  if(s.k==='user')return '<div class="user">'+md(s.text)+'</div>';
  if(s.k==='text'){const t=s.text||'',long=(t.split('\n').length>6||t.length>600)&&!expanded.has(k);return '<div class="text'+(long?' long':'')+'" data-k="'+esc(k)+'">'+md(t)+'</div>'+(long?'<button type="button" class="text-expand" data-expand="'+esc(k)+'">Show more</button>':'')}
  return '<details class="tool" data-k="'+esc(k)+'"'+(opened.has(k)?' open':'')+'><summary><span class="tag '+kind(s.name||'')+'">'+esc(s.name)+'</span><span class="cmd">'+esc(s.input)+'</span></summary><pre>'+esc(s.output||'(no output yet)')+'</pre></details>'}).join('')||'<div class="empty">No messages yet.</div>'}

function render(x){cur.x=x;$('vact').hidden=false;$('varc').textContent=x.archived?'Unarchive':'Archive';const f=$('vfeed'),atBottom=f.scrollHeight-f.scrollTop-f.clientHeight<80,top=f.scrollTop,restoreFocus=keepFeedFocus(f);
 $('vtitle').textContent=x.title||x.id;
 $('vmeta').innerHTML=[esc(x.provider),x.model&&esc(x.model),'<span title="'+esc(x.cwd)+'">'+esc(last2(x.cwd))+'</span>',dot(x.live,x.liveWhy),'history read from disk, the panel cannot stop or message it','last activity '+esc(recent(x.mtime))].filter(Boolean).join(' · ');
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
 if(x.live==='running'||x.live==='recent')timer=setTimeout(()=>load(false),4000)}

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
 if(a==='delete'&&!confirm('Delete "'+title+'"?\n\n'+(FILES[provider]?'Moves this session to the Command Center trash folder. A session counts as working only if it changed in the last 2 minutes, so stop it first if it is still open.':'Hides this session for good.')))return false;
 try{const r=await fetch('/session/meta?p='+enc(provider)+'&id='+enc(id)+'&a='+a,{method:'POST',body});const x=await r.json().catch(()=>({}));if(!r.ok){alert(x.error||'Could not do that.');return false}}catch(e){alert('Could not reach the panel.');return false}
 return true};
const vact=async a=>{const x=cur?.x;if(!x||!await window.sessAct(cur.p,cur.id,a,x.title||x.id))return;
 window.sessReload?.();if(a==='delete')return close();clearTimeout(timer);load(false)};
$('vren').onclick=()=>vact('rename');$('varc').onclick=()=>vact(cur?.x?.archived?'unarchive':'archive');$('vdel').onclick=()=>vact('delete');
const AGENT={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude',antigravity:'Antigravity'},RANK={running:0,recent:1,unknown:2,finished:3};
window.sessTable=list=>{
 const rows=list.filter(s=>s.id&&(!s.archived||showArch)).sort((a,b)=>(RANK[a.live]??2)-(RANK[b.live]??2)||b.mtime-a.mtime);
 return list.filter(s=>!s.id).map(s=>'<div class="'+(s.note?'pg-hint':'tk-warn')+'">'+esc(s.title)+'</div>').join('')
  +'<table class="ss" aria-label="Sessions"><thead><tr><th>Agent</th><th>Doing</th><th>Folder</th><th>Last activity</th><th>State</th><th></th></tr></thead><tbody>'
  +rows.map(s=>'<tr class="srow'+(s.archived?' arch':'')+'" data-p="'+esc(s.provider)+'" data-id="'+esc(s.id)+'"><td><span class="tk-badge p-'+esc(s.provider)+'">'+esc(AGENT[s.provider]||s.provider)+'</span></td><td class="st"><button type="button" class="session-open" data-session-open>'+esc(s.title||s.id)+'</button>'+(s.model?'<div class="m">'+esc(s.model)+'</div>':'')+'</td><td title="'+esc(s.cwd)+'">'+esc(last2(s.cwd))+'</td><td>'+esc(recent(s.mtime))+'</td><td class="sst">'+dot(s.live,s.liveWhy)+'</td><td class="sact"><button class="pill" data-a="rename">Rename</button><button class="pill" data-a="'+(s.archived?'unarchive':'archive')+'">'+(s.archived?'Unarchive':'Archive')+'</button><button class="pill" data-a="delete">Delete</button></td></tr>').join('')+'</tbody></table>'};
window.sessClick=(e,list,reload)=>{
 if(e.target.closest('[data-tog]')){showArch=!showArch;sessionPage=0;reload();return}
 const r=e.target.closest('.srow');if(!r)return;
 const p=r.dataset.p,id=r.dataset.id,b=e.target.closest('[data-a]');
 if(!b){if(p==='freebuff'){setTab('freebuff');pick(id);location.hash=id}else window.openSession(p,id);return}
 const s=list.find(x=>x.provider===p&&x.id===id);
 if(s)window.sessAct(p,id,b.dataset.a,s.title||id).then(ok=>ok&&reload())};

$('vclose').onclick=close;
$('view').onclick=e=>{if(e.target===$('view'))close()};
document.addEventListener('keydown',e=>{const view=$('view');if(view.hidden)return;if(e.key==='Escape'){close();return}if(e.key!=='Tab')return;const items=[...view.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.tabIndex!==-1&&x.getClientRects().length);if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
$('vfeed').addEventListener('toggle',e=>{const k=e.target.dataset?.k;if(k)e.target.open?opened.add(k):opened.delete(k)},true);
$('vfeed').onclick=e=>{const b=e.target.closest('[data-expand]');if(b){const t=b.previousElementSibling;expanded.add(b.dataset.expand);t.classList.remove('long');t.tabIndex=-1;b.remove();t.focus({preventScroll:true})}};

let gen=0,sessionComposing=false;
function renderSessions(el,list){
 const live=(list||[]).filter(s=>s.id&&!s.archived),n=k=>live.filter(s=>(s.live||'unknown')===k).length,top=el.scrollTop,left=el.querySelector('.session-table-wrap')?.scrollLeft||0;
 const fe=document.activeElement,searching=fe?.id==='session-search',cursor=searching?fe.selectionStart:null,control=el.contains(fe)&&['session-provider','session-state'].includes(fe.id)?fe.id:'',fr=el.contains(fe)&&fe.closest('.srow'),fk=fr&&[fr.dataset.p,fr.dataset.id,fe.dataset.a,fe.hasAttribute('data-session-open')];
 const q=sessionQuery.trim().toLowerCase(),rows=(list||[]).filter(s=>s.id&&(showArch||!s.archived)&&(sessionProvider==='all'||s.provider===sessionProvider)&&(sessionState==='all'||(s.live||'unknown')===sessionState)&&(!q||[s.title,s.id,s.cwd,s.model].some(v=>String(v||'').toLowerCase().includes(q)))).sort((a,b)=>(RANK[a.live]??2)-(RANK[b.live]??2)||b.mtime-a.mtime);
 const pages=Math.max(1,Math.ceil(rows.length/SESSION_PAGE_SIZE));sessionPage=Math.min(sessionPage,pages-1);const visible=rows.slice(sessionPage*SESSION_PAGE_SIZE,(sessionPage+1)*SESSION_PAGE_SIZE),arch=(list||[]).filter(s=>s.id&&s.archived).length;
 el.innerHTML='<div class="pg sess-all"><div class="cc-pagehead"><div><div class="cc-eyebrow">WORKSPACE / ACTIVITY</div><h2>Sessions</h2><p class="cc-lead">Find a conversation and see its latest activity.</p></div><div class="cc-count"><b>'+live.length+'</b><span>visible sessions</span></div></div>'
  +'<div class="session-summary"><div><b>'+n('running')+'</b><span>running (verified)</span></div><div><b>'+n('recent')+'</b><span>recent activity</span></div><div><b>'+n('unknown')+'</b><span>unknown</span></div><div><b>'+n('finished')+'</b><span>finished</span></div><p>Running means a live process was found and wrote recently. Recent activity alone does not verify a process. The list may be limited to 15 sessions per provider; these are history and cannot be controlled here.</p></div>'
  +'<div class="session-toolbar"><label><span>Search</span><input id="session-search" type="search" placeholder="Title, model or folder" value="'+esc(sessionQuery)+'"></label><label><span>Agent</span><select id="session-provider">'+[['all','All agents'],...Object.entries(AGENT)].map(([id,label])=>'<option value="'+esc(id)+'"'+(sessionProvider===id?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label><label><span>Activity</span><select id="session-state">'+[['all','All states'],['running','Running (verified)'],['recent','Recent activity'],['unknown','Unknown'],['finished','Finished']].map(([id,label])=>'<option value="'+id+'"'+(sessionState===id?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+(arch?'<button class="pill" data-tog="1">'+(showArch?'Hide':'Show')+' archived ('+arch+')</button>':'')+'</div>'
  +(list===null?'<div class="empty">Could not load sessions.</div>':(list||[]).filter(s=>!s.id).map(s=>'<div class="'+(s.note?'pg-hint':'tk-warn')+'">'+esc(s.title)+'</div>').join('')+(visible.length?'<div class="session-table-wrap">'+window.sessTable(visible)+'</div>':'<div class="empty">No sessions match these filters.</div>'))
  +'<div class="archive-pager"><span>'+rows.length+' matching · page '+(sessionPage+1)+' of '+pages+'</span><button class="pill" data-session-page="prev"'+(sessionPage===0?' disabled':'')+'>Previous</button><button class="pill" data-session-page="next"'+(sessionPage+1>=pages?' disabled':'')+'>Next</button></div></div>';
 const root=el.firstChild,reload=()=>renderSessions(el,list);root.onclick=e=>{const b=e.target.closest('[data-session-page]');if(b){sessionPage+=b.dataset.sessionPage==='next'?1:-1;return reload()}window.sessClick(e,list||[],()=>PAGES.sessions(el))};
 root.onchange=e=>{if(e.target.id==='session-provider')sessionProvider=e.target.value;else if(e.target.id==='session-state')sessionState=e.target.value;else return;sessionPage=0;reload()};
 root.oninput=e=>{if(e.target.id!=='session-search'||e.isComposing)return;sessionQuery=e.target.value;sessionPage=0;reload()};
 root.addEventListener('compositionstart',e=>{if(e.target.id==='session-search')sessionComposing=true});
 root.addEventListener('compositionend',e=>{if(e.target.id==='session-search'){sessionComposing=false;sessionQuery=e.target.value;sessionPage=0;reload()}});
 el.scrollTop=top;const wrap=el.querySelector('.session-table-wrap');if(wrap)wrap.scrollLeft=left;if(searching){const x=el.querySelector('#session-search');x?.focus();if(cursor!=null)x?.setSelectionRange(cursor,cursor)}else if(control)el.querySelector('#'+control)?.focus({preventScroll:true});
 if(fk){const t=el.querySelector('.srow[data-p="'+CSS.escape(fk[0])+'"][data-id="'+CSS.escape(fk[1])+'"]');(fk[2]?t?.querySelector('[data-a="'+CSS.escape(fk[2])+'"]'):fk[3]?t?.querySelector('[data-session-open]'):null)?.focus({preventScroll:true})}}
PAGES.sessions=async el=>{
 if(sessionComposing||(el.contains(document.activeElement)&&document.activeElement.tagName==='SELECT'))return;
 const my=++gen;
 let list;try{const r=await fetch('/sessions');if(!r.ok)throw 0;list=await r.json()}catch(e){list=null}
 if(my!==gen||!el.isConnected||tab!=='sessions')return;
 window.sessReload=()=>PAGES.sessions(el);
 renderSessions(el,list)};
setInterval(()=>{if(tab==='sessions')PAGES.sessions($('prov'))},10000);
})();
