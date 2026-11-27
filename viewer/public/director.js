(()=>{
const j=async(u,o)=>{try{const r=await fetch(u,o);const b=await r.json().catch(()=>null);return{ok:r.ok,body:b}}catch(e){return{ok:false,body:{error:'Could not reach the panel: '+e.message}}}};
const post=(u,b)=>j(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});
const PR={1:'P1 highest',2:'P2 high',3:'P3 normal',4:'P4 low',5:'P5 lowest'};
let d=null,at=0,busy=0,msg='',err='',advOpen=false;

const pct=(a,b)=>b?Math.round(100*a/b):0;
const pill=(t,cls)=>'<span class="dr-pill '+(cls||'')+'">'+esc(t)+'</span>';
const when=iso=>{const t=Date.parse(iso||'');if(!t)return '—';const s=Math.round((Date.now()-t)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':s<86400?Math.round(s/3600)+'h ago':new Date(t).toLocaleDateString()};
const at_=iso=>iso?new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

function progress(g){
 const n=g.counts.done+g.counts.failed+g.counts.cancelled+g.counts.interrupted, total=n+g.counts.running+g.counts.waiting+g.counts.starting;
 return '<div class="dr-bar"><i style="width:'+pct(g.counts.done,Math.max(total,1))+'%"></i></div><div class="m">'+g.counts.done+' done · '+g.counts.running+' running · '+g.counts.waiting+' waiting · '+g.counts.failed+' failed'+(g.counts.interrupted?' · '+g.counts.interrupted+' interrupted':'')+' of '+total+'</div>';
}

const SAY={waiting:'waiting',starting:'starting',running:'working',done:'done',failed:'failed',cancelled:'cancelled',interrupted:'interrupted'};
const CLS={done:'ok',running:'stage-working',starting:'stage-working',failed:'bad',interrupted:'warn',waiting:'',cancelled:''};

function goalCard(g){
 const btns=[];
 if(g.controls.canPause)btns.push('<button class="pill" data-d="pause" data-id="'+esc(g.id)+'">Pause</button>');
 if(g.controls.canResume)btns.push('<button class="pill" data-d="resume" data-id="'+esc(g.id)+'">Resume</button>');
 if(g.controls.canSteer)btns.push('<button class="pill" data-d="steer" data-id="'+esc(g.id)+'">Tell the director</button>');
 if(g.controls.canStop)btns.push('<button class="pill" data-d="stop" data-id="'+esc(g.id)+'">Stop</button>');
 if(g.status==='active')btns.push('<button class="pill" data-d="done" data-id="'+esc(g.id)+'">Mark done</button>');
 const needs=g.needsYou.length?'<div class="dr-needs">'+g.needsYou.map(n=>'<div class="dr-n">'+esc(n.detail)+(n.taskId&&n.kind==='resume'?' <button class="pill" data-d="resume-task" data-id="'+esc(n.taskId)+'">Resume task</button>':n.taskId&&n.kind==='retry'?' <button class="pill" data-d="retry-task" data-id="'+esc(n.taskId)+'">Retry task</button>':'')+'</div>').join('')+'</div>':'';
 const rows=(g.tasks||[]).map(t=>'<div class="dr-t">'+(t.director?pill('director','stage-working')+' ':'')+pill(SAY[t.status]||t.status,CLS[t.status])+' <b>'+esc(t.title)+'</b> <span class="m">'+(t.provider?esc(t.provider)+(t.model?' · '+esc(t.model):''):'no model yet')+'</span>'+(t.note?'<div class="m">'+esc(t.note)+'</div>':'')+'</div>').join('')||'<div class="m">The director has not started yet.</div>';
 const reps=g.evidence.filter(e=>e.report);
 const ev=reps.length?'<details class="dr-ev"><summary>Results</summary>'+reps.map(e=>'<div class="dr-e"><div><b>'+esc(e.title)+'</b> <span class="m">'+esc(e.provider||'')+(e.model?' · '+esc(e.model):'')+' · '+when(e.endedAt)+'</span></div><pre class="dr-pre">'+esc(String(e.report.head||'').slice(0,320))+'</pre><div class="m">'+esc(e.report.path)+'</div></div>').join('')+'</details>':'';
 return '<div class="dr-goal"><div class="dr-gh"><div><b>'+esc(g.title)+'</b> '+pill(g.stageLabel,'stage-'+g.stage)+'</div><div class="m">started '+when(g.createdAt)+' · '+esc(g.projectDir)+'</div></div>'
  +progress(g)+needs+'<div class="dr-sec">'+rows+'</div>'+ev
  +'<div class="dr-act">'+btns.join(' ')+'</div></div>';
}

function machinesCard(m){
 if(!m)return '<div class="tk-empty">No machine inventory.</div>';
 const cap=m.self.capabilities;
 const prov=Object.entries(cap.providers).map(([p,v])=>esc(p)+(v.enabled?(v.installed?' ✓':' (off/absent)'):' (turned off)')).join(' · ');
 let h='<div class="dr-goal"><div class="dr-gh"><div><b>'+esc(m.self.name)+'</b> '+pill('this machine','ok')+'</div><div class="m">'+esc(cap.os)+' · node '+esc(cap.node)+' · '+esc(cap.cores)+' cores · worktrees '+(cap.worktrees?'available':'not a git repo')+'</div></div>'
  +'<div class="m">'+prov+'</div><div class="m">Concurrency: '+esc(JSON.stringify(cap.concurrency))+'</div></div>';
 h+=m.peers.length?m.peers.map(p=>'<div class="dr-goal"><div class="dr-gh"><div><b>'+esc(p.name)+'</b> '+pill(p.status,p.status==='online'?'ok':'warn')+' '+pill(p.authenticated?'authenticated':'not authenticated',p.authenticated?'ok':'warn')+'</div><div class="m">'+esc(p.url)+' · id '+esc(p.id||'learned on its first hello')+' · last signed hello '+(p.lastHandshake?when(p.lastHandshake):'never')+(p.capabilities?' · '+esc(p.capabilities.os||'')+', '+(p.capabilities.providers?Object.keys(p.capabilities.providers).filter(k=>p.capabilities.providers[k].enabled).length+' provider(s)':'no providers')+' · claim '+((p.capabilities.claim&&p.capabilities.claim.supported)?'supported':'unsupported'):'')+'</div></div><div class="m">'+esc(p.note)+'</div><div class="dr-act"><button class="pill" data-d="machine-check" data-id="'+esc(p.key)+'">Connect</button> <button class="pill" data-d="machine-remove" data-id="'+esc(p.key)+'">Remove</button></div></div>').join(''):'<div class="tk-empty">No other machine is listed. Nothing is claimed about any machine that is not here.</div>';
 h+='<form id="dr-mform" class="dr-form"><div class="hl">Add a machine</div><div class="dr-grid"><label>Name<input id="dr-mname" placeholder="the other PC"></label><label>Panel address<input id="dr-murl" placeholder="http://127.0.0.1:4022"></label></div><div class="m">'+esc(m.bindNote)+'</div><div class="dr-act"><button class="pill" id="dr-madd" type="submit">Add</button></div></form>';
 return h;
}

function ghCard(g){
 if(!g)return '<div class="tk-empty">GitHub was not read.</div>';
 if(g.error)return '<div class="tk-warn">'+esc(g.error)+'</div>';
 if(!g.prs.length)return '<div class="tk-empty">No open pull requests in '+esc(g.repo||'this repository')+'.</div>';
 return '<div class="m">'+esc(g.repo)+' · read '+when(g.at)+' · <button class="pill" data-d="gh-refresh">Refresh</button></div>'
  +'<table class="ss tk-table"><thead><tr><th>PR</th><th>Head</th><th>CI</th><th>Review</th><th>Updated</th><th></th></tr></thead><tbody>'
  +g.prs.map(p=>'<tr><td><a href="'+esc(p.url)+'" target="_blank" rel="noopener">#'+esc(p.number)+'</a> '+esc(p.title)+(p.draft?' <span class="m">draft</span>':'')+'</td>'
   +'<td class="m">'+esc(p.head)+'<div>'+esc(p.headSha||'?')+'</div></td>'
   +'<td>'+pill(p.evidence.ci,p.ci.state==='passing'?'ok':p.ci.state==='failing'?'bad':'warn')+'<div class="m">'+p.ci.pass+' pass · '+p.ci.fail+' fail · '+p.ci.pending+' running</div></td>'
   +'<td class="m">'+esc(p.evidence.review)+'</td><td class="m">'+when(p.updatedAt)+'</td>'
   +'<td><button class="pill" data-d="approve-merge" data-n="'+esc(p.number)+'" data-repo="'+esc(g.repo||'')+'" data-sha="'+esc(p.headShaFull||'')+'">Approve merge</button></td></tr>').join('')
  +'</tbody></table>'
  +'<div class="m">Read from GitHub: heads, review decision and public CI only. Merged is read from the PR state; real-data and in-game verification are never inferred from CI and are not shown as done.</div>';
}

let orch=null,budget=null,models=null;

function picker(){
 if(!orch)return '<div class="tk-empty">Reading the director settings…</div>';
 const o=orch.orchestrator||{},bp=(budget&&budget.providers)||{};
 const usable=Object.keys(bp).filter(p=>bp[p].enabled&&bp[p].installed);
 const cur=usable.includes(o.provider)?o.provider:'';
 const rows=(cur&&models&&models[cur])||[];
 const off=o.mode!=='orchestrated';
 return '<div class="hl">Your director</div><div class="dr-grid"><label>Provider<select id="dr-prov">'+(cur?'':'<option value="">Choose…</option>')+usable.map(p=>'<option value="'+esc(p)+'"'+(p===cur?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select></label>'
  +'<label>Model (pick one or type any model id)<input id="dr-model" list="dr-models" value="'+esc(cur?o.model||'':'')+'" placeholder="'+(cur?'provider default':'choose a provider first')+'"'+(cur?'':' disabled')+'><datalist id="dr-models">'+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name||r.id)+'</option>').join('')+'</datalist></label>'
  +'<div class="dr-act"><button class="pill" id="dr-save" type="button">Use this director</button></div></div>'
  +'<div class="m">'+(off?'The director is off: goals go straight to one worker. Choose a provider to turn it on. ':'')+(usable.length?'It plans the work, hands tasks to the other models, checks their reports and reports back.':'No provider is turned on and installed. Turn one on in Setup.')+'</div>';
}

function build(){
 const need=d.needsYou||[];
 const dis=d.dispatcher;
 let h='<div id="dr-root" class="tk">';
 h+='<div class="tk-hello">Director</div>';
 if(d.config&&d.config.readError)h+='<div class="tk-bad"><b>config.json could not be read</b> ('+esc(d.config.readError)+'). The panel is using defaults. Saving a setting first copies the unreadable file to config.json.unreadable-*, so nothing is lost.</div>';
 if(dis&&(!dis.lastTick||Date.now()-dis.lastTick>15000||dis.error))h+='<div class="tk-bad"><b>The task dispatcher is not running.</b> '+esc(dis.error||'')+' Waiting tasks will not start.</div>';
 if(err)h+='<div class="tk-err">'+esc(err)+'</div>';
 if(msg)h+='<div class="tk-ok">'+esc(msg)+'</div>';
 h+='<div class="dr-form">'+picker()+'</div>';
 h+='<form id="dr-form" class="dr-form"><label class="hl" for="dr-text">What do you want done?</label>'
  +'<textarea id="dr-text" rows="4" placeholder="Say it in plain words. The director splits it up, picks models, watches them and checks the results."></textarea>'
  +'<div class="dr-act"><button class="pill" id="dr-go" type="submit">Send to the director</button><span id="dr-msg" class="m"></span></div></form>';
 if(need.length)h+='<div class="tk-h">Needs you</div>'+need.map(n=>'<div class="tk-att"><div><b>'+esc(n.goal)+'</b></div><div class="tk-note">'+esc(n.detail)+'</div></div>').join('');
 h+='<div class="tk-h">What the director is doing</div>';
 h+=(d.goals||[]).length?d.goals.map(goalCard).join(''):'<div class="tk-empty">Nothing yet. Write what you want above.</div>';
 const ghErr=d.github&&d.github.error;
 h+='<details id="dr-adv" class="dr-ev"'+(advOpen?' open':'')+'><summary>Advanced: folder, limits, machines, pull requests, other sessions</summary>'
  +'<div class="dr-form"><div class="hl">Where the director works</div><div class="dr-grid"><label>Folder<input id="dr-dir" value="'+esc((d.config&&d.config.projectDir)||'')+'"></label><label>Live tasks allowed<input id="dr-max" type="number" min="1" max="12" value="4"></label><label>Task minutes<input id="dr-min" type="number" min="5" max="1440" value="120"></label><label>Priority<select id="dr-pri">'+[1,2,3,4,5].map(n=>'<option value="'+n+'"'+(n===3?' selected':'')+'>'+PR[n]+'</option>').join('')+'</select></label></div></div>'
  +'<div class="tk-h">Machines</div>'+machinesCard(d.machines)
  +'<div class="tk-h">Pull requests and CI</div>'+(ghErr?'<div class="tk-warn">'+esc(ghErr)+'</div>':ghCard(d.github))
  +'<div class="tk-h">Other sessions found on disk (not started by the panel, cannot be stopped from here)</div>'
  +((d.discovered||[]).length?d.discovered.slice(0,12).map(s=>'<div class="tk-row">'+pill(s.provider,'')+'<span class="tk-rt">'+esc(s.title)+'</span><span class="m">'+esc(s.state)+' · '+when(s.mtime)+'</span></div>').join(''):'<div class="tk-empty">None found.</div>')
  +'</details></div>';
 return h;
}

const KEEP=['dr-text','dr-dir','dr-max','dr-min','dr-pri','dr-mname','dr-murl','dr-model'];
function keep(){
 const k={vals:{},focus:null};
 for(const id of KEEP){const x=$(id);if(x)k.vals[id]=x.value}
 const f=document.activeElement;
 if(f&&f.id&&$('prov')&&$('prov').contains(f))k.focus={id:f.id,s:f.selectionStart,e:f.selectionEnd};
 const adv=$('dr-adv');if(adv)advOpen=adv.open;
 return k}
function restore(k){
 for(const id of KEEP){const x=$(id);if(x&&k.vals[id]!=null)x.value=k.vals[id]}
 if(k.focus){const x=$(k.focus.id);if(x){x.focus();try{x.setSelectionRange(k.focus.s,k.focus.e)}catch{}}}}

async function load(){
 if(busy)return;busy=1;
 try{
  const [r,o,b]=await Promise.all([j('/director'),j('/orch'),j('/budget')]);
  if(r.ok&&r.body){d=r.body;at=Date.now();err=''}
  else err=(r.body&&r.body.error)||'The director is not answering.';
  if(o.ok)orch=o.body;
  if(b.ok)budget=b.body;
  if(!models){const m=await j('/models');if(m.ok)models=m.body}
  const el=$('prov');
  if(el&&tab==='director'){
   if(!d){el.innerHTML='<div class="empty">'+esc(err||'The director did not answer.')+'</div>';return}
   const top=el.scrollTop,k=keep();el.innerHTML=build();restore(k);el.scrollTop=top}
 }finally{busy=0}}

PAGES.director=async el=>{await load()};

document.addEventListener('submit',async e=>{
 if(e.target.id!=='dr-form'&&e.target.id!=='dr-mform')return;
 e.preventDefault();
 e.target.id==='dr-mform'?addMachine():startGoal()});

async function startGoal(){
 const x=$('dr-text'),t=x.value.trim();
 if(!t){say('tk-err','Write what you want done.');return}
 const lim=n=>$(n)?Number($(n).value):undefined;
 $('dr-go').disabled=true;say('m','Sending…');
 const r=await post('/director/goal',{title:t.split('\n')[0].slice(0,100),text:t,priority:lim('dr-pri'),projectDir:$('dr-dir')?$('dr-dir').value.trim():'',limits:{maxLive:lim('dr-max'),taskMinutes:lim('dr-min')}});
 $('dr-go').disabled=false;
 if(!r.ok){say('tk-err',(r.body&&r.body.error)||'Could not start it.');return}
 x.value='';msg='Sent. The director will plan it and start the other models.';err='';
 load()}

async function saveDirector(){
 const p=$('dr-prov').value,m=$('dr-model').value.trim();
 if(!p){err='Choose a provider for the director.';return load()}
 const r=await post('/orch/config',{orchestrator:{mode:'orchestrated',provider:p,model:m},workerModels:(orch&&orch.workerModels)||{}});
 if(!r.ok){err=(r.body&&r.body.error)||'Could not save the director.';return load()}
 orch=r.body;msg='Director set to '+p+(r.body.orchestrator.model?' · '+r.body.orchestrator.model:' · provider default')+'.';err='';load()}

async function addMachine(){
 const n=$('dr-mname'),u=$('dr-murl');
 const r=await post('/director/machines/add',{name:n.value.trim(),url:u.value.trim()});
 if(!r.ok){err=(r.body&&r.body.error)||'Could not add it.';return load()}
 msg=(r.body&&r.body.note)||'Added.';n.value='';u.value='';load()}

const say=(cls,txt)=>{const m=$('dr-msg');if(m){m.className=cls;m.textContent=txt}if(cls==='tk-err')err=txt};

document.addEventListener('change',e=>{if(tab==='director'&&e.target.id==='dr-prov'){const m=$('dr-model');if(m)m.value='';saveDirector()}});

document.addEventListener('click',async e=>{
 if(tab==='director'&&e.target.id==='dr-save')return saveDirector();
 const b=e.target.closest('[data-d]');if(!b||tab!=='director')return;
 const a=b.dataset.d,id=b.dataset.id;
 if(a==='gh-refresh'){b.disabled=true;await j('/director/github?fresh=1');return load()}
 if(a==='machine-check'){b.disabled=true;msg='Connecting…';await load();const r=await post('/director/machines/check',{id});msg=(r.body&&(r.body.why||('Connected: '+JSON.stringify(r.body.capabilities||{}).slice(0,200))))||'Done.';return load()}
 if(a==='machine-remove'){if(!confirm('Remove this machine from the list? Nothing is deleted on it.'))return;await post('/director/machines/remove',{id});return load()}
 if(a==='resume-task'||a==='retry-task'){const u=a==='resume-task'?'/director/task/'+encodeURIComponent(id)+'/resume':'/tasks/'+encodeURIComponent(id)+'/retry';let r=await post(u,{});if(!r.ok&&r.body&&r.body.orphanPid&&confirm(r.body.error+'\n\nResume anyway?'))r=await post(u,{force:true});else if(!r.ok)alert((r.body&&r.body.error)||'Could not do that.');return load()}
 if(a==='steer'){const note=prompt('What should change? It is saved on the goal and added to the goal as a new task.');if(!note||!note.trim())return;const r=await post('/director/goal/'+encodeURIComponent(id)+'/steer',{text:note.trim()});if(!r.ok)alert((r.body&&r.body.error)||'Could not save the note.');msg='Steering note saved.';return load()}
 if(a==='stop'){if(!confirm('Stop this goal? Its live tasks are cancelled; finished work is kept.'))return;const r=await post('/director/goal/'+encodeURIComponent(id)+'/stop',{});if(!r.ok)alert((r.body&&r.body.error)||'Could not stop it.');return load()}
 if(a==='pause'||a==='resume'||a==='done'){const r=await post('/director/goal/'+encodeURIComponent(id)+'/'+a,{});if(!r.ok)alert((r.body&&r.body.error)||'Could not do that.');return load()}
 if(a==='approve-merge'){
  const n=b.dataset.n,repo=b.dataset.repo;
  if(!confirm('Record your approval to merge PR #'+n+' at its current head commit?\n\nThis does NOT merge it. It records your approval for that exact commit.'))return;
  const r=await post('/director/merge-approval',{number:Number(n),repo});
  if(!r.ok){alert((r.body&&r.body.error)||'Could not record it.');return}
  let text=(r.body&&r.body.note)||'Approval recorded.';
  if(d&&d.config&&d.config.mergeEnabled&&r.body&&!(r.body.blockers||[]).length){
   const typed=prompt(text+'\n\nMerging from the panel is ON. Type the number '+n+' to merge now, or cancel to leave it alone.');
   if(typed===String(n)){const m=await post('/director/merge',{number:Number(n),repo,confirm:typed});msg=m.ok?'Merged.':'Not merged: '+((m.body&&(m.body.error||m.body.why))||'unknown reason');return load()}
  }
  msg=text;return load()}
});

setInterval(()=>{if(tab==='director')load()},12000);
})();
