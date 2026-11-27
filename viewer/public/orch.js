(()=>{
const NAMES={freebuff:'Freebuff',codex:'Codex',cursor:'Cursor',opencode:'OpenCode',claude:'Claude'};
const ORDER=['freebuff','codex','cursor','opencode','claude'];
const j=async u=>{try{const r=await fetch(u);return r.ok?await r.json():null}catch(e){return null}};
let st=null,models=null;

function pick(id,rows,value,blank){
 const list=rows||[],has=!value||list.some(r=>r.id===value);
 return '<select id="'+id+'" class="msel"><option value="">'+esc(blank)+'</option>'
  +list.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===value?' selected':'')+' title="'+esc(r.note||'')+'">'+esc(r.name)+(r.id&&r.id!==r.name?'  ·  '+esc(r.id):'')+(r.note&&/free|not read/.test(r.note)?'  ·  '+esc(r.note):'')+'</option>').join('')
  +(has?'':'<option value="'+esc(value)+'" selected>'+esc(value)+' (saved)</option>')+'</select>'
  +'<input id="'+id+'-x" class="or-x" placeholder="or type a model id" autocomplete="off">'}

const val=id=>{const x=$(id+'-x')?.value.trim();return x||$(id)?.value||''};

function build(el){
 const o=st.orchestrator,on=ORDER.filter(p=>st.providers[p]);
 const provs='<option value=""'+(o.provider?'':' selected')+'>First one that is on</option>'+on.map(p=>'<option value="'+p+'"'+(o.provider===p?' selected':'')+'>'+NAMES[p]+'</option>').join('');
 el.innerHTML='<div id="or-root" class="tk or">'
  +'<div class="tk-hello">Orchestrator</div>'
  +'<div id="or-tasks"></div>'
  +'<div class="tk-h">Team board <span class="m">(the agents write here; you can read it)</span></div><div id="or-board"></div>'
  +'<div class="tk-h">Budget right now</div><div id="or-budget"></div>'
  +'<details class="tk-box"><summary class="hl">Settings</summary>'
  +'<form id="or-form"><div class="hl">How new work is handled</div>'
  +'<label>Mode<select id="or-mode"><option value="simple"'+(o.mode==='simple'?' selected':'')+'>Simple: the panel picks a provider for each task</option><option value="orchestrated"'+(o.mode==='orchestrated'?' selected':'')+'>Orchestrated: one smart model plans the work and hands out the parts</option></select></label>'
  +'<div id="or-orch"><div class="tk-grid or-grid"><label>Orchestrator provider<select id="or-prov">'+provs+'</select></label>'
  +'<label>Orchestrator model<span id="or-modelbox"></span></label></div>'
  +'<div class="m">The orchestrator reads the live budget below, picks a provider and model for each part, watches the workers and checks their reports. Pick a strong model: it does the thinking, not the typing.</div></div>'
  +'<div class="hl or-gap">Worker model for each provider</div><div class="m">Used for tasks handed to that provider when nothing more specific is asked. Leave it on the provider default to use the model from Setup.</div>'
  +'<div id="or-workers" class="tk-grid or-wgrid"></div>'
  +'<div class="tk-act"><button class="pill" id="or-save">Save</button><span id="or-msg" class="m"></span></div></form>'
  +'<div class="hl or-gap">How it works</div><ul>'
  +'<li>Orchestrated (the default): what you ask for goes to the orchestrator. It splits the work, starts workers, approves their sub-tasks and checks their reports. Its workers show under it.</li>'
  +'<li>Simple: one agent does the whole job, picked by the panel. No orchestrator.</li>'
  +'<li>With no orchestrator provider picked, the first one that is on is used: Claude, Codex, OpenCode, Cursor, then Freebuff.</li>'
  +'<li>At most 8 live sub-tasks per task and 3 levels deep. Every sub-task obeys the provider limits.</li></ul></details></div>';
 fill();
 $('or-mode').onchange=toggle;
 $('or-prov').onchange=()=>{$('or-modelbox').innerHTML=$('or-prov').value?pick('or-model',models?.[$('or-prov').value],'','Provider default'):'<div class="m">Uses the provider default.</div>'};
 toggle()}

function fill(){
 const o=st.orchestrator,w=st.workerModels||{};
 $('or-modelbox').innerHTML=o.provider?pick('or-model',models?.[o.provider],o.model,'Provider default'):'<div class="m">Uses the provider default.</div>';
 $('or-workers').innerHTML=ORDER.filter(p=>st.providers[p]).map(p=>'<label>'+NAMES[p]+'<span>'+pick('or-w-'+p,models?.[p],w[p]||'','Provider default')+'</span></label>').join('')||'<div class="m">No provider is turned on. Use the Setup tab.</div>'}

const toggle=()=>{const e=$('or-orch');if(e)e.style.display=$('or-mode').value==='orchestrated'?'':'none'};

function money(b){
 return ORDER.map(p=>{const e=b.providers[p];if(!e)return '';
  const state=!e.enabled?'turned off':!e.installed?'not installed':'on';
  let lines=[];
  if(p==='freebuff'&&e.enabled)lines=[e.hoursLeft?esc(e.hoursLeft)+' of '+esc(e.hoursLimit)+' hours left today':esc(e.error||'hours not read yet'),...(e.models||[]).slice(0,6).map(m=>esc(m.name)+': '+(m.hoursPerHour===0?'free':m.workHoursLeft==null?'?':esc(m.workHoursLeft)+' h of work left'))];
  else if(p==='codex'&&e.enabled)lines=(e.windows||[]).map(x=>esc((x.minutes>=1440?x.minutes/1440+' day':x.minutes/60+' hour'))+' window: '+(x.stale?'old data':esc(100-x.usedPercent)+'% left')).concat(e.note?[esc(e.note)]:[]);
  else if(p==='cursor'&&e.enabled)lines=[e.signedIn?'signed in':'not signed in'];
  else if(p==='opencode'&&e.enabled)lines=e.today?['spent today '+esc(e.today.cost),'last 7 days '+esc(e.week?.cost)]:[];
  else if(e.enabled)lines=[esc(e.note||'')];
  return card(NAMES[p],esc(state),'running '+esc(e.running)+' of '+esc(e.max),lines)}).join('')}

let budgetAt=0,boardHtml='',building=0;
async function paint(el,quick){
 if(!el.querySelector('#or-root')){
  if(building)return;building=1;let s,m;
  try{[s,m]=await Promise.all([j('/orch'),j('/models')])}finally{building=0}
  if(tab!=='orch'||el.querySelector('#or-root'))return;
  if(!s){el.innerHTML='<div class="empty">The panel server does not know the orchestrator yet. Restart it.</div>';return}
  st=s;models=m;build(el);quick=false}
 window.TASKS?.($('or-tasks'));
 const n=await j('/board?json=1');
 if(tab==='orch'&&$('or-board')&&Array.isArray(n)){const h=n.length?n.slice(-20).reverse().map(x=>'<div class="note"><div class="m"><b>'+esc(x.from)+'</b> · '+when(x.at)+'</div><div class="t">'+md(x.text)+'</div></div>').join(''):'<div class="tk-empty">No notes yet.</div>';if(h!==boardHtml||!$('or-board').innerHTML){boardHtml=h;$('or-board').innerHTML=h}}
 if(quick&&Date.now()-budgetAt<60000)return;
 budgetAt=Date.now();
 const b=await j('/budget');if(tab!=='orch'||!$('or-budget'))return;
 $('or-budget').innerHTML=b?'<div class="cards">'+money(b)+'</div>':'<div class="empty">Budget not available.</div>'}

PAGES.orch=async (el,quick)=>{await paint(el,quick)};

document.addEventListener('submit',async e=>{
 if(e.target.id!=='or-form')return;e.preventDefault();
 const w={};for(const p of ORDER)if($('or-w-'+p))w[p]=val('or-w-'+p);
 const body={orchestrator:{mode:$('or-mode').value,provider:$('or-prov').value,model:val('or-model')},workerModels:w};
 const b=$('or-save'),m=$('or-msg');b.disabled=true;m.className='m';m.textContent='Saving…';
 try{
  const r=await fetch('/orch/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({error:'The server sent a bad answer.'}));
  if(!r.ok||d.error){m.className='tk-err';m.textContent=d.error||'Could not save.'}
  else{st=d;m.className='tk-ok';m.textContent='Saved. New tasks use this now.'}
 }catch(err){m.className='tk-err';m.textContent='Could not reach the server: '+err.message}
 finally{b.disabled=false}});
})();
