// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  /** @type {{id:string,label:string,len:number}[]} */
  let ALGS = [];
  let alg = 'md5';
  const algLabel = (id) => (ALGS.find((a) => a.id === id) || { label: id }).label;

  /** @param {string} tag @param {Record<string, any>} [props] @param {...(Node|string|null|undefined|false)} kids */
  function el(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
    return e;
  }

  function copy(text) { vscode.postMessage({ type: 'copy', text }); }

  /** A hash that is copied on click */
  function hash(value, extraClass) {
    if (!value) return el('span', { class: 'muted' }, '—');
    const s = el('code', { class: 'hash ' + (extraClass || ''), title: 'Click to copy', tabindex: '0' }, value);
    const go = () => {
      copy(value);
      s.classList.add('copied');
      setTimeout(() => s.classList.remove('copied'), 900);
    };
    s.addEventListener('click', go);
    s.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    return s;
  }

  /** Algorithm switcher; onPick(id) is called on change */
  function algSelect(onPick) {
    const s = el('select', { class: 'alg', title: 'Hash algorithm' },
      ...ALGS.map((a) => el('option', { value: a.id }, a.label)));
    s.value = alg;
    s.addEventListener('change', () => onPick(s.value, true));
    return s;
  }

  function header(file, sub) {
    return el('header', null,
      el('h1', null, file.name),
      el('div', { class: 'muted path' }, file.repoPath),
      sub || null);
  }

  // ---------- Single-commit card ----------

  let card = null;

  function renderCard() {
    const m = card;
    const c = m.commit;
    const raw = m.raw[alg], checkout = m.checkout[alg], disk = m.disk && m.disk[alg];
    const same = m.raw.md5 === m.checkout.md5;
    const diskMatch = m.disk && (m.disk.md5 === m.raw.md5 || m.disk.md5 === m.checkout.md5);

    const rows = [['In repository', raw, 'same as git show … | sha*sum / md5sum, and as on a Linux server']];
    if (!same) rows.push(['After checkout', checkout, 'with your local line endings (CRLF)']);

    app.replaceChildren(
      header(m.file),
      el('section', { class: 'commit' },
        el('div', null, el('span', { class: 'badge' }, c.short), ' ', el('strong', null, c.subject)),
        el('div', { class: 'muted' }, `${c.date} · ${c.author}`)),
      el('div', { class: 'toolbar' },
        el('label', null, 'Algorithm ', algSelect((id, persist) => { setAlg(id, persist); renderCard(); }))),
      el('table', { class: 'kv' },
        el('tbody', null,
          ...rows.map(([k, v, hint]) => el('tr', null,
            el('th', null, k),
            el('td', null, hash(v, 'big'), el('div', { class: 'muted small' }, hint)))),
          el('tr', null,
            el('th', null, 'File on disk'),
            el('td', null,
              hash(disk, 'big'),
              m.disk ? el('div', { class: diskMatch ? 'ok small' : 'warn small' },
                diskMatch ? '✓ matches this commit' : '✗ differs from this commit') : null)))),
      el('div', { class: 'actions' },
        el('button', { onclick: () => copy(raw) }, `Copy ${algLabel(alg)}`),
        el('button', { class: 'secondary', onclick: () => copy(c.hash) }, 'Copy commit hash'),
        el('button', { class: 'secondary', onclick: () => vscode.postMessage({ type: 'history' }) }, 'Full file history'))
    );
  }

  // ---------- History table ----------

  const H = { file: null, disk: null, rows: [], total: 0, done: false, cancelled: false };
  let tbody, search, status, bar, cancelBtn, hashTh, diskSlot, select;

  function setAlg(id, persist) {
    if (!ALGS.some((a) => a.id === id)) return;
    const changed = id !== alg;
    alg = id;
    if (select) select.value = id;
    if (persist) vscode.postMessage({ type: 'setAlg', alg: id });
    if (changed && tbody) refreshHashes();
  }

  function refreshHashes() {
    hashTh.textContent = algLabel(alg);
    diskSlot.replaceChildren(hash(H.disk && H.disk[alg]));
    for (const r of H.rows) fillHashCell(r);
  }

  function renderHistoryShell(m) {
    H.file = m.file; H.disk = m.disk;

    search = el('input', {
      type: 'search', value: m.target || '',
      placeholder: 'Paste a hash (MD5, SHA-1, SHA-256, …) to find its commit, or type text — matches are highlighted…',
      oninput: applyFilter,
    });
    select = algSelect(setAlg);
    status = el('div', { class: 'status' });
    bar = el('div', { class: 'bar' }, el('div'));
    cancelBtn = el('button', { class: 'secondary', onclick: () => { vscode.postMessage({ type: 'cancel' }); cancelBtn.disabled = true; } }, 'Stop');
    tbody = el('tbody');
    hashTh = el('th', null, algLabel(alg));
    diskSlot = el('span', null, hash(H.disk && H.disk[alg]));

    app.replaceChildren(
      header(H.file, el('div', { class: 'disk' }, el('span', { class: 'muted' }, 'File on disk: '), diskSlot)),
      el('div', { class: 'toolbar' }, search, select),
      el('div', { class: 'progress' }, bar, cancelBtn),
      status,
      el('table', { class: 'grid' },
        el('thead', null, el('tr', null,
          el('th', null, 'Commit'), el('th', null, 'Date'), el('th', null, 'Author'),
          el('th', null, 'Message'), hashTh)),
        tbody)
    );
    search.focus();
    applyFilter();
  }

  function fillHashCell(row) {
    const m = row.m;
    const crlf = m.raw && m.checkout && m.raw.md5 !== m.checkout.md5;
    const diskMatch = !!(H.disk && m.raw && (H.disk.md5 === m.raw.md5 || H.disk.md5 === m.checkout.md5));
    row.cell.replaceChildren(
      m.raw ? hash(m.raw[alg]) : el('span', { class: 'muted' }, 'file deleted'),
      crlf ? el('div', { class: 'crlf' }, el('span', { class: 'muted small' }, 'CRLF '), hash(m.checkout[alg], 'small')) : '',
      diskMatch ? el('span', { class: 'pill ok' }, 'same as disk') : '');
  }

  function addRow(m) {
    const c = m.commit;
    const cell = el('td', { class: 'md5' });
    const tr = el('tr', null,
      el('td', null, el('code', {
        class: 'commit-id', title: c.hash + '\nClick to copy the full hash',
        onclick: () => copy(c.hash),
      }, c.short)),
      el('td', { class: 'nowrap muted' }, c.date),
      el('td', { class: 'nowrap' }, c.author),
      el('td', { class: 'subject', title: c.subject }, c.subject),
      cell);

    const hashes = [...Object.values(m.raw || {}), ...Object.values(m.checkout || {})];
    const row = { m, tr, cell, hit: false, text: [c.hash, c.date, c.author, c.subject, ...hashes].join(' ').toLowerCase() };
    fillHashCell(row);
    H.rows.push(row);
    tbody.append(tr);
    filterRow(row, currentQuery());
    updateStatus();
  }

  /** A query that looks like a full hash of one of the algorithms → exact search across those algorithms. */
  function currentQuery() {
    const q = (search && search.value || '').trim().toLowerCase();
    const cands = /^[0-9a-f]+$/.test(q) ? ALGS.filter((a) => a.len === q.length) : [];
    return { q, cands };
  }

  // Rows are never hidden — matches are only highlighted.
  let scrolledFor = null;

  function filterRow(row, { q, cands }) {
    let hit = false, hitAlg = null;
    if (cands.length) {
      const m = row.m;
      for (const a of cands) {
        if ((m.raw && m.raw[a.id] === q) || (m.checkout && m.checkout[a.id] === q)) { hit = true; hitAlg = a.id; break; }
      }
      if (!hit && m.commit.hash === q) hit = true; // a 40-char query may also be a commit hash
    } else if (q) {
      hit = row.text.includes(q);
    }
    row.hit = hit;
    row.hitAlg = hitAlg;
    row.tr.classList.toggle('hit', hit);
    if (hit && scrolledFor !== q) {
      scrolledFor = q;
      if (hitAlg && hitAlg !== alg) setAlg(hitAlg, false); // show the column the hash was found in
      row.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function applyFilter() {
    const query = currentQuery();
    scrolledFor = null;
    for (const r of H.rows) filterRow(r, query);
    updateStatus();
  }

  function updateStatus() {
    const done = H.rows.length;
    const pct = H.total ? Math.round((done / H.total) * 100) : 0;
    bar.firstChild.style.width = (H.done ? 100 : pct) + '%';
    const running = !H.done;
    bar.parentElement.hidden = !running;

    const { q, cands } = currentQuery();
    const hitRows = H.rows.filter((r) => r.hit);
    const hits = hitRows.length;
    const kinds = cands.map((a) => a.label).join(' / ');
    let text, cls = '';
    if (cands.length) {
      const found = hitRows.find((r) => r.hitAlg);
      if (hits) { text = `Matches for ${q}${found ? ` (${algLabel(found.hitAlg)})` : ''}: ${hits}`; cls = 'ok'; }
      else if (running) text = `Searching for ${kinds} ${q}… checked ${done} of ${H.total || '?'}`;
      else {
        text = `${kinds} ${q} was not found in any of ${done} commits. The file may have been edited manually, or it has different line endings/encoding.`;
        cls = 'warn';
      }
    } else if (running) {
      text = `Computing… ${done} of ${H.total || '?'}`;
    } else {
      text = `${q ? `Matches: ${hits} of ${done}` : `Commits: ${done}`}${H.cancelled ? ' (stopped)' : ''}`;
    }
    if (!H.total && H.done) text = 'This file has no commits in history.';
    status.textContent = text;
    status.className = 'status ' + cls;
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'card': ALGS = m.algs; alg = m.alg; card = m; renderCard(); break;
      case 'init': ALGS = m.algs; alg = m.alg; renderHistoryShell(m); break;
      case 'total': H.total = m.n; updateStatus(); break;
      case 'row': addRow(m); break;
      case 'done': H.done = true; H.cancelled = m.cancelled; updateStatus(); break;
    }
  });

  app.append(el('div', { class: 'muted' }, 'Loading…'));
  vscode.postMessage({ type: 'ready' });
})();
