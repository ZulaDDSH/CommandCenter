(() => {
  let sequence = 0;
  const node = n => `<button class="cg-node" data-symbol="${esc(n.id)}"><b>${esc(n.name)}</b><span>${esc(n.kind)} · ${esc(n.file)}:${esc(n.line)}</span>${n.calls ? `<small>${esc(n.calls)} call sites</small>` : ''}</button>`;
  function drawLines(el) {
    const area = el.querySelector('.cg-map'), svg = area?.querySelector('svg'), center = area?.querySelector('.cg-center .cg-node');
    if (!svg || !center) return;
    const box = area.getBoundingClientRect(), c = center.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = '<defs><marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>';
    area.querySelectorAll('.cg-side .cg-node').forEach(item => {
      const r = item.getBoundingClientRect(), incoming = !!item.closest('.cg-in');
      const a = incoming ? r : c, b = incoming ? c : r, line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const vertical = box.width < 700;
      line.setAttribute('x1', vertical ? a.left + a.width/2 - box.left : a.right - box.left);
      line.setAttribute('y1', vertical ? a.bottom - box.top : a.top + a.height/2 - box.top);
      line.setAttribute('x2', vertical ? b.left + b.width/2 - box.left : b.left - box.left);
      line.setAttribute('y2', vertical ? b.top - box.top : b.top + b.height/2 - box.top);
      line.setAttribute('marker-end', 'url(#cg-arrow)'); svg.appendChild(line);
    });
  }
  async function load(el, params = {}) {
    const n = ++sequence, result = el.querySelector('.cg-result');
    result.textContent = 'Loading graph…';
    try {
      const response = await fetch('/codegraph?' + new URLSearchParams(params));
      const data = await response.json();
      if (n !== sequence || !el.isConnected) return;
      if (!response.ok) throw new Error(data.error || 'Could not read the graph.');
      el.querySelector('.cg-project').textContent = `Index: ${data.project}`;
      if (data.results) {
        result.innerHTML = `<h3>Search results</h3><div class="cg-results">${data.results.length ? data.results.map(node).join('') : 'No symbols found.'}</div>`;
        return;
      }
      const group = (title, entries, truncated, side) => `<section class="cg-side ${side}"><h3>${title}${truncated ? ' · showing 12' : ''}</h3><div class="cg-nodes">${entries.length ? entries.map(node).join('') : '<span class="cg-empty">None indexed</span>'}</div></section>`;
      result.innerHTML = `<div class="cg-map"><svg aria-hidden="true"></svg>${group('Called by', data.callers, data.callersTruncated, 'cg-in')}<section class="cg-center"><h3>Selected symbol</h3>${node(data.center)}</section>${group('Calls', data.callees, data.calleesTruncated, 'cg-out')}</div>`;
      requestAnimationFrame(() => drawLines(el));
    } catch (e) { if (n === sequence && el.isConnected) result.textContent = e.message; }
  }
  PAGES.graph = el => {
    if (el.querySelector('.cg-page')) return;
    el.innerHTML = '<div class="cg-page"><div class="cc-pagehead"><div><h2>Code graph</h2><div class="cg-project">Reading project…</div></div></div><p>Static call relationships from the configured project checkout. GDScript is not indexed by CodeGraph.</p><form class="cg-search"><label for="cg-query">Find a symbol</label><input id="cg-query" name="query" maxlength="200" required><button class="pill" type="submit">Search</button><button class="pill cg-home" type="button">Start over</button></form><div class="cg-result" aria-live="polite"></div></div>';
    const page = el.querySelector('.cg-page');
    page.querySelector('form').onsubmit = e => { e.preventDefault(); load(page, { query: page.querySelector('input').value.trim() }); };
    page.querySelector('.cg-home').onclick = () => load(page);
    page.onclick = e => { const target = e.target.closest('[data-symbol]'); if (target) load(page, { id: target.dataset.symbol }); };
    load(page);
  };
  addEventListener('resize', () => { const el = document.querySelector('.cg-page'); if (el) drawLines(el); });
})();
