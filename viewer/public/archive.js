(()=>{
const PROV=[['all','All'],['freebuff','Freebuff'],['codex','Codex'],['cursor','Cursor'],['opencode','OpenCode'],['claude','Claude']];
const DAY=864e5,opened=new Set();let lastSig='';
let sub='all',query='',qraw='';try{sub=localStorage.getItem('cc-archive-sub')||'all'}catch(e){}
if(!PROV.some(p=>p[0]===sub))sub='all';
const day=t=>new Date(t).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'});
const name=p=>(PROV.find(x=>x[0]===p)||[0,p])[1];
const get=async u=>{try{const r=await fetch(u);return r.ok?await r.json():null}catch(e){return null}};

function chart(rows){const now=new Date();now.setHours(0,0,0,0);const base=new Date(now).setDate(now.getDate()-13),n=Array(14).fill(0);
 rows.forEach(r=>{const d=new Date(r.mtime);d.setHours(0,0,0,0);const i=13-Math.round((now-d)/DAY);if(i>=0&&i<14)n[i]++});
 const max=Math.max(1,...n),W=14*22;
 return '<svg class="achart" viewBox="0 0 '+W+' 56" preserveAspectRatio="none" role="img" aria-label="Archived sessions by last activity, last 14 days">'
  +n.map((c,i)=>{const h=c?Math.max(3,Math.round(c/max*36)):1,x=i*22+3;
   return '<rect x="'+x+'" y="'+(40-h)+'" width="16" height="'+h+'" rx="2"><title>'+esc(day(new Date(now).setDate(now.getDate()-13+i)))+': '+c+'</title></rect>'
    +(c?'<text x="'+(x+8)+'" y="'+(36-h)+'" text-anchor="middle">'+c+'</text>':'')}).join('')
  +'<text x="3" y="53" class="ax">'+esc(new Date(base).toLocaleDateString([],{month:'short',day:'numeric'}))+'</text><text x="'+(W-3)+'" y="53" text-anchor="end" class="ax">today</text></svg>'}

function row(r){const k=r.provider+':'+r.id,o=opened.has(k);
 const body=r.report?'<pre class="arep">'+esc(r.report)+'</pre>':'<div class="asum">'+esc(r.provider==='freebuff'?'No report was saved for this session.':name(r.provider)+' session in '+(r.cwd||'an unknown folder')+', last activity '+day(r.mtime)+'. Open it to read the messages.')+'</div>';
 return '<details class="arow" data-k="'+esc(k)+'"'+(o?' open':'')+'><summary><span class="at">'+esc(r.title||r.id)+'</span><span class="ap">'+esc(name(r.provider))+'</span><span class="ad">'+esc(day(r.mtime))+'</span><span class="ac">'+(r.tools==null?'-':r.tools+' tool calls')+'</span><span class="ar '+(r.report?'yes':'no')+'">'+(r.report?'report':'no report')+'</span></summary>'
  +'<div class="abody">'+body+'<button class="pill aopen" data-p="'+esc(r.provider)+'" data-id="'+esc(r.id)+'">Open</button></div></details>'}

function draw(el,all){const keep=el.querySelector('.alist')?.scrollTop||0;
 const cnt=p=>p==='all'?all.length:all.filter(r=>r.provider===p).length;
 const rows=all.filter(r=>(sub==='all'||r.provider===sub)&&(!query||String(r.title||r.id).toLowerCase().includes(query)));
 el.innerHTML='<div class="archive"><div class="atabs">'+PROV.map(p=>'<button class="atab'+(p[0]===sub?' on':'')+'" data-sub="'+p[0]+'">'+p[1]+' <b>'+cnt(p[0])+'</b></button>').join('')
  +'<input class="asearch" type="search" aria-label="Search archived sessions" placeholder="Search by title" value="'+esc(qraw)+'"></div>'
  +'<div class="ahead"><div class="hl">'+esc(name(sub))+': last activity, last 14 days</div>'+chart(all.filter(r=>sub==='all'||r.provider===sub))+'</div>'
  +'<div class="alist">'+(rows.length?rows.map(row).join(''):'<div class="empty">'+(query?'Nothing matches your search.':sub==='all'?'No archived sessions yet.':'No archived '+esc(name(sub))+' sessions.')+'</div>')+'</div></div>';
 el.querySelector('.alist').scrollTop=keep;
 el.querySelectorAll('.atab').forEach(b=>b.onclick=()=>{sub=b.dataset.sub;try{localStorage.setItem('cc-archive-sub',sub)}catch(e){}draw(el,all)});
 const s=el.querySelector('.asearch');s.addEventListener('compositionend',()=>s.oninput());s.oninput=e=>{if(e&&e.isComposing)return;qraw=s.value;query=qraw.trim().toLowerCase();const pos=s.selectionStart;draw(el,all);const n=el.querySelector('.asearch');n.focus();n.setSelectionRange(pos,pos)};
 el.querySelectorAll('.aopen').forEach(b=>b.onclick=e=>{e.preventDefault();window.openSession(b.dataset.p,b.dataset.id)});
 el.querySelectorAll('.arow').forEach(d=>d.addEventListener('toggle',()=>{d.open?opened.add(d.dataset.k):opened.delete(d.dataset.k)}))}

PAGES.archive=async el=>{
 if(document.activeElement?.classList.contains('asearch')&&el.contains(document.activeElement))return;
 if(!el.querySelector('.archive'))el.innerHTML='<div class="empty">Loading…</div>';
 const all=await get('/archive/sessions');
 if(!el.isConnected||tab!=='archive')return;
 if(!Array.isArray(all)){if(!el.querySelector('.archive'))el.innerHTML='<div class="empty">Could not load sessions.</div>';return}
 const sig=new Date().toDateString()+':'+all.length+':'+all.reduce((t,r)=>t+r.mtime+(r.report?1:0),0);if(sig===lastSig&&el.querySelector('.archive'))return;lastSig=sig;
 draw(el,all)};
})();
