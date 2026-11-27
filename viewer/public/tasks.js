(()=>{
const P={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude',antigravity:'Antigravity',auto:'Automatic'};
const KINDS={code:['Coding','Real changes: features and fixes. Uses the strongest model.'],light:['Small coding','Small, clearly scoped edits. Uses a cheaper, faster model.'],read:['Read only','Looking, summarising and reviewing. The agent may not change files, only write its report.']};
const j=async u=>{try{return await (await fetch(u)).json()}catch(e){return null}};
const ms=v=>v&&v<1e11?v*1000:v||0;
const ts=iso=>iso?Date.parse(iso):0;
const at=iso=>iso?ago(ts(iso)):'';
const short=p=>String(p||'').split(/[\\/]+/).filter(Boolean).slice(-2).join('/');
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
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
 const st=el.scrollTop;el.innerHTML=html;shownHtml[key]=html;el.scrollTop=st}

function hoursCard(u){
 if(!u||u.loading)return card('Freebuff hours left','…','',['Checking…']);
 if(u.error||!u.today)return card('Freebuff hours left','?','',[esc(u.error||'No data yet.')]);
 const t=u.today,[hh,mm]=String(t.left).split(':').map(Number),pct=t.limit?Math.round(100*(hh+(mm||0)/60)/t.limit):0;
 return card('Freebuff hours left',esc(t.left),'of '+esc(t.limit)+' h today',[bar(pct),t.flashHours!=null?'About '+esc(t.flashHours)+' h of DeepSeek work.':'','Cheaper models cost less of these hours.'])}

function routeCard(r){
 if(!r||r.loading)return card('Next task goes to','…','',['Checking usage…']);
 if(r.error)return card('Next task goes to','unknown','',[esc(r.error)]);
 return card('Next task goes to',esc(P[r.provider]||r.provider),esc(r.model),[esc(r.why),'This is for Automatic coding tasks.'])}

PAGES.home=async el=>{
 if(busy.home)return;busy.home=1;
 try{
  const [t,ss,r,u,bd]=await Promise.all([j('/tasks'),j('/sessions'),j('/usage?p=route'),j('/usage?p=freebuff'),j('/board?json=1')]);
  if(tab!=='home')return;
  const tasks=t?.tasks||[],run=tasks.filter(isRun).length,wait=tasks.filter(x=>x.status==='waiting').length,fail=tasks.filter(x=>x.status==='failed').length;
  const today=new Date().toDateString(),doneToday=tasks.filter(x=>x.status==='done'&&new Date(ts(x.endedAt)).toDateString()===today).length;
  const work=(Array.isArray(ss)?ss:[]).filter(s=>(s.live==='running'||s.live==='recent')&&!s.archived).sort((a,b)=>ms(b.mtime)-ms(a.mtime));
  const bits=[];if(run)bits.push(plural(run,'task')+' running');if(wait)bits.push(wait+' waiting');if(work.length)bits.push(plural(work.length,'agent')+' with recent activity');
  const hello=bits.length?bits.join(', '):'All quiet. Nothing is running right now.';
  const per=['freebuff','codex','cursor','opencode','claude','antigravity'].map(p=>[p,work.filter(s=>s.provider===p).length]).filter(x=>x[1]);
  const att=tasks.filter(x=>x.note&&(x.status==='failed'||x.status==='waiting'||isRun(x))).sort((a,b)=>(ts(b.endedAt)||ts(b.createdAt))-(ts(a.endedAt)||ts(a.createdAt)));
  const notes=(Array.isArray(bd)?bd:[]).slice(-5).reverse();
  const html='<div id="hm-root" class="tk">'+health(t)+'<div class="tk-hello">'+esc(hello)+'</div>'
   +'<div class="cards">'
   +card('Tasks',String(run),'running',[wait+' waiting in line',doneToday+' finished today',fail+' failed'])
   +card('Agents with recent activity',String(work.length),'',per.length?per.map(x=>esc(P[x[0]])+': '+x[1]):['No recent activity.'])
   +routeCard(r)+hoursCard(u)+'</div>'
   +(att.length?'<div class="tk-h">Needs a look</div>'+att.slice(0,5).map(x=>'<div class="tk-att"><div>'+dot(x.status)+'<b>'+esc(x.title)+'</b> <span class="m">'+esc(x.status)+(x.ranOn?' on '+esc(P[x.ranOn]||x.ranOn):'')+'</span></div><div class="tk-note">'+esc(x.note)+'</div><div>'+(x.status==='failed'&&!x.parent?btn('retry','Retry',x.id)+' ':'')+btn('tab','Open Director','',' data-t="director"')+'</div></div>').join('')+(att.length>5?'<div class="m">'+(att.length-5)+' more on the Director tab.</div>':''):'')
   +(tasks.some(isRun)?'<div class="tk-h">Tasks running</div><div class="tk-rows">'+tasks.filter(isRun).slice(0,20).map(x=>'<div class="tk-row" data-tk="tab" data-t="director">'+badge(x.ranOn||x.provider)+'<span class="tk-rt">'+(x.role==='orchestrator'?'Director: ':'')+esc(x.title)+'</span><span class="m">'+esc(x.model||x.modelPref||'')+'</span><span class="m">'+(x.expiresAt?'<b>'+esc(left(x.expiresAt))+' left</b>':x.ranOn==='freebuff'?'no hour yet':'')+'</span></div>').join('')+'</div>':'')
   +'<div class="tk-h">Recent activity (last 2 minutes)</div>'
   +(work.length?'<div class="tk-rows">'+work.slice(0,40).map(s=>'<div class="tk-row" data-tk="open" data-p="'+esc(s.provider)+'" data-id="'+esc(s.id)+'">'+badge(s.provider)+'<span class="tk-rt">'+esc(String(s.title||s.id).slice(0,90))+'</span><span class="m tk-rf" title="'+esc(s.cwd||'')+'">'+esc(short(s.cwd))+'</span><span class="m">'+(ms(s.mtime)?ago(ms(s.mtime)):'')+'</span></div>').join('')+'</div>':'<div class="tk-empty">No agent has written in the last 2 minutes.</div>')
   +'<div class="tk-h">Latest board notes '+btn('tab','Open Director','',' data-t="director"')+'</div>'
   +(notes.length?notes.map(n=>'<div class="note"><div class="m"><b>'+esc(n.from)+'</b> · '+when(n.at)+'</div><div class="t">'+md(String(n.text).slice(0,300)+(String(n.text).length>300?'…':''))+'</div></div>').join(''):'<div class="tk-empty">No notes yet.</div>')
   +'</div>';
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
 return '<div class="tk-h">'+title+' ('+list.length+')</div>'+(list.length?'<table class="ss tk-table"><thead><tr><th></th><th>Task</th><th>Kind</th><th>Provider</th><th>Folder</th><th>Times</th><th>Note</th><th></th></tr></thead><tbody>'+list.map(row).join('')+'</tbody></table>':'<div class="tk-empty">'+empty+'</div>')}

function paint(){
 const root=$('tk-root');if(!root||tab!=='director')return;
 const t=last.t,tasks=t?.tasks||[];
 $('tk-health').innerHTML=health(t);
 const list=$('tk-list'),sl=getSelection();
 if(sl&&!sl.isCollapsed&&list.contains(sl.anchorNode))return;
 const run=tasks.filter(isRun).sort((a,b)=>ts(a.startedAt)-ts(b.startedAt)),wait=tasks.filter(x=>x.status==='waiting');
 const fin=tasks.filter(x=>['done','failed','cancelled','interrupted'].includes(x.status)).sort((a,b)=>(ts(b.endedAt)||ts(b.createdAt))-(ts(a.endedAt)||ts(a.createdAt))).slice(0,30);
 const saved={};for(const p of list.querySelectorAll('pre[data-k]'))saved[p.dataset.k]=[p.scrollTop,p.scrollHeight-p.scrollTop-p.clientHeight<30];
 const el=$('prov'),st=el.scrollTop;
 list.innerHTML=group('Running',run,'No task is running.')+group('Waiting in line',wait,'Nothing is waiting.')+group('Finished (newest first)',fin,'No finished tasks yet.');
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
 if(a==='tab')return setTab(b.dataset.t);
 if(a==='open'){
  if(b.dataset.p==='freebuff'){setTab('freebuff');location.hash=id}else window.openSession?.(b.dataset.p,id);
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

const refresh=()=>{if(tab==='home')PAGES.home($('prov'),true)};
setInterval(refresh,4500);refresh();setTimeout(refresh,1500);
})();
