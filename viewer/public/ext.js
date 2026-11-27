(()=>{
const SECS=[['hooks','Hooks','Small scripts a tool runs by itself at set moments, for example before it edits a file.'],['mcp','MCP servers','Extra tools your AI apps can use, like notes, images or game data.'],['plugins','Plugins','Add-on bundles for Claude Code. A plugin can bring its own hooks and tools.']];
const closed=new Set();let data=null,q='',busy=false;

function rowHtml(r){
 const dis=r.ro||r.locked||busy;
 return '<div class="xrow'+(r.on?'':' off')+'"><label class="sw" title="'+esc(r.ro?(r.note||'Cannot be switched here'):r.locked||(r.on?'Turn off':'Turn on'))+'"><input type="checkbox" data-id="'+esc(r.id)+'" data-rev="'+esc(r.rev)+'"'+(r.on?' checked':'')+(dis?' disabled':'')+'><span></span></label>'
  +'<div class="xmain"><div class="xname">'+esc(r.name)+'<span class="xapp">'+esc(r.app)+'</span></div><div class="xwhat">'+esc(r.what)+'</div><div class="xsrc" title="'+esc(r.path)+'">From '+esc(r.source)+(r.stashed?' (saved copy, put back when you turn it on)':'')+'</div>'
  +(r.ro&&r.note?'<div class="xnote">'+esc(r.note)+'</div>':'')+(r.locked?'<div class="xnote">'+esc(r.locked)+'</div>':'')+(!r.ro&&!r.locked&&r.note?'<div class="xnote">'+esc(r.note)+'</div>':'')+'</div></div>'}

function paint(el){
 if(!data)return;
 const f=q.trim().toLowerCase(),match=r=>!f||[r.name,r.what,r.source,r.app].join(' ').toLowerCase().includes(f);
 const bad=data.files.filter(x=>x.ok===false).map(x=>'<div class="xmsg bad">'+esc(x.file)+': '+esc(x.error||'cannot be read')+'</div>').join('')+(data.stash.ok?'':'<div class="xmsg bad">'+esc(data.stash.error)+'</div>');
 el.querySelector('.xbody').innerHTML=bad+SECS.map(([k,title,help])=>{
  const all=data.rows.filter(r=>r.section===k),rows=all.filter(match);
  return '<details class="xsec" data-k="'+k+'"'+(closed.has(k)?'':' open')+'><summary>'+title+' <span class="xcount">'+(f?rows.length+' of ':'')+all.length+' found, '+all.filter(r=>r.on).length+' on</span></summary><div class="xhint" style="padding:0 16px">'+help+'</div>'
   +(rows.length?rows.map(rowHtml).join(''):'<div class="xempty">'+(all.length?'Nothing matches your search.':'None found on this PC.')+'</div>')+'</details>'}).join('')}

async function load(el){
 let d=null;try{const r=await fetch('/ext/list');if(r.ok)d=await r.json()}catch(e){}
 if(!el.isConnected||tab!=='ext')return;
 if(!d){el.querySelector('.xbody').innerHTML='<div class="empty">Could not read the extension list.</div>';return}
 data=d;paint(el)}

function say(el,text,ok){const m=el.querySelector('.xmsg.top');m.hidden=!text;m.className='xmsg top '+(ok?'ok':'bad');m.textContent=text}

async function flip(el,box){
 const on=box.checked,body={id:box.dataset.id,on,rev:box.dataset.rev};
 busy=true;el.querySelectorAll('.sw input').forEach(i=>i.disabled=true);
 try{
  let r=await fetch('/ext/toggle',{method:'POST',body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
  if(r.status===422&&j.confirm&&confirm(j.error)){r=await fetch('/ext/toggle',{method:'POST',body:JSON.stringify({...body,reformat:true})});j=await r.json().catch(()=>({}))}
  if(r.ok)say(el,j.note||'Done. Restart the CLI for this to apply.',true);else say(el,j.error||'Could not change it.',false)
 }catch(e){say(el,'Could not reach the panel.',false)}
 busy=false;await load(el)}

PAGES.ext=el=>{
 if(!el.querySelector('.ext')){
  q='';el.innerHTML='<div class="ext"><h2>Hooks &amp; MCP</h2><div class="xhint">Everything that runs on this PC for your AI tools. Use the switches to turn things on or off. Each change keeps a backup copy of the file it touches. Restart the tool (CLI) for a change to apply.</div>'
   +'<div class="xbar"><input id="xq" type="search" placeholder="Search by name, what it does, or file" autocomplete="off"></div><div class="xmsg top" hidden></div><div class="xbody"><div class="empty">Reading…</div></div></div>';
  const inp=el.querySelector('#xq');inp.oninput=()=>{q=inp.value;paint(el)};
  el.querySelector('.xbody').addEventListener('change',e=>{if(e.target.matches('.sw input'))flip(el,e.target)});
  el.querySelector('.xbody').addEventListener('toggle',e=>{const k=e.target.dataset?.k;if(k)e.target.open?closed.delete(k):closed.add(k)},true)}
 else if(busy)return;
 load(el)};
})();
