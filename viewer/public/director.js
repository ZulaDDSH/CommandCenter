(()=>{
const j=async(u,o)=>{try{const r=await fetch(u,o);const b=await r.json().catch(()=>null);return{ok:r.ok,body:b}}catch(e){return{ok:false,body:{error:'Could not reach the panel: '+e.message}}}};
const post=(u,b)=>j(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});
const PR={1:'P1 highest',2:'P2 high',3:'P3 normal',4:'P4 low',5:'P5 lowest'};
const LIVE=['waiting','starting','running'];
const SAY=x=>x==='running'?'working':x;
const CLS={done:'ok',running:'stage-working',starting:'stage-working',failed:'bad',interrupted:'warn'};
let d=null,busy=0,saving=0,msg='',err='',advOpen=false,setOpen=false,curId='',orchGen=0,setup=null,setupAt=0,models=null,modelsAt=0,orch=null,budget=null,board=null,stick=true,tkOpen=false,bdOpen=false,buOpen=false;
const tasksEl=document.createElement('div');tasksEl.id='dr-tasks';
const NAMES={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude',antigravity:'Antigravity'};
const ORDER=['freebuff','codex','cursor','opencode','claude','antigravity'];

const pill=(t,cls)=>'<span class="dr-pill '+(cls||'')+'">'+esc(t)+'</span>';
const btn=(a,id,t)=>'<button class="pill" data-d="'+a+'" data-id="'+esc(id)+'">'+t+'</button>';
const when=iso=>{const t=Date.parse(iso||'');if(!t)return '—';const s=Math.round((Date.now()-t)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':s<86400?Math.round(s/3600)+'h ago':new Date(t).toLocaleDateString()};
const at_=iso=>iso?new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const usable=()=>{const bp=(budget&&budget.providers)||{};return Object.keys(bp).filter(p=>bp[p].enabled&&bp[p].installed)};

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

function picker(){
 if(!orch)return '<div class="tk-empty">Reading the director settings…</div>';
 const o=orch.orchestrator||{},us=usable().filter(p=>p!=='antigravity'),cur=us.includes(o.provider)?o.provider:'',rows=(cur&&models&&models[cur])||[],ef=(orch.efforts||{})[cur]||[];
 return '<div class="hl">Director</div><div class="dr-grid"><label>Provider<select id="dr-prov">'+(cur?'':'<option value="">Choose…</option>')+us.map(p=>'<option value="'+esc(p)+'"'+(p===cur?' selected':'')+'>'+esc(p)+'</option>').join('')+'</select></label>'
  +'<label>Model (pick one or type any model id)<input id="dr-model" list="dr-models" value="'+esc(cur?o.model||'':'')+'" placeholder="'+(cur?'provider default':'choose a provider first')+'"'+(cur?'':' disabled')+'><datalist id="dr-models">'+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name||r.id)+'</option>').join('')+'</datalist></label>'
  +'<label>Reasoning level<select id="dr-eff"'+(ef.length?'':' disabled')+'><option value="">default</option>'+ef.map(e=>'<option value="'+e+'"'+(o.effort===e?' selected':'')+'>'+e+'</option>').join('')+'</select></label></div>'
  +'<div class="m">'+(us.length?(o.mode!=='orchestrated'?'The director is off. Choose a provider to turn it on. ':'')+'It plans the work, hands tasks to the models ticked below, checks their reports and answers you. Press Enter or click away after typing a model to save it.':'No provider is turned on and installed. Turn one on in Setup.')+'</div>';
}

function team(){
 if(!orch)return '';
 const tm=orch.team||[],sp=(setup&&setup.providers)||{},on=(p,id)=>tm.find(m=>m.provider===p&&m.model===id);
 const cols=usable().map(p=>{
  const rows=((models&&models[p])||[]).slice(),ids=new Set(rows.map(r=>r.id));
  for(const m of tm)if(m.provider===p&&!ids.has(m.model))rows.push({id:m.model,name:m.model});
  const ef=(orch.efforts||{})[p]||[],stale=(d.goals||[]).some(g=>(g.tasks||[]).some(t=>t.login===p&&t.status==='failed')),s=stale?false:sp[p]&&sp[p].signedIn;
  const row=r=>{const k=p+'|'+r.id,m=on(p,r.id);return '<div class="dr-tm"><label><input type="checkbox" data-tm="'+esc(k)+'"'+(m?' checked':'')+'> '+esc(r.name||r.id)+' <span class="m">'+(r.name&&r.name!==r.id?esc(r.id):'')+'</span></label>'+(ef.length?'<select data-te="'+esc(k)+'" title="Reasoning level"'+(m?'':' disabled')+'><option value="">default level</option>'+ef.map(e=>'<option value="'+e+'"'+(m&&m.effort===e?' selected':'')+'>'+e+'</option>').join('')+'</select>':'<span class="m">no level</span>')+'</div>'};
  return '<div class="dr-tp"><div><b>'+esc(p)+'</b> '+(s===true?pill('signed in','ok'):s===false?pill(stale?'login expired':'not signed in','warn')+' <button class="pill" data-d="login" data-p="'+esc(p)+'">Log in</button>':pill('sign-in not checked',''))+'</div><div class="dr-tl">'+(rows.length?rows.map(row).join(''):'<div class="m">'+(models?'No models listed.':'Reading the model list…')+'</div>')+'</div></div>';
 });
 return '<div class="m">Tick the models the director may hand work to, and set how hard each one thinks. Nothing ticked means it may use any model of a provider that is on. Every provider signs in through its own login; API-key variables are removed from what agents run with.</div><div class="dr-grid">'+(cols.join('')||'<div class="tk-empty">No provider is on.</div>')+'</div>';
}

function money(b){
 return ORDER.map(p=>{const e=b.providers[p];if(!e)return '';
  const state=!e.enabled?'turned off':!e.installed?'not installed':'on';
  let lines=[];
  if(p==='freebuff'&&e.enabled)lines=[e.hoursLeft?esc(e.hoursLeft)+' of '+esc(e.hoursLimit)+' hours left today':esc(e.error||'hours not read yet'),...(e.models||[]).slice(0,6).map(m=>esc(m.name)+': '+(m.hoursPerHour===0?'free':m.workHoursLeft==null?'?':esc(m.workHoursLeft)+' h of work left'))];
  else if(p==='codex'&&e.enabled)lines=(e.windows||[]).map(x=>esc((x.minutes>=1440?x.minutes/1440+' day':x.minutes/60+' hour'))+' window: '+(x.stale?'old data':esc(100-x.usedPercent)+'% left')).concat(e.note?[esc(e.note)]:[]);
  else if(p==='cursor'&&e.enabled)lines=[e.signedIn?'signed in':'not signed in'];
  else if(p==='opencode'&&e.enabled)lines=e.today?['spent today '+esc(e.today.cost),'last 7 days '+esc(e.week&&e.week.cost)]:[];
  else if(e.enabled)lines=[esc(e.note||'')];
  return card(NAMES[p],esc(state),'running '+esc(e.running)+' of '+esc(e.max),lines)}).join('')}

function boardHtml(){
 if(!Array.isArray(board))return '<div class="tk-empty">Board not read yet.</div>';
 return board.length?board.slice(-20).reverse().map(x=>'<div class="note"><div class="m"><b>'+esc(x.from)+'</b> · '+when(x.at)+'</div><div class="t">'+md(x.text)+'</div></div>').join(''):'<div class="tk-empty">No notes yet.</div>';
}

function workers(){
 if(!orch)return '';
 const w=orch.workerModels||{};
 return '<div class="hl">Default model for each provider</div><div class="m">Used when a task goes to that provider and nothing more specific is asked. Leave blank to use the model from Setup.</div><div class="dr-grid">'
  +usable().map(p=>'<label>'+esc(NAMES[p]||p)+'<input data-wm="'+esc(p)+'" list="dr-wl-'+esc(p)+'" value="'+esc(w[p]||'')+'" placeholder="provider default"><datalist id="dr-wl-'+esc(p)+'">'+(((models&&models[p])||[]).map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name||r.id)+'</option>').join(''))+'</datalist></label>').join('')+'</div>';
}

function status(g){
 if(!g)return '';
 const ts=(g.tasks||[]).filter(t=>!t.director),n=l=>ts.filter(t=>l.includes(t.status)).length,tot=(g.budget&&g.budget.usedTasks)||ts.length;
 if(!ts.length)return '<div class="dr-status m">The director has not handed anything out yet. Last update '+when(g.updatedAt)+'.</div>';
 const bits=[[n(['running','starting']),'working'],[n(['waiting']),'waiting'],[n(['done']),'finished'],[n(['failed','interrupted']),'need a retry'],[n(['cancelled']),'stopped']].filter(x=>x[0]).map(x=>x[0]+' '+x[1]);
 return '<div class="dr-status m">'+esc(tot+' task(s) handed out'+(bits.length?': ':'')+bits.join(', ')+'. Every report comes back here. Last update '+when(g.updatedAt)+'.')+'</div>';
}

function current(){
 const gs=d.goals||[];
 if(curId==='new')return null;
 return gs.find(g=>g.id===curId)||gs.slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0]||null;
}

function bubble(m){
 const you=m.who==='you',live=!you&&LIVE.includes(m.status);
 const txt=you?m.text:live?'Working… planning, handing out tasks and checking their reports.':(m.text||(m.status==='done'?'Finished without a written report.':'Stopped.'));
 return '<div class="dr-bub '+(you?'dr-you':'dr-dir')+(live?' dr-live':'')+'"><div class="m">'+(you?'You':'Director')+' · '+at_(m.at)+(!you&&!live&&m.status&&m.status!=='done'?' · '+esc(m.status):'')+'</div><div class="dr-bt">'+esc(txt)+'</div></div>';
}

function needBtn(n){
 if(n.kind==='resume'&&n.taskId)return btn('resume-task',n.taskId,'Resume task');
 if(n.kind==='retry'&&n.taskId)return btn('retry-task',n.taskId,'Retry task');
 if(n.kind==='login')return '<button class="pill" data-d="login" data-p="'+esc(n.provider)+'">Log in to '+esc(n.provider)+'</button> '+btn('retry-task',n.taskId,'Retry task');
 if(n.kind==='approve'&&n.taskId)return btn('approve-task',n.taskId,'Approve')+' '+btn('refuse-task',n.taskId,'Refuse');
 return '';
}

function work(g){
 const rows=(g.tasks||[]).filter(t=>!t.director).map(t=>'<div class="dr-t">'+pill(SAY(t.status),CLS[t.status])+' <b>'+esc(t.title)+'</b> <span class="m">'+(t.provider?esc(t.provider)+(t.model?' · '+esc(t.model):''):'no model yet')+'</span>'+(t.login?' <button class="pill" data-d="login" data-p="'+esc(t.login)+'">Log in to '+esc(t.login)+'</button>':'')+(t.note?'<div class="m">'+esc(t.note)+'</div>':'')+'</div>').join('');
 const reps=g.evidence.filter(e=>e.report);
 const ev=reps.length?'<details class="dr-ev"><summary>Results</summary>'+reps.map(e=>'<div class="dr-e"><div><b>'+esc(e.title)+'</b> <span class="m">'+esc(e.provider||'')+(e.model?' · '+esc(e.model):'')+' · '+when(e.endedAt)+'</span></div><pre class="dr-pre">'+esc(String(e.report.head||'').slice(0,320))+'</pre><div class="m">'+esc(e.report.path)+'</div></div>').join('')+'</details>':'';
 return rows?'<div class="tk-h">Handed out</div><div class="dr-sec">'+rows+'</div>'+ev:ev;
}

function build(){
 const g=current(),need=d.needsYou||[],dis=d.dispatcher,gs=(d.goals||[]).slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
 const tm=(orch&&orch.team)||[],o=(orch&&orch.orchestrator)||{};
 let h='<div id="dr-root" class="tk"><div class="tk-hello">Director</div><div class="m">Tell the director what you want. It plans the work, hands it to the models you ticked, collects their reports and keeps you updated here.</div>';
 if(d.config&&d.config.readError)h+='<div class="tk-bad"><b>config.json could not be read</b> ('+esc(d.config.readError)+'). The panel is using defaults. Saving a setting first copies the unreadable file to config.json.unreadable-*, so nothing is lost.</div>';
 if(dis&&(!dis.lastTick||Date.now()-dis.lastTick>15000||dis.error))h+='<div class="tk-bad"><b>The task dispatcher is not running.</b> '+esc(dis.error||'')+' Waiting tasks will not start.</div>';
 if(err)h+='<div class="tk-err">'+esc(err)+'</div>';
 if(msg)h+='<div class="tk-ok">'+esc(msg)+'</div>';
 h+='<details id="dr-set" class="dr-ev"'+(setOpen?' open':'')+'><summary>Director and models: '+esc(o.provider?o.provider+(o.model?' '+o.model:'')+(o.effort?' ('+o.effort+')':''):'no director chosen')+', '+(tm.length?tm.length+' model(s) ticked':'any model')+'</summary><div class="dr-form">'+picker()+'</div><div class="dr-form"><div class="hl">Models the director may use</div>'+team()+'</div><div class="dr-form">'+workers()+'</div></details>';
 h+='<div class="dr-act"><label>Chat <select id="dr-chat"><option value="new"'+(g?'':' selected')+'>New chat</option>'+gs.map(x=>'<option value="'+esc(x.id)+'"'+(g&&x.id===g.id?' selected':'')+'>'+esc(x.title.slice(0,50))+' · '+when(x.updatedAt)+'</option>').join('')+'</select></label>'+(g?pill(g.stageLabel,'stage-'+g.stage):'')+'</div>'+status(g);
 h+='<div id="dr-thread">'+(g&&g.thread&&g.thread.length?g.thread.map(bubble).join(''):'<div class="tk-empty">Nothing here yet. Tell the director what you want done.</div>')+'</div>';
 h+='<form id="dr-form" class="dr-form dr-comp"><textarea id="dr-text" rows="3" placeholder="'+(g?'Reply to the director…':'Tell the director what you want done…')+'"></textarea><div class="dr-act"><button class="pill" id="dr-go" type="submit">Send</button><span id="dr-msg" class="m">Enter sends, Shift+Enter adds a line.</span></div></form>';
 if(g){const b=[];
  if(g.controls.canPause)b.push(btn('pause',g.id,'Pause'));
  if(g.controls.canResume)b.push(btn('resume',g.id,'Resume'));
  if(g.controls.canStop)b.push(btn('stop',g.id,'Stop'));
  if(g.status==='active')b.push(btn('done',g.id,'Mark done'));
  if(b.length)h+='<div class="dr-act">'+b.join(' ')+'</div>';
  h+=work(g);}
 if(need.length)h+='<div class="tk-h">Needs you</div>'+need.map(n=>'<div class="tk-att"><div><b>'+esc(n.goal)+'</b></div><div class="tk-note">'+esc(n.detail)+' '+needBtn(n)+'</div></div>').join('');
 h+='<details id="dr-tk" class="dr-ev"'+(tkOpen?' open':'')+'><summary>All tasks (the full tree: stop, retry, read each log)</summary><div id="dr-tasks"></div></details>';
 h+='<details id="dr-bd" class="dr-ev"'+(bdOpen?' open':'')+'><summary>Team board (the agents write here)</summary>'+boardHtml()+'</details>';
 h+='<details id="dr-bu" class="dr-ev"'+(buOpen?' open':'')+'><summary>Budget right now</summary>'+(budget&&budget.providers?'<div class="cards">'+money(budget)+'</div>':'<div class="empty">Budget not available.</div>')+'</details>';
 const ghErr=d.github&&d.github.error;
 h+='<details id="dr-adv" class="dr-ev"'+(advOpen?' open':'')+'><summary>Advanced: folder, limits, machines, pull requests</summary>'
  +'<div class="dr-form"><div class="hl">Where the director works (used by a new chat)</div><div class="dr-grid"><label>Folder<input id="dr-dir" value="'+esc((d.config&&d.config.projectDir)||'')+'"></label><label>Live tasks allowed<input id="dr-max" type="number" min="1" max="12" value="4"></label><label>Task minutes<input id="dr-min" type="number" min="5" max="1440" value="120"></label><label>Priority<select id="dr-pri">'+[1,2,3,4,5].map(n=>'<option value="'+n+'"'+(n===3?' selected':'')+'>'+PR[n]+'</option>').join('')+'</select></label></div></div>'
  +'<div class="tk-h">Machines</div>'+machinesCard(d.machines)
  +'<div class="tk-h">Pull requests and CI</div>'+(ghErr?'<div class="tk-warn">'+esc(ghErr)+'</div>':ghCard(d.github))
  +'</details></div>';
 return h;
}

const KEEP=['dr-text','dr-dir','dr-max','dr-min','dr-pri','dr-mname','dr-murl','dr-model'];
function keep(){
 const k={vals:{},focus:null,lists:[...document.querySelectorAll('.dr-tl')].map(x=>x.scrollTop)};
 for(const id of KEEP){const x=$(id);if(x)k.vals[id]=x.value}
 const f=document.activeElement,el=$('prov');
 if(f&&f.id&&el&&el.contains(f))k.focus={id:f.id,s:f.selectionStart,e:f.selectionEnd};
 const adv=$('dr-adv');if(adv)advOpen=adv.open;
 const set=$('dr-set');if(set)setOpen=set.open;
 for(const [id,f] of [['dr-tk',v=>tkOpen=v],['dr-bd',v=>bdOpen=v],['dr-bu',v=>buOpen=v]]){const x=$(id);if(x)f(x.open)}
 k.logs={};for(const p of tasksEl.querySelectorAll('pre[data-k]'))k.logs[p.dataset.k]=[p.scrollTop,p.scrollHeight-p.scrollTop-p.clientHeight<30];
 const th=$('dr-thread');k.th=th?{top:th.scrollTop,bottom:th.scrollHeight-th.scrollTop-th.clientHeight<30}:null;
 return k}
function restore(k){
 for(const id of KEEP){const x=$(id);if(x&&k.vals[id]!=null)x.value=k.vals[id]}
 document.querySelectorAll('.dr-tl').forEach((x,i)=>{if(k.lists[i])x.scrollTop=k.lists[i]});
 for(const p of tasksEl.querySelectorAll('pre[data-k]')){const o=k.logs&&k.logs[p.dataset.k];if(o)p.scrollTop=o[1]?p.scrollHeight:o[0]}
 const th=$('dr-thread');if(th)th.scrollTop=!k.th||k.th.bottom||stick?th.scrollHeight:k.th.top;
 stick=false;
 if(k.focus){const x=$(k.focus.id);if(x){x.focus();try{x.setSelectionRange(k.focus.s,k.focus.e)}catch{}}}}

function draw(force){
 const el=$('prov');if(!el||tab!=='director')return;
 if(!d){el.innerHTML='<div class="empty">'+esc(err||'The director did not answer.')+'</div>';return}
 const f=document.activeElement;
 if(!force&&(saving||(f&&f.tagName==='SELECT'&&el.contains(f))))return;
 const top=el.scrollTop,k=keep();el.innerHTML=build();const ph=$('dr-tasks');if(ph&&ph!==tasksEl)ph.replaceWith(tasksEl);restore(k);el.scrollTop=top}

async function load(){
 if(busy)return;busy=1;
 try{
  const gen=orchGen;
  const [r,o,b,s,bd]=await Promise.all([j('/director'),j('/orch'),j('/budget'),Date.now()-setupAt>60000?j('/setup'):null,j('/board?json=1')]);
  if(r.ok&&r.body){d=r.body;err=''}
  else err=(r.body&&r.body.error)||'The director is not answering.';
  if(o.ok&&gen===orchGen)orch=o.body;
  if(b.ok)budget=b.body;
  if(bd.ok&&Array.isArray(bd.body))board=bd.body;
  if(s&&s.ok){setup=s.body;setupAt=Date.now()}
  draw();
  if(!models&&Date.now()-modelsAt>60000){modelsAt=Date.now();j('/models').then(m=>{if(m.ok){models=m.body;draw()}})}
 }finally{busy=0}}

PAGES.director=async()=>{await load()};

document.addEventListener('submit',e=>{
 if(e.target.id!=='dr-form'&&e.target.id!=='dr-mform')return;
 e.preventDefault();
 e.target.id==='dr-mform'?addMachine():send()});

document.addEventListener('keydown',e=>{if(tab==='director'&&e.target.id==='dr-text'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('dr-form').requestSubmit()}});

const say=(cls,txt)=>{const m=$('dr-msg');if(m){m.className=cls;m.textContent=txt}if(cls==='tk-err')err=txt};

async function send(){
 const x=$('dr-text'),t=x.value.trim(),g=d&&current();
 if(!t){say('tk-err','Write something for the director.');return}
 const lim=n=>$(n)?Number($(n).value):undefined;
 $('dr-go').disabled=true;say('m','Sending…');
 const r=g?await post('/director/goal/'+encodeURIComponent(g.id)+'/steer',{text:t})
  :await post('/director/goal',{title:t.split('\n')[0].slice(0,100),text:t,priority:lim('dr-pri'),projectDir:$('dr-dir')?$('dr-dir').value.trim():'',limits:{maxLive:lim('dr-max'),taskMinutes:lim('dr-min')}});
 $('dr-go').disabled=false;
 if(!r.ok){say('tk-err',(r.body&&r.body.error)||'Could not send it.');return}
 if(!g&&r.body&&r.body.goal)curId=r.body.goal.id;
 x.value='';msg='';err='';stick=true;
 await load();draw(true)}

async function saveOrch(patch){
 const o=(orch&&orch.orchestrator)||{};
 saving=1;orchGen++;
 try{
  const r=await post('/orch/config',{orchestrator:{mode:o.mode||'orchestrated',...(o.provider==='antigravity'?{provider:'',model:'',effort:''}:{provider:o.provider,model:o.model,effort:o.effort}),...(patch.orchestrator||{})},workerModels:patch.workers||(orch&&orch.workerModels)||{},team:patch.team||(orch&&orch.team)||[]});
  orchGen++;
  if(r.ok){orch=r.body;err='';msg=patch.say||'Saved.'}else err=(r.body&&r.body.error)||'Could not save.';
 }finally{saving=0}
 draw(true)}

function saveDirector(){
 const p=$('dr-prov').value;
 if(!p){err='Choose a provider for the director.';return draw(true)}
 const m=$('dr-model').value.trim(),e=$('dr-eff').value;
 return saveOrch({orchestrator:{mode:'orchestrated',provider:p,model:m,effort:e},say:'Director set to '+p+(m?' · '+m:' · provider default')+(e?' ('+e+')':'')+'.'})}

function saveTeam(){
 const lv=new Map([...document.querySelectorAll('[data-te]')].map(x=>[x.dataset.te,x.value]));
 const list=[...document.querySelectorAll('[data-tm]')].filter(x=>x.checked).map(x=>{const i=x.dataset.tm.indexOf('|');return{provider:x.dataset.tm.slice(0,i),model:x.dataset.tm.slice(i+1),effort:lv.get(x.dataset.tm)||''}});
 return saveOrch({team:list,say:list.length?'The director may use '+list.length+' model(s).':'The director may use any model.'})}

function saveWorkers(){
 const w={};for(const x of document.querySelectorAll('[data-wm]'))w[x.dataset.wm]=x.value.trim();
 return saveOrch({workers:w,say:'Default models saved.'})}

async function addMachine(){
 const n=$('dr-mname'),u=$('dr-murl');
 const r=await post('/director/machines/add',{name:n.value.trim(),url:u.value.trim()});
 if(!r.ok){err=(r.body&&r.body.error)||'Could not add it.';return load()}
 msg=(r.body&&r.body.note)||'Added.';n.value='';u.value='';load()}

document.addEventListener('change',e=>{
 if(tab!=='director')return;
 const t=e.target;
 if(t.id==='dr-prov'){$('dr-model').value='';$('dr-eff').value='';saveDirector()}
 else if(t.id==='dr-model'||t.id==='dr-eff')saveDirector();
 else if(t.dataset&&(t.dataset.tm||t.dataset.te))saveTeam();
 else if(t.dataset&&t.dataset.wm!==undefined)saveWorkers();
 else if(t.id==='dr-chat'){curId=t.value;stick=true;draw(true)}});

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-d]');if(!b||tab!=='director')return;
 const a=b.dataset.d,id=b.dataset.id;
 if(a==='login'){const p=b.dataset.p,r=await j('/auth?p='+encodeURIComponent(p)+'&a=login',{method:'POST'});setupAt=0;const note=setup&&setup.providers&&setup.providers[p]&&setup.providers[p].loginNote;if(r.ok){msg='A terminal opened for the '+p+' login. Sign in in the browser, then press Retry on the task.'+(note?' '+note:'');err=''}else err='Could not open the login for '+p+'.';return load()}
 if(a==='gh-refresh'){b.disabled=true;await j('/director/github?fresh=1');return load()}
 if(a==='machine-check'){b.disabled=true;msg='Connecting…';await load();const r=await post('/director/machines/check',{id});msg=(r.body&&(r.body.why||('Connected: '+JSON.stringify(r.body.capabilities||{}).slice(0,200))))||'Done.';return load()}
 if(a==='machine-remove'){if(!confirm('Remove this machine from the list? Nothing is deleted on it.'))return;await post('/director/machines/remove',{id});return load()}
 if(a==='resume-task'||a==='retry-task'){
  const u=a==='resume-task'?'/director/task/'+encodeURIComponent(id)+'/resume':'/tasks/'+encodeURIComponent(id)+'/retry';
  let r=await post(u,{});
  if(!r.ok&&r.body&&r.body.orphanPid){if(!confirm(r.body.error+'\n\nGo ahead anyway?'))return load();r=await post(u,{force:true})}
  if(!r.ok)alert((r.body&&r.body.error)||'Could not do that.');
  return load()}
 if(a==='approve-task'||a==='refuse-task'){const r=await post('/tasks/'+encodeURIComponent(id)+'/'+(a==='approve-task'?'approve':'cancel'),{});if(!r.ok)alert((r.body&&r.body.error)||'Could not do that.');return load()}
 if(a==='stop'){if(!confirm('Stop this chat? Its live tasks are cancelled; finished work is kept.'))return;const r=await post('/director/goal/'+encodeURIComponent(id)+'/stop',{});if(!r.ok)alert((r.body&&r.body.error)||'Could not stop it.');return load()}
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

const tree=()=>{const x=$('dr-tk');if(tab==='director'&&x&&x.open&&tasksEl.isConnected&&window.TASKS)window.TASKS(tasksEl)};
document.addEventListener('toggle',e=>{if(e.target.id==='dr-tk')tree()},true);
setInterval(()=>{if(tab==='director')load().then(tree)},12000);
setInterval(tree,4500);
})();
