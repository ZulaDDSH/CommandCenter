const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
const md=s=>esc(s).replace(/\x60([^\x60\n]+)\x60/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
function keepFeedFocus(f){const a=document.activeElement;if(!f.contains(a))return()=>{};const button=a.matches('[data-expand]'),key=button?a.dataset.expand:a.matches('.text[tabindex="-1"]')?a.dataset.k:null;return()=>{if(key==null)return;const t=(button&&Array.from(f.querySelectorAll('[data-expand]')).find(x=>x.dataset.expand===key))||Array.from(f.querySelectorAll('.text[data-k]')).find(x=>x.dataset.k===key);if(t){if(!t.matches('button'))t.tabIndex=-1;t.focus({preventScroll:true})}}}
const ago=ms=>{const s=Math.round((Date.now()-ms)/1000);return s<60?s+'s ago':s<3600?Math.round(s/60)+'m ago':Math.round(s/3600)+'h ago'};
const state=x=>x.report?'done':x.queued?'queued':(Date.now()-x.mtime<90000?'live':'idle');
const rate=x=>(x.rate?.tps!=null&&!x.report&&!x.queued?'<b>'+x.rate.tps+' tok/s</b> · ':'')+(x.rate?'~'+(x.rate.tokens>=1000?Math.round(x.rate.tokens/100)/10+'k':x.rate.tokens)+' tok out · ':'');
const AUTHS={freebuff:['login']};
const authBtns=p=>'<div class="auth">'+AUTHS[p].map(a=>'<button class="pill" data-auth="'+p+':'+a+'">'+(a==='login'?'Log in':'Log out')+'</button>').join('')+'<button class="pill" data-refresh="'+p+'">Refresh usage</button></div>';
const kind=n=>/terminal|command/.test(n)?'run':/read|glob|search|list/.test(n)?'read':/replace|write/.test(n)?'edit':'';
const stat=(a,d)=>'<span class="add">+'+a+'</span> <span class="del">-'+d+'</span>';
let sel=decodeURIComponent(location.hash.slice(1)),data=[],sig='',dfile=null,showHid=false;
const opened=new Set(),expanded=new Set();
const cur=()=>data.find(d=>d.slug===sel);
function item(x){const c=x.changes;return '<a class="s'+(x.slug===sel?' on':'')+'" data-s="'+x.slug+'"><div class="n"><span class="dot '+state(x)+'"></span>'+esc(x.label||x.slug)+'</div><div class="m">'+(x.expiresAt?'<b>'+left(x.expiresAt)+' left</b> · ':x.hourOver?'<b>hour over, waits to rejoin</b> · ':'')+rate(x)+x.steps.filter(s=>s.k==='tool').length+' tool calls · '+ago(x.mtime)+(c&&c.files.length?' · '+stat(c.add,c.del):'')+'</div><div class="fact"><button class="pill" data-fa="rename">Rename</button><button class="pill" data-fa="'+(x.hidden?'unarchive':'archive')+'">'+(x.hidden?'Unarchive':'Archive')+'</button><button class="pill" data-fa="delete">Delete</button></div></a>'}
const shown=()=>data.filter(x=>!x.archived&&(!x.hidden||showHid));
function list(){const n=data.filter(x=>!x.archived&&x.hidden).length;$('list').innerHTML=(shown().map(item).join('')||'<div class="s m">No running sessions.</div>')+(n?'<div class="s m"><button class="pill" data-fatog="1">'+(showHid?'Hide ':'Show ')+n+' archived</button></div>':'')}
function header(){const x=cur();if(!x)return;$('title').textContent=x.label||x.slug;const c=x.changes;
 $('meta').innerHTML=state(x)+(x.expiresAt?' · '+left(x.expiresAt)+' left':x.hourOver?' · hour over, waits to rejoin':'')+' · '+rate(x).replace(/ · $/,'')+' · updated '+ago(x.mtime)+(c?' · '+esc(c.branch):'');
 $('chg').innerHTML=c&&c.files.length?'<button class="pill" id="pill">'+c.files.length+' file'+(c.files.length>1?'s':'')+' changed '+stat(c.add,c.del)+'</button>':(c?'<span class="meta">no changes yet</span>':'<span class="meta">no worktree</span>');
 if(!$('pop').hidden)pop()}
function pop(){const c=cur()?.changes;if(!c)return;
 $('pop').innerHTML='<div class="c">vs '+esc(c.base)+(c.commits.length?' · '+c.commits.length+' commit'+(c.commits.length>1?'s':'')+': '+esc(c.commits[0]):' · uncommitted')+'</div>'+c.files.map(f=>{const i=f.path.lastIndexOf('/');return '<div class="f'+(f.path===dfile?' on':'')+'" data-f="'+esc(f.path)+'" title="'+esc(f.path)+'"><span class="p">&lrm;<i>'+esc(f.path.slice(0,i+1))+'</i><b>'+esc(f.path.slice(i+1))+'</b>'+(f.isNew?'<span class="new">new</span>':'')+'&lrm;</span><span class="st">'+stat(f.add,f.del)+'</span></div>'}).join('')}
async function openDiff(file){dfile=file;const f=cur().changes.files.find(f=>f.path===file);
 $('dname').textContent=file;$('dstat').innerHTML=f?stat(f.add,f.del):'';$('diff').classList.add('on');$('dbody').innerHTML='<div class="ln m">loading…</div>';
 const t=await (await fetch('/diff?slug='+encodeURIComponent(sel)+'&file='+encodeURIComponent(file))).text();
 $('dbody').innerHTML=t.split('\n').filter(l=>!/^(diff --git|index |--- |\+\+\+ |new file mode)/.test(l)).map(l=>'<div class="ln '+(l[0]==='+'?'a':l[0]==='-'?'d':l.startsWith('@@')?'h':l[0]==='\\'?'m':'')+'">'+esc(l)+'</div>').join('')||'<div class="ln m">No diff.</div>'}
function feed(){const x=cur();if(!x){$('feed').innerHTML='<div class="empty">No session.</div>';return}
 const f=$('feed'),atBottom=f.scrollHeight-f.scrollTop-f.clientHeight<80,top=f.scrollTop,restoreFocus=keepFeedFocus(f);
 f.innerHTML=x.steps.map((s,i)=>{const key=x.slug+':'+i;
  if(s.k==='user')return '<div class="user">'+md(s.text)+'</div>';
  if(s.k==='text'){const long=(s.text.split('\n').length>6||s.text.length>600)&&!expanded.has(key);return '<div class="text'+(long?' long':'')+'" data-k="'+esc(key)+'">'+md(s.text)+'</div>'+(long?'<button type="button" class="text-expand" data-expand="'+esc(key)+'">Show more</button>':'')}
  return '<details class="tool" data-k="'+key+'"'+(opened.has(key)?' open':'')+'><summary><span class="tag '+kind(s.name)+'">'+esc(s.name)+'</span><span class="cmd">'+esc(s.input)+'</span></summary><pre>'+esc(s.output||'(no output yet)')+'</pre></details>'}).join('')
  +(x.report?'<div class="report"><b>Report: fb-reports/'+esc(x.slug)+'.md</b>\n\n'+md(x.report)+'</div>':'');
 f.scrollTop=($('follow').checked&&atBottom)?f.scrollHeight:top;restoreFocus()}
async function tick(){try{const d=await (await fetch('/api')).json();const s=JSON.stringify(d.map(x=>[x.slug,x.mtime,!!x.report,x.expiresAt&&left(x.expiresAt),!!x.hourOver]));
 const old=JSON.stringify(cur()?.changes);data=d;const v=shown();if(v.length&&!v.some(x=>x.slug===sel)){sel=v[0].slug;sig=''}list();header();
 if(s!==sig){sig=s;feed()}if(dfile&&JSON.stringify(cur()?.changes)!==old)openDiff(dfile)}catch(e){}}
function pick(s){if(!s||s===sel)return;sel=s;dfile=null;$('diff').classList.remove('on');$('pop').hidden=true;list();header();feed();$('feed').scrollTop=$('feed').scrollHeight}
$('list').onclick=e=>{const a=e.target.closest('[data-s]'),b=e.target.closest('[data-fa]');
 if(e.target.closest('[data-fatog]')){showHid=!showHid;list();return}
 if(a&&b){const x=data.find(d=>d.slug===a.dataset.s);if(x)window.sessAct('freebuff',x.slug,b.dataset.fa,x.label||x.slug).then(ok=>ok&&tick());return}
 if(a)location.hash=a.dataset.s};
window.onhashchange=()=>pick(decodeURIComponent(location.hash.slice(1)));
$('chg').onclick=e=>{if(!e.target.closest('#pill'))return;$('pop').hidden=!$('pop').hidden;pop()};
$('pop').onclick=e=>{const r=e.target.closest('[data-f]');if(r){openDiff(r.dataset.f);pop()}};
document.addEventListener('click',e=>{if(!e.target.closest('#pop,#pill'))$('pop').hidden=true});
$('dclose').onclick=()=>{dfile=null;$('diff').classList.remove('on')};
$('feed').addEventListener('toggle',e=>{const k=e.target.dataset?.k;if(k)e.target.open?opened.add(k):opened.delete(k)},true);
$('feed').onclick=e=>{const b=e.target.closest('[data-expand]');if(b){const t=b.previousElementSibling;expanded.add(b.dataset.expand);t.classList.remove('long');t.tabIndex=-1;b.remove();t.focus({preventScroll:true})}};
const when=iso=>iso?new Date(iso).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}):'?';
const left=iso=>{const m=Math.max(0,Math.round((new Date(iso)-Date.now())/60000));return m>=60?Math.floor(m/60)+'h '+(m%60)+'m':m+'m'};
async function hours(fresh){try{const u=await (await fetch('/usage?p=freebuff'+(fresh?'&fresh=1':''))).json();if(u.loading)return setTimeout(hours,3000);
 if(u.error){$('hours').innerHTML='<div class="hl">Freebuff hours</div><div class="hm">unavailable: '+esc(u.error)+'</div>';return}
 const t=u.today,[hh,mm]=String(t.left).split(':').map(Number),pct=t.limit?Math.round(100*(hh+(mm||0)/60)/t.limit):0;
 $('hours').innerHTML='<div class="hl">Freebuff hours today</div><div class="big">'+esc(t.left)+' <small>/ '+esc(t.limit)+' left</small></div><div class="bar"><i style="width:'+(+pct||0)+'%"></i></div>'
  +'<div class="hm">'+(t.flashHours!=null?'<b>'+esc(t.flashHours)+' h</b> of DeepSeek work · ':'')+'resets '+esc(when(t.resetAt))+'</div>'
  +'<details class="more"'+isOpen('hours')+'><summary>More</summary><div class="hm">'+(t.flashHours!=null?'DeepSeek V4.1 Flash uses '+esc(t.flashCost)+' of these per hour of work. Beam and Solar are free.<br>':'')+'Monthly bonus: '+esc(u.month.left)+' / '+esc(u.month.limit)+' left<br>Running: '+u.open.length+' session'+(u.open.length===1?'':'s')
  +(u.open.length?'<br>'+u.open.map(o=>'<span class="chip" title="ends '+esc(when(o.endsAt))+'">'+esc(left(o.endsAt))+' left</span>').join(''):'')+'<br>Checked '+ago(u.fetchedAt)+'<br>To log out, type /logout inside freebuff.</div>'+authBtns('freebuff')+'</details>'}catch(e){}}
function isOpen(id){return $(id).querySelector('details.more')?.open?' open':''}
async function fbModels(){try{const m=await (await fetch('/usage?p=fbmodels')).json();if(m.loading)return setTimeout(fbModels,3000);
 if(m.error){$('fbm').innerHTML='<div class="hl">Freebuff model</div><div class="hm">unavailable: '+esc(m.error)+'</div>';return}
 const cur=m.current||m.recommendedKey,isDs=r=>/deepseek/i.test(r.name),sel=m.rows.find(r=>r.key===cur);
 const cost=r=>r.hours==null?'':r.hours===0?'free':r.hours+' hrs';
 const opt=r=>'<option value="'+esc(r.key)+'"'+(r.key===cur?' selected':'')+'>'+esc(r.name)+(r.hours==null?'':'  ·  '+cost(r))+'</option>';
 $('fbm').innerHTML='<div class="hl">Freebuff model</div><select id="fbsel" class="msel"><optgroup label="DeepSeek">'+m.rows.filter(isDs).map(opt).join('')+'</optgroup><optgroup label="Other models">'+m.rows.filter(r=>!isDs(r)).map(opt).join('')+'</optgroup></select>'
  +'<div class="hm" title="Applies to the next freebuff CLI. A running CLI keeps its model.">'+(sel&&sel.hours!=null?'<span class="mc'+(sel.hours===0?' free':'')+'">'+cost(sel)+(sel.hours?' per hour of use':'')+'</span>':'')+(m.current?'':' · recommended')+'</div>';
 $('fbsel').onchange=async e=>{e.target.disabled=true;const r=await fetch('/fb-model?key='+encodeURIComponent(e.target.value),{method:'POST'});if(!r.ok)alert('Could not save the model');fbModels()}}catch(e){}}
async function spawnInfo(){try{const d=await (await fetch('/spawn-check')).json();
 const R=d.roles||{};$('spawn').innerHTML='<div class="hl">Next freebuff task</div><div class="hm nt">'+(d.spawn?'Starts a new CLI':d.target?'Goes to CLI '+esc(d.target):'Waits')+' · '+esc(d.clis.length)+' / '+esc(d.max)+' CLIs</div><details class="more"'+isOpen('spawn')+'><summary>Details</summary><div class="hm">'+esc(d.why||'')+'<br>'
  +d.clis.map(c=>c.pending?'starting'+(c.model?' · '+esc(c.model):'')+' · no hour yet':'pid '+esc(c.pid)+(c.model?' · '+esc(c.model):'')+' · '+esc(c.minsLeft)+' min left · '+(c.working.length?'recent activity: '+esc(c.working.join(', ')):'idle')+(c.queued.length?' · queued: '+esc(c.queued.join(', ')):'')).join('<br>')
  +(d.codeLeft!=null?(d.clis.length?'<br>':'')+esc(d.codeLeft)+' h of '+esc(R.code||'coding')+' work left':'')+'</div></details>'}catch(e){}}
fetch('/setup').then(r=>r.json()).then(s=>{if(!s.config.setupDone&&!localStorage.getItem('cc-tab'))setTab('setup')}).catch(()=>{});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-auth],[data-refresh]');if(!b)return;
 if(b.dataset.auth){const [p,a]=b.dataset.auth.split(':');const r=await fetch('/auth?p='+p+'&a='+a,{method:'POST'});b.textContent=r.ok?'Opened a terminal window':'Failed';return}
 const p=b.dataset.refresh;b.textContent='Refreshing…';await fetch('/usage?p='+p+'&fresh=1');setTimeout(()=>{p==='freebuff'?hours():prov();routeInfo()},p==='freebuff'?6000:3000)});
let tab='home';try{tab=localStorage.getItem('cc-tab')||'home'}catch(e){}if(tab==='tasks'||tab==='board'||tab==='orch')tab='director';if(['freebuff','codex','cursor','opencode','claude'].includes(tab))tab='sessions';
const card=(title,big,sub,lines)=>'<div class="hours"><div class="hl">'+title+'</div><div class="big">'+big+(sub?' <small>'+sub+'</small>':'')+'</div><div class="hm">'+lines.filter(Boolean).join('<br>')+'</div></div>';
const bar=pct=>'<div class="bar"><i style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div>';
window.PAGES={};
function prov(){if(tab!=='freebuff')PAGES[tab]?.($('prov'))}
function setTab(t){const changed=tab!==t;tab=t;try{localStorage.setItem('cc-tab',t)}catch(e){}
 document.body.classList.toggle('other',t!=='freebuff');
 if(changed)$('prov').scrollTop=0;
  if(data.length){const v=shown();if(v.length&&!v.some(x=>x.slug===sel)){sel=v[0].slug;feed()}list();header()}document.querySelectorAll('#tabs a').forEach(a=>{const active=a.dataset.t===(t==='freebuff'?'sessions':t);a.classList.toggle('on',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});prov()}
$('tabs').onclick=e=>{const a=e.target.closest('[data-t]');if(a)setTab(a.dataset.t)};
$('tabs').onkeydown=e=>{const a=e.target.closest('[data-t]');if(a&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setTab(a.dataset.t)}};
async function routeInfo(){try{const r=await (await fetch('/usage?p=route')).json();if(r.loading)return setTimeout(routeInfo,3000);
 $('route').innerHTML=r.error?'Automatic routing: '+esc(r.error):'Automatic routing: <b>'+esc(r.provider)+'</b> · '+esc(r.model)+(r.effort?' ('+r.effort+')':'')+(r.variant?' ('+r.variant+')':'')+' <span title="'+esc(r.why)+'">ⓘ</span>'}catch(e){}}
addEventListener("DOMContentLoaded",()=>setTab(tab));routeInfo();setInterval(routeInfo,300000);setInterval(prov,60000);
tick();setInterval(tick,4000);hours();setInterval(hours,300000);fbModels();spawnInfo();setInterval(spawnInfo,15000);
