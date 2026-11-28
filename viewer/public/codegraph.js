(() => {
  let sequence = 0;
  let state = { project: '', scope: '', file: '' };
  const symbol = n => `<button class="cg-node" data-symbol="${esc(n.id)}"><b>${esc(n.name)}</b><span>${esc(n.kind)} · ${esc(n.file)}:${esc(n.line)}</span>${n.calls ? `<small>${esc(n.calls)} call sites</small>` : ''}</button>`;
  function lines(page, links) {
    const map = page.querySelector('.cg-overview'), svg = map?.querySelector('svg');
    if (!svg) return;
    const box = map.getBoundingClientRect(), positions = new Map();
    map.querySelectorAll('[data-graph-id]').forEach(n => { const r = n.getBoundingClientRect(); positions.set(n.dataset.graphId, [r.left+r.width/2-box.left, r.top+r.height/2-box.top, r.width/2, r.height/2]); });
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = '<defs><marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>';
    const fragment = document.createDocumentFragment();
    links.forEach(l => { const a=positions.get(l.source), b=positions.get(l.target); if (!a || !b) return; const dx=b[0]-a[0],dy=b[1]-a[1],start=Math.min(a[2]/Math.abs(dx||1e-9),a[3]/Math.abs(dy||1e-9)),end=Math.min(b[2]/Math.abs(dx||1e-9),b[3]/Math.abs(dy||1e-9)); const line=document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1',a[0]+dx*start); line.setAttribute('y1',a[1]+dy*start); line.setAttribute('x2',b[0]-dx*end); line.setAttribute('y2',b[1]-dy*end); line.setAttribute('marker-end','url(#cg-arrow)'); const title=document.createElementNS('http://www.w3.org/2000/svg','title'); title.textContent=`${l.kind}: ${l.count}`; line.appendChild(title); fragment.appendChild(line); });
    svg.appendChild(fragment);
  }
  async function request(page, endpoint, params) {
    const n=++sequence, result=page.querySelector('.cg-result');
    result.textContent='Loading graph…';
    try {
      const response=await fetch(endpoint+'?'+new URLSearchParams({ project: state.project, ...params }));
      const data=await response.json();
      if (n!==sequence || !page.isConnected) return null;
      if (!response.ok) throw new Error(data.error || 'Could not read the graph.');
      page.querySelector('.cg-project-path').value=data.project;
      state.project=data.project;
      try { localStorage.setItem('cc-graph-project',state.project); } catch {}
      return data;
    } catch(e) { if(n===sequence && page.isConnected) result.textContent=e.message; return null; }
  }
  async function overview(page, scope='', file='') {
    const data=await request(page,'/codegraph/overview',{scope,file});
    if (!data) return;
    state.scope=scope; state.file=file;
    const area=page.querySelector('.cg-result');
    const entries=data.nodes.sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));
    area.innerHTML=`<div class="cg-location"><button class="pill cg-up" type="button" ${!scope&&!file?'disabled':''}>Up one level</button><b>${esc(file||scope||'Entire project')}</b><span>${entries.length} items · ${data.links.reduce((n,x)=>n+x.count,0)} connections between items</span></div><div class="cg-viewport"><div class="cg-overview"><svg aria-hidden="true"></svg><div class="cg-grid">${entries.map(n=>`<button class="cg-node cg-item" data-graph-id="${esc(n.id)}" data-kind="${esc(n.kind)}" data-path="${esc(n.path)}"><b>${esc(n.name||'(unnamed)')}</b><span>${esc(n.kind)} · ${n.symbols} symbols · ${n.internal} internal links</span></button>`).join('')}</div></div></div>`;
    area._links=data.links; requestAnimationFrame(()=>lines(page,data.links));
  }
  async function search(page, query, offset=0) {
    const data=await request(page,'/codegraph',{query,offset}); if(!data)return;
    page.querySelector('.cg-result').innerHTML=`<h3>Search results</h3><p>Matches ${offset+1}–${offset+data.results.length}. Select a symbol to inspect its calls.</p><div class="cg-results">${data.results.length?data.results.map(symbol).join(''):'No symbols found.'}</div><div class="cg-location"><button class="pill cg-prev" type="button" ${offset?'':'disabled'}>Previous</button><button class="pill cg-next" type="button" ${data.hasMore?'':'disabled'}>Next</button></div>`;
    page.querySelector('.cg-prev').onclick=()=>search(page,query,Math.max(0,offset-30));
    page.querySelector('.cg-next').onclick=()=>search(page,query,offset+30);
  }
  async function focus(page,id) {
    const data=await request(page,'/codegraph',{id}); if(!data)return;
    const group=(title,entries,side)=>`<section class="cg-side ${side}"><h3>${title}</h3><div class="cg-nodes">${entries.length?entries.map(symbol).join(''):'<span class="cg-empty">None indexed</span>'}</div></section>`;
    page.querySelector('.cg-result').innerHTML=`<div class="cg-location"><button class="pill cg-back" type="button">Back to overview</button></div><div class="cg-map">${group('Called by',data.callers,'cg-in')}<section class="cg-center"><h3>Selected symbol</h3>${symbol(data.center)}</section>${group('Calls',data.callees,'cg-out')}</div>`;
  }
  PAGES.graph=el=>{
    if(el.querySelector('.cg-page'))return;
    el.innerHTML='<div class="cg-page"><div class="cc-pagehead"><div><h2>Code graph</h2></div></div><p>Explore every indexed area and its connections. Open folders and files to see more detail. GDScript is not indexed by CodeGraph.</p><form class="cg-project-form"><label for="cg-project">Indexed project folder</label><input id="cg-project" class="cg-project-path" placeholder="Choose a project folder" required><button class="pill" type="submit">Open graph</button><button class="pill cg-browse" type="button">Browse…</button></form><form class="cg-search"><label for="cg-query">Find a symbol</label><input id="cg-query" maxlength="200" required><button class="pill" type="submit">Search</button><button class="pill cg-home" type="button">Entire project</button></form><div class="cg-result" aria-live="polite"></div></div>';
    const page=el.querySelector('.cg-page'), project=page.querySelector('.cg-project-path');
    page.querySelector('.cg-project-form').onsubmit=e=>{e.preventDefault();state.project=project.value.trim();overview(page);};
    page.querySelector('.cg-search').onsubmit=e=>{e.preventDefault();search(page,page.querySelector('#cg-query').value.trim());};
    page.querySelector('.cg-home').onclick=()=>overview(page);
    page.querySelector('.cg-browse').onclick=async()=>{try{const r=await fetch('/setup/pick-folder?what=project',{method:'POST'}), v=await r.json();if(v.error)throw new Error(v.error);if(v.path){project.value=v.path;state.project=v.path;overview(page);}}catch(e){page.querySelector('.cg-result').textContent=e.message;}};
    page.onclick=e=>{const item=e.target.closest('[data-kind]'), sym=e.target.closest('[data-symbol]');if(item){const kind=item.dataset.kind,p=item.dataset.path;if(kind==='folder')overview(page,p);else if(kind==='file'||kind==='outside')overview(page,'',p);else if(kind==='symbol')focus(page,p);}else if(sym)focus(page,sym.dataset.symbol);else if(e.target.closest('.cg-back'))overview(page,state.scope,state.file);else if(e.target.closest('.cg-up')){if(state.file)overview(page,state.file.includes('/')?state.file.slice(0,state.file.lastIndexOf('/')):'');else overview(page,state.scope.includes('/')?state.scope.slice(0,state.scope.lastIndexOf('/')):'');}};
    (async()=>{try{const saved=localStorage.getItem('cc-graph-project');const s=saved?'':(await (await fetch('/setup')).json()).config.projectDir;state.project=saved||s||'';project.value=state.project;if(state.project)overview(page);else page.querySelector('.cg-result').textContent='Choose the folder containing the CodeGraph index.';}catch(e){page.querySelector('.cg-result').textContent=e.message;}})();
  };
  addEventListener('resize',()=>{const page=document.querySelector('.cg-page'), links=page?.querySelector('.cg-result')?._links;if(links)lines(page,links);});
})();
