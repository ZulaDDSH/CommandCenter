(()=>{
const P={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude',antigravity:'Antigravity',auto:'Automatic'};
const KINDS={code:['Coding','Real changes: features and fixes. Uses the strongest model.'],light:['Small coding','Small, clearly scoped edits. Uses a cheaper, faster model.'],read:['Read only','Looking, summarising and reviewing. The agent may not change files, only write its report.']};
const j=async u=>{try{return await (await fetch(u)).json()}catch(e){return null}};
const ts=iso=>iso?Date.parse(iso):0;
const at=iso=>iso?ago(ts(iso)):'';
const short=p=>String(p||'').split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
let usageOpen=false,usageProvider='freebuff',usageNotice='',usageRefreshId=0;
const badge=p=>'<span class="tk-badge p-'+esc(p)+'">'+esc(P[p]||p)+'</span>';
const isRun=t=>t.status==='running'||t.status==='starting';
const DOT={running:'live',starting:'idle',waiting:'queued',done:'done',failed:'failed',cancelled:'cancelled',interrupted:'failed'};
const dot=s=>'<span class="dot '+(DOT[s]||'queued')+'" title="'+esc(s)+'"></span>';
const btn=(a,label,id,extra)=>'<button class="pill" data-tk="'+a+'"'+(id?' data-id="'+esc(id)+'"':'')+(extra||'')+'>'+label+'</button>';
const busy={},last={t:null,ss:null},views={},open=new Set(),shownHtml={};


function health(t){
 if(!t)return '<div class="tk-bad"><b>Could not reach the panel server.</b></div>';
 const d=t.dispatcher||{};
 return ((!d.lastTick||Date.now()-d.lastTick>15000||d.error)?'<div class="tk-bad"><b>The task dispatcher is not running.</b>'+(d.error?' '+esc(d.error):'')+' Waiting tasks will not start until it is back.</div>':'')
  +(t.driver?.error?'<div class="tk-warn">The Freebuff driver could not load: '+esc(t.driver.error)+'</div>':'')}

function put(el,key,rootId,html){
 if(shownHtml[key]===html&&el.querySelector('#'+rootId))return;
 const active=el.contains(document.activeElement)?document.activeElement:null;
 const match=b=>active&&['tk','id','t','p'].every(k=>b.dataset[k]===active.dataset[k]);
 const index=active?.matches('button[data-tk]')?Array.from(el.querySelectorAll('button[data-tk]')).filter(match).indexOf(active):-1;
 const st=el.scrollTop,usageTop=el.querySelector('#home-usage-body')?.scrollTop||0;el.innerHTML=html;shownHtml[key]=html;el.scrollTop=st;const usageBody=el.querySelector('#home-usage-body');if(usageBody)usageBody.scrollTop=usageTop;
 if(index>=0)Array.from(el.querySelectorAll('button[data-tk]')).filter(match)[index]?.focus({preventScroll:true})}

const getBudget=async()=>{try{const r=await fetch('/budget');if(!r.ok)throw 0;return await r.json()}catch{return {error:'Could not load usage. Try again.'}}};
function usageDetails(provider,entry){
 if(!entry)return '<div class="usage-empty">Usage is unavailable right now.</div>';
 if(!entry.enabled)return '<div class="usage-empty">This provider is turned off.</div>';
 if(entry.error)return '<div class="usage-empty">Usage could not be read: '+esc(entry.error)+'</div>';
 if(provider==='freebuff'){
  const head=entry.hoursLeft!=null?'<div class="usage-line"><span>Shared Freebuff hours</span><b>'+esc(entry.hoursLeft)+' left</b></div>':'<div class="usage-empty">Shared hours unavailable.</div>';
  const rows=(entry.models||[]).map(m=>'<div class="usage-line"><span>'+esc(m.name)+'</span><b>'+esc(m.workHoursLeft==='unlimited'?'No Freebuff hours charged':m.workHoursLeft==null?'Unavailable':m.workHoursLeft+' h estimated')+'</b></div>').join('');
  return head+'<p>Model estimates use the shared Freebuff allowance.</p>'+(rows||'<div class="usage-empty">Model estimates are unavailable.</div>');
 }
 if(provider==='codex'){
  const rows=(entry.windows||[]).map(w=>{const left=!w.stale&&typeof w.usedPercent==='number'?Math.max(0,Math.min(100,100-w.usedPercent))+'% left':'Unavailable';const label=w.minutes>=1440?(w.minutes/1440)+'-day window':w.minutes?(w.minutes/60)+'-hour window':'Usage window';return '<div class="usage-line"><span>'+esc(label)+(w.resetsAt?'<small>Resets '+esc(new Date(w.resetsAt).toLocaleString())+'</small>':'')+'</span><b>'+esc(left)+'</b></div>'}).join('');
  return '<p>These usage windows are shared across Codex models.</p>'+(rows||'<div class="usage-empty">Remaining usage is unavailable.</div>');
 }
 if(provider==='opencode'){
  const names={rolling:'5-hour window',weekly:'Weekly window',monthly:'Monthly window'};
  const rows=(entry.windows||[]).map(w=>'<div class="usage-line"><span>'+esc(names[w.name]||w.name)+(w.resetsAt?'<small>Resets '+esc(new Date(w.resetsAt).toLocaleString())+'</small>':'')+'</span><b>'+esc((100-w.usedPercent)+'% left')+'</b></div>').join('');
  return '<p>OpenCode Go models share these usage windows.</p>'+(rows||'<div class="usage-empty">'+esc(entry.note||'Remaining usage is unavailable.')+'</div>');
 }
 return '<div class="usage-empty">Remaining usage is unavailable. Check your '+esc(P[provider])+' account for its current limits.</div>';
}
function usageDrawer(budget){
 const providers=(budget&&budget.providers)||{},order=['freebuff','codex','cursor','opencode','claude','antigravity'];
 return '<section role="region" id="home-usage" class="home-usage'+(usageOpen?' is-open':'')+'" aria-label="Model usage" aria-hidden="'+(!usageOpen)+'"'+(usageOpen?'':' inert')+'><div class="usage-head"><div><h2>Model usage</h2><p>Remaining usage by provider</p></div><div class="usage-actions"><button type="button" class="pill" data-tk="usage-refresh">Refresh</button><button type="button" class="pill" data-tk="usage-close" aria-label="Close usage">Close</button></div></div><div class="usage-tabs" aria-label="Usage providers">'+order.map(p=>'<button type="button" class="pill'+(p===usageProvider?' on':'')+'" data-tk="usage-provider" data-p="'+p+'" aria-pressed="'+(p===usageProvider)+'">'+esc(P[p])+'</button>').join('')+'</div><div id="home-usage-body" class="usage-body"><h3>'+esc(P[usageProvider])+'</h3><div class="usage-notice" role="status">'+esc(usageNotice)+'</div>'+(budget?.error?'<div class="usage-empty">'+esc(budget.error)+'</div>':budget?usageDetails(usageProvider,providers[usageProvider]):'<div class="usage-empty">Loading usage...</div>')+'</div></section>';
}
PAGES.home=async el=>{
 if(busy.home)return;busy.home=1;
 try{
  const [t,budget]=await Promise.all([j('/tasks?brief=1'),usageOpen?getBudget():Promise.resolve(null)]);
  if(tab!=='home')return;
  const tasks=t?.tasks||[],run=tasks.filter(isRun).length,wait=tasks.filter(x=>x.status==='waiting').length;
  const hello=run||wait?[run?plural(run,'task')+' running':'',wait?plural(wait,'task')+' waiting':''].filter(Boolean).join(' · '):'No Command Center tasks are running.';
  const html='<div id="hm-root" class="tk home-page"><div class="home-intro"><div class="cc-eyebrow">WORKSPACE / OVERVIEW</div><h1>Your command center</h1><p>'+esc(hello)+'</p><button type="button" class="pill home-usage-trigger" data-tk="usage-open" aria-controls="home-usage" aria-expanded="'+usageOpen+'">Model usage</button></div>'+health(t)
   +'<div class="home-nav" aria-label="Workspace pages"><div class="home-nav-heading">WORKSPACE</div>'
   +'<button type="button" class="home-link" data-tk="tab" data-t="director"><span><b>Director</b><small>Plan and follow work</small></span><span aria-hidden="true">→</span></button>'
   +'<button type="button" class="home-link" data-tk="tab" data-t="sessions"><span><b>Sessions</b><small>Open conversations and see their status</small></span><span aria-hidden="true">→</span></button>'
   +'<button type="button" class="home-link" data-tk="tab" data-t="archive"><span><b>Archive</b><small>Find previous work</small></span><span aria-hidden="true">→</span></button>'
   +'<button type="button" class="home-link" data-tk="tab" data-t="setup"><span><b>Setup</b><small>Manage providers and preferences</small></span><span aria-hidden="true">→</span></button></div>'+usageDrawer(budget)+'</div>';
  put(el,'home','hm-root',html);
 }finally{busy.home=0}};

function build(el){
 el.innerHTML='<div id="tk-root" class="tk"><div id="tk-health"></div><div id="tk-list"></div></div>'}

function row(t){
 const b=[];
 if(isRun(t)||t.status==='waiting')b.push(btn('cancel','Stop',t.id));
 if(['failed','cancelled','interrupted'].includes(t.status)&&!t.parent)b.push(btn('retry','Retry',t.id));
 b.push(btn('view',open.has(t.id)?'Hide':'View',t.id));
 if(t.status==='running'&&t.ranOn==='opencode'&&window.openSession){
  const s=(last.ss||[]).find(x=>x.provider==='opencode'&&String(x.title).includes(t.id));
  if(s)b.push('<button class="pill" data-tk="open" data-p="opencode" data-id="'+esc(s.id)+'">Open session</button>')}
 const note=[t.status==='waiting'&&t.reason?esc(t.reason):'',t.note?'<span class="'+(t.status==='failed'?'tk-err':'')+'">'+esc(t.note)+'</span>':''].filter(Boolean).join('<br>');
 const d=Math.min(t.depth||0,3),pt=t.parent&&last.t?.tasks?.find(x=>x.id===t.parent);
 let r='<tr><td>'+dot(t.status)+'</td><td class="tk-title" style="padding-left:'+(8+d*18)+'px">'+(d?'<span class="m">↳ </span>':'')+(t.role==='orchestrator'?'<span class="tk-badge">Director</span> ':'')+'<b>'+esc(t.title)+'</b><div class="m">'+esc(t.hold?'waiting for the director':t.status)+(pt?' · sub-task of '+esc(String(pt.title).slice(0,40)):'')+'</div></td>'
  +'<td>'+esc(t.role==='orchestrator'?'Director':(KINDS[t.kind]||[t.kind])[0])+'</td>'
  +'<td>'+esc(P[t.provider]||t.provider)+(t.ranOn?' → <b>'+esc(P[t.ranOn]||t.ranOn)+'</b>':'')+((t.model||t.modelPref)?'<div class="m">'+esc(t.model||t.modelPref)+'</div>':'')+(t.expiresAt?'<div class="m"><b>'+esc(left(t.expiresAt))+' left</b> in this Freebuff hour</div>':'')+'</td>'
  +'<td class="m" title="'+esc(t.cwd||'')+'">'+esc(short(t.cwd))+'</td>'
  +'<td class="m"><div>Created '+at(t.createdAt)+'</div>'+(t.startedAt?'<div>Started '+at(t.startedAt)+'</div>':'')+(t.endedAt?'<div>Ended '+at(t.endedAt)+'</div>':'')+'</td>'
  +'<td class="tk-notecell">'+note+'</td><td class="tk-btns">'+b.join(' ')+'</td></tr>';
 if(open.has(t.id)){
  const v=views[t.id],pre=(k,s,empty)=>'<pre class="tk-pre" data-k="'+k+esc(t.id)+'">'+(s?esc(s):'<span class="m">'+empty+'</span>')+'</pre>';
  r+='<tr class="tk-view"><td colspan="8"><div class="tk-vt">Task</div>'+pre('txt:',v?.task?.text??t.text,'')
   +'<div class="tk-vt">Report</div>'+(v?pre('rep:',v.report,'No report yet.'):'<div class="m">Loading…</div>')
   +'<div class="tk-vt">Log (last part)</div>'+(v?pre('log:',v.log,t.ranOn==='freebuff'?'No log. Freebuff tasks work inside their own session.':'No output yet.'):'<div class="m">Loading…</div>')
   +'</td></tr>'}
 return r}

function tree(list){
 const ids=new Set(list.map(t=>t.id)),out=[],seen=new Set();
 const add=(t,n)=>{if(seen.has(t.id)||n>6)return;seen.add(t.id);out.push(t);for(const k of list)if(k.parent===t.id)add(k,n+1)};
 for(const t of list)if(!t.parent||!ids.has(t.parent))add(t,0);
 for(const t of list)add(t,0);
 return out}

function group(title,list,empty){
 list=tree(list);
 return '<div class="tk-h">'+title+' ('+list.length+')</div>'+(list.length?'<div class="tk-scroll-hint">Scroll horizontally to see all task details.</div><div class="tk-table-wrap" tabindex="0" role="region" aria-label="'+title+' tasks"><table class="ss tk-table"><thead><tr><th></th><th>Task</th><th>Kind</th><th>Provider</th><th>Folder</th><th>Times</th><th>Note</th><th></th></tr></thead><tbody>'+list.map(row).join('')+'</tbody></table></div>':'<div class="tk-empty">'+empty+'</div>')}

function paint(){
 const root=$('tk-root');if(!root||tab!=='director')return;
 const t=last.t,tasks=t?.tasks||[];
 $('tk-health').innerHTML=health(t);
 const list=$('tk-list'),sl=getSelection();
 if(sl&&!sl.isCollapsed&&list.contains(sl.anchorNode))return;
 const run=tasks.filter(isRun).sort((a,b)=>ts(a.startedAt)-ts(b.startedAt)),wait=tasks.filter(x=>x.status==='waiting');
 const fin=tasks.filter(x=>['done','failed','cancelled','interrupted'].includes(x.status)).sort((a,b)=>(ts(b.endedAt)||ts(b.createdAt))-(ts(a.endedAt)||ts(a.createdAt))).slice(0,30);
 const saved={};for(const p of list.querySelectorAll('pre[data-k]'))saved[p.dataset.k]=[p.scrollTop,p.scrollHeight-p.scrollTop-p.clientHeight<30];
 const scroll=Object.fromEntries(Array.from(list.querySelectorAll('.tk-table-wrap'),p=>[p.getAttribute('aria-label'),p.scrollLeft]));
 const focused=document.activeElement?.classList.contains('tk-table-wrap')?document.activeElement.getAttribute('aria-label'):null;
 const el=$('prov'),st=el.scrollTop;
 list.innerHTML=group('Running',run,'No task is running.')+group('Waiting in line',wait,'Nothing is waiting.')+group('Finished (newest first)',fin,'No finished tasks yet.');
 list.querySelectorAll('.tk-table-wrap').forEach(p=>{const label=p.getAttribute('aria-label');p.scrollLeft=scroll[label]||0;if(label===focused)p.focus({preventScroll:true})});
 for(const p of list.querySelectorAll('pre[data-k]')){const o=saved[p.dataset.k];p.scrollTop=!o||o[1]?p.scrollHeight:o[0]}
 el.scrollTop=st}

async function fetchView(id){
 const d=await j('/task-log?id='+encodeURIComponent(id));
 if(d&&d.task)views[id]=d}

async function load(){
 const [t,ss]=await Promise.all([j('/tasks?brief=1'),j('/sessions')]);
 if(t)last.t=t;if(Array.isArray(ss))last.ss=ss;
 const tasks=last.t?.tasks||[];
 await Promise.all([...open].map(id=>{const x=tasks.find(y=>y.id===id);if(!x){open.delete(id);delete views[id];return}
  const v=views[id];return(!v||isRun(x)||v.task.status!==x.status)?fetchView(id):0}));
 paint()}

window.TASKS=async el=>{
 if(busy.tasks)return;busy.tasks=1;
 try{
  if(!el.querySelector('#tk-root'))build(el);
  await load();
 }finally{busy.tasks=0}};

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-tk]');if(!b)return;
 const a=b.dataset.tk,id=b.dataset.id;
 if(a==='usage-open'||a==='usage-close'){usageOpen=a==='usage-open';if(!usageOpen){usageRefreshId++;usageNotice=''}const drawer=$('home-usage'),trigger=document.querySelector('[data-tk="usage-open"]');drawer.classList.toggle('is-open',usageOpen);drawer.inert=!usageOpen;drawer.setAttribute('aria-hidden',String(!usageOpen));trigger?.setAttribute('aria-expanded',String(usageOpen));if(usageOpen){drawer.querySelector('[data-tk="usage-close"]')?.focus();PAGES.home($('prov'))}else trigger?.focus();return}
 if(a==='usage-provider'){usageRefreshId++;usageProvider=b.dataset.p;usageNotice='';return PAGES.home($('prov'))}
 if(a==='usage-refresh'){const p=usageProvider,id=++usageRefreshId;usageNotice='Refreshing usage...';const n=$('home-usage-body')?.querySelector('.usage-notice');if(n)n.textContent=usageNotice;try{const ps=p==='freebuff'?['freebuff','fbmodels']:['codex','cursor','opencode'].includes(p)?[p]:[];const results=await Promise.all(ps.map(x=>fetch('/usage?p='+encodeURIComponent(x)+'&fresh=1')));if(results.some(r=>!r.ok))throw 0;if(id!==usageRefreshId)return;usageNotice=ps.length?'Refresh requested. Values may take a moment.':'Checking available usage...'}catch{if(id!==usageRefreshId)return;usageNotice='Could not request a refresh.'}if(tab==='home'&&usageOpen)PAGES.home($('prov'));setTimeout(()=>{if(id!==usageRefreshId)return;usageNotice='';if(tab==='home'&&usageOpen)PAGES.home($('prov'))},3000);return}
 if(a==='tab')return setTab(b.dataset.t);
 if(a==='open'){
  window.openSession?.(b.dataset.p,id);
  return}
 if(a==='view'){
  if(open.has(id))open.delete(id);else{open.add(id);delete views[id]}
  paint();if(open.has(id)){await fetchView(id);paint()}
  return}
 if(a==='cancel'&&!confirm('Stop this task? A running agent will be stopped.'))return;
 b.disabled=true;
 const r=await fetch('/tasks/'+encodeURIComponent(id)+'/'+a,{method:'POST'}).catch(()=>null);
 const d=r?await r.json().catch(()=>null):null;
 if(!r||!r.ok||!d||d.error)alert(d?.error||'Could not reach the server.');
 if(a==='retry')delete views[id];
 if(tab==='home')PAGES.home($('prov'));else if(tab==='director'&&$('tk-root'))load();
});

document.addEventListener('keydown',e=>{if(tab==='home'&&usageOpen&&e.key==='Escape'){e.preventDefault();document.querySelector('[data-tk="usage-close"]')?.click()}});
const refresh=()=>{if(tab==='home')PAGES.home($('prov'),true)};
setInterval(refresh,4500);refresh();setTimeout(refresh,1500);
})();
