(()=>{
const j=async(u,o)=>{try{const r=await fetch(u,o);const b=await r.json().catch(()=>null);return{ok:r.ok,body:b}}catch(e){return{ok:false,body:{error:'Could not reach the panel: '+e.message}}}};
const post=(u,b)=>j(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});
const PR={1:'P1 highest',2:'P2 high',3:'P3 normal',4:'P4 low',5:'P5 lowest'};
let d=null,at=0,busy=0,msg='',err='',ghOpen=false;

const pct=(a,b)=>b?Math.round(100*a/b):0;
const pill=(t,cls)=>'<span class="dr-pill '+(cls||'')+'">'+esc(t)+'</span>';
const when=iso=>{const t=Date.parse(iso||'');if(!t)return '—';const s=Math.round((Date.now()-t)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':s<86400?Math.round(s/3600)+'h ago':new Date(t).toLocaleDateString()};
const at_=iso=>iso?new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';

function progress(g){
 const n=g.counts.done+g.counts.failed+g.counts.cancelled+g.counts.interrupted, total=n+g.counts.running+g.counts.waiting+g.counts.starting;
 return '<div class="dr-bar"><i style="width:'+pct(g.counts.done,Math.max(total,1))+'%"></i></div><div class="m">'+g.counts.done+' done · '+g.counts.running+' running · '+g.counts.waiting+' waiting · '+g.counts.failed+' failed'+(g.counts.interrupted?' · '+g.counts.interrupted+' interrupted':'')+' of '+total+'</div>';
}

function goalCard(g){
 const live=g.agents.length;
 const ag=live?g.agents.map(a=>'<div class="dr-agent"><span class="dr-chip" title="'+esc(a.controllable?'The panel started this run and can stop it.':'Discovered only.')+'">'+(a.root?'goal run · ':'')+esc(a.provider||'?')+(a.model?' · '+esc(a.model):'')+(a.controllable?' · controllable':' · discovered')+'</span>'
  +'<span class="m">'+(a.worktree?esc(a.worktree)+(a.branch?' ('+esc(a.branch)+')':''):'no worktree')+'</span>'
  +'<span class="m">'+(a.leaseOwner?'owner '+esc(String(a.leaseOwner).split(':').slice(0,2).join(':')):'no lease yet')+'</span></div>').join(''):'<span class="m">No agent is running for this goal.</span>';
 const btns=[];
 if(g.controls.canPause)btns.push('<button class="pill" data-d="pause" data-id="'+esc(g.id)+'">Pause</button>');
 if(g.controls.canResume)btns.push('<button class="pill" data-d="resume" data-id="'+esc(g.id)+'">Resume</button>');
 if(g.controls.canStop)btns.push('<button class="pill" data-d="stop" data-id="'+esc(g.id)+'">Stop</button>');
 if(g.controls.canSteer)btns.push('<button class="pill" data-d="steer" data-id="'+esc(g.id)+'">Steer</button>');
 if(g.status==='active')btns.push('<button class="pill" data-d="done" data-id="'+esc(g.id)+'">Mark done</button>');
 const blockers=g.blockers.length?'<div class="dr-blockers">'+g.blockers.map(b=>'<div class="dr-b"><b>'+esc(b.kind)+'</b> '+esc(b.detail||'')+(b.taskId?' <span class="m">'+esc(b.taskId)+'</span>':'')+'</div>').join('')+'</div>':'';
 const needs=g.needsYou.length?'<div class="dr-needs">'+g.needsYou.map(n=>'<div class="dr-n">'+esc(n.detail)+(n.taskId&&n.kind==='resume'?' <button class="pill" data-d="resume-task" data-id="'+esc(n.taskId)+'">Resume task</button>':n.taskId&&n.kind==='retry'?' <button class="pill" data-d="retry-task" data-id="'+esc(n.taskId)+'">Retry task</button>':n.taskId&&n.kind==='approve'?' <span class="m">approve it on the Orchestrator tab</span>':'')+'</div>').join('')+'</div>':'';
 const ev=g.evidence.length?'<details class="dr-ev"><summary>'+g.evidence.length+' result(s) with evidence</summary>'+g.evidence.map(e=>{
  const rep=e.report?'<div class="m">Report '+esc(e.report.path)+' · '+esc(e.report.bytes)+' bytes · '+when(e.report.at)+'</div><pre class="dr-pre">'+esc(String(e.report.head||'').slice(0,320))+'</pre>':'<div class="m">No report file.</div>';
  const wt=e.worktree?'<div class="m">Worktree '+esc(e.worktree.path)+' · head '+esc(e.worktree.head||'?')+' · '+esc(e.worktree.dirty)+' uncommitted file(s)'+(e.worktree.commits&&e.worktree.commits.length?' · '+esc(e.worktree.commits[0]):'')+'</div>':'';
  return '<div class="dr-e"><div><b>'+esc(e.title)+'</b> '+pill(e.status,e.status)+' <span class="m">'+esc(e.provider||'')+(e.model?' · '+esc(e.model):'')+(e.exitCode!=null?' · exit '+esc(e.exitCode):'')+' · '+when(e.endedAt)+'</span></div>'+rep+wt+(e.note?'<div class="m">'+esc(e.note)+'</div>':'')+'</div>'}).join('')+'</details>':'';
 const steer=g.steer.length?'<details class="dr-ev"><summary>Steering notes</summary>'+g.steer.map(s=>'<div class="dr-e"><div class="m">'+when(s.at)+'</div><div>'+esc(s.text)+'</div></div>').join('')+'</details>':'';
 return '<div class="dr-goal"><div class="dr-gh"><div><span class="dr-pr">'+esc(PR[g.priority]||'P3')+'</span> <b>'+esc(g.title)+'</b> '+pill(g.status,g.status)+' '+pill(g.stageLabel,'stage-'+g.stage)+'</div><div class="m">'+esc(g.id)+' · '+esc(g.projectDir)+' · updated '+when(g.updatedAt)+'</div></div>'
  +progress(g)
  +blockers+needs
  +'<div class="dr-sec"><div class="hl">Assigned agents</div>'+ag+'</div>'
  +'<div class="dr-sec"><div class="hl">Limits</div><div class="m">'+g.budget.usedLive+' of '+g.budget.maxLive+' live · '+g.budget.usedTasks+' of '+g.budget.maxTasks+' tasks · '+g.budget.taskMinutes+' min per task'+(g.budget.oldestRunMin?' · oldest run '+g.budget.oldestRunMin+' min':'')+'</div></div>'
  +ev+steer
  +'<div class="dr-act">'+btns.join(' ')+'</div></div>';
}

function machinesCard(m){
 if(!m)return '<div class="tk-empty">No machine inventory.</div>';
 const cap=m.self.capabilities;
 const prov=Object.entries(cap.providers).map(([p,v])=>esc(p)+(v.enabled?(v.installed?' ✓':' (off/absent)'):' (turned off)')).join(' · ');
 let h='<div class="dr-goal"><div class="dr-gh"><div><b>'+esc(m.self.name)+'</b> '+pill('this machine','ok')+'</div><div class="m">'+esc(cap.os)+' · node '+esc(cap.node)+' · '+esc(cap.cores)+' cores · worktrees '+(cap.worktrees?'available':'not a git repo')+'</div></div>'
  +'<div class="m">'+prov+'</div><div class="m">Concurrency: '+esc(JSON.stringify(cap.concurrency))+'</div></div>';
 h+=m.peers.length?m.peers.map(p=>'<div class="dr-goal"><div class="dr-gh"><div><b>'+esc(p.name)+'</b> '+pill(p.status,p.status==='online'?'ok':'warn')+' '+pill(p.authenticated?'authenticated':'not authenticated',p.authenticated?'ok':'warn')+'</div><div class="m">'+esc(p.url)+' · id '+esc(p.reportedId||p.id)+' · last signed hello '+(p.lastHandshake?when(p.lastHandshake):'never')+(p.capabilities?' · '+esc(p.capabilities.os||'')+', '+(p.capabilities.providers?Object.keys(p.capabilities.providers).filter(k=>p.capabilities.providers[k].enabled).length+' provider(s)':'no providers')+' · claim '+((p.capabilities.claim&&p.capabilities.claim.supported)?'supported':'unsupported'):'')+'</div></div><div class="m">'+esc(p.note)+'</div><div class="dr-act"><button class="pill" data-d="machine-check" data-id="'+esc(p.id)+'">Connect</button> <button class="pill" data-d="machine-remove" data-id="'+esc(p.id)+'">Remove</button></div></div>').join(''):'<div class="tk-empty">No other machine is listed. Nothing is claimed about any machine that is not here.</div>';
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

function build(){
 const need=d.needsYou||[];
 const active=(d.goals||[]).filter(g=>g.status==='active').length;
 const liveAgents=(d.goals||[]).reduce((a,g)=>a+g.agents.length,0);
 const failing=((d.github&&d.github.prs)||[]).filter(p=>p.ci.state==='failing').length;
 const ghOk=d.github&&!d.github.error;
 let h='<div id="dr-root" class="tk">';
 h+='<div class="tk-hello">Director</div>';
 h+='<div class="cards">'
  +card('Goals',String(active),'active',[(d.goals||[]).length+' total','Paused and stopped goals start nothing.'])
  +card('Needs you',String(need.length),need.length?'waiting on you':'nothing',[need.length?'The first one is below.':'All goals are moving on their own.'])
  +card('Agents running',String(liveAgents),'controllable',['Only runs the panel started can be paused or stopped.'])
  +card('Pull requests',ghOk?String(failing):'—',ghOk?'failing CI':'not read',[ghOk?((d.github.prs||[]).length+' open'):'Needs the gh CLI.'])
  +'</div>';
 if(d.dispatcher&&(!d.dispatcher.lastTick||Date.now()-d.dispatcher.lastTick>15000||d.dispatcher.error))h+='<div class="tk-bad"><b>The task dispatcher is not running.</b> '+esc(d.dispatcher.error||'')+' Waiting tasks will not start.</div>';
 if(err)h+='<div class="tk-err">'+esc(err)+'</div>';
 if(msg)h+='<div class="tk-ok">'+esc(msg)+'</div>';
 h+='<form id="dr-form" class="dr-form"><div class="hl">New goal</div><div class="dr-grid"><label>Name<input id="dr-title" placeholder="Ship the decode fix"></label><label>Priority<select id="dr-pri">'+[1,2,3,4,5].map(n=>'<option value="'+n+'"'+(n===3?' selected':'')+'>'+PR[n]+'</option>').join('')+'</select></label></div>'
  +'<label>What does done look like?<textarea id="dr-text" rows="4" placeholder="Describe the goal in plain words. The orchestrator splits it into tasks, picks agents and checks the reports."></textarea></label>'
  +'<div class="dr-grid"><label>Folder<input id="dr-dir" value="'+esc((d.config&&d.config.projectDir)||'')+'"></label><label>Live tasks allowed<input id="dr-max" type="number" min="1" max="12" value="4"></label><label>Task minutes<input id="dr-min" type="number" min="5" max="1440" value="120"></label></div>'
  +'<div class="dr-act"><button class="pill" id="dr-go" type="submit">Start goal</button><span id="dr-msg" class="m"></span></div></form>';
 h+='<div class="tk-h">Needs you now</div>';
 h+=need.length?need.map(n=>'<div class="tk-att"><div><b>'+esc(n.goal)+'</b> <span class="m">'+esc(n.kind)+'</span></div><div class="tk-note">'+esc(n.detail)+'</div></div>').join(''):'<div class="tk-empty">Nothing needs you.</div>';
 h+='<div class="tk-h">Goals</div>';
 h+=(d.goals||[]).length?d.goals.map(goalCard).join(''):'<div class="tk-empty">No goals yet. Start one above.</div>';
 h+='<div class="tk-h">Machines</div>'+machinesCard(d.machines);
 h+='<div class="tk-h">Pull requests and CI</div>'+ghCard(d.github);
 h+='<div class="tk-h">Discovered sessions (not controllable)</div>';
 h+=(d.discovered||[]).length?d.discovered.slice(0,12).map(s=>'<div class="tk-row">'+pill(s.provider,'')+'<span class="tk-rt">'+esc(s.title)+'</span><span class="m">'+esc(s.state)+' · '+when(s.mtime)+' · the panel did not start it</span></div>').join(''):'<div class="tk-empty">No sessions found on disk.</div>';
 h+='</div>';
 return h;
}

async function load(){
 if(busy)return;busy=1;
 try{
  const r=await j('/director');
  if(r.ok&&r.body){d=r.body;at=Date.now();err=''}
  else err=(r.body&&r.body.error)||'The director is not answering.';
  const el=$('prov');
  if(el&&tab==='director'){
   if(!d){el.innerHTML='<div class="empty">'+esc(err||'The director did not answer.')+'</div>';return}
   const top=el.scrollTop;el.innerHTML=build();el.scrollTop=top}
 }finally{busy=0}}

PAGES.director=async el=>{await load()};

document.addEventListener('submit',async e=>{
 if(e.target.id!=='dr-form'&&e.target.id!=='dr-mform')return;
 e.preventDefault();
 e.target.id==='dr-mform'?addMachine():startGoal()});

async function startGoal(){
 const t=$('dr-title'),x=$('dr-text');
 if(!t.value.trim()||!x.value.trim()){say('tk-err','Give the goal a name and say what done looks like.');return}
 $('dr-go').disabled=true;say('m','Starting…');
 const r=await post('/director/goal',{title:t.value.trim(),text:x.value.trim(),priority:Number($('dr-pri').value),projectDir:$('dr-dir').value.trim(),limits:{maxLive:Number($('dr-max').value),taskMinutes:Number($('dr-min').value)}});
 $('dr-go').disabled=false;
 if(!r.ok){say('tk-err',(r.body&&r.body.error)||'Could not start the goal.');return}
 t.value='';x.value='';say('tk-ok','Started. The first task is queued and the dispatcher will assign it.');
 load()}

async function addMachine(){
 const n=$('dr-mname'),u=$('dr-murl');
 const r=await post('/director/machines/add',{name:n.value.trim(),url:u.value.trim()});
 if(!r.ok){err=(r.body&&r.body.error)||'Could not add it.';return load()}
 msg=(r.body&&r.body.note)||'Added.';n.value='';u.value='';load()}

const say=(cls,txt)=>{const m=$('dr-msg');if(m){m.className=cls;m.textContent=txt}if(cls==='tk-err')err=txt};

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-d]');if(!b||tab!=='director')return;
 const a=b.dataset.d,id=b.dataset.id;
 if(a==='gh-refresh'){b.disabled=true;await j('/director/github?fresh=1');return load()}
 if(a==='machine-check'){b.disabled=true;msg='Connecting…';await load();const r=await post('/director/machines/check',{id});msg=(r.body&&(r.body.why||('Connected: '+JSON.stringify(r.body.capabilities||{}).slice(0,200))))||'Done.';return load()}
 if(a==='machine-remove'){if(!confirm('Remove this machine from the list? Nothing is deleted on it.'))return;await post('/director/machines/remove',{id});return load()}
 if(a==='resume-task'||a==='retry-task'){const u=a==='resume-task'?'/director/task/'+encodeURIComponent(id)+'/resume':'/tasks/'+encodeURIComponent(id)+'/retry';const r=await post(u,{});if(!r.ok)alert((r.body&&r.body.error)||'Could not do that.');return load()}
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
