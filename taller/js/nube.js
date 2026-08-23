/* ═══════════════════════════════════════════════════════════
   nube.js — Conexión del Taller a Supabase (REST directo, sin
   librerías, igual que el CRM). Dos roles:
   · José entra con su correo/clave del CRM (sesión propia de esta
     app — NO se toca la sesión del CRM para no invalidarla).
   · Karen entra con el link secreto #k=… que trae URL, anon key y
     sus credenciales; se guardan en el dispositivo y la re-conexión
     es automática para siempre (hasta que se le cambie la clave).
   ═══════════════════════════════════════════════════════════ */
const Nube = (() => {
  const K_CFG = 'sstaller_cfg';

  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(K_CFG)); } catch { cfg = null; }

  const guardar = () => localStorage.setItem(K_CFG, JSON.stringify(cfg));
  const conectado = () => !!(cfg && cfg.url && cfg.anonKey && cfg.session);
  const rol = () => (cfg && cfg.rol) || null;   // 'jose' | 'taller'

  /* Del CRM (mismo origen) se pueden leer URL/anonKey/email para
     prellenar el login de José — la SESIÓN del CRM no se reutiliza. */
  function pistaCRM() {
    try {
      const c = JSON.parse(localStorage.getItem('sscrm_sync_cfg'));
      return c ? { url: c.url, anonKey: c.anonKey, email: c.email } : null;
    } catch { return null; }
  }

  async function loginRaw(url, anonKey, email, password) {
    const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error_description || d.msg || 'login failed');
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    };
  }

  async function conectarJose(url, anonKey, email, password) {
    const session = await loginRaw(url, anonKey, email, password);
    cfg = { rol: 'jose', url, anonKey, email, session };
    guardar();
  }

  /* Karen: sus credenciales viven en el dispositivo → si la sesión se
     cae, se re-conecta sola sin que ella haga nada */
  async function conectarTaller(url, anonKey, email, password) {
    const session = await loginRaw(url, anonKey, email, password);
    cfg = { rol: 'taller', url, anonKey, email, pass: password, session };
    guardar();
  }

  async function renovar() {
    try {
      const resp = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
        body: JSON.stringify({ refresh_token: cfg.session.refresh_token }),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error('refresh caído');
      cfg.session = {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expira: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      };
      guardar();
    } catch (e) {
      /* Karen guarda su clave: reintento silencioso con login completo */
      if (cfg.rol === 'taller' && cfg.pass) {
        cfg.session = await loginRaw(cfg.url, cfg.anonKey, cfg.email, cfg.pass);
        guardar();
      } else {
        cfg.session = null; guardar();
        throw new Error('SESION_EXPIRADA');
      }
    }
  }

  async function token() {
    if (!conectado()) throw new Error('SIN_CONEXION');
    if (cfg.session.expira - 60 < Math.floor(Date.now() / 1000)) await renovar();
    return cfg.session.access_token;
  }

  /* ── REST a la tabla `taller` ── */
  async function rest(metodo, ruta, body, prefer) {
    const t = await token();
    const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const resp = await fetch(`${cfg.url}/rest/v1/${ruta}`, {
      method: metodo, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    const txt = await resp.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function listarDocs() {
    const PAGINA = 1000, MAX = 20;
    const docs = [];
    for (let p = 0; p < MAX; p++) {
      const filas = await rest('GET', `taller?select=id,data&order=id&limit=${PAGINA}&offset=${p * PAGINA}`);
      for (const f of filas) docs.push(f.data);
      if (filas.length < PAGINA) break;
    }
    return docs;
  }

  const upsertDoc = doc => rest('POST', 'taller', [{ id: doc.id, data: doc }], 'resolution=merge-duplicates');
  const borrarDoc = id => rest('DELETE', `taller?id=eq.${encodeURIComponent(id)}`);

  /* ── Storage: bucket `taller` ── */
  async function subirArchivo(path, blob, contentType) {
    const t = await token();
    const resp = await fetch(`${cfg.url}/storage/v1/object/taller/${path}`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey, Authorization: `Bearer ${t}`,
        'Content-Type': contentType || blob.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: blob,
    });
    if (!resp.ok) throw new Error(`Storage ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    return path;
  }

  const _urls = new Map();   // caché de objectURLs por sesión
  async function bajarArchivo(path) {
    if (_urls.has(path)) return _urls.get(path);
    const t = await token();
    const resp = await fetch(`${cfg.url}/storage/v1/object/taller/${path}`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${t}` },
    });
    if (!resp.ok) throw new Error(`Storage ${resp.status}`);
    const url = URL.createObjectURL(await resp.blob());
    _urls.set(path, url);
    return url;
  }

  async function bajarBlob(path) {
    const t = await token();
    const resp = await fetch(`${cfg.url}/storage/v1/object/taller/${path}`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${t}` },
    });
    if (!resp.ok) throw new Error(`Storage ${resp.status}`);
    return resp.blob();
  }

  /* ── IA (solo del lado de José): misma clave del CRM ── */
  const iaClave = () => localStorage.getItem('sscrm_ia_key') || localStorage.getItem('sstaller_ia_key');
  const iaGuardarClave = v => localStorage.setItem('sstaller_ia_key', v.trim());

  async function iaLeerPDF(b64pdf, prompt) {
    const clave = iaClave();
    if (!clave) throw new Error('SIN_CLAVE_IA');
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': clave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 4096,
        fallbacks: 'default',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64pdf } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => null);
      const msj = err && err.error && err.error.message;
      throw new Error(resp.status === 401 ? 'CLAVE_IA_INVALIDA' : (msj || `IA ${resp.status}`));
    }
    const data = await resp.json();
    if (data.stop_reason === 'refusal') throw new Error('La IA declinó leer este PDF');
    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('La IA no devolvió datos legibles');
    return JSON.parse(m[0]);
  }

  function desconectar() {
    localStorage.removeItem(K_CFG);
    cfg = null;
  }

  /* Link secreto de Karen: #k=<base64url(JSON)> con todo lo necesario */
  const armarLink = (email, password) => {
    const payload = { u: cfg.url, a: cfg.anonKey, e: email, p: password };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${location.origin}${location.pathname}#k=${b64}`;
  };
  const leerLink = hash => {
    const m = (hash || '').match(/#k=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch { return null; }
  };

  return {
    conectado, rol, pistaCRM, conectarJose, conectarTaller, desconectar,
    listarDocs, upsertDoc, borrarDoc,
    subirArchivo, bajarArchivo, bajarBlob,
    iaClave, iaGuardarClave, iaLeerPDF,
    armarLink, leerLink,
    info: () => cfg ? { url: cfg.url, email: cfg.email, rol: cfg.rol } : null,
  };
})();
