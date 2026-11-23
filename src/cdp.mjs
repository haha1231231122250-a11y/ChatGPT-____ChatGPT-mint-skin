// cdp.mjs — zero-dependency Chrome DevTools Protocol client (Node 22+ global WebSocket/fetch).
// Only ever talks to 127.0.0.1:PORT of the locally running ChatGPT desktop app.

export const DEFAULT_PORT = 9335;

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (ev) => this.#onMessage(ev));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
      this.emit('__disconnected', {});
    });
  }

  static async connect(url, timeoutMs = 8000) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout: ${url}`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP connect error: ${url}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  #onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(`${p.method} failed: ${msg.error.message}`), { cdp: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) this.emit(msg.method, msg.params || {});
  }

  send(method, params = {}, sessionId, timeoutMs = 0) {
    if (this.closed) return Promise.reject(new Error('CDP closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
        }, timeoutMs);
      }
      this.pending.set(id, {
        method,
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  emit(event, params) {
    for (const cb of this.listeners.get(event) || []) {
      try { cb(params); } catch (err) { console.error('[cdp] listener error:', err); }
    }
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true, userGesture = true } = {}) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue, userGesture });
    if (res.exceptionDetails) {
      throw new Error('evaluate exception: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result?.value;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

export async function httpJson(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function probeVersion(port = DEFAULT_PORT) {
  return httpJson(`http://127.0.0.1:${port}/json/version`);
}

export async function listTargets(port = DEFAULT_PORT) {
  return httpJson(`http://127.0.0.1:${port}/json/list`);
}

/**
 * True when the target is the ChatGPT desktop shell page (Electron app:// local page).
 * The main chat window is `app://-/index.html`; auxiliary windows can append a query
 * (e.g. `?initialRoute=%2Favatar-overlay`) and are excluded by the default config.
 */
export function isShellTarget(target, config) {
  if (!target || target.type !== 'page') return false;
  const url = (target.url || '').replace(/\/$/, '');
  const exact = config?.targetUrlExact ?? 'app://-/index.html';
  const prefixes = config?.targetUrlPrefixes ?? ['app://-/'];
  if (!prefixes.some((p) => url.startsWith(p.replace(/\/$/, '')))) return false;
  const excludes = config?.targetUrlExcludes ?? ['devtools://'];
  if (excludes.some((p) => url.startsWith(p))) return false;
  const mode = config?.targetMatch ?? 'exact-main';
  if (mode === 'any') return true;
  if (mode === 'exact') return url === exact.replace(/\/$/, '');
  return url.split(/[?#]/, 1)[0] === exact.replace(/\/$/, '') &&
    !new URLSearchParams(url.split('#', 1)[0].split('?')[1]).has('initialRoute');
}

export async function findShellTarget(port, config) {
  const list = await listTargets(port);
  const matches = list.filter((t) => isShellTarget(t, config));
  // Prefer the query-less main window even if auxiliary windows exist.
  const exact = config?.targetUrlExact ?? 'app://-/index.html';
  return matches.find((t) => t.url === exact) || matches[0] || null;
}
