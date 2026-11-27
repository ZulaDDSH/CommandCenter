(()=>{
const LABEL={working:'working',idle:'waiting for you',done:'finished'},DOT={working:'live',idle:'idle',done:'done'};
const dot=s=>'<span class="sdot '+(DOT[s]||'done')+'"></span>'+(LABEL[s]||esc(s));
const last2=p=>String(p||'').split(/[\\/]/).filter(Boolean).slice(-2).join('/')||'?';
const stamp=t=>{const d=new Date(t);return isNaN(d)?'?':d.toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const recent=ms=>ms?(Date.now()-ms<864e5?ago(ms):stamp(ms)):'?';
const opened=new Set(),expanded=new Set(),showArch=new Set();
let cur=null,timer=0,token=0,lastRaw='';

function steps(x){const key=x.provider+':'+x.id+':';
 return x.steps.map((s,i)=>{const k=key+i;
  if(s.k==='user')return '<div class="user">'+md(s.text)+'</div>';
  if(s.k==='text'){const t=s.text||'',long=t.split('\n').length>6||t.length>600;return '<div class="text'+(long&&!expanded.has(k)?' long':'')+'" data-k="'+esc(k)+'">'+md(t)+'</div>'}
  return '<details class="tool" data-k="'+esc(k)+'"'+(opened.has(k)?' open':'')+'><summary><span class="tag '+kind(s.name||'')+'">'+esc(s.name)+'</span><span class="cmd">'+esc(s.input)+'</span></summary><pre>'+esc(s.output||'(no output yet)')+'</pre></details>'}).join('')||'<div class="empty">No messages yet.</div>'}

function render(x){cur.x=x;$('vact').hidden=false;$('varc').textContent=x.archived?'Unarchive':'Archive';const f=$('vfeed'),atBottom=f.scrollHeight-f.scrollTop-f.clientHeight<80,top=f.scrollTop;
 $('vtitle').textContent=x.title||x.id;
 $('vmeta').innerHTML=[esc(x.provider),x.model&&esc(x.model),'<span title="'+esc(x.cwd)+'">'+esc(last2(x.cwd))+'</span>',dot(x.state),'last activity '+esc(recent(x.mtime))].filter(Boolean).join(' · ');
 f.innerHTML=steps(x);
 f.scrollTop=($('vfollow').checked&&atBottom)?f.scrollHeight:top}

async function load(first){const t=token;let raw,ok;
 try{const r=await fetch('/session?p='+encodeURIComponent(cur.p)+'&id='+encodeURIComponent(cur.id));ok=r.ok;raw=await r.text()}catch(e){raw=null}
 if(t!==token)return;
 let x=null;try{x=JSON.parse(raw)}catch(e){}
 if(!ok||!x||x.error||!Array.isArray(x.steps)){
  if(first){$('vtitle').textContent='Session not found';$('vmeta').textContent='';$('vfeed').innerHTML='<div class="empty">'+esc(x?.error||'Could not load this session. It may have been removed.')+'</div>'}
  return}
 if(first||raw!==lastRaw){lastRaw=raw;render(x);if(first)$('vfeed').scrollTop=$('vfeed').scrollHeight}
 if(x.state==='working')timer=setTimeout(()=>load(false),4000)}

function close(){token++;clearTimeout(timer);cur=null;$('view').hidden=true}

window.openSession=(provider,id)=>{
 token++;clearTimeout(timer);cur={p:provider,id};lastRaw='';$('vact').hidden=true;
 $('vtitle').textContent='Loading…';$('vmeta').textContent='';$('vfeed').innerHTML='<div class="empty">Loading…</div>';
 $('view').hidden=false;load(true)};

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
window.sessTable=(provider,list)=>{
 const arch=list.filter(s=>s.id&&s.archived),on=showArch.has(provider);
 return '<table class="ss"><thead><tr><th>Title</th><th>Model</th><th>Folder</th><th>Started</th><th>Last activity</th><th>State</th><th></th></tr></thead><tbody>'
  +list.filter(s=>!s.archived||on).map(s=>s.id?'<tr class="srow'+(s.archived?' arch':'')+'" data-id="'+esc(s.id)+'"><td class="st">'+esc(s.title||s.id)+'</td><td>'+esc(s.model||'')+'</td><td title="'+esc(s.cwd)+'">'+esc(last2(s.cwd))+'</td><td>'+esc(s.started?stamp(s.started):'?')+'</td><td>'+esc(recent(s.mtime))+'</td><td class="sst">'+dot(s.state)+'</td><td class="sact"><button class="pill" data-a="rename">Rename</button><button class="pill" data-a="'+(s.archived?'unarchive':'archive')+'">'+(s.archived?'Unarchive':'Archive')+'</button><button class="pill" data-a="delete">Delete</button></td></tr>'
   :'<tr><td colspan="7" class="m">'+esc(s.title)+'</td></tr>').join('')+'</tbody></table>'
  +(arch.length?'<div class="sarch"><button class="pill" data-tog="1">'+(on?'Hide ':'Show ')+arch.length+' archived</button></div>':'')};
window.sessClick=(e,provider,list,reload)=>{
 if(e.target.closest('[data-tog]')){showArch.has(provider)?showArch.delete(provider):showArch.add(provider);reload();return}
 const r=e.target.closest('.srow');if(!r)return;
 const b=e.target.closest('[data-a]');
 if(!b){window.openSession(provider,r.dataset.id);return}
 const s=list.find(x=>x.id===r.dataset.id);
 if(s)window.sessAct(provider,s.id,b.dataset.a,s.title||s.id).then(ok=>ok&&reload())};

$('vclose').onclick=close;
$('view').onclick=e=>{if(e.target===$('view'))close()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('view').hidden)close()});
$('vfeed').addEventListener('toggle',e=>{const k=e.target.dataset?.k;if(k)e.target.open?opened.add(k):opened.delete(k)},true);
$('vfeed').onclick=e=>{const t=e.target.closest('.text.long');if(t){expanded.add(t.dataset.k);t.classList.remove('long')}};

window.sessionsFor=async(provider,el)=>{
 let list;try{const r=await fetch('/sessions');if(!r.ok)throw 0;list=await r.json()}catch(e){list=null}
 if(!el.isConnected||tab!==provider||el.querySelector('.sess'))return;
 const rows=Array.isArray(list)?list.filter(s=>s.provider===provider):[];
 const reload=()=>{el.querySelector('.sess')?.remove();window.sessionsFor(provider,el)};
 window.sessReload=reload;
 const sec=document.createElement('div');sec.className='sess';
 sec.innerHTML='<div class="hl">Sessions</div>'+(list===null?'<div class="empty">Could not load sessions.</div>':!rows.length?'<div class="empty">No sessions found</div>':window.sessTable(provider,rows));
 sec.onclick=e=>window.sessClick(e,provider,rows,reload);
 el.appendChild(sec)};
})();
