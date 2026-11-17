'use strict';
const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let extUri;

// ---------- Hash algorithms ----------

const ALGS = [
  { id: 'md5', label: 'MD5', len: 32 },
  { id: 'sha1', label: 'SHA-1', len: 40 },
  { id: 'sha256', label: 'SHA-256', len: 64 },
  { id: 'sha384', label: 'SHA-384', len: 96 },
  { id: 'sha512', label: 'SHA-512', len: 128 },
  { id: 'crc32', label: 'CRC32', len: 8 },
];
const algById = (id) => ALGS.find((a) => a.id === id) || ALGS[0];
const HASH_LENGTHS = new Set(ALGS.map((a) => a.len));
const isHashLike = (s) => /^[0-9a-f]+$/i.test(s) && HASH_LENGTHS.has(s.length);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE, same as zip / crc32 / 7-Zip) with the same update/digest shape as crypto.Hash. */
class Crc32 {
  constructor() { this.c = 0xffffffff; }
  update(b) {
    let c = this.c;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    this.c = c;
    return this;
  }
  digest() { return ((this.c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }
}

const makeHasher = (id) => (id === 'crc32' ? new Crc32() : crypto.createHash(id));

/** { md5: '…', sha1: '…', … } for a buffer */
function hashAll(buf) {
  const out = {};
  for (const a of ALGS) out[a.id] = makeHasher(a.id).update(buf).digest('hex');
  return out;
}

/** Hashes of a file on disk, streamed (large files are not loaded into memory). */
function hashFile(p, ids) {
  return new Promise((resolve, reject) => {
    const hs = ids.map((id) => [id, makeHasher(id)]);
    fs.createReadStream(p)
      .on('error', reject)
      .on('data', (d) => { for (const [, h] of hs) h.update(d); })
      .on('end', () => resolve(Object.fromEntries(hs.map(([id, h]) => [id, h.digest('hex')]))));
  });
}

// ---------- Git ----------

function cfg(key, def) {
  const v = vscode.workspace.getConfiguration('gitFileHash').get(key);
  return v === undefined || v === null || v === '' ? def : v;
}

const defaultAlg = () => algById(cfg('algorithm', 'md5')).id;

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      cfg('gitPath', 'git'),
      args,
      { cwd, encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr && stderr.toString('utf8').trim()) || err.message));
        else resolve(stdout);
      }
    );
  });
}

/** File from the context menu or the active editor, plus its path inside the repository. */
async function resolveFile(uri) {
  if (!(uri instanceof vscode.Uri)) uri = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri;
  if (!uri || uri.scheme !== 'file') throw new Error('Open or select a file on disk.');
  const full = uri.fsPath;
  const dir = path.dirname(full);
  const name = path.basename(full);
  let prefix;
  try {
    prefix = (await git(['rev-parse', '--show-prefix'], dir)).toString('utf8').trim();
  } catch (e) {
    throw new Error(`The file is not inside a git repository: ${e.message}`);
  }
  return { uri, full, dir, name, repoPath: prefix + name };
}

const LOG_FORMAT = '--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s';
const LOG_DATE = '--date=format:%Y-%m-%d %H:%M';
function parseCommit(line) {
  const [hash, short, date, author, subject] = line.split('\x1f');
  return { hash, short, date, author, subject };
}

async function fileHistory(f) {
  const raw = (await git(['log', `-n${cfg('maxCommits', 500)}`, LOG_FORMAT, LOG_DATE, '--', f.name], f.dir)).toString('utf8');
  return raw.split('\n').filter(Boolean).map(parseCommit);
}

/**
 * raw      — bytes as stored in the repository (= git show … | md5sum)
 * checkout — with filters/EOL applied, i.e. how the file lands on disk after checkout on this machine
 * Each is { md5, sha1, sha256, sha384, sha512, crc32 }.
 */
async function hashesAtRevision(f, rev) {
  const spec = `${rev}:${f.repoPath}`;
  const rawBuf = await git(['cat-file', 'blob', spec], f.dir);
  const raw = hashAll(rawBuf);
  let checkout = raw;
  try {
    const coBuf = await git(['cat-file', '--filters', spec], f.dir);
    if (!coBuf.equals(rawBuf)) checkout = hashAll(coBuf);
  } catch (_) { /* old git */ }
  return { raw, checkout };
}

function diskHashes(f) {
  try { return hashAll(fs.readFileSync(f.full)); } catch (_) { return null; }
}

async function pickRevision(f) {
  const history = await fileHistory(f);
  const manual = { label: '$(edit) Enter a commit, branch or tag…', manual: true };
  const items = [manual, ...history.map((c) => ({
    label: `$(git-commit) ${c.short}  ${c.subject}`,
    description: `${c.date} · ${c.author}`,
    commit: c,
  }))];
  const sel = await vscode.window.showQuickPick(items, {
    title: `Hash: ${f.repoPath}`,
    placeHolder: 'Select a commit',
    matchOnDescription: true,
  });
  if (!sel) return null;
  if (!sel.manual) return sel.commit;

  const input = await vscode.window.showInputBox({ title: 'Commit, branch or tag', placeHolder: '9287ab5 / staging / v1.2.0' });
  if (!input || !input.trim()) return null;
  const line = (await git(['log', '-1', LOG_FORMAT, LOG_DATE, `${input.trim()}^{commit}`, '--'], f.dir)).toString('utf8').trim();
  return parseCommit(line);
}

// ---------- Webview ----------

function nonce() {
  return crypto.randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
}

function createView(title, f) {
  const media = vscode.Uri.joinPath(extUri, 'media');
  const panel = vscode.window.createWebviewPanel('gitFileHash', title, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  });
  panel.iconPath = new vscode.ThemeIcon('symbol-key');

  const view = { panel, cancelled: false, disposed: false };
  let ready = false;
  const queue = [];
  view.post = (m) => {
    if (view.disposed) return;
    if (ready) panel.webview.postMessage(m); else queue.push(m);
  };

  panel.onDidDispose(() => { view.disposed = true; view.cancelled = true; });
  panel.webview.onDidReceiveMessage(async (m) => {
    if (m.type === 'ready') {
      ready = true;
      for (const x of queue.splice(0)) panel.webview.postMessage(x);
    } else if (m.type === 'copy') {
      await vscode.env.clipboard.writeText(m.text);
      vscode.window.setStatusBarMessage(`$(check) Copied: ${m.text}`, 3000);
    } else if (m.type === 'cancel') {
      view.cancelled = true;
    } else if (m.type === 'history') {
      wrap(cmdHistory)(f.uri);
    } else if (m.type === 'setAlg' && ALGS.some((a) => a.id === m.alg)) {
      await vscode.workspace.getConfiguration('gitFileHash').update('algorithm', m.alg, vscode.ConfigurationTarget.Global);
    }
  });

  const w = panel.webview;
  const n = nonce();
  const css = w.asWebviewUri(vscode.Uri.joinPath(media, 'view.css'));
  const js = w.asWebviewUri(vscode.Uri.joinPath(media, 'view.js'));
  w.html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${w.cspSource}; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}"><title>${title}</title></head>
<body><main id="app"></main><script nonce="${n}" src="${js}"></script></body></html>`;
  return view;
}

// ---------- Commands ----------

/** Works for any file, no git needed. Supports multi-selection in the Explorer. */
async function copyFileHash(uri, uris, algIds) {
  let list = Array.isArray(uris) && uris.length ? uris : [uri];
  if (!(list[0] instanceof vscode.Uri)) {
    const ed = vscode.window.activeTextEditor;
    list = ed ? [ed.document.uri] : [];
  }
  list = list.filter((u) => u && u.scheme === 'file');
  if (!list.length) throw new Error('Open or select a file on disk.');

  const results = [];
  for (const u of list) {
    if (fs.statSync(u.fsPath).isDirectory()) continue;
    results.push({ name: path.basename(u.fsPath), sums: await hashFile(u.fsPath, algIds) });
  }
  if (!results.length) throw new Error('Select a file, not a folder.');

  let text;
  if (algIds.length === 1) {
    const id = algIds[0];
    text = results.length === 1 ? results[0].sums[id] : results.map((r) => `${r.sums[id]}  ${r.name}`).join('\n');
  } else {
    const pad = Math.max(...algIds.map((id) => algById(id).label.length));
    text = results.map((r) =>
      (results.length > 1 ? `${r.name}\n` : '') +
      algIds.map((id) => `${algById(id).label.padEnd(pad)}  ${r.sums[id]}`).join('\n')
    ).join('\n\n');
  }
  await vscode.env.clipboard.writeText(text);

  const dirty = list.some((u) => vscode.workspace.textDocuments.some((d) => d.uri.fsPath === u.fsPath && d.isDirty));
  const note = dirty ? ' (unsaved changes not included)' : '';
  const what = algIds.length === 1 ? algById(algIds[0]).label : 'all hashes';
  if (results.length === 1 && algIds.length === 1) {
    vscode.window.setStatusBarMessage(`$(check) ${what} of ${results[0].name}: ${text} — copied${note}`, 5000);
  } else {
    vscode.window.setStatusBarMessage(`$(check) Copied ${what} of ${results.length} file(s)${note}`, 5000);
  }
  if (dirty) vscode.window.showWarningMessage('The hash was computed from the saved file on disk — unsaved changes are not included.');
}

async function cmdCopyFileHash(uri, uris) {
  await copyFileHash(uri, uris, [defaultAlg()]);
}

async function cmdCopyFileHashAs(uri, uris) {
  const def = defaultAlg();
  const items = [
    ...ALGS.map((a) => ({ label: a.label, description: `${a.len} hex chars${a.id === def ? ' · default' : ''}`, ids: [a.id] })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: 'All algorithms', description: 'one line per algorithm', ids: ALGS.map((a) => a.id) },
  ];
  const sel = await vscode.window.showQuickPick(items, { title: 'Copy file hash', placeHolder: 'Select a hash algorithm' });
  if (!sel || !sel.ids) return;
  await copyFileHash(uri, uris, sel.ids);
}

function viewInit(f, extra) {
  return { file: { name: f.name, repoPath: f.repoPath }, algs: ALGS, alg: defaultAlg(), ...extra };
}

async function cmdAtCommit(uri) {
  const f = await resolveFile(uri);
  const c = await pickRevision(f);
  if (!c) return;
  const h = await hashesAtRevision(f, c.hash);
  const view = createView(`Hash: ${f.name} @ ${c.short}`, f);
  view.post({ type: 'card', ...viewInit(f, { commit: c, raw: h.raw, checkout: h.checkout, disk: diskHashes(f) }) });
}

async function cmdHistory(uri, target) {
  const f = await resolveFile(uri);
  const view = createView(`Hash: ${f.name} — history`, f);
  view.post({ type: 'init', ...viewInit(f, { disk: diskHashes(f), target: target || '' }) });

  const history = await fileHistory(f);
  view.post({ type: 'total', n: history.length });
  for (const c of history) {
    if (view.cancelled) break;
    let h = null;
    try { h = await hashesAtRevision(f, c.hash); } catch (_) { /* file deleted in this commit */ }
    view.post({ type: 'row', commit: c, raw: h && h.raw, checkout: h && h.checkout });
  }
  view.post({ type: 'done', cancelled: view.cancelled });
}

async function cmdFindCommit(uri) {
  const f = await resolveFile(uri);
  const input = await vscode.window.showInputBox({
    title: `Find commit by hash: ${f.repoPath}`,
    placeHolder: 'MD5 / SHA-1 / SHA-256 / SHA-384 / SHA-512 / CRC32, e.g. of the file on the server',
    validateInput: (v) => (isHashLike(v.trim())
      ? null
      : `Expected a hex hash of length ${[...HASH_LENGTHS].sort((a, b) => a - b).join(', ')}`),
  });
  if (!input) return;
  await cmdHistory(f.uri, input.trim().toLowerCase());
}

function wrap(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (e) { vscode.window.showErrorMessage(`Git Hash: ${e.message}`); }
  };
}

function activate(context) {
  extUri = context.extensionUri;
  context.subscriptions.push(
    vscode.commands.registerCommand('gitFileHash.copyFileHash', wrap(cmdCopyFileHash)),
    vscode.commands.registerCommand('gitFileHash.copyFileHashAs', wrap(cmdCopyFileHashAs)),
    vscode.commands.registerCommand('gitFileHash.atCommit', wrap(cmdAtCommit)),
    vscode.commands.registerCommand('gitFileHash.history', wrap((uri) => cmdHistory(uri))),
    vscode.commands.registerCommand('gitFileHash.findCommit', wrap(cmdFindCommit))
  );
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { hashAll, Crc32 } };
