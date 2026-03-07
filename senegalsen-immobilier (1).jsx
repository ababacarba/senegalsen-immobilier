
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ── Supabase client (native fetch — no external lib) ──────────────
const SB_URL = "https://rgwozhjpufgebaiygvhr.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnd296aGpwdWZnZWJhaXlndmhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NzYwODksImV4cCI6MjA4ODI1MjA4OX0.d7ljAI5JiPon0jhYs_LGTN3JeKg9bD_rgnvvgGOQFDs";

let _session = null; // in-memory auth session

function sbHeaders(extra = {}) {
  const h = { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${_session?.access_token || SB_KEY}`, ...extra };
  return h;
}

// Querybuilder — mirrors the supabase-js chainable API
function qb(table) {
  let _url = `${SB_URL}/rest/v1/${table}`;
  let _params = [];
  let _method = "GET";
  let _body = null;
  let _headers = {};
  let _single = false;
  let _count = null;

  const api = {
    select(cols = "*", opts = {}) {
      _params.push(`select=${encodeURIComponent(cols)}`);
      if (opts.count) { _count = opts.count; _headers["Prefer"] = opts.head ? "count=exact" : "count=exact"; if (opts.head) _method = "HEAD"; }
      return api;
    },
    eq(col, val) { _params.push(`${col}=eq.${encodeURIComponent(val)}`); return api; },
    neq(col, val) { _params.push(`${col}=neq.${encodeURIComponent(val)}`); return api; },
    or(expr) { _params.push(`or=(${encodeURIComponent(expr)})`); return api; },
    in(col, vals) { _params.push(`${col}=in.(${vals.map(v => encodeURIComponent(v)).join(",")})`); return api; },
    order(col, opts = {}) { _params.push(`order=${col}${opts.ascending === false ? ".desc" : ".asc"}`); return api; },
    limit(n) { _params.push(`limit=${n}`); return api; },
    single() { _single = true; _headers["Accept"] = "application/vnd.pgrst.object+json"; return api; },
    insert(rows) { _method = "POST"; _body = Array.isArray(rows) ? rows : [rows]; _headers["Prefer"] = "return=representation"; return api; },
    update(row) { _method = "PATCH"; _body = row; _headers["Prefer"] = "return=representation"; return api; },
    delete() { _method = "DELETE"; _headers["Prefer"] = "return=representation"; return api; },
    upsert(row) { _method = "POST"; _body = Array.isArray(row) ? row : [row]; _headers["Prefer"] = "resolution=merge-duplicates,return=representation"; return api; },
    async then(resolve, reject) {
      try {
        const qs = _params.length ? "?" + _params.join("&") : "";
        const res = await fetch(_url + qs, {
          method: _method,
          headers: { ...sbHeaders(), ..._headers },
          body: _body ? JSON.stringify(_body) : undefined,
        });
        if (_method === "HEAD") {
          const count = parseInt(res.headers.get("Content-Range")?.split("/")?.[1] || "0");
          return resolve({ count, data: null, error: null });
        }
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) return resolve({ data: null, error: json || { message: res.statusText }, count: null });
        const data = _single ? json : (Array.isArray(json) ? json : (json ? [json] : []));
        const countHdr = res.headers.get("Content-Range");
        const count = countHdr ? parseInt(countHdr.split("/")[1]) : null;
        resolve({ data: _single ? (Array.isArray(data) ? data[0] : data) : data, error: null, count });
      } catch (e) { resolve({ data: null, error: { message: e.message }, count: null }); }
    }
  };
  return api;
}

// RPC helper
async function rpc(fn, params = {}) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: sbHeaders(),
      body: JSON.stringify(params),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { data, error: res.ok ? null : data };
  } catch (e) { return { data: null, error: { message: e.message } }; }
}

// Auth helpers (REST)
const auth = {
  async getSession() {
    const raw = sessionStorage.getItem("sb_session");
    if (raw) { _session = JSON.parse(raw); return { data: { session: _session } }; }
    return { data: { session: null } };
  },
  async signInWithPassword({ email, password }) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data };
    _session = data; sessionStorage.setItem("sb_session", JSON.stringify(data));
    _authListeners.forEach(fn => fn("SIGNED_IN", data));
    return { data: { user: data.user }, error: null };
  },
  async signUp({ email, password, options }) {
    const res = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY },
      body: JSON.stringify({ email, password, data: options?.data }),
    });
    const data = await res.json();
    if (!res.ok) return { data: null, error: data };
    return { data, error: null };
  },
  async signOut() {
    await fetch(`${SB_URL}/auth/v1/logout`, { method: "POST", headers: sbHeaders() }).catch(() => {});
    _session = null; sessionStorage.removeItem("sb_session");
    _authListeners.forEach(fn => fn("SIGNED_OUT", null));
    return { error: null };
  },
  async resetPasswordForEmail(email) {
    await fetch(`${SB_URL}/auth/v1/recover`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY },
      body: JSON.stringify({ email }),
    });
    return { error: null };
  },
  onAuthStateChange(fn) {
    _authListeners.push(fn);
    return { data: { subscription: { unsubscribe: () => { _authListeners = _authListeners.filter(f => f !== fn); } } } };
  },
};

let _authListeners = [];

// Realtime (WebSocket-based, no library needed)
const _channels = {};
function channel(name) {
  let _handlers = [];
  let _ws = null;
  const ch = {
    on(event, config, fn) { _handlers.push({ event, config, fn }); return ch; },
    subscribe() {
      try {
        const wsUrl = SB_URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + SB_KEY + "&vsn=1.0.0";
        _ws = new WebSocket(wsUrl);
        _ws.onopen = () => {
          _ws.send(JSON.stringify({ topic: "realtime:*", event: "phx_join", payload: { config: { broadcast: { self: false }, presence: { key: "" } } }, ref: null }));
          _handlers.forEach(h => {
            if (h.config?.table) {
              _ws.send(JSON.stringify({
                topic: `realtime:${h.config.schema || "public"}:${h.config.table}${h.config.filter ? ":" + h.config.filter : ""}`,
                event: "phx_join", payload: { config: { broadcast: { self: false } } }, ref: null,
              }));
            }
          });
        };
        _ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.event === "postgres_changes") {
              _handlers.forEach(h => { if (h.event === "INSERT" || h.event === "*") h.fn({ new: msg.payload.record }); });
            }
          } catch (_) {}
        };
        _ws.onerror = () => {};
        _channels[name] = _ws;
      } catch (_) {}
      return ch;
    },
  };
  return ch;
}
function removeChannel(ch) { try { ch?._ws?.close(); } catch (_) {} }

// Main sb object — mirrors supabase-js surface used in this app
const sb = {
  from: (table) => qb(table),
  rpc: (fn, params) => rpc(fn, params),
  auth,
  channel,
  removeChannel,
};

// ── Helpers ────────────────────────────────────────────────────────
const fmt = v => new Intl.NumberFormat("fr-SN",{style:"currency",currency:"XOF",maximumFractionDigits:0}).format(v);
const fmtM = v => (v >= 1e9 ? (v/1e9).toFixed(1)+"Md" : v >= 1e6 ? (v/1e6).toFixed(0)+"M" : v >= 1e3 ? (v/1e3).toFixed(0)+"K" : v)+" FCFA";
const ago = d => { const s=Math.floor((Date.now()-new Date(d))/1000); return s<60?"À l'instant":s<3600?Math.floor(s/60)+"min":s<86400?Math.floor(s/3600)+"h":Math.floor(s/86400)+"j"; };
const DOC={titre_foncier:{l:"Titre Foncier",c:"#16a34a",b:"#dcfce7"},bail:{l:"Bail",c:"#2563eb",b:"#dbeafe"},permis_occuper:{l:"Permis d'occuper",c:"#d97706",b:"#fef3c7"},deliberation:{l:"Délibération",c:"#d97706",b:"#fef3c7"},autre:{l:"Autre doc.",c:"#6b7280",b:"#f3f4f6"}};
const PICO={appartement:"🏢",maison:"🏠",villa:"🏡",terrain:"🌿",bureau:"💼",commerce:"🏪"};
const TXL={vente:"Vente",location:"Location",location_saisonniere:"Saisonnier"};
const TXC={vente:{bg:"#1e3a5f",color:"#fff"},location:{bg:"#0a5c36",color:"#fff"},location_saisonniere:{bg:"#92400e",color:"#fff"}};
const REGIONS=["Dakar","Thiès","Saint-Louis","Ziguinchor","Kaolack","Diourbel","Louga","Fatick","Kolda","Tambacounda","Kédougou","Sédhiou","Kaffrine","Matam"];
const QUARTIERS=["Almadies","Ngor","Ouakam","Plateau","Point E","Sacré-Cœur","Mermoz","Liberté 6","HLM","Fann","Médina","Gueule Tapée","Grand Dakar","Parcelles Assainies","Pikine","Guédiawaye","Thiaroye","Rufisque","Mbao"];
const FEATS=[{k:"piscine",l:"🏊 Piscine"},{k:"jardin",l:"🌿 Jardin"},{k:"parking",l:"🚗 Parking"},{k:"gardien",l:"👮 Gardien"},{k:"climatisation",l:"❄️ Clim"},{k:"ascenseur",l:"🛗 Ascenseur"},{k:"meuble",l:"🛋️ Meublé"},{k:"wifi",l:"📶 Wifi"},{k:"terrasse",l:"🏗️ Terrasse"},{k:"balcon",l:"🌅 Balcon"},{k:"vue_mer",l:"🌊 Vue mer"},{k:"fibre_optique",l:"🔌 Fibre"}];
const FL={piscine:"🏊 Piscine",jardin:"🌿 Jardin",parking:"🚗 Parking",gardien:"👮 Gardien",climatisation:"❄️ Clim",ascenseur:"🛗 Ascenseur",meuble:"🛋️ Meublé",wifi:"📶 Wifi",terrasse:"🏗️ Terrasse",balcon:"🌅 Balcon",vue_mer:"🌊 Vue mer",fibre_optique:"🔌 Fibre",viabilise:"⚡ Viabilisé",permis_construire:"📋 PC"};
const STEPS=["Type","Détails","Photos","Équipements","Localisation"];

// ══════════════════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════════════════
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap');
@import url('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --g:#0a5c36;--gl:#e8f5ef;--gm:#16a34a;
  --au:#f4a01b;--al:#fef3c7;
  --nv:#1e3a5f;--rd:#dc2626;--rl:#fee2e2;
  --tx:#1a1a1a;--mu:#6b7280;--br:#e5e7eb;
  --bg:#f9f8f5;--wh:#fff;
  --sh:0 2px 12px rgba(0,0,0,.07);--shh:0 8px 32px rgba(0,0,0,.13);
  --r:14px;--fd:'Syne',sans-serif;--fb:'DM Sans',sans-serif;
}
body{font-family:var(--fb);background:var(--bg);color:var(--tx);-webkit-font-smoothing:antialiased}
button,input,select,textarea{font-family:var(--fb)}
/* ── NAV ── */
.nav{background:var(--wh);border-bottom:1px solid var(--br);position:sticky;top:0;z-index:300;box-shadow:0 1px 8px rgba(0,0,0,.06)}
.navi{max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:62px;gap:8px}
.logo{font-family:var(--fd);font-size:19px;font-weight:800;color:var(--g);cursor:pointer;display:flex;align-items:center;gap:5px;border:none;background:none;flex-shrink:0}
.logo span{color:var(--au)}
.navl{display:flex;gap:2px;align-items:center}
.nb{padding:7px 11px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;color:var(--mu);border:none;background:none;transition:.18s;white-space:nowrap}
.nb:hover,.nb.on{color:var(--g);background:var(--gl)}
.ncta{background:var(--g);color:#fff;padding:8px 16px;border-radius:100px;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:.18s;white-space:nowrap}
.ncta:hover{background:#083d25;transform:translateY(-1px)}
.nauth{display:flex;gap:7px;align-items:center}
.av{width:34px;height:34px;border-radius:50%;background:var(--g);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;cursor:pointer;border:none;flex-shrink:0;position:relative}
/* notif badge */
.nbadge{position:absolute;top:-4px;right:-4px;background:var(--rd);color:#fff;border-radius:50%;min-width:17px;height:17px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;line-height:1}
/* ── HERO ── */
.hero{background:linear-gradient(135deg,#051f11,#0a5c36 50%,#0d6b40);position:relative;overflow:hidden;padding:74px 20px 90px}
.hero::before{content:'';position:absolute;inset:0;background:url('https://images.unsplash.com/photo-1562501700-54b33a3cc900?w=1400&auto=format&q=35') center/cover;opacity:.08}
.heroi{max-width:820px;margin:0 auto;text-align:center;position:relative}
.htag{display:inline-flex;align-items:center;gap:4px;background:rgba(244,160,27,.18);border:1px solid rgba(244,160,27,.38);color:var(--au);padding:4px 13px;border-radius:100px;font-size:11px;font-weight:700;margin-bottom:16px;letter-spacing:.4px}
.hero h1{font-family:var(--fd);font-size:clamp(24px,5vw,50px);font-weight:800;color:#fff;line-height:1.1;margin-bottom:11px}
.hero h1 em{color:var(--au);font-style:normal}
.hero p{color:rgba(255,255,255,.68);font-size:15px;margin-bottom:30px}
.sbox{background:#fff;border-radius:16px;padding:15px;box-shadow:0 20px 60px rgba(0,0,0,.22)}
.stabs{display:flex;gap:3px;margin-bottom:11px;background:var(--bg);border-radius:10px;padding:3px}
.stab{flex:1;padding:7px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;border:none;background:none;color:var(--mu);transition:.18s}
.stab.on{background:var(--g);color:#fff}
.srow{display:flex;gap:7px;flex-wrap:wrap}
.si{flex:1;min-width:150px;padding:10px 12px;border:1.5px solid var(--br);border-radius:9px;font-size:13px;outline:none;transition:.18s}
.si:focus{border-color:var(--g)}
.sbtn{background:var(--g);color:#fff;padding:10px 20px;border-radius:9px;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:.18s;white-space:nowrap}
.sbtn:hover{background:#083d25;transform:translateY(-1px)}
/* ── STATS ── */
.sbar{background:var(--nv);padding:15px 20px}
.sbari{max-width:1280px;margin:0 auto;display:flex;justify-content:space-around;flex-wrap:wrap;gap:10px}
.st{text-align:center}
.stn{font-family:var(--fd);font-size:22px;font-weight:800;color:var(--au)}
.stl{font-size:10px;color:rgba(255,255,255,.52)}
/* ── SECTION ── */
.sec{max-width:1280px;margin:0 auto;padding:48px 20px}
.sech{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px;gap:10px;flex-wrap:wrap}
.sectl{font-family:var(--fd);font-size:22px;font-weight:800}
.sectl span{color:var(--g)}
.seclink{color:var(--g);font-size:12px;font-weight:700;cursor:pointer;border:none;background:none;white-space:nowrap}
.seclink:hover{text-decoration:underline}
/* ── FILTERS ── */
.fils{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
.flab{font-size:10px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:.5px}
.fbt{padding:6px 12px;border-radius:100px;border:1.5px solid var(--br);background:#fff;font-size:11px;font-weight:600;cursor:pointer;transition:.18s;color:var(--mu)}
.fbt:hover,.fbt.on{border-color:var(--g);color:var(--g);background:var(--gl);font-weight:700}
/* ── ADV FILTERS ── */
.advfil{background:#fff;border:1px solid var(--br);border-radius:var(--r);padding:18px;margin-bottom:18px;box-shadow:var(--sh)}
.advfilg{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.range-row{display:flex;gap:6px}
.range-row .si{flex:1;min-width:0}
/* ── GRID ── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:18px}
/* ── CARD ── */
.card{background:#fff;border-radius:var(--r);box-shadow:var(--sh);overflow:hidden;cursor:pointer;transition:.22s;border:1px solid var(--br);position:relative}
.card:hover{box-shadow:var(--shh);transform:translateY(-4px)}
.cimg{width:100%;height:196px;object-fit:cover;display:block;background:#e5e7eb}
.cbdg{position:absolute;top:9px;left:9px;display:flex;gap:4px;flex-wrap:wrap}
.bdg{padding:3px 8px;border-radius:5px;font-size:10px;font-weight:700}
.bprem{background:var(--au);color:#1a1a1a}
.cfav{position:absolute;top:9px;right:9px;background:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.13);cursor:pointer;border:none;font-size:14px;transition:.18s}
.cfav:hover{transform:scale(1.18)}
.cbod{padding:13px}
.cpri{font-family:var(--fd);font-size:18px;font-weight:800;color:var(--g);margin-bottom:3px}
.cpri small{font-size:10px;color:var(--mu);font-weight:400}
.ctit{font-size:13px;font-weight:600;margin-bottom:5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cloc{font-size:11px;color:var(--mu);margin-bottom:8px}
.cmeta{display:flex;gap:9px;flex-wrap:wrap;border-top:1px solid var(--br);padding-top:8px}
.cmi{font-size:11px;color:var(--mu);display:flex;align-items:center;gap:2px}
.cmi strong{color:var(--tx);font-weight:600}
.cft{display:flex;justify-content:space-between;align-items:center;padding:7px 13px;border-top:1px solid var(--br);background:var(--bg)}
.trsm{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700}
.tbar{width:40px;height:3px;background:var(--br);border-radius:2px;overflow:hidden}
.tfil{height:100%;border-radius:2px}
/* ── SKELETON ── */
.sk{animation:shim 1.4s infinite;border-radius:8px}
.skimg{width:100%;height:196px;background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:400% 100%}
@keyframes shim{0%{background-position:100% 0}100%{background-position:-100% 0}}
/* ── OVERLAY ── */
.ov{position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:500;display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(4px)}
.modal{background:#fff;border-radius:20px;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.22)}
.mhd{padding:20px 20px 0;display:flex;justify-content:space-between;align-items:center}
.mtit{font-family:var(--fd);font-size:20px;font-weight:800}
.mcls{width:32px;height:32px;border-radius:50%;border:none;background:var(--bg);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:.15s}
.mcls:hover{background:var(--br)}
.mbd{padding:20px}
.mtabs{display:flex;gap:3px;background:var(--bg);border-radius:9px;padding:3px;margin-bottom:18px}
.mtab{flex:1;padding:7px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;border:none;background:none;color:var(--mu);transition:.18s}
.mtab.on{background:var(--g);color:#fff}
/* ── FORM ── */
.fg{margin-bottom:13px}
.fl{display:block;font-size:11px;font-weight:700;color:var(--tx);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
.fl span{color:var(--rd)}
.fi{width:100%;padding:9px 12px;border:1.5px solid var(--br);border-radius:9px;font-size:13px;outline:none;transition:.18s;background:#fff}
.fi:focus{border-color:var(--g);box-shadow:0 0 0 3px rgba(10,92,54,.07)}
.fbt2{width:100%;padding:11px;border-radius:9px;font-size:14px;font-weight:700;border:none;cursor:pointer;transition:.18s}
.fbg{background:var(--g);color:#fff}.fbg:hover{background:#083d25}.fbg:disabled{background:#9ca3af;cursor:not-allowed}
.fbo{background:#fff;color:var(--g);border:2px solid var(--g)}.fbo:hover{background:var(--gl)}
.frd{background:var(--rd);color:#fff}.frd:hover{background:#b91c1c}
.divd{display:flex;align-items:center;gap:7px;margin:13px 0;color:var(--mu);font-size:11px}
.divd::before,.divd::after{content:'';flex:1;height:1px;background:var(--br)}
.al{padding:9px 12px;border-radius:8px;font-size:12px;margin-bottom:11px;display:flex;align-items:flex-start;gap:6px}
.ale{background:var(--rl);color:#991b1b;border:1px solid #fecaca}
.alo{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.awi{background:var(--al);color:#92400e;border:1px solid #fde68a}
/* ── STEPS ── */
.steps{display:flex;margin-bottom:22px}
.sti{flex:1;text-align:center;position:relative}
.sti:not(:last-child)::after{content:'';position:absolute;top:14px;left:55%;width:90%;height:2px;background:var(--br)}
.sti.dn:not(:last-child)::after{background:var(--g)}
.stci{width:28px;height:28px;border-radius:50%;border:2px solid var(--br);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin:0 auto 4px;background:#fff;color:var(--mu);position:relative;z-index:1;transition:.3s}
.sti.ac .stci{border-color:var(--g);color:var(--g);background:var(--gl)}
.sti.dn .stci{border-color:var(--g);background:var(--g);color:#fff}
.stlb{font-size:9px;color:var(--mu);display:none}
@media(min-width:480px){.stlb{display:block}}
.sti.ac .stlb{color:var(--g);font-weight:700}
.iuz{border:2px dashed var(--br);border-radius:10px;padding:26px 14px;text-align:center;cursor:pointer;transition:.18s;background:var(--bg)}
.iuz:hover{border-color:var(--g);background:var(--gl)}
.fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.fchip{padding:7px 4px;border:1.5px solid var(--br);border-radius:7px;text-align:center;cursor:pointer;font-size:10px;transition:.18s;background:#fff;line-height:1.4}
.fchip.on{border-color:var(--g);background:var(--gl);color:var(--g);font-weight:700}
.prow{display:flex;gap:7px;align-items:flex-end}
.psuf{padding:9px 11px;background:var(--bg);border:1.5px solid var(--br);border-radius:9px;font-size:11px;font-weight:700;color:var(--mu);white-space:nowrap}
/* ── DETAIL ── */
.bkb{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:5px;padding:14px 20px 0;color:var(--g);font-weight:700;font-size:12px;cursor:pointer;border:none;background:none}
.bkb:hover{text-decoration:underline}
.detl{max-width:1280px;margin:0 auto;padding:18px 20px;display:grid;grid-template-columns:1fr 320px;gap:24px}
@media(max-width:860px){.detl{grid-template-columns:1fr}}
.gmain{width:100%;height:370px;object-fit:cover;border-radius:var(--r);display:block;margin-bottom:20px;cursor:zoom-in}
.dtit{font-family:var(--fd);font-size:clamp(17px,3vw,25px);font-weight:800;margin-bottom:8px;line-height:1.2}
.dpri{font-family:var(--fd);font-size:clamp(20px,3.5vw,32px);font-weight:800;color:var(--g)}
.dtags{display:flex;gap:5px;flex-wrap:wrap;margin:11px 0 16px}
.tag{padding:4px 9px;border-radius:6px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:3px}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;margin-bottom:20px}
.spec{background:var(--bg);border-radius:9px;padding:10px;text-align:center}
.spico{font-size:19px;margin-bottom:2px}
.spv{font-weight:700;font-size:14px}
.spl{font-size:10px;color:var(--mu)}
.frow{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:20px}
.ftag{padding:4px 9px;background:var(--gl);color:var(--g);border-radius:6px;font-size:11px;font-weight:700}
/* ── CONTACT CARD ── */
.ccrd{background:#fff;border-radius:var(--r);box-shadow:var(--sh);border:1px solid var(--br);overflow:hidden;position:sticky;top:72px}
.cchd{background:var(--g);padding:15px 17px;color:#fff}
.ccpri{font-family:var(--fd);font-size:21px;font-weight:800}
.ccsub{font-size:10px;opacity:.75;margin-top:2px}
.ccbd{padding:15px;display:flex;flex-direction:column;gap:8px}
.btn{padding:10px 14px;border-radius:9px;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:.18s;width:100%;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px}
.btg{background:var(--g);color:#fff}.btg:hover{background:#083d25}
.btw{background:#25d366;color:#fff}.btw:hover{background:#1fba59}
.bto{background:#fff;color:var(--g);border:2px solid var(--g)}.bto:hover{background:var(--gl)}
.bty{background:var(--al);color:#92400e;border:none}.bty:hover{background:var(--au);color:#fff}
.trdet{background:var(--bg);border-radius:9px;padding:10px;display:flex;align-items:center;gap:9px}
.trcir{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--fd);font-weight:800;font-size:14px;flex-shrink:0}
/* ── MESSAGING ── */
.chat-modal{background:#fff;border-radius:20px;width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.22)}
.chat-hd{padding:16px 18px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:10px;flex-shrink:0}
.chat-av{width:38px;height:38px;border-radius:50%;background:var(--g);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0}
.chat-info{flex:1;min-width:0}
.chat-name{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-sub{font-size:11px;color:var(--mu)}
.chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;min-height:0}
.msg{max-width:78%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word}
.msg-me{background:var(--g);color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.msg-them{background:var(--bg);color:var(--tx);align-self:flex-start;border:1px solid var(--br);border-bottom-left-radius:4px}
.msg-time{font-size:9px;opacity:.65;margin-top:3px}
.chat-inp{padding:12px 14px;border-top:1px solid var(--br);display:flex;gap:8px;align-items:flex-end;flex-shrink:0}
.chat-inp .fi{flex:1;resize:none;min-height:38px;max-height:100px;border-radius:10px;padding:8px 12px}
.chat-send{background:var(--g);color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;transition:.18s}
.chat-send:hover{background:#083d25}
.chat-send:disabled{background:#9ca3af;cursor:not-allowed}
.typing{font-size:11px;color:var(--mu);font-style:italic;padding:0 14px 6px}
/* ── NOTIF PANEL ── */
.notif-panel{position:absolute;top:50px;right:0;background:#fff;border:1px solid var(--br);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.14);width:320px;z-index:400;overflow:hidden}
.notif-hd{padding:12px 14px;border-bottom:1px solid var(--br);display:flex;justify-content:space-between;align-items:center}
.notif-tit{font-weight:800;font-size:13px;font-family:var(--fd)}
.notif-item{padding:10px 14px;border-bottom:1px solid var(--br);display:flex;gap:10px;cursor:pointer;transition:.15s}
.notif-item:hover{background:var(--bg)}
.notif-item.unr{background:#f0fdf4}
.notif-ico{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.notif-body{flex:1;min-width:0}
.notif-ttl{font-size:12px;font-weight:700;color:var(--tx)}
.notif-txt{font-size:11px;color:var(--mu);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notif-age{font-size:10px;color:var(--mu);margin-top:2px}
.notif-empty{padding:24px;text-align:center;color:var(--mu);font-size:13px}
/* ── MAP ── */
.mappage{max-width:1280px;margin:0 auto;padding:20px}
.mapsb{display:grid;grid-template-columns:290px 1fr;height:560px;border-radius:var(--r);overflow:hidden;border:1px solid var(--br);box-shadow:var(--sh)}
@media(max-width:680px){.mapsb{grid-template-columns:1fr;height:auto}}
.mlist{overflow-y:auto;border-right:1px solid var(--br);background:#fff}
@media(max-width:680px){.mlist{height:180px}}
.mitem{padding:9px 11px;border-bottom:1px solid var(--br);cursor:pointer;transition:.15s;display:flex;gap:8px;align-items:flex-start}
.mitem:hover,.mitem.sel{background:var(--gl)}
.mthumb{width:52px;height:42px;border-radius:5px;object-fit:cover;flex-shrink:0}
.minfo{flex:1;min-width:0}
.mpri{font-family:var(--fd);font-size:11px;font-weight:800;color:var(--g)}
.mnam{font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mloc{font-size:9px;color:var(--mu);margin-top:1px}
#lmap{width:100%;height:100%}
@media(max-width:680px){#lmap{height:320px}}
.leaflet-popup-content-wrapper{border-radius:10px!important;padding:0!important;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.17)!important}
.leaflet-popup-content{margin:0!important;width:200px!important}
.pimg{width:100%;height:100px;object-fit:cover;display:block}
.pbd{padding:8px 10px}
.ppri{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:#0a5c36}
.ptit{font-size:10px;color:#374151;margin-top:2px;line-height:1.3}
/* ── PRICE TABLE ── */
.ptable-wrap{overflow:auto;border-radius:var(--r);border:1px solid var(--br);box-shadow:var(--sh)}
.ptable{width:100%;border-collapse:collapse;background:#fff;min-width:600px}
.ptable th{background:var(--bg);padding:9px 12px;font-size:10px;font-weight:700;color:var(--mu);text-align:left;border-bottom:1px solid var(--br);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.ptable td{padding:10px 12px;font-size:12px;border-bottom:1px solid var(--br);vertical-align:middle}
.ptable tr:last-child td{border-bottom:none}
.ptable tr:hover td{background:var(--bg)}
.price-cell{font-family:var(--fd);font-weight:800;color:var(--g)}
/* ── SIMULATOR ── */
.sim-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sim-result{background:linear-gradient(135deg,var(--g),#16a34a);color:#fff;border-radius:12px;padding:18px;margin-top:14px}
.sim-kpi{text-align:center;padding:8px}
.sim-val{font-family:var(--fd);font-size:22px;font-weight:800}
.sim-lbl{font-size:10px;opacity:.8;margin-top:2px}
.sim-divid{width:1px;background:rgba(255,255,255,.25)}
/* ── DASHBOARD ── */
.dash{max-width:1280px;margin:0 auto;padding:24px 20px}
.dashg{display:grid;grid-template-columns:210px 1fr;gap:18px}
@media(max-width:740px){.dashg{grid-template-columns:1fr}}
.dside{display:flex;flex-direction:column;gap:5px}
.dnb{padding:8px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:var(--mu);border:none;background:none;text-align:left;transition:.18s;display:flex;align-items:center;gap:7px;position:relative}
.dnb:hover,.dnb.on{color:var(--g);background:var(--gl)}
.dpc{background:#fff;border-radius:var(--r);border:1px solid var(--br);padding:16px;text-align:center;margin-bottom:5px}
.dav{width:56px;height:56px;border-radius:50%;background:var(--g);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--fd);font-size:20px;font-weight:800;margin:0 auto 8px}
.dname{font-weight:700;font-size:13px;margin-bottom:1px}
.drole{font-size:10px;color:var(--g);font-weight:700;background:var(--gl);padding:2px 8px;border-radius:100px;display:inline-block;margin-top:4px}
.kpig{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:11px;margin-bottom:18px}
.kpi{background:#fff;border-radius:var(--r);border:1px solid var(--br);padding:14px;box-shadow:var(--sh)}
.kpiv{font-family:var(--fd);font-size:26px;font-weight:800;color:var(--g)}
.kpil{font-size:11px;color:var(--mu);margin-top:1px}
.kpiic{font-size:22px;margin-bottom:3px}
.dtit2{font-family:var(--fd);font-size:17px;font-weight:800;margin-bottom:13px}
.dtbl{width:100%;border-collapse:collapse;background:#fff;border-radius:var(--r);overflow:hidden;border:1px solid var(--br);box-shadow:var(--sh)}
.dtbl th{background:var(--bg);padding:9px 12px;font-size:10px;font-weight:700;color:var(--mu);text-align:left;border-bottom:1px solid var(--br);text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}
.dtbl td{padding:10px 12px;font-size:12px;border-bottom:1px solid var(--br);vertical-align:middle}
.dtbl tr:last-child td{border-bottom:none}
.dtbl tr:hover td{background:var(--bg)}
.sdot{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700}
.dot{width:5px;height:5px;border-radius:50%}
.dg{background:#16a34a}.dy{background:#d97706}.dr{background:#dc2626}
.abtns{display:flex;gap:4px}
.ab{padding:3px 8px;border-radius:4px;font-size:10px;font-weight:700;border:none;cursor:pointer;transition:.15s}
.abe{background:var(--al);color:#92400e}.abe:hover{background:var(--au);color:#fff}
.abd{background:var(--rl);color:var(--rd)}.abd:hover{background:var(--rd);color:#fff}
.abv{background:var(--gl);color:var(--g)}.abv:hover{background:var(--g);color:#fff}
.cbrw{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.cblbl{font-size:10px;color:var(--mu);width:80px;flex-shrink:0;text-align:right}
.cbwrp{flex:1;height:16px;background:var(--bg);border-radius:3px;overflow:hidden}
.cbfil{height:100%;border-radius:3px;background:var(--g);transition:.5s}
.cbval{font-size:10px;font-weight:700;width:32px;flex-shrink:0}
/* ── REVIEW STARS ── */
.stars{display:flex;gap:2px}
.star{font-size:14px;color:#d1d5db}.star.on{color:var(--au)}
/* ── AGENCY PAGE ── */
.agpage{max-width:1280px;margin:0 auto;padding:20px}
.ag-hero{background:linear-gradient(135deg,var(--nv),#264f8c);border-radius:var(--r);padding:28px;color:#fff;display:flex;gap:18px;align-items:center;margin-bottom:24px;flex-wrap:wrap}
.ag-logo{width:70px;height:70px;border-radius:14px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-family:var(--fd);font-size:26px;font-weight:800;flex-shrink:0}
.ag-info{flex:1}
.ag-name{font-family:var(--fd);font-size:22px;font-weight:800;margin-bottom:5px}
.ag-meta{font-size:13px;opacity:.75}
.ag-badges{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
.ag-badge{padding:4px 10px;border-radius:100px;font-size:11px;font-weight:700;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25)}
/* ── SIMILAR ── */
.similar{max-width:1280px;margin:0 auto;padding:0 20px 40px}
/* ── PROMO / FOOTER ── */
.promo{background:var(--g);padding:42px 20px;text-align:center}
.promo h2{font-family:var(--fd);font-size:22px;font-weight:800;color:#fff;margin-bottom:7px}
.promo p{color:rgba(255,255,255,.68);font-size:13px;margin-bottom:18px}
.pbtn{background:var(--au);color:#1a1a1a;padding:11px 26px;border-radius:100px;font-size:13px;font-weight:800;border:none;cursor:pointer}
.footer{background:var(--nv);color:rgba(255,255,255,.55);padding:30px 20px;text-align:center}
.flogo{font-family:var(--fd);font-size:18px;font-weight:800;color:#fff;margin-bottom:4px}
.flogo span{color:var(--au)}
.flinks{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin:10px 0}
.flnk{color:rgba(255,255,255,.4);text-decoration:none;font-size:11px;cursor:pointer}
.flnk:hover{color:#fff}
/* ── TOAST ── */
.toast{position:fixed;bottom:20px;right:20px;z-index:1000;padding:11px 15px;border-radius:10px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.17);animation:slu .3s ease;display:flex;align-items:center;gap:6px;max-width:290px}
.tok{background:#166534;color:#fff}.terr{background:#991b1b;color:#fff}
@keyframes slu{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
.ldr{display:flex;justify-content:center;align-items:center;min-height:260px}
.spin{width:34px;height:34px;border:3px solid var(--br);border-top-color:var(--g);border-radius:50%;animation:spn .7s linear infinite}
@keyframes spn{to{transform:rotate(360deg)}}
/* ── COMPARE BAR ── */
.cmpbar{position:fixed;bottom:0;left:0;right:0;background:var(--nv);color:#fff;z-index:400;padding:10px 20px;display:flex;align-items:center;gap:12px;box-shadow:0 -4px 20px rgba(0,0,0,.25);flex-wrap:wrap}
.cmpbar-title{font-family:var(--fd);font-weight:800;font-size:13px;flex-shrink:0}
.cmp-items{display:flex;gap:8px;flex:1;flex-wrap:wrap;min-width:0}
.cmp-item{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);border-radius:8px;padding:5px 9px;font-size:11px;font-weight:600;max-width:160px}
.cmp-item-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.cmp-rm{background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:14px;padding:0;flex-shrink:0;line-height:1}
.cmp-rm:hover{color:#fff}
.cmpbar .btn{padding:8px 18px;font-size:12px;flex-shrink:0;width:auto}
/* ── COMPARE MODAL ── */
.cmp-modal{background:#fff;border-radius:18px;width:100%;max-width:780px;max-height:88vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.22)}
.cmp-table{width:100%;border-collapse:collapse}
.cmp-table th{background:var(--g);color:#fff;padding:12px 14px;font-family:var(--fd);font-weight:700;font-size:13px;text-align:left;position:sticky;top:0;z-index:1}
.cmp-table th:first-child{background:var(--bg);color:var(--mu);font-family:var(--fb);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.cmp-table td{padding:10px 14px;border-bottom:1px solid var(--br);font-size:12px;vertical-align:top}
.cmp-table td:first-child{font-weight:700;color:var(--mu);font-size:11px;text-transform:uppercase;letter-spacing:.3px;background:var(--bg);white-space:nowrap}
.cmp-table tr:last-child td{border-bottom:none}
.cmp-img{width:100%;height:120px;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px}
.cmp-badge-ok{color:#16a34a;font-weight:700}.cmp-badge-no{color:#6b7280}
/* ── SPARKLINE ── */
.sparkline-wrap{background:var(--bg);border-radius:10px;padding:14px;margin-bottom:20px}
.sparkline-title{font-family:var(--fd);font-weight:700;font-size:13px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
.sparkline-delta{font-size:11px;font-weight:700;padding:2px 7px;border-radius:100px}
/* ── SHARE POPUP ── */
.share-popup{position:absolute;bottom:calc(100% + 8px);right:0;background:#fff;border:1px solid var(--br);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:12px;width:220px;z-index:200}
.share-btn-item{width:100%;padding:8px 10px;border:none;background:none;text-align:left;cursor:pointer;font-size:12px;font-weight:600;border-radius:7px;display:flex;align-items:center;gap:8px;transition:.15s}
.share-btn-item:hover{background:var(--bg)}
/* ── ALERT MODAL ── */
.alert-filters{display:grid;grid-template-columns:1fr 1fr;gap:9px}
/* ── PROFILE EDIT ── */
.pedit-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
/* ── LOAD MORE ── */
.loadmore-wrap{text-align:center;padding:28px 0}
.loadmore-btn{background:#fff;border:2px solid var(--g);color:var(--g);padding:11px 32px;border-radius:100px;font-size:13px;font-weight:700;cursor:pointer;transition:.18s}
.loadmore-btn:hover{background:var(--g);color:#fff}
/* ── BOOST BADGE ── */
.boost-badge{background:linear-gradient(135deg,var(--au),#f59e0b);color:#1a1a1a;font-size:9px;font-weight:800;padding:2px 7px;border-radius:100px;display:inline-flex;align-items:center;gap:3px}
@media(max-width:580px){
  .navl{display:none}
  .srow{flex-direction:column}
  .detl{padding:12px}
  .gmain{height:220px}
  .fgrid{grid-template-columns:repeat(2,1fr)}
  .sim-grid{grid-template-columns:1fr}
  .advfilg{grid-template-columns:1fr 1fr}
  .cmpbar{flex-direction:column;align-items:flex-start}
  .cmp-modal{border-radius:14px 14px 0 0;max-width:100%;max-height:95vh}
  .alert-filters{grid-template-columns:1fr}
  .pedit-grid{grid-template-columns:1fr}
}

/* ── Role Dashboards ─────────────────────── */
.dash-card{background:#fff;border:1px solid var(--br);border-radius:var(--r);padding:15px;box-shadow:var(--sh);margin-bottom:0}
.empty-state{background:#fff;border:1px solid var(--br);border-radius:var(--r);padding:36px 24px;text-align:center;box-shadow:var(--sh)}
`;

// ══════════════════════════════════════════════════════════
// TRUST
// ══════════════════════════════════════════════════════════
function Trust({score,lg}){
  const c=score>=80?"#16a34a":score>=60?"#d97706":"#dc2626";
  if(lg)return(
    <div className="trdet">
      <div className="trcir" style={{background:c+"20",color:c}}>{score}</div>
      <div>
        <div style={{fontWeight:700,fontSize:12,color:c}}>{score>=80?"✅ Annonce de confiance":score>=60?"⚠️ Confiance modérée":"❗ Non vérifiée"}</div>
        <div style={{fontSize:10,color:"var(--mu)"}}>Score SeneGalsen</div>
      </div>
    </div>
  );
  return(<div className="trsm"><div className="tbar"><div className="tfil" style={{width:score+"%",background:c}}/></div><span style={{color:c}}>{score}%</span></div>);
}

// ══════════════════════════════════════════════════════════
// CARD
// ══════════════════════════════════════════════════════════
function Card({l,onClick,favIds=[],onFav}){
  const isFav=favIds.includes(l.id);
  const tx=TXC[l.transaction_type]||TXC.vente;
  const doc=DOC[l.document_type];
  return(
    <div className="card" onClick={onClick}>
      <div style={{position:"relative"}}>
        <img className="cimg" src={l.cover_image||"https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=600"} alt={l.title} loading="lazy" onError={e=>e.target.src="https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=600"}/>
        <div className="cbdg">
          <span className="bdg" style={{background:tx.bg,color:tx.color}}>{TXL[l.transaction_type]}</span>
          {l.is_premium&&<span className="bdg bprem">⭐ Premium</span>}
        </div>
        <button className="cfav" onClick={e=>{e.stopPropagation();onFav&&onFav(l.id,!isFav)}} title={isFav?"Retirer des favoris":"Ajouter aux favoris"}>
          {isFav?"❤️":"🤍"}
        </button>
      </div>
      <div className="cbod">
        <div className="cpri">{fmt(l.price)}{l.transaction_type==="location"&&<small>/mois</small>}</div>
        <div className="ctit">{PICO[l.property_type]} {l.title}</div>
        <div className="cloc">📍 {l.quartier}, {l.city}</div>
        <div className="cmeta">
          {l.surface&&<div className="cmi">📐<strong>{l.surface}</strong>m²</div>}
          {l.rooms&&<div className="cmi">🏠<strong>{l.rooms}</strong>p.</div>}
          {l.bedrooms&&<div className="cmi">🛏<strong>{l.bedrooms}</strong></div>}
          {doc&&<div className="cmi"><span style={{background:doc.b,color:doc.c,borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700}}>{doc.l}</span></div>}
        </div>
      </div>
      <div className="cft"><Trust score={l.trust_score||0}/><span style={{fontSize:10,color:"var(--mu)"}}>👁 {l.views_count||0}</span></div>
    </div>
  );
}
function Skel(){
  return(<div className="card"><div className="sk skimg"/><div className="cbod"><div className="sk" style={{height:19,width:"55%",marginBottom:6}}/><div className="sk" style={{height:13,width:"90%",marginBottom:5}}/><div className="sk" style={{height:11,width:"42%"}}/></div></div>);
}
function Stars({n}){return(<div className="stars">{[1,2,3,4,5].map(i=><span key={i} className={`star ${i<=n?"on":""}`}>★</span>)}</div>);}

// ══════════════════════════════════════════════════════════
// AUTH MODAL
// ══════════════════════════════════════════════════════════
function AuthModal({onClose,onSuccess}){
  const [tab,setTab]=useState("login");
  const [email,setEmail]=useState(""),  [pass,setPass]=useState(""), [name,setName]=useState("");
  const [loading,setLoading]=useState(false), [err,setErr]=useState(""), [ok,setOk]=useState("");

  async function login(e){
    e.preventDefault();setErr("");setLoading(true);
    const{data,error}=await sb.auth.signInWithPassword({email,password:pass});
    setLoading(false);
    if(error){setErr(error.message);return;}
    onSuccess(data.user);
  }
  async function signup(e){
    e.preventDefault();setErr("");setLoading(true);
    const{error}=await sb.auth.signUp({email,password:pass,options:{data:{full_name:name}}});
    setLoading(false);
    if(error){setErr(error.message);return;}
    setOk("Compte créé ! Vérifiez votre email pour confirmer.");
  }
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mhd"><div className="mtit">🏡 SeneGalsen</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          <div className="mtabs">
            <button className={`mtab ${tab==="login"?"on":""}`} onClick={()=>{setTab("login");setErr("");setOk("");}}>Connexion</button>
            <button className={`mtab ${tab==="signup"?"on":""}`} onClick={()=>{setTab("signup");setErr("");setOk("");}}>Inscription</button>
          </div>
          {err&&<div className="al ale">❌ {err}</div>}
          {ok&&<div className="al alo">✅ {ok}</div>}
          {tab==="login"?(
            <form onSubmit={login}>
              <div className="fg"><label className="fl">Email <span>*</span></label><input className="fi" type="email" placeholder="votre@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
              <div className="fg"><label className="fl">Mot de passe <span>*</span></label><input className="fi" type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} required/></div>
              <button className="fbt2 fbg" type="submit" disabled={loading}>{loading?"Connexion...":"Se connecter"}</button>
              <div className="divd">ou</div>
              <p style={{textAlign:"center",fontSize:12,color:"var(--mu)"}}>Pas de compte ? <button type="button" onClick={()=>setTab("signup")} style={{color:"var(--g)",fontWeight:700,background:"none",border:"none",cursor:"pointer"}}>S'inscrire gratuitement</button></p>
            </form>
          ):(
            <form onSubmit={signup}>
              <div className="fg"><label className="fl">Nom complet <span>*</span></label><input className="fi" placeholder="Ibrahima Diallo" value={name} onChange={e=>setName(e.target.value)} required/></div>
              <div className="fg"><label className="fl">Email <span>*</span></label><input className="fi" type="email" placeholder="votre@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
              <div className="fg"><label className="fl">Mot de passe <span>*</span></label><input className="fi" type="password" placeholder="Min. 8 caractères" value={pass} onChange={e=>setPass(e.target.value)} required minLength={8}/></div>
              <button className="fbt2 fbg" type="submit" disabled={loading}>{loading?"Création...":"Créer mon compte"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// LISTING FORM
// ══════════════════════════════════════════════════════════
function ListingForm({user,onClose,onSuccess}){
  const [step,setStep]=useState(0), [loading,setLoading]=useState(false), [err,setErr]=useState("");
  const [form,setForm]=useState({transaction_type:"vente",property_type:"appartement",title:"",description:"",price:"",surface:"",rooms:"",bedrooms:"",bathrooms:"",document_type:"titre_foncier",is_negotiable:false,region:"Dakar",city:"Dakar",commune:"",quartier:"",cover_image:"",features:{}});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const tog=k=>setForm(f=>({...f,features:{...f.features,[k]:!f.features[k]}}));
  const valid=[()=>form.transaction_type&&form.property_type,()=>form.title&&form.price,()=>true,()=>true,()=>form.city&&form.quartier];

  async function submit(){
    setErr("");setLoading(true);
    const p={owner_id:user.id,transaction_type:form.transaction_type,property_type:form.property_type,title:form.title,description:form.description,price:parseInt(String(form.price).replace(/\D/g,""))||0,surface:parseFloat(form.surface)||null,rooms:parseInt(form.rooms)||null,bedrooms:parseInt(form.bedrooms)||null,bathrooms:parseInt(form.bathrooms)||null,document_type:form.document_type,is_negotiable:form.is_negotiable,region:form.region,city:form.city,commune:form.commune,quartier:form.quartier,cover_image:form.cover_image||"https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=800",features:form.features,trust_score:40,status:"active"};
    const{data,error}=await sb.from("listings").insert([p]).select().single();
    setLoading(false);
    if(error){setErr(error.message);return;}
    onSuccess(data);
  }
  const S0=()=>(
    <div>
      <div className="fg">
        <label className="fl">Type de transaction <span>*</span></label>
        <div style={{display:"flex",gap:7}}>{Object.entries(TXL).map(([v,l])=>(<button key={v} type="button" onClick={()=>set("transaction_type",v)} style={{flex:1,padding:"9px 5px",borderRadius:9,border:`2px solid ${form.transaction_type===v?"var(--g)":"var(--br)"}`,background:form.transaction_type===v?"var(--gl)":"#fff",color:form.transaction_type===v?"var(--g)":"var(--mu)",fontWeight:700,cursor:"pointer",fontSize:12}}>{l}</button>))}</div>
      </div>
      <div className="fg">
        <label className="fl">Type de bien <span>*</span></label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>{Object.entries(PICO).map(([v,ico])=>(<button key={v} type="button" onClick={()=>set("property_type",v)} style={{padding:"10px 5px",borderRadius:9,border:`2px solid ${form.property_type===v?"var(--g)":"var(--br)"}`,background:form.property_type===v?"var(--gl)":"#fff",color:form.property_type===v?"var(--g)":"var(--tx)",fontWeight:700,cursor:"pointer",textAlign:"center"}}><div style={{fontSize:19}}>{ico}</div><div style={{fontSize:10,marginTop:2}}>{v.charAt(0).toUpperCase()+v.slice(1)}</div></button>))}</div>
      </div>
    </div>
  );
  const S1=()=>(<div>
    <div className="fg"><label className="fl">Titre <span>*</span></label><input className="fi" placeholder="Belle villa avec piscine — Almadies" value={form.title} onChange={e=>set("title",e.target.value)}/></div>
    <div className="fg"><label className="fl">Description</label><textarea className="fi" rows={3} placeholder="Décrivez votre bien en détail..." value={form.description} onChange={e=>set("description",e.target.value)} style={{resize:"vertical"}}/></div>
    <div className="prow"><div className="fg" style={{flex:1}}><label className="fl">Prix (FCFA) <span>*</span></label><input className="fi" placeholder="Ex: 45000000" value={form.price} onChange={e=>set("price",e.target.value)}/></div><div className="psuf">{form.transaction_type==="location"?"/mois":"XOF"}</div></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
      <div className="fg"><label className="fl">Surface (m²)</label><input className="fi" type="number" placeholder="120" value={form.surface} onChange={e=>set("surface",e.target.value)}/></div>
      <div className="fg"><label className="fl">Pièces</label><input className="fi" type="number" placeholder="5" value={form.rooms} onChange={e=>set("rooms",e.target.value)}/></div>
      <div className="fg"><label className="fl">Chambres</label><input className="fi" type="number" placeholder="3" value={form.bedrooms} onChange={e=>set("bedrooms",e.target.value)}/></div>
      <div className="fg"><label className="fl">Sdb</label><input className="fi" type="number" placeholder="2" value={form.bathrooms} onChange={e=>set("bathrooms",e.target.value)}/></div>
    </div>
    <div className="fg"><label className="fl">Document</label><select className="fi" value={form.document_type} onChange={e=>set("document_type",e.target.value)}><option value="titre_foncier">📗 Titre Foncier</option><option value="bail">📘 Bail</option><option value="permis_occuper">📙 Permis d'occuper</option><option value="deliberation">📒 Délibération</option><option value="autre">📄 Autre</option></select></div>
    <div style={{display:"flex",alignItems:"center",gap:7}}><input type="checkbox" id="ng" checked={form.is_negotiable} onChange={e=>set("is_negotiable",e.target.checked)} style={{width:14,height:14,cursor:"pointer"}}/><label htmlFor="ng" style={{fontSize:13,cursor:"pointer"}}>Prix négociable</label></div>
  </div>);
  const S2=()=>(<div>
    <div className="fg"><label className="fl">URL photo de couverture</label><input className="fi" placeholder="https://images.unsplash.com/..." value={form.cover_image} onChange={e=>set("cover_image",e.target.value)}/><p style={{fontSize:10,color:"var(--mu)",marginTop:3}}>Collez l'URL d'une image hébergée</p></div>
    {form.cover_image&&<div style={{borderRadius:9,overflow:"hidden",marginTop:8}}><img src={form.cover_image} alt="preview" style={{width:"100%",height:150,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"}/></div>}
    <div className="iuz" style={{marginTop:11}} onClick={()=>alert("Upload Supabase Storage disponible en production.")}><div style={{fontSize:24,marginBottom:4}}>📸</div><div style={{fontWeight:700,fontSize:13}}>Ajouter des photos</div><div style={{fontSize:11,color:"var(--mu)",marginTop:2}}>JPG, PNG, WebP · Max 20 photos</div></div>
  </div>);
  const S3=()=>(<div><label className="fl" style={{marginBottom:10}}>Équipements</label><div className="fgrid">{FEATS.map(({k,l})=>(<div key={k} className={`fchip ${form.features[k]?"on":""}`} onClick={()=>tog(k)}>{l}</div>))}</div></div>);
  const S4=()=>(<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
      <div className="fg"><label className="fl">Région <span>*</span></label><select className="fi" value={form.region} onChange={e=>set("region",e.target.value)}>{REGIONS.map(r=><option key={r}>{r}</option>)}</select></div>
      <div className="fg"><label className="fl">Ville <span>*</span></label><input className="fi" placeholder="Dakar" value={form.city} onChange={e=>set("city",e.target.value)}/></div>
    </div>
    <div className="fg"><label className="fl">Commune</label><input className="fi" placeholder="Almadies" value={form.commune} onChange={e=>set("commune",e.target.value)}/></div>
    <div className="fg"><label className="fl">Quartier <span>*</span></label><input className="fi" list="ql" placeholder="Almadies, Point E..." value={form.quartier} onChange={e=>set("quartier",e.target.value)}/><datalist id="ql">{QUARTIERS.map(q=><option key={q} value={q}/>)}</datalist></div>
  </div>);
  const stepsComp=[<S0/>,<S1/>,<S2/>,<S3/>,<S4/>];
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:530}}>
        <div className="mhd"><div className="mtit">+ Déposer une annonce</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          <div className="steps">{STEPS.map((s,i)=>(<div key={i} className={`sti ${i<step?"dn":""} ${i===step?"ac":""}`}><div className="stci">{i<step?"✓":i+1}</div><div className="stlb">{s}</div></div>))}</div>
          <div style={{minHeight:250}}>{stepsComp[step]}</div>
          {err&&<div className="al ale" style={{marginTop:8}}>❌ {err}</div>}
          <div style={{display:"flex",gap:8,marginTop:16}}>
            {step>0&&<button className="fbt2 fbo" style={{flex:1}} onClick={()=>setStep(s=>s-1)}>← Précédent</button>}
            {step<STEPS.length-1?(<button className="fbt2 fbg" style={{flex:2}} onClick={()=>valid[step]()&&setStep(s=>s+1)} disabled={!valid[step]()}>Suivant →</button>):(<button className="fbt2 fbg" style={{flex:2}} onClick={submit} disabled={loading||!valid[step]()}>{loading?"Publication...":"📤 Publier l'annonce"}</button>)}
          </div>
          <p style={{textAlign:"center",fontSize:10,color:"var(--mu)",marginTop:7}}>Étape {step+1}/{STEPS.length} · {STEPS[step]}</p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MESSAGING
// ══════════════════════════════════════════════════════════
function ChatModal({user,listing,ownerProfile,onClose}){
  const [msgs,setMsgs]=useState([]);
  const [text,setText]=useState("");
  const [convId,setConvId]=useState(null);
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const endRef=useRef(null);
  const channelRef=useRef(null);

  useEffect(()=>{
    if(!user||!listing?.owner_id)return;
    initConv();
    return()=>{if(channelRef.current)sb.removeChannel(channelRef.current);};
  },[]);

  async function initConv(){
    setLoading(true);
    const{data:id}=await sb.rpc("get_or_create_conversation",{p_listing_id:listing.id,p_user_a:user.id,p_user_b:listing.owner_id});
    if(!id){setLoading(false);return;}
    setConvId(id);
    await sb.rpc("mark_messages_read",{p_conv_id:id,p_uid:user.id}).catch(()=>{});
    const{data:m}=await sb.from("messages").select("*").eq("conversation_id",id).order("created_at");
    setMsgs(m||[]);
    setLoading(false);
    // Realtime
    const ch=sb.channel(`conv:${id}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`conversation_id=eq.${id}`},payload=>{
      setMsgs(prev=>[...prev,payload.new]);
    }).subscribe();
    channelRef.current=ch;
  }

  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[msgs]);

  async function send(){
    if(!text.trim()||!convId||sending)return;
    setSending(true);
    const msg={conversation_id:convId,listing_id:listing.id,sender_id:user.id,receiver_id:listing.owner_id,content:text.trim()};
    const{data}=await sb.from("messages").insert([msg]).select().single();
    if(data)setMsgs(m=>[...m,data]);
    setText("");setSending(false);
    await sb.rpc("increment_contacts",{listing_uuid:listing.id}).catch(()=>{});
  }

  const ownerName=ownerProfile?.full_name||listing?.quartier||"Annonceur";
  const ownerIni=(ownerName[0]||"?").toUpperCase();

  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="chat-modal">
        <div className="chat-hd">
          <div className="chat-av">{ownerIni}</div>
          <div className="chat-info">
            <div className="chat-name">{ownerName}</div>
            <div className="chat-sub">📍 {PICO[listing.property_type]} {listing.title?.slice(0,40)}</div>
          </div>
          <button className="mcls" onClick={onClose}>✕</button>
        </div>
        <div className="chat-msgs">
          {loading?<div className="ldr"><div className="spin"/></div>:(
            <>
              {msgs.length===0&&<div style={{textAlign:"center",color:"var(--mu)",fontSize:13,padding:"20px 0"}}>💬 Commencez la conversation</div>}
              {msgs.map(m=>{
                const isMe=m.sender_id===user.id;
                return(<div key={m.id} style={{display:"flex",justifyContent:isMe?"flex-end":"flex-start"}}><div className={`msg ${isMe?"msg-me":"msg-them"}`}>{m.content}<div className="msg-time" style={{textAlign:isMe?"right":"left"}}>{ago(m.created_at)}</div></div></div>);
              })}
              <div ref={endRef}/>
            </>
          )}
        </div>
        <div className="chat-inp">
          <textarea className="fi" placeholder="Votre message..." value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}/>
          <button className="chat-send" onClick={send} disabled={!text.trim()||sending}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// RENTAL SIMULATOR
// ══════════════════════════════════════════════════════════
function Simulator({listing,onClose}){
  const defPrice=listing?.price||50000000;
  const [prix,setPrix]=useState(String(defPrice));
  const [surf,setSurf]=useState(String(listing?.surface||100));
  const [loyerMois,setLoyerMois]=useState(String(Math.round(defPrice*0.006/1000)*1000));
  const [charges,setCharges]=useState("15");
  const [txImpo,setTxImpo]=useState("15");

  const p=parseInt(String(prix).replace(/\D/g,""))||1;
  const l=parseInt(String(loyerMois).replace(/\D/g,""))||0;
  const s=parseFloat(surf)||1;
  const ch=parseFloat(charges)/100;
  const tx=parseFloat(txImpo)/100;
  const loyerBrut=l*12;
  const rendBrut=loyerBrut/p*100;
  const loyerNet=loyerBrut*(1-ch)*(1-tx);
  const rendNet=loyerNet/p*100;
  const payback=loyerNet>0?Math.round(p/loyerNet):0;
  const prixM2=p/s;

  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:500}}>
        <div className="mhd"><div className="mtit">📊 Simulateur de rentabilité</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          <div className="al awi">💡 Estimez le rendement locatif de votre investissement en FCFA</div>
          <div className="sim-grid">
            <div className="fg"><label className="fl">Prix d'achat (FCFA)</label><input className="fi" value={prix} onChange={e=>setPrix(e.target.value)} placeholder="50000000"/></div>
            <div className="fg"><label className="fl">Surface (m²)</label><input className="fi" type="number" value={surf} onChange={e=>setSurf(e.target.value)} placeholder="100"/></div>
            <div className="fg"><label className="fl">Loyer mensuel (FCFA)</label><input className="fi" value={loyerMois} onChange={e=>setLoyerMois(e.target.value)} placeholder="350000"/></div>
            <div className="fg"><label className="fl">Charges + frais (%)</label><input className="fi" type="number" value={charges} onChange={e=>setCharges(e.target.value)} min="0" max="50" step="1"/></div>
            <div className="fg"><label className="fl">Imposition IRL (%)</label><input className="fi" type="number" value={txImpo} onChange={e=>setTxImpo(e.target.value)} min="0" max="40" step="1"/></div>
          </div>
          <div className="sim-result">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1px 1fr 1px 1fr",gap:0}}>
              <div className="sim-kpi"><div className="sim-val">{rendBrut.toFixed(2)}%</div><div className="sim-lbl">Rendement brut</div></div>
              <div className="sim-divid"/>
              <div className="sim-kpi"><div className="sim-val">{rendNet.toFixed(2)}%</div><div className="sim-lbl">Rendement net</div></div>
              <div className="sim-divid"/>
              <div className="sim-kpi"><div className="sim-val">{payback > 0 ? payback+"ans" : "—"}</div><div className="sim-lbl">Retour invest.</div></div>
            </div>
            <div style={{borderTop:"1px solid rgba(255,255,255,.2)",marginTop:12,paddingTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:14,fontFamily:"var(--fd)",fontWeight:800}}>{fmt(Math.round(loyerNet/12))}</div><div style={{fontSize:10,opacity:.75}}>Revenu net/mois</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:14,fontFamily:"var(--fd)",fontWeight:800}}>{fmt(Math.round(prixM2))}</div><div style={{fontSize:10,opacity:.75}}>Prix/m²</div></div>
            </div>
          </div>
          <p style={{fontSize:10,color:"var(--mu)",marginTop:10,lineHeight:1.5}}>* Simulation indicative. Consultez un notaire ou un conseiller fiscal pour des données précises. IRL = Impôt sur les Revenus Locatifs (Sénégal).</p>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// NOTIFICATIONS PANEL
// ══════════════════════════════════════════════════════════
function NotifPanel({user,notifs,onClose,onMarkAll}){
  const icoMap={message:"💬",listing_view:"👁",alert_match:"🔔",system:"📢"};
  const bgMap={message:"#dcfce7",listing_view:"#dbeafe",alert_match:"#fef3c7",system:"#f3f4f6"};
  return(
    <div style={{position:"relative"}}>
      <div className="notif-panel">
        <div className="notif-hd">
          <span className="notif-tit">🔔 Notifications</span>
          {notifs.some(n=>!n.is_read)&&<button onClick={onMarkAll} style={{fontSize:11,color:"var(--g)",fontWeight:700,background:"none",border:"none",cursor:"pointer"}}>Tout marquer lu</button>}
        </div>
        {notifs.length===0?(
          <div className="notif-empty">Aucune notification</div>
        ):notifs.slice(0,8).map(n=>(
          <div key={n.id} className={`notif-item ${!n.is_read?"unr":""}`} onClick={()=>{sb.from("notifications").update({is_read:true}).eq("id",n.id);onClose();}}>
            <div className="notif-ico" style={{background:bgMap[n.type]||"#f3f4f6"}}>{icoMap[n.type]||"📢"}</div>
            <div className="notif-body">
              <div className="notif-ttl">{n.title}</div>
              {n.body&&<div className="notif-txt">{n.body}</div>}
              <div className="notif-age">{ago(n.created_at)}</div>
            </div>
            {!n.is_read&&<div style={{width:7,height:7,borderRadius:"50%",background:"var(--g)",flexShrink:0,marginTop:4}}/>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAP PAGE
// ══════════════════════════════════════════════════════════
function MapPage({listings,onSelect}){
  const mapRef=useRef(null);
  const leafRef=useRef(null);
  const [selId,setSelId]=useState(null);
  const listRef=useRef(null);
  const geo=listings.filter(l=>l.latitude&&l.longitude);
  useEffect(()=>{
    if(!window.L){const s=document.createElement("script");s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";s.onload=init;document.head.appendChild(s);}
    else init();
    return()=>{if(leafRef.current){leafRef.current.remove();leafRef.current=null;}};
  },[]);
  useEffect(()=>{if(leafRef.current&&geo.length)addMarkers();},[listings]);
  function init(){
    if(leafRef.current||!mapRef.current)return;
    const L=window.L;
    const map=L.map(mapRef.current,{center:[14.72,-17.45],zoom:12});
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19}).addTo(map);
    leafRef.current=map;addMarkers();
  }
  function addMarkers(){
    const L=window.L,map=leafRef.current;
    geo.forEach(l=>{
      const tx=TXC[l.transaction_type]||TXC.vente;
      const ico=L.divIcon({className:"",html:`<div style="background:${tx.bg};color:${tx.color};padding:3px 8px;border-radius:100px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.28);font-family:'Syne',sans-serif;border:2px solid rgba(255,255,255,.5)">${l.price>=1e6?(l.price/1e6).toFixed(0)+"M":(l.price/1e3).toFixed(0)+"K"}</div>`,iconAnchor:[0,0]});
      const mk=L.marker([l.latitude,l.longitude],{icon:ico}).addTo(map);
      mk.bindPopup(`<img class="pimg" src="${l.cover_image||""}" onerror="this.src='https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300'"/><div class="pbd"><div class="ppri">${fmt(l.price)}${l.transaction_type==="location"?"/mois":""}</div><div class="ptit">${PICO[l.property_type]||""} ${l.title||""}</div><div style="font-size:9px;color:#6b7280;margin-top:2px">📍 ${l.quartier||""}, ${l.city||""}</div></div>`,{maxWidth:200});
      mk.on("click",()=>{setSelId(l.id);const el=listRef.current?.querySelector(`[data-id="${l.id}"]`);el?.scrollIntoView({behavior:"smooth",block:"nearest"});});
    });
  }
  return(
    <div className="mappage">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <h1 style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:20}}>🗺️ Carte des annonces</h1>
        <span style={{fontSize:12,color:"var(--mu)"}}>{geo.length} biens géolocalisés sur OpenStreetMap</span>
      </div>
      <div className="mapsb">
        <div className="mlist" ref={listRef}>
          {geo.map(l=>(<div key={l.id} data-id={l.id} className={`mitem ${selId===l.id?"sel":""}`} onClick={()=>{setSelId(l.id);onSelect(l);}}>
            <img className="mthumb" src={l.cover_image||""} alt="" onError={e=>e.target.src="https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200"}/>
            <div className="minfo"><div className="mpri">{fmt(l.price)}{l.transaction_type==="location"&&<span style={{fontWeight:400,fontSize:9,color:"var(--mu)"}}>/m</span>}</div><div className="mnam">{PICO[l.property_type]} {l.title}</div><div className="mloc">📍 {l.quartier}, {l.city}</div></div>
          </div>))}
        </div>
        <div id="lmap" ref={mapRef}/>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// PRICE TABLE (neighborhood stats)
// ══════════════════════════════════════════════════════════
function PriceTable(){
  const [data,setData]=useState([]);
  const [loading,setLoading]=useState(true);
  const [txF,setTxF]=useState("vente");
  useEffect(()=>{
    sb.from("neighborhood_prices").select("*").eq("transaction_type",txF).order("avg_price",{ascending:false}).limit(20).then(({data:d})=>{setData(d||[]);setLoading(false);});
  },[txF]);
  return(
    <div className="sec" style={{paddingTop:0}}>
      <div className="sech">
        <h2 className="sectl">Prix <span>par quartier</span></h2>
        <div style={{display:"flex",gap:6}}>
          {[["vente","Vente"],["location","Location"]].map(([v,l])=>(<button key={v} className={`fbt ${txF===v?"on":""}`} onClick={()=>{setTxF(v);setLoading(true);}}>{l}</button>))}
        </div>
      </div>
      {loading?<div className="ldr"><div className="spin"/></div>:(
        <div className="ptable-wrap">
          <table className="ptable">
            <thead><tr><th>Quartier</th><th>Ville</th><th>Type</th><th>Annonces</th><th>Prix médian</th><th>Prix moyen</th><th>Prix/m²</th><th>Min</th><th>Max</th></tr></thead>
            <tbody>{data.map((r,i)=>(
              <tr key={i}>
                <td style={{fontWeight:700}}>{r.quartier||"—"}</td>
                <td style={{color:"var(--mu)"}}>{r.city||"—"}</td>
                <td><span className="bdg" style={{background:TXC[r.transaction_type]?.bg||"#e5e7eb",color:TXC[r.transaction_type]?.color||"#374151",display:"inline-block"}}>{TXL[r.transaction_type]||r.transaction_type}</span></td>
                <td>{r.listing_count}</td>
                <td className="price-cell">{fmtM(r.median_price)}</td>
                <td className="price-cell">{fmtM(r.avg_price)}</td>
                <td style={{color:"var(--mu)",fontSize:11}}>{r.avg_price_per_m2?fmtM(r.avg_price_per_m2)+"/m²":"—"}</td>
                <td style={{color:"var(--mu)",fontSize:11}}>{fmtM(r.min_price)}</td>
                <td style={{color:"var(--mu)",fontSize:11}}>{fmtM(r.max_price)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// AGENCY PAGE
// ══════════════════════════════════════════════════════════
function AgencyPage({agencyId,onBack,onOpenListing,favIds,onFav}){
  const [agency,setAgency]=useState(null);
  const [listings,setListings]=useState([]);
  const [reviews,setReviews]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    Promise.all([
      sb.from("agencies").select("*").eq("id",agencyId).single(),
      sb.from("listings").select("*").eq("agency_id",agencyId).eq("status","active").order("is_premium",{ascending:false}),
      sb.from("reviews").select("*").eq("agency_id",agencyId).order("created_at",{ascending:false}),
    ]).then(([{data:a},{data:l},{data:r}])=>{
      setAgency(a);setListings(l||[]);setReviews(r||[]);setLoading(false);
    });
  },[agencyId]);
  if(loading)return <div className="ldr"><div className="spin"/></div>;
  if(!agency)return <div style={{padding:32,textAlign:"center",color:"var(--mu)"}}>Agence introuvable.</div>;
  const avgRating=reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:0;
  const planColor={free:"#6b7280",basic:"#2563eb",premium:"#d97706",vip:"#7c3aed"};
  return(
    <div className="agpage">
      <button className="bkb" style={{marginBottom:16}} onClick={onBack}>← Retour</button>
      <div className="ag-hero">
        <div className="ag-logo">{agency.name?.[0]||"A"}</div>
        <div className="ag-info">
          <div className="ag-name">{agency.name}</div>
          {agency.description&&<div className="ag-meta">{agency.description}</div>}
          <div className="ag-badges">
            {agency.is_verified&&<span className="ag-badge">✅ Agence vérifiée</span>}
            <span className="ag-badge" style={{background:`${planColor[agency.subscription_plan]}30`,borderColor:`${planColor[agency.subscription_plan]}60`,color:planColor[agency.subscription_plan]}}>⭐ Plan {agency.subscription_plan}</span>
            {agency.phone&&<span className="ag-badge">📞 {agency.phone}</span>}
          </div>
          {reviews.length>0&&<div style={{display:"flex",alignItems:"center",gap:8,marginTop:10}}>
            <Stars n={Math.round(avgRating)}/><span style={{color:"rgba(255,255,255,.8)",fontSize:13}}>{avgRating.toFixed(1)} ({reviews.length} avis)</span>
          </div>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:24}}>
        <div>
          <div className="dtit2">🏠 Annonces de l'agence ({listings.length})</div>
          {listings.length===0?<div style={{textAlign:"center",padding:28,color:"var(--mu)"}}>Aucune annonce active.</div>:(
            <div className="grid">{listings.map(l=><Card key={l.id} l={l} onClick={()=>onOpenListing(l)} favIds={favIds} onFav={onFav}/>)}</div>
          )}
        </div>
        <div>
          <div className="dtit2">⭐ Avis clients ({reviews.length})</div>
          {reviews.length===0?<div style={{textAlign:"center",padding:24,color:"var(--mu)",background:"#fff",borderRadius:"var(--r)",border:"1px solid var(--br)"}}>Aucun avis pour le moment.</div>:(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {reviews.map((r,i)=>(
                <div key={i} style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:14,boxShadow:"var(--sh)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}><Stars n={r.rating}/><span style={{fontSize:10,color:"var(--mu)"}}>{ago(r.created_at)}</span></div>
                  {r.comment&&<p style={{fontSize:13,color:"#374151",lineHeight:1.5}}>{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// DETAIL PAGE
// ══════════════════════════════════════════════════════════
function DetailPage({l,user,onBack,onOpenListing,onShowAgency,favIds,onFav,showToast}){
  const tx=TXC[l.transaction_type]||TXC.vente;
  const doc=DOC[l.document_type];
  const feats=l.features||{};
  const [similar,setSimilar]=useState([]);
  const [agency,setAgency]=useState(null);
  const [showChat,setShowChat]=useState(false);
  const [showSim,setShowSim]=useState(false);
  const [ownerProfile,setOwnerProfile]=useState(null);
  useEffect(()=>{
    sb.rpc("increment_listing_views",{listing_uuid:l.id}).catch(()=>{});
    sb.from("listings").select("*").eq("status","active").eq("property_type",l.property_type).neq("id",l.id).limit(4).then(({data})=>setSimilar(data||[]));
    if(l.agency_id)sb.from("agencies").select("*").eq("id",l.agency_id).single().then(({data})=>setAgency(data));
    if(l.owner_id)sb.from("profiles").select("*").eq("id",l.owner_id).single().then(({data})=>setOwnerProfile(data));
  },[l.id]);

  function handleContact(){
    if(!user){showToast("Connectez-vous pour contacter l'annonceur","err");return;}
    if(l.owner_id===user.id){showToast("C'est votre propre annonce","err");return;}
    setShowChat(true);
  }
  return(
    <>
      {showChat&&<ChatModal user={user} listing={l} ownerProfile={ownerProfile} onClose={()=>setShowChat(false)}/>}
      {showSim&&<Simulator listing={l} onClose={()=>setShowSim(false)}/>}
      <button className="bkb" onClick={onBack}>← Retour</button>
      <div className="detl">
        <div>
          <img className="gmain" src={l.cover_image||"https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=900"} alt={l.title} onError={e=>e.target.src="https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=900"} onClick={()=>window.open(l.cover_image,"_blank")}/>
          <div className="dtags">
            <span className="bdg" style={{...tx,padding:"5px 12px",borderRadius:7,fontSize:12}}>{TXL[l.transaction_type]}</span>
            <span className="tag" style={{background:"#f3f4f6",color:"#374151"}}>{PICO[l.property_type]} {l.property_type}</span>
            {l.is_verified&&<span className="tag" style={{background:"#dcfce7",color:"#166534"}}>✅ Vérifié</span>}
            {l.is_premium&&<span className="tag" style={{background:"var(--al)",color:"#92400e"}}>⭐ Premium</span>}
          </div>
          <h1 className="dtit">{l.title}</h1>
          <div style={{color:"var(--mu)",fontSize:12,marginBottom:14,display:"flex",alignItems:"center",gap:4}}>📍 {[l.quartier,l.commune,l.city,l.region].filter(Boolean).join(", ")}</div>
          <div className="sgrid">
            {l.surface&&<div className="spec"><div className="spico">📐</div><div className="spv">{l.surface}</div><div className="spl">m²</div></div>}
            {l.rooms&&<div className="spec"><div className="spico">🏠</div><div className="spv">{l.rooms}</div><div className="spl">Pièces</div></div>}
            {l.bedrooms&&<div className="spec"><div className="spico">🛏</div><div className="spv">{l.bedrooms}</div><div className="spl">Chambres</div></div>}
            {l.bathrooms&&<div className="spec"><div className="spico">🚿</div><div className="spv">{l.bathrooms}</div><div className="spl">Sdb</div></div>}
          </div>
          {Object.keys(feats).filter(k=>feats[k]).length>0&&<div style={{marginBottom:20}}><div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14,marginBottom:8}}>Équipements</div><div className="frow">{Object.keys(feats).filter(k=>feats[k]).map(k=><div className="ftag" key={k}>{FL[k]||k}</div>)}</div></div>}
          <PriceSparkline listingId={l.id} currentPrice={l.price}/>
          {l.description&&<div style={{marginBottom:20}}><div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14,marginBottom:8}}>Description</div><p style={{fontSize:13,lineHeight:1.75,color:"#374151"}}>{l.description}</p></div>}
          {doc&&<div style={{marginBottom:20}}><div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14,marginBottom:8}}>Document de propriété</div><span style={{background:doc.b,color:doc.c,padding:"5px 12px",borderRadius:6,fontSize:11,display:"inline-flex",alignItems:"center",gap:5,fontWeight:700}}>📄 {doc.l}</span></div>}
          {agency&&<div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:15,marginBottom:20,cursor:"pointer",transition:".18s",boxShadow:"var(--sh)"}} onClick={()=>onShowAgency(agency.id)}><div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:9,background:"var(--g)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--fd)",fontWeight:800,fontSize:17,flexShrink:0}}>{agency.name?.[0]||"A"}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6}}>{agency.name}{agency.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4}}>✅</span>}</div>
              <div style={{fontSize:11,color:"var(--mu)"}}>Voir toutes les annonces de l'agence →</div>
            </div>
          </div></div>}
        </div>
        <div>
          <div className="ccrd">
            <div className="cchd">
              <div className="ccpri">{fmt(l.price)}</div>
              <div className="ccsub">{l.transaction_type==="location"?"par mois":"Prix de vente"}{l.is_negotiable&&" · Négociable"}</div>
            </div>
            <div className="ccbd">
              <Trust score={l.trust_score||0} lg/>
              <button className="btn btg">📞 Appeler l'annonceur</button>
              <a href={`https://wa.me/${ownerProfile?.whatsapp?.replace(/\D/g,"")||"221770000000"}?text=${encodeURIComponent("Bonjour, je suis intéressé par votre annonce : "+l.title+" ("+new URL(window.location.href).origin+"/annonce/"+l.id+")")}`} target="_blank" rel="noopener" className="btn btw" style={{textDecoration:"none"}}>💬 WhatsApp</a>
              <button className="btn bto" onClick={handleContact}>✉️ Envoyer un message</button>
              {l.transaction_type!=="location"&&<button className="btn bty" onClick={()=>setShowSim(true)}>📊 Simuler la rentabilité</button>}
              <ShareBtn listing={l} showToast={showToast}/>
              <button className="btn" style={{background:"var(--bg)",color:"var(--tx)",border:"1.5px solid var(--br)",fontWeight:600,fontSize:12}} onClick={()=>onFav(l.id,!favIds.includes(l.id))}>
                {favIds.includes(l.id)?"❤️ Retirer des favoris":"🤍 Ajouter aux favoris"}
              </button>
              <div style={{fontSize:10,color:"var(--mu)",textAlign:"center"}}>👁 {l.views_count} vues · 📩 {l.contacts_count} contacts</div>
            </div>
          </div>
          {l.latitude&&<div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:13,marginTop:11}}>
            <div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:12,marginBottom:7}}>📍 Localisation</div>
            <div style={{background:"var(--bg)",borderRadius:8,height:120,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"var(--mu)",fontSize:11,gap:2}}>
              <span style={{fontSize:20}}>🗺️</span><span style={{fontWeight:700}}>{l.quartier}, {l.city}</span><span style={{fontSize:9}}>{l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}</span>
            </div>
          </div>}
        </div>
      </div>
      {similar.length>0&&(
        <div className="similar">
          <div className="sech" style={{marginBottom:18}}><h2 className="sectl">Annonces <span>similaires</span></h2></div>
          <div className="grid">{similar.map(s=><Card key={s.id} l={s} onClick={()=>onOpenListing(s)} favIds={favIds} onFav={onFav}/>)}</div>
        </div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════
// ADVANCED FILTER PANEL
// ══════════════════════════════════════════════════════════
function AdvFilters({filters,onChange,onReset}){
  const [open,setOpen]=useState(false);
  const active=filters.priceMin||filters.priceMax||filters.surfMin||filters.bedrooms;
  return(
    <div style={{marginBottom:14}}>
      <button className={`fbt ${active?"on":""}`} onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:5}}>
        🎚️ Filtres avancés {active&&"●"}
      </button>
      {open&&(
        <div className="advfil" style={{marginTop:8}}>
          <div className="advfilg">
            <div className="fg">
              <label className="fl">Prix min (FCFA)</label>
              <input className="fi" type="number" placeholder="0" value={filters.priceMin||""} onChange={e=>onChange("priceMin",e.target.value)}/>
            </div>
            <div className="fg">
              <label className="fl">Prix max (FCFA)</label>
              <input className="fi" type="number" placeholder="Illimité" value={filters.priceMax||""} onChange={e=>onChange("priceMax",e.target.value)}/>
            </div>
            <div className="fg">
              <label className="fl">Surface min (m²)</label>
              <input className="fi" type="number" placeholder="0" value={filters.surfMin||""} onChange={e=>onChange("surfMin",e.target.value)}/>
            </div>
            <div className="fg">
              <label className="fl">Chambres min</label>
              <select className="fi" value={filters.bedrooms||""} onChange={e=>onChange("bedrooms",e.target.value)}>
                <option value="">Tout</option>
                {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}+</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Document</label>
              <select className="fi" value={filters.docType||""} onChange={e=>onChange("docType",e.target.value)}>
                <option value="">Tout</option>
                {Object.entries(DOC).map(([v,{l}])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Région</label>
              <select className="fi" value={filters.region||""} onChange={e=>onChange("region",e.target.value)}>
                <option value="">Toutes</option>
                {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <button className="fbt" onClick={onReset} style={{marginTop:4}}>🗑 Réinitialiser les filtres</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// LISTING EDIT MODAL
// ══════════════════════════════════════════════════════════
function ListingEditModal({user,listing,onClose,onSaved}){
  const [form,setForm]=useState({title:listing.title||"",description:listing.description||"",price:String(listing.price||""),surface:String(listing.surface||""),rooms:String(listing.rooms||""),bedrooms:String(listing.bedrooms||""),bathrooms:String(listing.bathrooms||""),cover_image:listing.cover_image||"",quartier:listing.quartier||"",city:listing.city||"",is_negotiable:listing.is_negotiable||false,status:listing.status||"active"});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const [saving,setSaving]=useState(false),[err,setErr]=useState("");
  async function save(){
    setSaving(true);setErr("");
    const{error}=await sb.from("listings").update({
      title:form.title,description:form.description,
      price:parseInt(String(form.price).replace(/\D/g,""))||listing.price,
      surface:parseFloat(form.surface)||null,rooms:parseInt(form.rooms)||null,
      bedrooms:parseInt(form.bedrooms)||null,bathrooms:parseInt(form.bathrooms)||null,
      cover_image:form.cover_image,quartier:form.quartier,city:form.city,
      is_negotiable:form.is_negotiable,status:form.status,updated_at:new Date().toISOString()
    }).eq("id",listing.id);
    setSaving(false);
    if(error){setErr(error.message);return;}
    onSaved({...listing,...form,price:parseInt(String(form.price).replace(/\D/g,""))||listing.price});
    onClose();
  }
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:500}}>
        <div className="mhd"><div className="mtit">✏️ Modifier l'annonce</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          {err&&<div className="al ale">❌ {err}</div>}
          <div className="fg"><label className="fl">Titre</label><input className="fi" value={form.title} onChange={e=>set("title",e.target.value)}/></div>
          <div className="fg"><label className="fl">Description</label><textarea className="fi" rows={3} value={form.description} onChange={e=>set("description",e.target.value)} style={{resize:"vertical"}}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <div className="fg"><label className="fl">Prix (FCFA)</label><input className="fi" value={form.price} onChange={e=>set("price",e.target.value)}/></div>
            <div className="fg"><label className="fl">Surface (m²)</label><input className="fi" type="number" value={form.surface} onChange={e=>set("surface",e.target.value)}/></div>
            <div className="fg"><label className="fl">Pièces</label><input className="fi" type="number" value={form.rooms} onChange={e=>set("rooms",e.target.value)}/></div>
            <div className="fg"><label className="fl">Chambres</label><input className="fi" type="number" value={form.bedrooms} onChange={e=>set("bedrooms",e.target.value)}/></div>
          </div>
          <div className="fg"><label className="fl">URL photo</label><input className="fi" value={form.cover_image} onChange={e=>set("cover_image",e.target.value)}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <div className="fg"><label className="fl">Quartier</label><input className="fi" value={form.quartier} onChange={e=>set("quartier",e.target.value)}/></div>
            <div className="fg"><label className="fl">Ville</label><input className="fi" value={form.city} onChange={e=>set("city",e.target.value)}/></div>
          </div>
          <div className="fg"><label className="fl">Statut</label>
            <select className="fi" value={form.status} onChange={e=>set("status",e.target.value)}>
              <option value="active">✅ Actif</option>
              <option value="pending">⏳ En attente</option>
              <option value="archived">📦 Archivé</option>
              <option value="sold">🤝 Vendu</option>
              <option value="rented">🔑 Loué</option>
            </select>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:13}}>
            <input type="checkbox" id="en" checked={form.is_negotiable} onChange={e=>set("is_negotiable",e.target.checked)} style={{width:14,height:14,cursor:"pointer"}}/><label htmlFor="en" style={{fontSize:13,cursor:"pointer"}}>Prix négociable</label>
          </div>
          <button className="fbt2 fbg" onClick={save} disabled={saving}>{saving?"Enregistrement...":"💾 Sauvegarder"}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════
// DASHBOARD PARTICULIER (default)
// ══════════════════════════════════════════════════════════
function ParticulierDash({user,profile,myList,convs,favIds,favListings,alerts,loading,onOpenListing,onShowAgency,showDT,setEditListing,setShowProfileEdit,toggleStatus,del,boost,toggleAlert,deleteAlert,setProfile,onFav}){
  const [tab,setTab]=useState("overview");
  const totV=myList.reduce((s,l)=>s+(l.views_count||0),0);
  const totC=myList.reduce((s,l)=>s+(l.contacts_count||0),0);
  const act=myList.filter(l=>l.status==="active").length;
  const unread=convs.filter(c=>c.last_message_at>new Date(Date.now()-3600000).toISOString()).length;
  const navs=[
    {k:"overview",i:"📊",l:"Tableau de bord"},
    {k:"listings",i:"🏠",l:`Mes annonces (${myList.length})`},
    {k:"messages",i:"💬",l:`Messages${unread>0?" ●":""}`},
    {k:"favorites",i:"❤️",l:`Favoris (${favIds.length})`},
    {k:"alerts",i:"🔔",l:`Alertes (${alerts.filter(a=>a.is_active).length})`},
    {k:"profile",i:"👤",l:"Mon profil"},
  ];
  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user}>
      {loading?<div className="ldr"><div className="spin"/></div>:(
        <>
          {tab==="overview"&&(
            <>
              <div className="dtit2">📊 Tableau de bord</div>
              <div className="kpig">
                {[["🏠",myList.length,"Total annonces"],["✅",act,"Actives"],["👁",totV.toLocaleString("fr"),"Vues"],["📩",totC,"Contacts"],["❤️",favIds.length,"Favoris"],["🔔",alerts.filter(a=>a.is_active).length,"Alertes actives"]].map(([ico,val,lbl])=>(
                  <div className="kpi" key={lbl}><div className="kpiic">{ico}</div><div className="kpiv">{val}</div><div className="kpil">{lbl}</div></div>
                ))}
              </div>
              {myList.length>0&&<PerformanceChart myList={myList}/>}
              <RecentListingsTable myList={myList} onOpenListing={onOpenListing} onViewAll={()=>setTab("listings")}/>
            </>
          )}
          {tab==="listings"&&<MyListingsTab myList={myList} onOpenListing={onOpenListing} setEditListing={setEditListing} toggleStatus={toggleStatus} del={del} boost={boost}/>}
          {tab==="messages"&&<MessagesTab convs={convs} onOpenListing={onOpenListing}/>}
          {tab==="favorites"&&<FavoritesTab favListings={favListings} favIds={favIds} onFav={onFav} onOpenListing={onOpenListing}/>}
          {tab==="alerts"&&<AlertsTab alerts={alerts} toggleAlert={toggleAlert} deleteAlert={deleteAlert}/>}
          {tab==="profile"&&<ProfileTab user={user} profile={profile} setShowProfileEdit={setShowProfileEdit} showDT={showDT}/>}
        </>
      )}
    </DashLayout>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD AGENT
// ══════════════════════════════════════════════════════════
function AgentDash({user,profile,myList,convs,loading,onOpenListing,showDT,setEditListing,setShowProfileEdit,toggleStatus,del,boost,setProfile}){
  const [tab,setTab]=useState("overview");
  const [agencyInfo,setAgencyInfo]=useState(null);
  const [agencyListings,setAgencyListings]=useState([]);
  const [showEditProfile,setShowEditProfile]=useState(false);
  const [agBio,setAgBio]=useState(profile.bio||"");
  const [agExp,setAgExp]=useState(profile.experience_years||0);
  const [agSpec,setAgSpec]=useState((profile.specialties||[]).join(", "));
  const [savingProfile,setSavingProfile]=useState(false);

  useEffect(()=>{
    if(profile.agency_id){
      sb.from("agencies").select("*").eq("id",profile.agency_id).single().then(({data})=>setAgencyInfo(data));
      sb.from("listings").select("*").eq("agency_id",profile.agency_id).order("created_at",{ascending:false}).limit(20).then(({data})=>setAgencyListings(data||[]));
    }
  },[profile.agency_id]);

  const totV=myList.reduce((s,l)=>s+(l.views_count||0),0);
  const totC=myList.reduce((s,l)=>s+(l.contacts_count||0),0);
  const act=myList.filter(l=>l.status==="active").length;
  const unread=convs.filter(c=>c.last_message_at>new Date(Date.now()-3600000).toISOString()).length;

  async function saveAgentProfile(){
    setSavingProfile(true);
    const specs=agSpec.split(",").map(s=>s.trim()).filter(Boolean);
    await sb.from("profiles").update({bio:agBio,experience_years:parseInt(agExp)||0,specialties:specs}).eq("id",user.id);
    setSavingProfile(false);
    setProfile(p=>({...p,bio:agBio,experience_years:parseInt(agExp)||0,specialties:specs}));
    showDT("✅ Profil agent mis à jour !");
    setShowEditProfile(false);
  }

  const navs=[
    {k:"overview",i:"📊",l:"Vue d'ensemble"},
    {k:"listings",i:"🏠",l:`Mes annonces (${myList.length})`},
    {k:"leads",i:"📩",l:`Leads (${convs.length})${unread>0?" ●":""}`},
    {k:"agency",i:"🏢",l:"Mon agence"},
    {k:"profile",i:"👤",l:"Mon profil"},
  ];

  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user} roleLabel="🏡 Agent immobilier">
      {loading?<div className="ldr"><div className="spin"/></div>:(
        <>
          {tab==="overview"&&(
            <>
              <div className="dtit2">📊 Performance Agent</div>
              <div className="kpig">
                {[["🏠",myList.length,"Mes annonces"],["✅",act,"Actives"],["👁",totV.toLocaleString("fr"),"Vues totales"],["📩",totC,"Contacts reçus"],["💬",convs.length,"Conversations"],["📅",profile.experience_years||0,"Ans d'exp."]].map(([ico,val,lbl])=>(
                  <div className="kpi" key={lbl}><div className="kpiic">{ico}</div><div className="kpiv">{val}</div><div className="kpil">{lbl}</div></div>
                ))}
              </div>
              {agencyInfo&&(
                <div className="dash-card" style={{marginBottom:16}}>
                  <div style={{display:"flex",gap:13,alignItems:"center"}}>
                    <div style={{width:48,height:48,borderRadius:10,background:"var(--g)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:20}}>{(agencyInfo.name||"A")[0]}</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{agencyInfo.name}</div>
                      <div style={{fontSize:11,color:"var(--mu)"}}>{agencyInfo.city} · Plan {agencyInfo.subscription_plan}</div>
                      {agencyInfo.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4}}>✅ Vérifiée</span>}
                    </div>
                  </div>
                </div>
              )}
              {myList.length>0&&<PerformanceChart myList={myList}/>}
              <RecentListingsTable myList={myList} onOpenListing={onOpenListing} onViewAll={()=>setTab("listings")}/>
            </>
          )}
          {tab==="listings"&&<MyListingsTab myList={myList} onOpenListing={onOpenListing} setEditListing={setEditListing} toggleStatus={toggleStatus} del={del} boost={boost}/>}
          {tab==="leads"&&(
            <>
              <div className="dtit2">📩 Leads & Contacts ({convs.length})</div>
              {convs.length===0?(
                <div className="empty-state">
                  <div style={{fontSize:36,marginBottom:8}}>📩</div>
                  <div style={{fontWeight:700}}>Aucun lead pour l'instant</div>
                  <div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Les prospects qui contactent vos annonces apparaîtront ici.</div>
                </div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {convs.map((c,i)=>(
                    <div key={i} className="dash-card" style={{display:"flex",gap:12,alignItems:"center",cursor:"pointer"}} onClick={()=>c.listing_id&&onOpenListing({id:c.listing_id,...c.listings})}>
                      <div style={{width:44,height:36,borderRadius:7,overflow:"hidden",flexShrink:0,background:"var(--bg)"}}>
                        {c.listings&&c.listings.cover_image&&<img src={c.listings.cover_image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:12}}>{(c.listings&&c.listings.property_type&&PICO[c.listings.property_type])||"🏠"} {(c.listings&&c.listings.title)||"Annonce"}</div>
                        <div style={{fontSize:10,color:"var(--mu)"}}>Dernier message · {ago(c.last_message_at)}</div>
                      </div>
                      <span style={{fontSize:11,color:"var(--g)",fontWeight:700}}>→</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab==="agency"&&(
            <>
              <div className="dtit2">🏢 Mon agence</div>
              {!profile.agency_id?(
                <div className="empty-state">
                  <div style={{fontSize:36,marginBottom:8}}>🏢</div>
                  <div style={{fontWeight:700}}>Pas encore rattaché à une agence</div>
                  <div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Demandez à l'administrateur de votre agence de vous ajouter.</div>
                </div>
              ):agencyInfo?(
                <>
                  <div className="dash-card" style={{marginBottom:16}}>
                    <div style={{display:"flex",gap:13,alignItems:"center",marginBottom:14}}>
                      <div style={{width:56,height:56,borderRadius:12,background:"var(--g)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:24}}>{(agencyInfo.name||"A")[0]}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:16,display:"flex",alignItems:"center",gap:6}}>{agencyInfo.name}{agencyInfo.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4}}>✅ Vérifiée</span>}</div>
                        <div style={{fontSize:11,color:"var(--mu)"}}>{agencyInfo.city}</div>
                        <div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>Plan : <strong>{agencyInfo.subscription_plan}</strong></div>
                      </div>
                    </div>
                    {[["📧",agencyInfo.email||"—"],["📱",agencyInfo.phone||"—"],["💬",agencyInfo.whatsapp||"—"],["📍",agencyInfo.address||"—"]].map(([ico,val])=>(
                      <div key={ico} style={{display:"flex",gap:8,padding:"7px 0",borderBottom:"1px solid var(--br)",fontSize:12}}><span>{ico}</span><span style={{color:"var(--mu)"}}>{val}</span></div>
                    ))}
                    {agencyInfo.description&&<p style={{fontSize:12,color:"var(--mu)",marginTop:10,lineHeight:1.5}}>{agencyInfo.description}</p>}
                  </div>
                  <div className="dtit2" style={{marginTop:14}}>🏠 Annonces de l'agence ({agencyListings.length})</div>
                  {agencyListings.length>0&&(
                    <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                      <table className="dtbl" style={{minWidth:480}}>
                        <thead><tr><th>Bien</th><th>Prix</th><th>Statut</th><th>Vues</th></tr></thead>
                        <tbody>
                          {agencyListings.slice(0,10).map(l=>(
                            <tr key={l.id} style={{cursor:"pointer"}} onClick={()=>onOpenListing(l)}>
                              <td><div style={{fontWeight:600,fontSize:11}}>{PICO[l.property_type]} {(l.title||"").slice(0,24)}</div><div style={{fontSize:9,color:"var(--mu)"}}>📍 {l.quartier}</div></td>
                              <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)"}}>{fmt(l.price)}</td>
                              <td><span className="sdot"><span className={`dot ${l.status==="active"?"dg":l.status==="archived"?"dr":"dy"}`}/>{l.status}</span></td>
                              <td style={{fontSize:11,color:"var(--mu)"}}>👁 {l.views_count||0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ):<div className="ldr"><div className="spin"/></div>}
            </>
          )}
          {tab==="profile"&&(
            <>
              <div className="dtit2">👤 Mon profil agent</div>
              <div className="dash-card" style={{maxWidth:520}}>
                <div style={{display:"flex",gap:13,alignItems:"center",marginBottom:16}}>
                  <div className="dav" style={{width:56,height:56,fontSize:20,margin:0}}>{(profile.full_name||user.email||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)}</div>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{profile.full_name||"—"}</div>
                    <div style={{fontSize:11,color:"var(--mu)"}}>{user.email}</div>
                    <span className="drole">🏡 Agent immobilier</span>
                  </div>
                </div>
                {!showEditProfile?(
                  <>
                    {[["📧 Email",user.email],["📱 Téléphone",profile.phone||"Non renseigné"],["💬 WhatsApp",profile.whatsapp||"Non renseigné"],["📝 Bio",profile.bio||"Non renseigné"],["🎯 Spécialités",(profile.specialties||[]).join(", ")||"Non renseigné"],["📅 Expérience",(profile.experience_years||0)+" ans"]].map(([k,v])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--br)",fontSize:12,gap:10,flexWrap:"wrap"}}><span style={{color:"var(--mu)",fontWeight:600,flexShrink:0}}>{k}</span><span style={{fontWeight:700,textAlign:"right"}}>{v}</span></div>
                    ))}
                    <div style={{display:"flex",gap:8,marginTop:14}}>
                      <button className="fbt2 fbg" style={{flex:1}} onClick={()=>{setAgBio(profile.bio||"");setAgExp(profile.experience_years||0);setAgSpec((profile.specialties||[]).join(", "));setShowEditProfile(true);}}>✏️ Modifier</button>
                      <button className="fbt2 fbo" style={{flex:1}} onClick={()=>setShowProfileEdit(true)}>👤 Profil général</button>
                    </div>
                  </>
                ):(
                  <>
                    <div className="fg"><label className="fl">Bio professionnelle</label><textarea className="fi" rows={3} value={agBio} onChange={e=>setAgBio(e.target.value)} placeholder="Décrivez votre expertise..."/></div>
                    <div className="fg"><label className="fl">Années d'expérience</label><input className="fi" type="number" value={agExp} onChange={e=>setAgExp(e.target.value)} min={0} max={50}/></div>
                    <div className="fg"><label className="fl">Spécialités (séparées par virgules)</label><input className="fi" value={agSpec} onChange={e=>setAgSpec(e.target.value)} placeholder="Vente, Location, Terrains..."/></div>
                    <div style={{display:"flex",gap:8,marginTop:10}}>
                      <button className="fbt2 fbg" style={{flex:1}} onClick={saveAgentProfile} disabled={savingProfile}>{savingProfile?"Enregistrement...":"💾 Sauvegarder"}</button>
                      <button className="fbt2 fbo" style={{flex:1}} onClick={()=>setShowEditProfile(false)}>Annuler</button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </DashLayout>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD AGENCE
// ══════════════════════════════════════════════════════════
function AgenceDash({user,profile,myList,loading,onOpenListing,showDT,setEditListing,setShowProfileEdit,toggleStatus,del,boost,setProfile}){
  const [tab,setTab]=useState("overview");
  const [agencyInfo,setAgencyInfo]=useState(null);
  const [agents,setAgents]=useState([]);
  const [allListings,setAllListings]=useState([]);
  const [reviews,setReviews]=useState([]);
  const [editingAgency,setEditingAgency]=useState(false);
  const [agForm,setAgForm]=useState({});
  const [savingAg,setSavingAg]=useState(false);
  const [agLoading,setAgLoading]=useState(true);

  useEffect(()=>{loadAgency();},[]);
  async function loadAgency(){
    setAgLoading(true);
    const agId=profile.agency_id;
    if(!agId){setAgLoading(false);return;}
    const[{data:ag},{data:ags},{data:ls},{data:rv}]=await Promise.all([
      sb.from("agencies").select("*").eq("id",agId).single(),
      sb.from("profiles").select("*").eq("agency_id",agId).neq("id",user.id),
      sb.from("listings").select("*").eq("agency_id",agId).order("created_at",{ascending:false}),
      sb.from("reviews").select("*").eq("agency_id",agId).order("created_at",{ascending:false}),
    ]);
    if(ag){setAgencyInfo(ag);setAgForm({name:ag.name||"",email:ag.email||"",phone:ag.phone||"",whatsapp:ag.whatsapp||"",address:ag.address||"",description:ag.description||""});}
    if(ags)setAgents(ags);
    if(ls)setAllListings(ls);
    if(rv)setReviews(rv);
    setAgLoading(false);
  }

  async function saveAgency(){
    setSavingAg(true);
    const{error}=await sb.from("agencies").update(agForm).eq("id",profile.agency_id);
    setSavingAg(false);
    if(error){showDT("❌ "+error.message,"err");return;}
    setAgencyInfo(a=>({...a,...agForm}));
    showDT("✅ Informations agence mises à jour !");
    setEditingAgency(false);
  }

  const totV=allListings.reduce((s,l)=>s+(l.views_count||0),0);
  const totC=allListings.reduce((s,l)=>s+(l.contacts_count||0),0);
  const act=allListings.filter(l=>l.status==="active").length;
  const avgRating=reviews.length>0?(reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1):null;
  const PLANS={free:{l:"Gratuit",c:"#94a3b8"},basic:{l:"Basic",c:"#3b82f6"},premium:{l:"Premium",c:"#f59e0b"},vip:{l:"VIP",c:"#0a5c36"}};

  const navs=[
    {k:"overview",i:"📊",l:"Vue d'ensemble"},
    {k:"listings",i:"🏠",l:`Annonces (${allListings.length})`},
    {k:"team",i:"👥",l:`Équipe (${agents.length+1})`},
    {k:"reviews",i:"⭐",l:`Avis (${reviews.length})`},
    {k:"agency_profile",i:"🏢",l:"Profil agence"},
    {k:"profile",i:"👤",l:"Mon compte"},
  ];

  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user} roleLabel="🏢 Agence">
      {agLoading?<div className="ldr"><div className="spin"/></div>:!profile.agency_id?(
        <div className="empty-state">
          <div style={{fontSize:40,marginBottom:10}}>🏢</div>
          <div style={{fontWeight:700,fontSize:15}}>Aucune agence associée</div>
          <div style={{fontSize:12,color:"var(--mu)",marginTop:5}}>Contactez l'administrateur pour créer ou associer votre agence.</div>
        </div>
      ):(
        <>
          {tab==="overview"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
                <div style={{width:52,height:52,borderRadius:12,background:agencyInfo&&PLANS[agencyInfo.subscription_plan]?PLANS[agencyInfo.subscription_plan].c:"var(--g)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:22}}>{(agencyInfo&&agencyInfo.name||"A")[0]}</div>
                <div>
                  <div style={{fontWeight:800,fontSize:17,display:"flex",alignItems:"center",gap:7}}>{agencyInfo&&agencyInfo.name}{agencyInfo&&agencyInfo.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4}}>✅ Vérifiée</span>}</div>
                  {agencyInfo&&<span style={{background:PLANS[agencyInfo.subscription_plan]?PLANS[agencyInfo.subscription_plan].c:"var(--g)",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:100}}>Plan {agencyInfo.subscription_plan&&PLANS[agencyInfo.subscription_plan]?PLANS[agencyInfo.subscription_plan].l:agencyInfo.subscription_plan}</span>}
                </div>
              </div>
              <div className="kpig">
                {[["🏠",allListings.length,"Annonces"],["✅",act,"Actives"],["👁",totV.toLocaleString("fr"),"Vues"],["📩",totC,"Contacts"],["👥",agents.length+1,"Agents"],["⭐",avgRating||"—","Note moy."]].map(([ico,val,lbl])=>(
                  <div className="kpi" key={lbl}><div className="kpiic">{ico}</div><div className="kpiv">{val}</div><div className="kpil">{lbl}</div></div>
                ))}
              </div>
              {allListings.length>0&&<PerformanceChart myList={allListings}/>}
              <RecentListingsTable myList={allListings} onOpenListing={onOpenListing} onViewAll={()=>setTab("listings")} title="Dernières annonces de l'agence"/>
            </>
          )}
          {tab==="listings"&&(
            <>
              <div className="dtit2">🏠 Toutes les annonces de l'agence ({allListings.length})</div>
              {allListings.length===0?<div className="empty-state"><div style={{fontSize:32}}>🏠</div><div style={{fontWeight:700,marginTop:8}}>Aucune annonce publiée</div></div>:(
                <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                  <table className="dtbl" style={{minWidth:580}}>
                    <thead><tr><th>Bien</th><th>Prix</th><th>Statut</th><th>Boost</th><th>Vues</th><th>Actions</th></tr></thead>
                    <tbody>{allListings.map(l=>(
                      <tr key={l.id}>
                        <td><div style={{display:"flex",gap:7,alignItems:"center"}}><img src={l.cover_image||""} alt="" style={{width:38,height:30,borderRadius:4,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/><div><div style={{fontWeight:600,fontSize:11}}>{PICO[l.property_type]} {(l.title||"").slice(0,22)}</div><div style={{fontSize:9,color:"var(--mu)"}}>📍 {l.quartier}</div></div></div></td>
                        <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)"}}>{fmt(l.price)}</td>
                        <td><span className="sdot"><span className={`dot ${l.status==="active"?"dg":l.status==="archived"?"dr":"dy"}`}/>{l.status}</span></td>
                        <td>{l.is_premium?<span className="boost-badge">⭐ Premium</span>:<button className="ab abe" onClick={()=>boost(l.id)}>🚀 Boost</button>}</td>
                        <td style={{fontSize:11,color:"var(--mu)"}}>👁 {l.views_count||0}</td>
                        <td><div className="abtns">
                          <button className="ab abv" onClick={()=>onOpenListing(l)} title="Voir">👁</button>
                          <button className="ab abe" onClick={()=>setEditListing(l)} title="Modifier">✏️</button>
                          <button className="ab abe" onClick={()=>toggleStatus(l.id,l.status)}>{l.status==="active"?"⏸":"▶"}</button>
                          <button className="ab abd" onClick={()=>del(l.id)}>🗑</button>
                        </div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {tab==="team"&&(
            <>
              <div className="dtit2">👥 Équipe ({agents.length+1} membres)</div>
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                <div className="dash-card" style={{display:"flex",gap:12,alignItems:"center"}}>
                  <div className="dav" style={{width:44,height:44,fontSize:15,margin:0,flexShrink:0}}>{(profile.full_name||user.email||"?")[0].toUpperCase()}</div>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13}}>{profile.full_name||user.email}</div><div style={{fontSize:10,color:"var(--mu)"}}>{user.email}</div></div>
                  <span style={{background:"var(--gl)",color:"var(--g)",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:100}}>🏢 Responsable</span>
                </div>
                {agents.map(ag=>(
                  <div key={ag.id} className="dash-card" style={{display:"flex",gap:12,alignItems:"center"}}>
                    <div className="dav" style={{width:44,height:44,fontSize:15,margin:0,flexShrink:0}}>{(ag.full_name||ag.id||"A")[0].toUpperCase()}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{ag.full_name||"Agent"}</div>
                      <div style={{fontSize:10,color:"var(--mu)"}}>{ag.phone||"—"}</div>
                      {ag.bio&&<div style={{fontSize:10,color:"var(--mu)",marginTop:2,fontStyle:"italic"}}>{ag.bio.slice(0,60)}{ag.bio.length>60?"…":""}</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      {ag.experience_years>0&&<div style={{fontSize:10,color:"var(--mu)"}}>{ag.experience_years} ans exp.</div>}
                      {ag.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4}}>✅ Vérifié</span>}
                    </div>
                  </div>
                ))}
                {agents.length===0&&<div style={{textAlign:"center",padding:"20px",color:"var(--mu)",fontSize:12}}>Aucun agent rattaché encore. Les agents qui s'inscrivent et choisissent votre agence apparaîtront ici.</div>}
              </div>
            </>
          )}
          {tab==="reviews"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
                <div className="dtit2" style={{marginBottom:0}}>⭐ Avis clients ({reviews.length})</div>
                {avgRating&&<div style={{background:"#fef3c7",border:"1px solid #f59e0b",borderRadius:8,padding:"5px 12px",fontSize:13,fontWeight:800,color:"#92400e"}}>⭐ {avgRating}/5</div>}
              </div>
              {reviews.length===0?(
                <div className="empty-state"><div style={{fontSize:36}}>⭐</div><div style={{fontWeight:700,marginTop:8}}>Aucun avis pour l'instant</div><div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Les avis de vos clients apparaîtront ici.</div></div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {reviews.map(r=>(
                    <div key={r.id} className="dash-card">
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <Stars n={r.rating}/>
                        <span style={{fontSize:10,color:"var(--mu)"}}>{ago(r.created_at)}</span>
                      </div>
                      {r.comment&&<p style={{fontSize:12,color:"var(--tx)",lineHeight:1.5,margin:0}}>{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab==="agency_profile"&&(
            <>
              <div className="dtit2">🏢 Profil agence</div>
              <div className="dash-card" style={{maxWidth:540}}>
                {!editingAgency?(
                  <>
                    {[["🏷️ Nom",agencyInfo&&agencyInfo.name],["📧 Email",agencyInfo&&agencyInfo.email||"—"],["📱 Téléphone",agencyInfo&&agencyInfo.phone||"—"],["💬 WhatsApp",agencyInfo&&agencyInfo.whatsapp||"—"],["📍 Adresse",agencyInfo&&agencyInfo.address||"—"],["📝 Description",agencyInfo&&agencyInfo.description||"—"],["💎 Plan",agencyInfo&&agencyInfo.subscription_plan],["✅ Vérifiée",agencyInfo&&agencyInfo.is_verified?"Oui":"En attente"]].map(([k,v])=>(
                      <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--br)",fontSize:12,gap:10,flexWrap:"wrap"}}><span style={{color:"var(--mu)",fontWeight:600,flexShrink:0}}>{k}</span><span style={{fontWeight:700,textAlign:"right"}}>{v}</span></div>
                    ))}
                    <button className="fbt2 fbg" style={{marginTop:14,width:"100%"}} onClick={()=>setEditingAgency(true)}>✏️ Modifier les informations</button>
                    {agencyInfo&&!agencyInfo.is_verified&&<div className="al awi" style={{marginTop:10}}>⚠️ Votre agence est en attente de vérification. Nous vous contacterons sous 48h.</div>}
                  </>
                ):(
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Nom de l'agence</label><input className="fi" value={agForm.name||""} onChange={e=>setAgForm(f=>({...f,name:e.target.value}))}/></div>
                      <div className="fg"><label className="fl">Email</label><input className="fi" type="email" value={agForm.email||""} onChange={e=>setAgForm(f=>({...f,email:e.target.value}))}/></div>
                      <div className="fg"><label className="fl">Téléphone</label><input className="fi" value={agForm.phone||""} onChange={e=>setAgForm(f=>({...f,phone:e.target.value}))}/></div>
                      <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">WhatsApp</label><input className="fi" value={agForm.whatsapp||""} onChange={e=>setAgForm(f=>({...f,whatsapp:e.target.value}))}/></div>
                      <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Adresse</label><input className="fi" value={agForm.address||""} onChange={e=>setAgForm(f=>({...f,address:e.target.value}))}/></div>
                      <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Description</label><textarea className="fi" rows={3} value={agForm.description||""} onChange={e=>setAgForm(f=>({...f,description:e.target.value}))}/></div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:12}}>
                      <button className="fbt2 fbg" style={{flex:1}} onClick={saveAgency} disabled={savingAg}>{savingAg?"Sauvegarde...":"💾 Sauvegarder"}</button>
                      <button className="fbt2 fbo" style={{flex:1}} onClick={()=>setEditingAgency(false)}>Annuler</button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {tab==="profile"&&<ProfileTab user={user} profile={profile} setShowProfileEdit={setShowProfileEdit} showDT={showDT}/>}
        </>
      )}
    </DashLayout>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD PROMOTEUR
// ══════════════════════════════════════════════════════════
const PIPELINE_STEPS=["nouveau","contacte","visite","offre","signe","perdu"];
const PIPELINE_LABELS={nouveau:"🆕 Nouveau",contacte:"📞 Contacté",visite:"🏠 Visite",offre:"📋 Offre",signe:"✅ Signé",perdu:"❌ Perdu"};
const PIPELINE_COLORS={nouveau:"#3b82f6",contacte:"#f59e0b",visite:"#8b5cf6",offre:"#06b6d4",signe:"#16a34a",perdu:"#dc2626"};
const PROJECT_STATUS={etude:{l:"🔍 Étude",c:"#6b7280"},construction:{l:"🏗️ Construction",c:"#f59e0b"},commercialisation:{l:"🚀 Commercialisation",c:"#3b82f6"},livre:{l:"✅ Livré",c:"#16a34a"},archive:{l:"📦 Archivé",c:"#94a3b8"}};

function PromoteurDash({user,profile,loading,onOpenListing,showDT,setShowProfileEdit}){
  const [tab,setTab]=useState("overview");
  const [promoteurInfo,setPromoteurInfo]=useState(null);
  const [projects,setProjects]=useState([]);
  const [leads,setLeads]=useState([]);
  const [pLoading,setPLoading]=useState(true);
  const [editingProj,setEditingProj]=useState(null);
  const [showNewProj,setShowNewProj]=useState(false);
  const [editingPromoteur,setEditingPromoteur]=useState(false);
  const [pForm,setPForm]=useState({});
  const [savingP,setSavingP]=useState(false);
  const [newProj,setNewProj]=useState({name:"",description:"",city:"Dakar",quartier:"",total_lots:0,lots_available:0,price_from:0,price_to:0,status:"commercialisation",delivery_date:""});
  const [savingProj,setSavingProj]=useState(false);
  const [filterStatus,setFilterStatus]=useState("all");

  useEffect(()=>{loadPromoteur();},[]);
  async function loadPromoteur(){
    setPLoading(true);
    const[{data:pr},{data:pj},{data:ld}]=await Promise.all([
      sb.from("promoteurs").select("*").eq("owner_id",user.id).single(),
      sb.from("projects").select("*").eq("owner_id",user.id).order("created_at",{ascending:false}),
      sb.from("project_leads").select("*,projects(name)").eq("promoteur_id",user.id).order("created_at",{ascending:false}),
    ]);
    if(pr){setPromoteurInfo(pr);setPForm({name:pr.name||"",email:pr.email||"",phone:pr.phone||"",whatsapp:pr.whatsapp||"",address:pr.address||"",description:pr.description||""});}
    if(pj)setProjects(pj);
    if(ld)setLeads(ld);
    setPLoading(false);
  }

  async function saveProject(){
    setSavingProj(true);
    if(editingProj){
      await sb.from("projects").update(newProj).eq("id",editingProj.id);
      setProjects(ps=>ps.map(p=>p.id===editingProj.id?{...p,...newProj}:p));
      showDT("✅ Projet mis à jour !");
    } else {
      const{data}=await sb.from("projects").insert([{...newProj,owner_id:user.id,promoteur_id:promoteurInfo&&promoteurInfo.id}]).select().single();
      if(data)setProjects(ps=>[data,...ps]);
      showDT("✅ Projet créé !");
    }
    setSavingProj(false);
    setShowNewProj(false);
    setEditingProj(null);
    setNewProj({name:"",description:"",city:"Dakar",quartier:"",total_lots:0,lots_available:0,price_from:0,price_to:0,status:"commercialisation",delivery_date:""});
  }

  async function deleteProject(id){
    if(!confirm("Supprimer ce projet ?"))return;
    await sb.from("projects").delete().eq("id",id);
    setProjects(ps=>ps.filter(p=>p.id!==id));
    showDT("🗑 Projet supprimé");
  }

  async function updateLeadStatus(id,status){
    await sb.from("project_leads").update({status}).eq("id",id);
    setLeads(ls=>ls.map(l=>l.id===id?{...l,status}:l));
    showDT("✅ Statut mis à jour");
  }

  async function savePromoteur(){
    setSavingP(true);
    const{error}=await sb.from("promoteurs").update(pForm).eq("id",promoteurInfo&&promoteurInfo.id);
    setSavingP(false);
    if(error){showDT("❌ "+error.message,"err");return;}
    setPromoteurInfo(p=>({...p,...pForm}));
    showDT("✅ Informations mises à jour !");
    setEditingPromoteur(false);
  }

  const totProjects=projects.length;
  const totLots=projects.reduce((s,p)=>s+p.total_lots,0);
  const totAvail=projects.reduce((s,p)=>s+p.lots_available,0);
  const totLeads=leads.length;
  const totSigned=leads.filter(l=>l.status==="signe").length;
  const totViews=projects.reduce((s,p)=>s+p.views_count,0);

  const navs=[
    {k:"overview",i:"📊",l:"Vue d'ensemble"},
    {k:"projects",i:"🏗️",l:`Projets (${projects.length})`},
    {k:"crm",i:"📩",l:`CRM Leads (${leads.length})`},
    {k:"company",i:"🏛️",l:"Mon entreprise"},
    {k:"profile",i:"👤",l:"Mon compte"},
  ];

  const filteredLeads=filterStatus==="all"?leads:leads.filter(l=>l.status===filterStatus);

  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user} roleLabel="🏗️ Promoteur">
      {pLoading?<div className="ldr"><div className="spin"/></div>:(
        <>
          {tab==="overview"&&(
            <>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
                {promoteurInfo&&(
                  <>
                    <div style={{width:52,height:52,borderRadius:12,background:"var(--nv)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:22}}>{(promoteurInfo.name||"P")[0]}</div>
                    <div>
                      <div style={{fontWeight:800,fontSize:16,display:"flex",alignItems:"center",gap:7}}>{promoteurInfo.name}{promoteurInfo.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4}}>✅ Vérifié</span>}</div>
                      <div style={{fontSize:11,color:"var(--mu)"}}>{promoteurInfo.city}</div>
                    </div>
                  </>
                )}
              </div>
              <div className="kpig">
                {[["🏗️",totProjects,"Projets"],["🏘️",totLots,"Lots totaux"],["🟢",totAvail,"Lots disponibles"],["📩",totLeads,"Leads"],["✅",totSigned,"Signés"],["👁",totViews,"Vues totales"]].map(([ico,val,lbl])=>(
                  <div className="kpi" key={lbl}><div className="kpiic">{ico}</div><div className="kpiv">{val}</div><div className="kpil">{lbl}</div></div>
                ))}
              </div>
              <div className="dtit2" style={{marginTop:10}}>🏗️ Projets récents</div>
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {projects.slice(0,3).map(p=>(
                  <div key={p.id} className="dash-card" style={{display:"flex",gap:12,alignItems:"center",cursor:"pointer"}} onClick={()=>setTab("projects")}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                        <span style={{fontWeight:700,fontSize:13}}>{p.name}</span>
                        <span style={{background:PROJECT_STATUS[p.status]?PROJECT_STATUS[p.status].c:"#ccc",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>{PROJECT_STATUS[p.status]?PROJECT_STATUS[p.status].l:p.status}</span>
                      </div>
                      <div style={{fontSize:10,color:"var(--mu)"}}>📍 {p.quartier}, {p.city} · {p.lots_available}/{p.total_lots} lots disponibles</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:14,color:"var(--g)"}}>{fmt(p.price_from)}</div>
                      <div style={{fontSize:9,color:"var(--mu)"}}>dès</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab==="projects"&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div className="dtit2" style={{marginBottom:0}}>🏗️ Mes projets immobiliers</div>
                <button className="fbt2 fbg" style={{padding:"8px 16px"}} onClick={()=>{setEditingProj(null);setNewProj({name:"",description:"",city:"Dakar",quartier:"",total_lots:0,lots_available:0,price_from:0,price_to:0,status:"commercialisation",delivery_date:""});setShowNewProj(true);}}>+ Nouveau projet</button>
              </div>
              {showNewProj&&(
                <div className="dash-card" style={{marginBottom:16,background:"#f0fdf4",border:"1px solid #86efac"}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:"#16a34a"}}>{editingProj?"✏️ Modifier":"➕ Nouveau"} projet</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Nom du projet *</label><input className="fi" value={newProj.name} onChange={e=>setNewProj(p=>({...p,name:e.target.value}))} placeholder="Résidence Les Palmiers"/></div>
                    <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Description</label><textarea className="fi" rows={2} value={newProj.description} onChange={e=>setNewProj(p=>({...p,description:e.target.value}))}/></div>
                    <div className="fg"><label className="fl">Ville</label><input className="fi" value={newProj.city} onChange={e=>setNewProj(p=>({...p,city:e.target.value}))}/></div>
                    <div className="fg"><label className="fl">Quartier</label><input className="fi" value={newProj.quartier} onChange={e=>setNewProj(p=>({...p,quartier:e.target.value}))}/></div>
                    <div className="fg"><label className="fl">Total lots</label><input className="fi" type="number" value={newProj.total_lots} onChange={e=>setNewProj(p=>({...p,total_lots:parseInt(e.target.value)||0}))}/></div>
                    <div className="fg"><label className="fl">Lots disponibles</label><input className="fi" type="number" value={newProj.lots_available} onChange={e=>setNewProj(p=>({...p,lots_available:parseInt(e.target.value)||0}))}/></div>
                    <div className="fg"><label className="fl">Prix dès (FCFA)</label><input className="fi" type="number" value={newProj.price_from} onChange={e=>setNewProj(p=>({...p,price_from:parseInt(e.target.value)||0}))}/></div>
                    <div className="fg"><label className="fl">Prix jusqu'à (FCFA)</label><input className="fi" type="number" value={newProj.price_to} onChange={e=>setNewProj(p=>({...p,price_to:parseInt(e.target.value)||0}))}/></div>
                    <div className="fg"><label className="fl">Statut</label>
                      <select className="fi" value={newProj.status} onChange={e=>setNewProj(p=>({...p,status:e.target.value}))}>
                        {Object.entries(PROJECT_STATUS).map(([v,{l}])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div className="fg"><label className="fl">Livraison prévue</label><input className="fi" value={newProj.delivery_date} onChange={e=>setNewProj(p=>({...p,delivery_date:e.target.value}))} placeholder="T4 2026"/></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:12}}>
                    <button className="fbt2 fbg" style={{flex:1}} onClick={saveProject} disabled={savingProj||!newProj.name}>{savingProj?"Sauvegarde...":"💾 Sauvegarder"}</button>
                    <button className="fbt2 fbo" style={{flex:1}} onClick={()=>{setShowNewProj(false);setEditingProj(null);}}>Annuler</button>
                  </div>
                </div>
              )}
              {projects.length===0&&!showNewProj?<div className="empty-state"><div style={{fontSize:40}}>🏗️</div><div style={{fontWeight:700,marginTop:8}}>Aucun projet encore</div><div style={{fontSize:12,color:"var(--mu)",marginTop:4}}>Cliquez "+ Nouveau projet" pour commencer.</div></div>:(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {projects.map(p=>(
                    <div key={p.id} className="dash-card">
                      <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                        {p.cover_image&&<img src={p.cover_image} alt="" style={{width:72,height:56,borderRadius:8,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/>}
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                            <span style={{fontWeight:700,fontSize:14}}>{p.name}</span>
                            <span style={{background:PROJECT_STATUS[p.status]?PROJECT_STATUS[p.status].c:"#ccc",color:"#fff",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>{PROJECT_STATUS[p.status]?PROJECT_STATUS[p.status].l:p.status}</span>
                            {p.delivery_date&&<span style={{fontSize:10,color:"var(--mu)"}}>Livraison: {p.delivery_date}</span>}
                          </div>
                          <div style={{fontSize:11,color:"var(--mu)",marginBottom:6}}>📍 {p.quartier&&p.quartier+", "}{p.city}</div>
                          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                            {[["🏘️",`${p.lots_available}/${p.total_lots} lots`],["💰",`${fmt(p.price_from)} — ${fmt(p.price_to)}`],["👁",`${p.views_count||0} vues`],["📩",`${p.leads_count||0} leads`]].map(([ico,val])=>(
                              <span key={ico} style={{fontSize:10,color:"var(--mu)"}}>{ico} {val}</span>
                            ))}
                          </div>
                        </div>
                        <div className="abtns">
                          <button className="ab abe" onClick={()=>{setEditingProj(p);setNewProj({name:p.name,description:p.description||"",city:p.city,quartier:p.quartier||"",total_lots:p.total_lots,lots_available:p.lots_available,price_from:p.price_from,price_to:p.price_to,status:p.status,delivery_date:p.delivery_date||""});setShowNewProj(true);}}>✏️</button>
                          <button className="ab abd" onClick={()=>deleteProject(p.id)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab==="crm"&&(
            <>
              <div className="dtit2">📩 CRM — Pipeline Leads ({leads.length})</div>
              <div className="al awi" style={{marginBottom:14}}>💡 Suivez vos prospects du premier contact jusqu'à la signature.</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {[["all","Tous"],["nouveau","Nouveaux"],["contacte","Contactés"],["visite","Visites"],["offre","Offres"],["signe","Signés"],["perdu","Perdus"]].map(([v,l])=>(
                  <button key={v} className={`fbt ${filterStatus===v?"on":""}`} onClick={()=>setFilterStatus(v)} style={{fontSize:10}}>{v!=="all"&&PIPELINE_LABELS[v]?PIPELINE_LABELS[v]:l} {v!=="all"?`(${leads.filter(ld=>ld.status===v).length})`:""}</button>
                ))}
              </div>
              {filteredLeads.length===0?<div className="empty-state"><div style={{fontSize:36}}>📩</div><div style={{fontWeight:700,marginTop:8}}>Aucun lead {filterStatus!=="all"?`"${filterStatus}"`:""}</div></div>:(
                <div style={{display:"flex",flexDirection:"column",gap:9}}>
                  {filteredLeads.map(lead=>(
                    <div key={lead.id} className="dash-card">
                      <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                        <div style={{width:40,height:40,borderRadius:9,background:PIPELINE_COLORS[lead.status]||"#ccc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{PIPELINE_LABELS[lead.status]?PIPELINE_LABELS[lead.status].slice(0,2):"📩"}</div>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontWeight:700,fontSize:13}}>{lead.name||"Prospect"}</div>
                          <div style={{fontSize:10,color:"var(--mu)"}}>{lead.email||""}{lead.phone&&" · "+lead.phone}</div>
                          {lead.projects&&<div style={{fontSize:10,color:"var(--g)",marginTop:2}}>🏗️ {lead.projects.name}</div>}
                          {lead.message&&<div style={{fontSize:10,color:"var(--mu)",marginTop:4,fontStyle:"italic"}}>"{lead.message.slice(0,80)}{lead.message.length>80?"…":""}"</div>}
                          {lead.budget>0&&<div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>Budget: {fmt(lead.budget)}</div>}
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                          <span style={{fontSize:9,color:"var(--mu)"}}>{ago(lead.created_at)}</span>
                          <select style={{fontSize:10,padding:"3px 6px",border:"1px solid var(--br)",borderRadius:6,background:"#fff",cursor:"pointer",fontWeight:700,color:PIPELINE_COLORS[lead.status]||"#333"}} value={lead.status} onChange={e=>updateLeadStatus(lead.id,e.target.value)}>
                            {PIPELINE_STEPS.map(s=><option key={s} value={s}>{PIPELINE_LABELS[s]}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {tab==="company"&&(
            <>
              <div className="dtit2">🏛️ Mon entreprise</div>
              {!promoteurInfo?(
                <div className="empty-state"><div style={{fontSize:36}}>🏛️</div><div style={{fontWeight:700,marginTop:8}}>Aucun profil promoteur</div><div style={{fontSize:12,color:"var(--mu)",marginTop:4}}>Contactez l'administrateur pour créer votre profil promoteur.</div></div>
              ):(
                <div className="dash-card" style={{maxWidth:520}}>
                  {!editingPromoteur?(
                    <>
                      {[["🏷️ Nom",promoteurInfo.name],["📧 Email",promoteurInfo.email||"—"],["📱 Téléphone",promoteurInfo.phone||"—"],["💬 WhatsApp",promoteurInfo.whatsapp||"—"],["📍 Adresse",promoteurInfo.address||"—"],["🌐 Site web",promoteurInfo.website||"—"],["✅ Vérifié",promoteurInfo.is_verified?"Oui":"En attente"]].map(([k,v])=>(
                        <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--br)",fontSize:12,gap:10,flexWrap:"wrap"}}><span style={{color:"var(--mu)",fontWeight:600}}>{k}</span><span style={{fontWeight:700,textAlign:"right"}}>{v}</span></div>
                      ))}
                      <button className="fbt2 fbg" style={{marginTop:14,width:"100%"}} onClick={()=>setEditingPromoteur(true)}>✏️ Modifier</button>
                      {!promoteurInfo.is_verified&&<div className="al awi" style={{marginTop:10}}>⚠️ En attente de vérification par nos équipes.</div>}
                    </>
                  ):(
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Nom de l'entreprise</label><input className="fi" value={pForm.name||""} onChange={e=>setPForm(f=>({...f,name:e.target.value}))}/></div>
                        <div className="fg"><label className="fl">Email</label><input className="fi" type="email" value={pForm.email||""} onChange={e=>setPForm(f=>({...f,email:e.target.value}))}/></div>
                        <div className="fg"><label className="fl">Téléphone</label><input className="fi" value={pForm.phone||""} onChange={e=>setPForm(f=>({...f,phone:e.target.value}))}/></div>
                        <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">WhatsApp</label><input className="fi" value={pForm.whatsapp||""} onChange={e=>setPForm(f=>({...f,whatsapp:e.target.value}))}/></div>
                        <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Adresse</label><input className="fi" value={pForm.address||""} onChange={e=>setPForm(f=>({...f,address:e.target.value}))}/></div>
                        <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Description</label><textarea className="fi" rows={3} value={pForm.description||""} onChange={e=>setPForm(f=>({...f,description:e.target.value}))}/></div>
                      </div>
                      <div style={{display:"flex",gap:8,marginTop:12}}>
                        <button className="fbt2 fbg" style={{flex:1}} onClick={savePromoteur} disabled={savingP}>{savingP?"Sauvegarde...":"💾 Sauvegarder"}</button>
                        <button className="fbt2 fbo" style={{flex:1}} onClick={()=>setEditingPromoteur(false)}>Annuler</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {tab==="profile"&&<ProfileTab user={user} profile={profile} setShowProfileEdit={setShowProfileEdit} showDT={showDT}/>}
        </>
      )}
    </DashLayout>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD ADMIN
// ══════════════════════════════════════════════════════════
function AdminDash({user,profile,showDT}){
  const [tab,setTab]=useState("overview");
  const [stats,setStats]=useState(null);
  const [users,setUsers]=useState([]);
  const [allListings,setAllListings]=useState([]);
  const [agencies,setAgencies]=useState([]);
  const [promoteurs,setPromoteurs]=useState([]);
  const [adminLoading,setAdminLoading]=useState(true);
  const [userSearch,setUserSearch]=useState("");
  const [listingSearch,setListingSearch]=useState("");
  const [listingFilter,setListingFilter]=useState("all");

  useEffect(()=>{loadAdmin();},[]);
  async function loadAdmin(){
    setAdminLoading(true);
    const[{data:st},{data:us},{data:ls},{data:ag},{data:pr}]=await Promise.all([
      sb.from("admin_stats").select("*").single(),
      sb.from("profiles").select("id,full_name,phone,role,is_verified,created_at,email:id").order("created_at",{ascending:false}).limit(100),
      sb.from("listings").select("id,title,property_type,transaction_type,price,status,is_verified,is_featured,trust_score,quartier,city,created_at,views_count,owner_id").order("created_at",{ascending:false}).limit(100),
      sb.from("agencies").select("*").order("created_at",{ascending:false}),
      sb.from("promoteurs").select("*").order("created_at",{ascending:false}),
    ]);
    if(st)setStats(st);
    if(us)setUsers(us);
    if(ls)setAllListings(ls);
    if(ag)setAgencies(ag);
    if(pr)setPromoteurs(pr);
    setAdminLoading(false);
  }

  async function updateUserRole(id,role){
    const{error}=await sb.from("profiles").update({role}).eq("id",id);
    if(error){showDT("❌ "+error.message,"err");return;}
    setUsers(us=>us.map(u=>u.id===id?{...u,role}:u));
    showDT("✅ Rôle mis à jour");
  }
  async function verifyUser(id,val){
    await sb.from("profiles").update({is_verified:val}).eq("id",id);
    setUsers(us=>us.map(u=>u.id===id?{...u,is_verified:val}:u));
    showDT(val?"✅ Utilisateur vérifié":"Vérification retirée");
  }
  async function updateListingStatus(id,status){
    await sb.from("listings").update({status}).eq("id",id);
    setAllListings(ls=>ls.map(l=>l.id===id?{...l,status}:l));
    showDT("✅ Annonce mise à jour");
  }
  async function verifyListing(id,val){
    const ts=val?95:0;
    await sb.from("listings").update({is_verified:val,trust_score:ts}).eq("id",id);
    setAllListings(ls=>ls.map(l=>l.id===id?{...l,is_verified:val,trust_score:ts}:l));
    showDT(val?"✅ Annonce vérifiée":"Vérification retirée");
  }
  async function featureListing(id,val){
    await sb.from("listings").update({is_featured:val}).eq("id",id);
    setAllListings(ls=>ls.map(l=>l.id===id?{...l,is_featured:val}:l));
    showDT(val?"⭐ Annonce mise en avant":"Mise en avant retirée");
  }
  async function verifyAgency(id,val){
    await sb.from("agencies").update({is_verified:val}).eq("id",id);
    setAgencies(ag=>ag.map(a=>a.id===id?{...a,is_verified:val}:a));
    showDT(val?"✅ Agence vérifiée":"Vérification retirée");
  }
  async function updateAgencyPlan(id,plan){
    await sb.from("agencies").update({subscription_plan:plan}).eq("id",id);
    setAgencies(ag=>ag.map(a=>a.id===id?{...a,subscription_plan:plan}:a));
    showDT("✅ Plan mis à jour");
  }
  async function verifyPromoteur(id,val){
    await sb.from("promoteurs").update({is_verified:val}).eq("id",id);
    setPromoteurs(ps=>ps.map(p=>p.id===id?{...p,is_verified:val}:p));
    showDT(val?"✅ Promoteur vérifié":"Vérification retirée");
  }
  async function deleteListingAdmin(id){
    if(!confirm("Supprimer définitivement cette annonce ?"))return;
    await sb.from("listings").delete().eq("id",id);
    setAllListings(ls=>ls.filter(l=>l.id!==id));
    showDT("🗑 Annonce supprimée");
  }

  const filteredUsers=users.filter(u=>{
    const q=userSearch.toLowerCase();
    return !q||(u.full_name||"").toLowerCase().includes(q)||(u.id||"").includes(q);
  });
  const filteredListings=allListings.filter(l=>{
    const q=listingSearch.toLowerCase();
    const matchQ=!q||(l.title||"").toLowerCase().includes(q)||(l.quartier||"").toLowerCase().includes(q);
    const matchF=listingFilter==="all"||l.status===listingFilter||(listingFilter==="pending_verify"&&!l.is_verified&&l.status==="active");
    return matchQ&&matchF;
  });

  const ROLES=["particulier","agent","agence","promoteur","admin"];
  const navs=[
    {k:"overview",i:"📊",l:"Vue d'ensemble"},
    {k:"users",i:"👥",l:`Utilisateurs (${users.length})`},
    {k:"listings",i:"🏠",l:`Annonces (${allListings.length})`},
    {k:"agencies",i:"🏢",l:`Agences (${agencies.length})`},
    {k:"promoteurs",i:"🏗️",l:`Promoteurs (${promoteurs.length})`},
    {k:"profile",i:"👤",l:"Mon compte"},
  ];

  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user} roleLabel="🔐 Administrateur" adminMode>
      {adminLoading?<div className="ldr"><div className="spin"/></div>:(
        <>
          {tab==="overview"&&stats&&(
            <>
              <div className="dtit2">📊 Statistiques plateforme</div>
              <div className="kpig">
                {[["👥",stats.total_users,"Utilisateurs"],["🏠",stats.active_listings,"Annonces actives"],["⏳",stats.pending_listings,"En attente"],["🏢",stats.total_agencies,"Agences"],["✅",stats.verified_agencies,"Vérifiées"],["👁",(stats.total_views||0).toLocaleString("fr"),"Vues totales"]].map(([ico,val,lbl])=>(
                  <div className="kpi" key={lbl}><div className="kpiic">{ico}</div><div className="kpiv">{val}</div><div className="kpil">{lbl}</div></div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginTop:4}}>
                <div className="dash-card">
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>👥 Répartition par rôle</div>
                  {[["particulier","🙋 Particuliers"],["agent","🏡 Agents"],["agence","🏢 Agences"],["promoteur","🏗️ Promoteurs"],["admin","🔐 Admins"]].map(([role,label])=>{
                    const count=users.filter(u=>u.role===role).length;
                    const pct=users.length>0?Math.round(count/users.length*100):0;
                    return(
                      <div key={role} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}><span>{label}</span><span style={{fontWeight:700}}>{count}</span></div>
                        <div style={{height:6,background:"var(--bg)",borderRadius:3}}><div style={{height:6,background:"var(--g)",borderRadius:3,width:pct+"%"}}/></div>
                      </div>
                    );
                  })}
                </div>
                <div className="dash-card">
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🏠 Statuts annonces</div>
                  {[["active","✅ Actives","#16a34a"],["pending","⏳ En attente","#f59e0b"],["archived","📦 Archivées","#94a3b8"],["sold","💰 Vendues","#3b82f6"]].map(([status,label,color])=>{
                    const count=allListings.filter(l=>l.status===status).length;
                    const pct=allListings.length>0?Math.round(count/allListings.length*100):0;
                    return(
                      <div key={status} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}><span>{label}</span><span style={{fontWeight:700}}>{count}</span></div>
                        <div style={{height:6,background:"var(--bg)",borderRadius:3}}><div style={{height:6,background:color,borderRadius:3,width:pct+"%"}}/></div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="al awi" style={{marginTop:14}}>📅 Annonces cette semaine : <strong>{stats.listings_this_week}</strong> · Agents : <strong>{stats.total_agents}</strong> · Promoteurs : <strong>{stats.total_promoteurs}</strong></div>
            </>
          )}
          {tab==="users"&&(
            <>
              <div className="dtit2">👥 Gestion des utilisateurs ({filteredUsers.length})</div>
              <input className="fi" style={{marginBottom:12}} placeholder="Rechercher par nom ou ID..." value={userSearch} onChange={e=>setUserSearch(e.target.value)}/>
              <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                <table className="dtbl" style={{minWidth:640}}>
                  <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Inscrit</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredUsers.map(u=>(
                      <tr key={u.id}>
                        <td>
                          <div style={{fontWeight:600,fontSize:11}}>{u.full_name||"Sans nom"}</div>
                          <div style={{fontSize:9,color:"var(--mu)",fontFamily:"monospace"}}>{u.id.slice(0,16)}…</div>
                          {u.phone&&<div style={{fontSize:9,color:"var(--mu)"}}>{u.phone}</div>}
                        </td>
                        <td>
                          <select style={{fontSize:10,padding:"3px 5px",border:"1px solid var(--br)",borderRadius:5,cursor:"pointer",fontWeight:700}} value={u.role||"particulier"} onChange={e=>updateUserRole(u.id,e.target.value)}>
                            {ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                          </select>
                        </td>
                        <td>
                          <span style={{background:u.is_verified?"#dcfce7":"#fef3c7",color:u.is_verified?"#16a34a":"#92400e",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>
                            {u.is_verified?"✅ Vérifié":"⏳ En attente"}
                          </span>
                        </td>
                        <td style={{fontSize:10,color:"var(--mu)"}}>{u.created_at?new Date(u.created_at).toLocaleDateString("fr-SN"):"—"}</td>
                        <td>
                          <div className="abtns">
                            <button className="ab abe" title={u.is_verified?"Retirer vérification":"Vérifier"} onClick={()=>verifyUser(u.id,!u.is_verified)}>{u.is_verified?"❌":"✅"}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab==="listings"&&(
            <>
              <div className="dtit2">🏠 Modération annonces ({filteredListings.length})</div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                <input className="fi" style={{flex:"1 1 180px"}} placeholder="Rechercher..." value={listingSearch} onChange={e=>setListingSearch(e.target.value)}/>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {[["all","Toutes"],["active","Actives"],["pending","En attente"],["archived","Archivées"],["pending_verify","À vérifier"]].map(([v,l])=>(
                    <button key={v} className={`fbt ${listingFilter===v?"on":""}`} onClick={()=>setListingFilter(v)} style={{fontSize:10}}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                <table className="dtbl" style={{minWidth:700}}>
                  <thead><tr><th>Annonce</th><th>Prix</th><th>Statut</th><th>Trust</th><th>Vues</th><th>Actions</th></tr></thead>
                  <tbody>
                    {filteredListings.map(l=>(
                      <tr key={l.id}>
                        <td>
                          <div style={{fontWeight:600,fontSize:11,display:"flex",alignItems:"center",gap:5}}>
                            {PICO[l.property_type]} {(l.title||"").slice(0,28)}
                            {l.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:8,padding:"1px 4px",borderRadius:3}}>✅</span>}
                            {l.is_featured&&<span style={{background:"#fef3c7",color:"#92400e",fontSize:8,padding:"1px 4px",borderRadius:3}}>⭐</span>}
                          </div>
                          <div style={{fontSize:9,color:"var(--mu)"}}>📍 {l.quartier}, {l.city} · {ago(l.created_at)}</div>
                        </td>
                        <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)"}}>{fmt(l.price)}</td>
                        <td>
                          <select style={{fontSize:9,padding:"2px 4px",border:"1px solid var(--br)",borderRadius:4}} value={l.status} onChange={e=>updateListingStatus(l.id,e.target.value)}>
                            {["active","pending","archived","sold","rented"].map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td><span style={{fontWeight:800,fontSize:11,color:l.trust_score>=80?"#16a34a":l.trust_score>=60?"#d97706":"#dc2626"}}>{l.trust_score||0}%</span></td>
                        <td style={{fontSize:10,color:"var(--mu)"}}>👁 {l.views_count||0}</td>
                        <td>
                          <div className="abtns">
                            <button className="ab abe" title={l.is_verified?"Retirer vérification":"Vérifier"} onClick={()=>verifyListing(l.id,!l.is_verified)}>{l.is_verified?"❌ Unverify":"✅ Verify"}</button>
                            <button className="ab abe" title={l.is_featured?"Retirer mise en avant":"Mettre en avant"} onClick={()=>featureListing(l.id,!l.is_featured)}>{l.is_featured?"❌ Unfeature":"⭐ Feature"}</button>
                            <button className="ab abd" onClick={()=>deleteListingAdmin(l.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab==="agencies"&&(
            <>
              <div className="dtit2">🏢 Gestion agences ({agencies.length})</div>
              <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                <table className="dtbl" style={{minWidth:640}}>
                  <thead><tr><th>Agence</th><th>Ville</th><th>Plan</th><th>Statut</th><th>Actions</th></tr></thead>
                  <tbody>
                    {agencies.map(ag=>(
                      <tr key={ag.id}>
                        <td><div style={{fontWeight:600,fontSize:12}}>{ag.name}</div>{ag.email&&<div style={{fontSize:9,color:"var(--mu)"}}>{ag.email}</div>}</td>
                        <td style={{fontSize:11}}>{ag.city}</td>
                        <td>
                          <select style={{fontSize:10,padding:"3px 5px",border:"1px solid var(--br)",borderRadius:5,cursor:"pointer",fontWeight:700}} value={ag.subscription_plan} onChange={e=>updateAgencyPlan(ag.id,e.target.value)}>
                            {["free","basic","premium","vip"].map(p=><option key={p} value={p}>{p}</option>)}
                          </select>
                        </td>
                        <td><span style={{background:ag.is_verified?"#dcfce7":"#fef3c7",color:ag.is_verified?"#16a34a":"#92400e",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>{ag.is_verified?"✅ Vérifiée":"⏳ En attente"}</span></td>
                        <td><button className="ab abe" onClick={()=>verifyAgency(ag.id,!ag.is_verified)}>{ag.is_verified?"❌ Unverify":"✅ Vérifier"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab==="promoteurs"&&(
            <>
              <div className="dtit2">🏗️ Gestion promoteurs ({promoteurs.length})</div>
              {promoteurs.length===0?<div className="empty-state"><div style={{fontSize:36}}>🏗️</div><div style={{fontWeight:700,marginTop:8}}>Aucun promoteur inscrit</div></div>:(
                <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
                  <table className="dtbl" style={{minWidth:580}}>
                    <thead><tr><th>Promoteur</th><th>Ville</th><th>Contact</th><th>Statut</th><th>Actions</th></tr></thead>
                    <tbody>
                      {promoteurs.map(p=>(
                        <tr key={p.id}>
                          <td><div style={{fontWeight:600,fontSize:12}}>{p.name}</div>{p.email&&<div style={{fontSize:9,color:"var(--mu)"}}>{p.email}</div>}</td>
                          <td style={{fontSize:11}}>{p.city}</td>
                          <td style={{fontSize:10,color:"var(--mu)"}}>{p.phone||"—"}</td>
                          <td><span style={{background:p.is_verified?"#dcfce7":"#fef3c7",color:p.is_verified?"#16a34a":"#92400e",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>{p.is_verified?"✅ Vérifié":"⏳ En attente"}</span></td>
                          <td><button className="ab abe" onClick={()=>verifyPromoteur(p.id,!p.is_verified)}>{p.is_verified?"❌ Unverify":"✅ Vérifier"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {tab==="profile"&&<ProfileTab user={user} profile={profile} setShowProfileEdit={()=>showDT("Modif profil admin","")} showDT={showDT}/>}
        </>
      )}
    </DashLayout>
  );
}

// ══════════════════════════════════════════════════════════
// SHARED DASHBOARD COMPONENTS
// ══════════════════════════════════════════════════════════
function DashLayout({children,navs,tab,setTab,profile,user,roleLabel,adminMode}){
  const ini=(profile&&profile.full_name||user.email||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  return(
    <div className="dash">
      <div className="dashg">
        <div>
          <div className="dpc">
            <div className="dav">{ini}</div>
            <div className="dname">{profile&&profile.full_name||user.email&&user.email.split("@")[0]}</div>
            <div style={{fontSize:10,color:"var(--mu)",margin:"2px 0 5px"}}>{user.email}</div>
            <span className="drole">{roleLabel||("👤 "+(profile&&profile.role||"Utilisateur"))}</span>
            {adminMode&&<div style={{marginTop:6,background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:6,padding:"3px 8px",fontSize:9,fontWeight:700,color:"#dc2626",textAlign:"center"}}>🔐 MODE ADMIN</div>}
          </div>
          <div className="dside">
            {navs.map(({k,i,l})=>(<button key={k} className={`dnb ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{i} {l}</button>))}
          </div>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}

function PerformanceChart({myList,title}){
  if(!myList||myList.length===0)return null;
  const mx=Math.max(...myList.map(x=>x.views_count||0),1);
  return(
    <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:16,marginBottom:16,boxShadow:"var(--sh)"}}>
      <div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14,marginBottom:12}}>{title||"📈 Performance par annonce (vues)"}</div>
      {myList.slice(0,5).map(l=>{const w=Math.round(((l.views_count||0)/mx)*100);return(
        <div key={l.id} className="cbrw">
          <div className="cblbl" title={l.title}>{(l.title||"").slice(0,11)}{l.title&&l.title.length>11?"…":""}</div>
          <div className="cbwrp"><div className="cbfil" style={{width:w+"%"}}/></div>
          <div className="cbval">{l.views_count||0}</div>
        </div>
      );})}
    </div>
  );
}

function RecentListingsTable({myList,onOpenListing,onViewAll,title}){
  return(
    <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"hidden",boxShadow:"var(--sh)"}}>
      <div style={{padding:"11px 15px",borderBottom:"1px solid var(--br)",fontFamily:"var(--fd)",fontWeight:700,fontSize:13,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        {title||"Annonces récentes"} <button className="ab abv" onClick={onViewAll}>Voir toutes →</button>
      </div>
      {myList.length===0?<div style={{padding:24,textAlign:"center",color:"var(--mu)",fontSize:12}}>Aucune annonce. Déposez via "+ Annonce".</div>:(
        <table className="dtbl"><thead><tr><th>Annonce</th><th>Prix</th><th>Statut</th><th>Vues</th></tr></thead>
        <tbody>{myList.slice(0,5).map(l=>(<tr key={l.id} style={{cursor:"pointer"}} onClick={()=>onOpenListing(l)}>
          <td><div style={{fontWeight:600,fontSize:11}}>{PICO[l.property_type]} {(l.title||"").slice(0,24)}…</div><div style={{fontSize:9,color:"var(--mu)"}}>📍 {l.quartier}</div></td>
          <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)",whiteSpace:"nowrap"}}>{fmt(l.price)}</td>
          <td><span className="sdot"><span className={`dot ${l.status==="active"?"dg":l.status==="archived"?"dr":"dy"}`}/>{l.status}</span></td>
          <td style={{color:"var(--mu)",fontSize:11}}>👁 {l.views_count||0}</td>
        </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}

function MyListingsTab({myList,onOpenListing,setEditListing,toggleStatus,del,boost}){
  return(
    <>
      <div className="dtit2">🏠 Mes annonces ({myList.length})</div>
      {myList.length===0?<div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:32,textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>🏠</div><div style={{fontWeight:700,marginBottom:4}}>Aucune annonce</div><div style={{fontSize:11,color:"var(--mu)"}}>Cliquez sur "+ Annonce" pour commencer.</div></div>:(
        <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",overflow:"auto",boxShadow:"var(--sh)"}}>
          <table className="dtbl" style={{minWidth:560}}><thead><tr><th>Bien</th><th>Prix</th><th>Statut</th><th>Boost</th><th>Vues</th><th>Actions</th></tr></thead>
          <tbody>{myList.map(l=>(<tr key={l.id}>
            <td><div style={{display:"flex",gap:7,alignItems:"center"}}><img src={l.cover_image||""} alt="" style={{width:38,height:30,borderRadius:4,objectFit:"cover",flexShrink:0}} onError={e=>e.target.style.display="none"}/><div><div style={{fontWeight:600,fontSize:11}}>{(l.title||"").slice(0,22)}…</div><div style={{fontSize:9,color:"var(--mu)"}}>📍 {l.quartier}</div></div></div></td>
            <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)",whiteSpace:"nowrap"}}>{fmt(l.price)}</td>
            <td><span className="sdot"><span className={`dot ${l.status==="active"?"dg":l.status==="archived"?"dr":"dy"}`}/>{l.status}</span></td>
            <td>{l.is_premium?<span className="boost-badge">⭐ Premium</span>:<button className="ab abe" onClick={()=>boost(l.id)}>🚀 Boost</button>}</td>
            <td style={{fontSize:11,color:"var(--mu)"}}>👁 {l.views_count||0}</td>
            <td><div className="abtns">
              <button className="ab abv" onClick={()=>onOpenListing(l)} title="Voir">👁</button>
              <button className="ab abe" onClick={()=>setEditListing(l)} title="Modifier">✏️</button>
              <button className="ab abe" onClick={()=>toggleStatus(l.id,l.status)} title={l.status==="active"?"Archiver":"Réactiver"}>{l.status==="active"?"⏸":"▶"}</button>
              <button className="ab abd" onClick={()=>del(l.id)} title="Supprimer">🗑</button>
            </div></td>
          </tr>))}</tbody></table>
        </div>
      )}
    </>
  );
}

function MessagesTab({convs,onOpenListing}){
  return(
    <>
      <div className="dtit2">💬 Mes conversations ({convs.length})</div>
      {convs.length===0?<div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:28,textAlign:"center"}}><div style={{fontSize:28,marginBottom:7}}>💬</div><div style={{fontWeight:700,fontSize:13}}>Aucune conversation</div><div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Les messages envoyés via les annonces apparaîtront ici.</div></div>:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {convs.map((c,i)=>(
            <div key={i} style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:13,display:"flex",gap:11,alignItems:"center",cursor:"pointer",boxShadow:"var(--sh)",transition:".18s"}} onClick={()=>c.listing_id&&onOpenListing({id:c.listing_id,...c.listings})}>
              <div style={{width:44,height:36,borderRadius:8,overflow:"hidden",flexShrink:0,background:"var(--bg)"}}>{c.listings&&c.listings.cover_image&&<img src={c.listings.cover_image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} onError={e=>e.target.style.display="none"}/>}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{(c.listings&&c.listings.property_type&&PICO[c.listings.property_type])||"🏠"} {(c.listings&&c.listings.title)||"Annonce"}</div><div style={{fontSize:10,color:"var(--mu)",marginTop:1}}>Dernier message · {ago(c.last_message_at)}</div></div>
              <span style={{fontSize:11,color:"var(--g)",fontWeight:700}}>→</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FavoritesTab({favListings,favIds,onFav,onOpenListing}){
  return(
    <>
      <div className="dtit2">❤️ Mes favoris ({favIds.length})</div>
      {favListings.length===0?<div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:28,textAlign:"center"}}><div style={{fontSize:28,marginBottom:7}}>🤍</div><div style={{fontWeight:700,fontSize:13}}>Aucun favori</div><div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Cliquez ❤️ sur les annonces pour les sauvegarder.</div></div>:(
        <div className="grid">{favListings.map(l=><Card key={l.id} l={l} onClick={()=>onOpenListing(l)} favIds={favIds} onFav={onFav}/>)}</div>
      )}
    </>
  );
}

function AlertsTab({alerts,toggleAlert,deleteAlert}){
  return(
    <>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div className="dtit2" style={{marginBottom:0}}>🔔 Mes alertes de recherche</div>
      </div>
      <div className="al awi" style={{marginBottom:14}}>💡 Recevez une notification dès qu'une annonce correspond à vos critères. Créez des alertes depuis la page Annonces.</div>
      {alerts.length===0?(
        <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:28,textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:7}}>🔔</div>
          <div style={{fontWeight:700,fontSize:13}}>Aucune alerte</div>
          <div style={{fontSize:11,color:"var(--mu)",marginTop:3}}>Allez sur la page Annonces, filtrez et cliquez "Créer une alerte".</div>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {alerts.map(a=>(
            <div key={a.id} style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:14,boxShadow:"var(--sh)",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{width:38,height:38,borderRadius:9,background:a.is_active?"var(--gl)":"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🔔</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13}}>{a.label}</div>
                <div style={{fontSize:10,color:"var(--mu)",marginTop:2,display:"flex",gap:6,flexWrap:"wrap"}}>
                  {a.filters&&a.filters.transaction_type&&<span style={{background:"var(--bg)",padding:"1px 5px",borderRadius:3}}>{TXL[a.filters.transaction_type]}</span>}
                  {a.filters&&a.filters.property_type&&<span style={{background:"var(--bg)",padding:"1px 5px",borderRadius:3}}>{a.filters.property_type}</span>}
                  {a.filters&&a.filters.region&&<span style={{background:"var(--bg)",padding:"1px 5px",borderRadius:3}}>📍 {a.filters.region}</span>}
                  {a.filters&&a.filters.price_max&&<span style={{background:"var(--bg)",padding:"1px 5px",borderRadius:3}}>Max {fmtM(a.filters.price_max)}</span>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <span style={{fontSize:10,fontWeight:700,color:a.is_active?"var(--g)":"var(--mu)"}}>{a.is_active?"● Active":"○ Inactive"}</span>
                <button className="ab abe" onClick={()=>toggleAlert(a.id,a.is_active)}>{a.is_active?"⏸":"▶"}</button>
                <button className="ab abd" onClick={()=>deleteAlert(a.id)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ProfileTab({user,profile,setShowProfileEdit,showDT}){
  const ini=(profile&&profile.full_name||user.email||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  return(
    <>
      <div className="dtit2">👤 Mon profil</div>
      <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:20,maxWidth:480,boxShadow:"var(--sh)"}}>
        <div style={{display:"flex",alignItems:"center",gap:13,marginBottom:20}}>
          <div className="dav" style={{width:60,height:60,fontSize:22,margin:0}}>{ini}</div>
          <div><div style={{fontWeight:700,fontSize:16}}>{profile&&profile.full_name||"—"}</div><div style={{fontSize:11,color:"var(--mu)"}}>{user.email}</div><span className="drole" style={{marginTop:4,display:"inline-block"}}>👤 {profile&&profile.role||"Utilisateur"}</span></div>
        </div>
        {[["📧 Email",user.email],["📱 Téléphone",profile&&profile.phone||"Non renseigné"],["💬 WhatsApp",profile&&profile.whatsapp||"Non renseigné"],["✅ Vérifié",profile&&profile.is_verified?"Compte vérifié":"En attente de vérification"],["📅 Inscrit le",new Date(user.created_at).toLocaleDateString("fr-SN",{day:"numeric",month:"long",year:"numeric"})]].map(([k,v])=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid var(--br)",fontSize:12,gap:10,flexWrap:"wrap"}}><span style={{color:"var(--mu)",fontWeight:600,flexShrink:0}}>{k}</span><span style={{fontWeight:700,textAlign:"right"}}>{v}</span></div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
          <button className="fbt2 fbg" style={{flex:1}} onClick={()=>setShowProfileEdit(true)}>✏️ Modifier le profil</button>
          <button className="fbt2 fbo" style={{flex:1}} onClick={()=>{navigator.clipboard.writeText(user.email);showDT("📋 Email copié !");}}>📋 Copier email</button>
        </div>
        {profile&&!profile.is_verified&&<div className="al awi" style={{marginTop:12}}>⚠️ Votre compte n'est pas encore vérifié. Vérifiez votre email.</div>}
      </div>
      <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:"var(--r)",padding:16,maxWidth:480,marginTop:14,boxShadow:"var(--sh)"}}>
        <div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14,marginBottom:12}}>🔐 Sécurité</div>
        <button className="fbt2 fbo" style={{marginBottom:8}} onClick={()=>sb.auth.resetPasswordForEmail(user.email).then(()=>showDT("📧 Email de réinitialisation envoyé !"))}>🔑 Changer le mot de passe</button>
        <p style={{fontSize:11,color:"var(--mu)"}}>Un email vous sera envoyé pour réinitialiser votre mot de passe.</p>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════════════════════
function EmptyState({icon,title,sub}){
  return(
    <div className="empty-state">
      <div style={{fontSize:40,marginBottom:8}}>{icon}</div>
      <div style={{fontWeight:700}}>{title}</div>
      {sub&&<div style={{fontSize:11,color:"var(--mu)",marginTop:4}}>{sub}</div>}
    </div>
  );
}


function Dashboard({user,onOpenListing,onShowAgency,onLogout,favIds,onFav}){
  const [myList,setMyList]=useState([]);
  const [convs,setConvs]=useState([]);
  const [favListings,setFavListings]=useState([]);
  const [alerts,setAlerts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [profile,setProfile]=useState(null);
  const [editListing,setEditListing]=useState(null);
  const [showProfileEdit,setShowProfileEdit]=useState(false);
  const [dToast,setDToast]=useState(null);
  const showDT=(msg,type="ok")=>{setDToast({msg,type});setTimeout(()=>setDToast(null),3200);};

  useEffect(()=>{load();},[]);
  async function load(){
    setLoading(true);
    const[{data:p},{data:l},{data:cv},{data:al},fl]=await Promise.all([
      sb.from("profiles").select("*").eq("id",user.id).single(),
      sb.from("listings").select("*").eq("owner_id",user.id).order("created_at",{ascending:false}),
      sb.from("conversations").select("*,listings(title,cover_image,property_type)").or("participant_a.eq."+user.id+",participant_b.eq."+user.id).order("last_message_at",{ascending:false}).limit(10),
      sb.from("alerts").select("*").eq("user_id",user.id).order("created_at",{ascending:false}),
      favIds.length>0?sb.from("listings").select("*").in("id",favIds):Promise.resolve({data:[]}),
    ]);
    if(p)setProfile(p);if(l)setMyList(l);if(cv)setConvs(cv);if(al)setAlerts(al);
    if(fl&&fl.data)setFavListings(fl.data);
    setLoading(false);
  }
  useEffect(()=>{
    if(favIds.length>0)sb.from("listings").select("*").in("id",favIds).then(({data})=>setFavListings(data||[]));
    else setFavListings([]);
  },[favIds]);

  async function toggleStatus(id,cur){
    const ns=cur==="active"?"archived":"active";
    await sb.from("listings").update({status:ns}).eq("id",id);
    setMyList(ls=>ls.map(l=>l.id===id?{...l,status:ns}:l));
    showDT(ns==="active"?"✅ Annonce réactivée":"📦 Annonce archivée");
  }
  async function del(id){
    if(!confirm("Supprimer définitivement cette annonce ?"))return;
    await sb.from("listings").delete().eq("id",id);
    setMyList(ls=>ls.filter(l=>l.id!==id));
    showDT("🗑 Annonce supprimée");
  }
  async function boost(id){
    await sb.rpc("boost_listing",{p_listing_id:id,p_days:7});
    setMyList(ls=>ls.map(l=>l.id===id?{...l,is_premium:true}:l));
    showDT("⭐ Annonce boostée 7 jours !");
  }
  async function toggleAlert(id,cur){
    await sb.from("alerts").update({is_active:!cur}).eq("id",id);
    setAlerts(al=>al.map(a=>a.id===id?{...a,is_active:!cur}:a));
  }
  async function deleteAlert(id){
    await sb.from("alerts").delete().eq("id",id);
    setAlerts(al=>al.filter(a=>a.id!==id));
    showDT("Alerte supprimée");
  }

  const role=profile&&profile.role||"particulier";
  const sharedProps={user,profile,myList,convs,favIds,favListings,alerts,loading,onOpenListing,onShowAgency,showDT,setEditListing,setShowProfileEdit,toggleStatus,del,boost,toggleAlert,deleteAlert,setProfile,onFav};

  return(
    <>
      {editListing&&<ListingEditModal user={user} listing={editListing} onClose={()=>setEditListing(null)} onSaved={updated=>{setMyList(ls=>ls.map(l=>l.id===updated.id?updated:l));showDT("✅ Annonce mise à jour !");}}/>}
      {showProfileEdit&&profile&&<ProfileEditModal user={user} profile={profile} onClose={()=>setShowProfileEdit(false)} onSaved={p=>{setProfile(prev=>({...prev,...p}));showDT("✅ Profil mis à jour !");}}/>}
      {dToast&&<div className={"toast t"+dToast.type} style={{zIndex:1100}}>{dToast.msg}</div>}

      {/* Role-based top nav strip */}
      <div style={{background:"var(--nv)",padding:"6px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{color:"#fff",fontSize:11,fontWeight:700}}>
            {role==="admin"?"🔐 Admin":role==="agence"?"🏢 Agence":role==="agent"?"🏡 Agent":role==="promoteur"?"🏗️ Promoteur":"👤 Particulier"}
          </span>
          {profile&&profile.is_verified&&<span style={{background:"#dcfce7",color:"#16a34a",fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:100}}>✅ Vérifié</span>}
        </div>
        <button className="dnb" onClick={onLogout} style={{color:"#ef4444",fontSize:11,background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.15)",borderRadius:7,padding:"4px 10px"}}>🚪 Déconnexion</button>
      </div>

      {!profile&&loading?<div className="ldr"><div className="spin"/></div>:(
        role==="admin"?<AdminDash user={user} profile={profile||{}} showDT={showDT}/>:
        role==="agence"?<AgenceDash {...sharedProps}/>:
        role==="promoteur"?<PromoteurDash {...sharedProps}/>:
        role==="agent"?<AgentDash {...sharedProps}/>:
        <ParticulierDash {...sharedProps}/>
      )}
    </>
  );
}


// ══════════════════════════════════════════════════════════
// PRICE HISTORY SPARKLINE
// ══════════════════════════════════════════════════════════
function PriceSparkline({listingId,currentPrice}){
  const [history,setHistory]=useState([]);
  useEffect(()=>{
    sb.from("price_history").select("*").eq("listing_id",listingId).order("changed_at").limit(8)
      .then(({data})=>{
        if(data&&data.length>0){
          const pts=[...data.map(h=>({price:Number(h.new_price),date:h.changed_at})),{price:currentPrice,date:new Date().toISOString()}];
          setHistory(pts);
        }
      });
  },[listingId]);
  if(history.length<2)return null;
  const prices=history.map(h=>h.price);
  const min=Math.min(...prices),max=Math.max(...prices);
  const range=max-min||1;
  const W=260,H=60,pad=8;
  const pw=W-pad*2,ph=H-pad*2;
  const pts=history.map((h,i)=>{
    const x=pad+i/(history.length-1)*pw;
    const y=pad+ph-(h.price-min)/range*ph;
    return `${x},${y}`;
  }).join(" ");
  const first=prices[0],last=prices[prices.length-1];
  const delta=((last-first)/first*100).toFixed(1);
  const up=last>=first;
  return(
    <div className="sparkline-wrap">
      <div className="sparkline-title">
        📉 Historique des prix
        <span className="sparkline-delta" style={{background:up?"#dcfce7":"#fee2e2",color:up?"#16a34a":"#dc2626"}}>{up?"+":""}{delta}%</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{height:60}}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up?"#0a5c36":"#dc2626"} stopOpacity=".15"/>
            <stop offset="100%" stopColor={up?"#0a5c36":"#dc2626"} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={`${pad},${H} ${pts} ${W-pad},${H}`} fill="url(#sg)"/>
        <polyline points={pts} fill="none" stroke={up?"#0a5c36":"#dc2626"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {history.map((h,i)=>{
          const x=pad+i/(history.length-1)*pw;
          const y=pad+ph-(h.price-min)/range*ph;
          return<circle key={i} cx={x} cy={y} r={i===history.length-1?4:2.5} fill={up?"#0a5c36":"#dc2626"}/>;
        })}
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--mu)",marginTop:4}}>
        <span>{new Date(history[0].date).toLocaleDateString("fr-SN")}</span>
        <span style={{fontWeight:700,color:up?"#16a34a":"#dc2626"}}>{fmt(last)}</span>
        <span>Aujourd'hui</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// SHARE BUTTON
// ══════════════════════════════════════════════════════════
function ShareBtn({listing,showToast}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    function click(e){if(ref.current&&!ref.current.contains(e.target))setOpen(false);}
    document.addEventListener("mousedown",click);return()=>document.removeEventListener("mousedown",click);
  },[]);
  const url=`https://senegalsen-immo.vercel.app/annonce/${listing.id}`;
  const title=`${listing.title} — ${fmt(listing.price)}`;
  const waMsg=encodeURIComponent(`🏡 *SeneGalsen Immobilier*\n${title}\n📍 ${listing.quartier}, ${listing.city}\n${url}`);

  async function share(method){
    setOpen(false);
    sb.rpc("increment_shares",{listing_uuid:listing.id}).catch(()=>{});
    if(method==="native"&&navigator.share){await navigator.share({title,text:`${listing.title} — ${listing.quartier}`,url});return;}
    if(method==="copy"){await navigator.clipboard.writeText(url);showToast("🔗 Lien copié !");return;}
    if(method==="wa"){window.open(`https://wa.me/?text=${waMsg}`,"_blank");return;}
    if(method==="fb"){window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,"_blank");return;}
  }
  return(
    <div style={{position:"relative"}} ref={ref}>
      <button className="btn" style={{background:"var(--bg)",color:"var(--tx)",border:"1.5px solid var(--br)",fontWeight:600,fontSize:12}} onClick={()=>setOpen(o=>!o)}>
        🔗 Partager
      </button>
      {open&&(
        <div className="share-popup">
          <div style={{fontWeight:700,fontSize:11,color:"var(--mu)",marginBottom:7,textTransform:"uppercase",letterSpacing:".4px"}}>Partager l'annonce</div>
          {navigator.share&&<button className="share-btn-item" onClick={()=>share("native")}>📤 Partager via...</button>}
          <button className="share-btn-item" onClick={()=>share("copy")}>🔗 Copier le lien</button>
          <button className="share-btn-item" onClick={()=>share("wa")}>💬 WhatsApp</button>
          <button className="share-btn-item" onClick={()=>share("fb")}>📘 Facebook</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// COMPARE BAR + MODAL
// ══════════════════════════════════════════════════════════
function CompareBar({items,onRemove,onClear,onCompare}){
  if(items.length===0)return null;
  return(
    <div className="cmpbar">
      <span className="cmpbar-title">⚖️ Comparer ({items.length}/3)</span>
      <div className="cmp-items">
        {items.map(l=>(
          <div key={l.id} className="cmp-item">
            <span style={{fontSize:14}}>{PICO[l.property_type]}</span>
            <span className="cmp-item-name">{(l.title||"").slice(0,22)}</span>
            <button className="cmp-rm" onClick={()=>onRemove(l.id)}>✕</button>
          </div>
        ))}
        {items.length<3&&<span style={{fontSize:11,color:"rgba(255,255,255,.4)",alignSelf:"center"}}>+ Ajoutez jusqu'à 3 biens</span>}
      </div>
      <button className="btn btg" style={{padding:"8px 16px",fontSize:12,width:"auto"}} onClick={onCompare} disabled={items.length<2}>Comparer →</button>
      <button className="btn" style={{padding:"7px 12px",fontSize:11,width:"auto",background:"rgba(255,255,255,.1)",color:"#fff",border:"none"}} onClick={onClear}>✕ Vider</button>
    </div>
  );
}

function CompareModal({items,onClose}){
  const rows=[
    ["Prix",l=>fmt(l.price)+(l.transaction_type==="location"?"/mois":"")],
    ["Type",l=>PICO[l.property_type]+" "+l.property_type],
    ["Transaction",l=>TXL[l.transaction_type]||l.transaction_type],
    ["Surface",l=>l.surface?l.surface+" m²":"—"],
    ["Pièces",l=>l.rooms||"—"],
    ["Chambres",l=>l.bedrooms||"—"],
    ["Sdb",l=>l.bathrooms||"—"],
    ["Quartier",l=>l.quartier||"—"],
    ["Ville",l=>l.city||"—"],
    ["Document",l=>DOC[l.document_type]?.l||"—"],
    ["Trust Score",l=><span style={{fontWeight:800,color:l.trust_score>=80?"#16a34a":l.trust_score>=60?"#d97706":"#dc2626"}}>{l.trust_score||0}%</span>],
    ["Vues",l=>"👁 "+(l.views_count||0)],
    ["Piscine",l=><span className={l.features?.piscine?"cmp-badge-ok":"cmp-badge-no"}>{l.features?.piscine?"✅":"—"}</span>],
    ["Parking",l=><span className={l.features?.parking?"cmp-badge-ok":"cmp-badge-no"}>{l.features?.parking?"✅":"—"}</span>],
    ["Clim",l=><span className={l.features?.climatisation?"cmp-badge-ok":"cmp-badge-no"}>{l.features?.climatisation?"✅":"—"}</span>],
    ["Meublé",l=><span className={l.features?.meuble?"cmp-badge-ok":"cmp-badge-no"}>{l.features?.meuble?"✅":"—"}</span>],
    ["Vue mer",l=><span className={l.features?.vue_mer?"cmp-badge-ok":"cmp-badge-no"}>{l.features?.vue_mer?"✅":"—"}</span>],
  ];
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="cmp-modal">
        <div className="mhd" style={{padding:"18px 18px 0"}}><div className="mtit">⚖️ Comparatif</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div style={{padding:"14px",overflowX:"auto"}}>
          <table className="cmp-table" style={{minWidth:480}}>
            <thead>
              <tr>
                <th style={{width:110}}></th>
                {items.map(l=>(
                  <th key={l.id}>
                    <img className="cmp-img" src={l.cover_image||"https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300"} alt="" onError={e=>e.target.src="https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300"}/>
                    <div style={{fontSize:12,lineHeight:1.3}}>{(l.title||"").slice(0,30)}</div>
                    <div style={{fontSize:10,opacity:.75,marginTop:2}}>📍 {l.quartier}, {l.city}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label,fn])=>(
                <tr key={label}>
                  <td>{label}</td>
                  {items.map(l=><td key={l.id}>{typeof fn(l)==="object"?fn(l):String(fn(l))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ALERT MODAL (save search)
// ══════════════════════════════════════════════════════════
function AlertModal({user,currentFilters,onClose,showToast}){
  const [label,setLabel]=useState("Mon alerte immo");
  const [txType,setTxType]=useState(currentFilters?.txF&&currentFilters.txF!=="all"?currentFilters.txF:"");
  const [propType,setPropType]=useState(currentFilters?.propF&&currentFilters.propF!=="all"?currentFilters.propF:"");
  const [region,setRegion]=useState(currentFilters?.advF?.region||"");
  const [pMax,setPMax]=useState(currentFilters?.advF?.priceMax||"");
  const [saving,setSaving]=useState(false);
  async function save(){
    setSaving(true);
    const filters={};
    if(txType)filters.transaction_type=txType;
    if(propType)filters.property_type=propType;
    if(region)filters.region=region;
    if(pMax)filters.price_max=parseInt(pMax);
    await sb.from("alerts").insert([{user_id:user.id,label,filters,is_active:true}]);
    setSaving(false);
    showToast("🔔 Alerte créée ! Vous serez notifié des nouvelles annonces.");
    onClose();
  }
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mhd"><div className="mtit">🔔 Créer une alerte</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          <div className="al awi">💡 Vous recevrez une notification dès qu'une nouvelle annonce correspond à vos critères.</div>
          <div className="fg"><label className="fl">Nom de l'alerte</label><input className="fi" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Mon alerte villa Almadies"/></div>
          <div className="alert-filters">
            <div className="fg">
              <label className="fl">Type de transaction</label>
              <select className="fi" value={txType} onChange={e=>setTxType(e.target.value)}>
                <option value="">Tous</option>
                {Object.entries(TXL).map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Type de bien</label>
              <select className="fi" value={propType} onChange={e=>setPropType(e.target.value)}>
                <option value="">Tous</option>
                {Object.entries(PICO).map(([v,i])=><option key={v} value={v}>{i} {v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Région</label>
              <select className="fi" value={region} onChange={e=>setRegion(e.target.value)}>
                <option value="">Toutes</option>
                {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Prix max (FCFA)</label>
              <input className="fi" type="number" value={pMax} onChange={e=>setPMax(e.target.value)} placeholder="Illimité"/>
            </div>
          </div>
          <button className="fbt2 fbg" onClick={save} disabled={saving||!label}>{saving?"Enregistrement...":"🔔 Sauvegarder l'alerte"}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// PROFILE EDIT MODAL
// ══════════════════════════════════════════════════════════
function ProfileEditModal({user,profile,onClose,onSaved}){
  const [name,setName]=useState(profile?.full_name||"");
  const [phone,setPhone]=useState(profile?.phone||"");
  const [wa,setWa]=useState(profile?.whatsapp||"");
  const [saving,setSaving]=useState(false);
  const [err,setErr]=useState("");
  async function save(){
    setSaving(true);setErr("");
    const{error}=await sb.from("profiles").update({full_name:name,phone,whatsapp:wa}).eq("id",user.id);
    setSaving(false);
    if(error){setErr(error.message);return;}
    onSaved({full_name:name,phone,whatsapp:wa});
    onClose();
  }
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="mhd"><div className="mtit">✏️ Modifier le profil</div><button className="mcls" onClick={onClose}>✕</button></div>
        <div className="mbd">
          {err&&<div className="al ale">❌ {err}</div>}
          <div className="pedit-grid">
            <div className="fg" style={{gridColumn:"1/-1"}}><label className="fl">Nom complet</label><input className="fi" value={name} onChange={e=>setName(e.target.value)} placeholder="Ibrahima Diallo"/></div>
            <div className="fg"><label className="fl">Téléphone</label><input className="fi" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+221 77 000 00 00"/></div>
            <div className="fg"><label className="fl">WhatsApp</label><input className="fi" value={wa} onChange={e=>setWa(e.target.value)} placeholder="+221 77 000 00 00"/></div>
          </div>
          <button className="fbt2 fbg" onClick={save} disabled={saving}>{saving?"Enregistrement...":"💾 Sauvegarder"}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════
export default function App(){
  const [page,setPage]=useState("home");
  const [prevPage,setPrevPage]=useState("home");
  const [listings,setListings]=useState([]);
  const [featured,setFeatured]=useState([]);
  const [selected,setSelected]=useState(null);
  const [agencyId,setAgencyId]=useState(null);
  const [loading,setLoading]=useState(true);
  const [stats,setStats]=useState({total:0,agencies:0,cities:0});
  const [searchQ,setSearchQ]=useState("");
  const [txF,setTxF]=useState("all"), [propF,setPropF]=useState("all");
  const [advF,setAdvF]=useState({});
  const [stab,setStab]=useState("vente");
  const [user,setUser]=useState(null);
  const [favIds,setFavIds]=useState([]);
  const [notifs,setNotifs]=useState([]);
  const [showAuth,setShowAuth]=useState(false);
  const [showForm,setShowForm]=useState(false);
  const [showNotif,setShowNotif]=useState(false);
  const [toast,setToast]=useState(null);
  const [newCount,setNewCount]=useState(0);
  const [cmpItems,setCmpItems]=useState([]);
  const [showCmp,setShowCmp]=useState(false);
  const [showAlert,setShowAlert]=useState(false);
  const [listPage,setListPage]=useState(1);
  const [sortBy,setSortBy]=useState("date");
  const PAGE_SIZE=12;

  useEffect(()=>{
    sb.auth.getSession().then(({data:{session}})=>{setUser(session?.user??null);if(session?.user)loadUserData(session.user);});
    const{data:{subscription}}=sb.auth.onAuthStateChange((_e,session)=>{setUser(session?.user??null);if(session?.user)loadUserData(session.user);else{setFavIds([]);setNotifs([]);}});
    loadAll();
    // Realtime: new active listings
    const rtList=sb.channel("rt-listings").on("postgres_changes",{event:"INSERT",schema:"public",table:"listings",filter:"status=eq.active"},payload=>{
      setListings(prev=>[payload.new,...prev]);
      setStats(s=>({...s,total:s.total+1}));
      setNewCount(n=>n+1);
    }).subscribe();
    // Realtime: notifications for logged-in user
    let rtNotif;
    sb.auth.getSession().then(({data:{session}})=>{
      if(session?.user){
        rtNotif=sb.channel("rt-notifs").on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications",filter:`user_id=eq.${session.user.id}`},payload=>{
          setNotifs(prev=>[payload.new,...prev]);
        }).subscribe();
      }
    });
    return()=>{subscription.unsubscribe();sb.removeChannel(rtList);if(rtNotif)sb.removeChannel(rtNotif);};
  },[]);

  async function loadAll(){
    setLoading(true);
    const[{data:all},{data:feat},{count}]=await Promise.all([
      sb.from("listings").select("*").eq("status","active").order("is_featured",{ascending:false}).order("created_at",{ascending:false}),
      sb.from("listings").select("*").eq("status","active").eq("is_featured",true).limit(6),
      sb.from("agencies").select("id",{count:"exact",head:true}),
    ]);
    if(all){setListings(all);setStats({total:all.length,agencies:count||3,cities:new Set(all.map(l=>l.city)).size});}
    if(feat)setFeatured(feat);
    setLoading(false);
  }

  async function loadUserData(u){
    const[{data:favs},{data:nots}]=await Promise.all([
      sb.from("favorites").select("listing_id").eq("user_id",u.id),
      sb.from("notifications").select("*").eq("user_id",u.id).order("created_at",{ascending:false}).limit(20),
    ]);
    if(favs)setFavIds(favs.map(f=>f.listing_id));
    if(nots)setNotifs(nots);
  }

  async function toggleFav(listingId,add){
    if(!user){showT("Connectez-vous pour sauvegarder des favoris","err");return;}
    if(add){
      await sb.from("favorites").upsert({user_id:user.id,listing_id:listingId});
      setFavIds(f=>[...f.filter(x=>x!==listingId),listingId]);
      showT("❤️ Ajouté aux favoris");
    } else {
      await sb.from("favorites").delete().eq("user_id",user.id).eq("listing_id",listingId);
      setFavIds(f=>f.filter(x=>x!==listingId));
      showT("Retiré des favoris");
    }
  }

  async function markAllRead(){
    await sb.from("notifications").update({is_read:true}).eq("user_id",user.id);
    setNotifs(n=>n.map(x=>({...x,is_read:true})));
  }

  function showT(msg,type="ok"){setToast({msg,type});setTimeout(()=>setToast(null),3400);}
  function open(l,from){setSelected(l);setPrevPage(from||page);setPage("detail");window.scrollTo(0,0);}
  function showAgency(id,from){setAgencyId(id);setPrevPage(from||page);setPage("agency");window.scrollTo(0,0);}
  async function logout(){await sb.auth.signOut();setUser(null);setPage("home");setFavIds([]);setNotifs([]);showT("Déconnecté ✓");}
  useEffect(()=>setListPage(1),[searchQ,txF,propF,advF,sortBy]);
  function toggleCmp(l){setCmpItems(prev=>{if(prev.find(x=>x.id===l.id))return prev.filter(x=>x.id!==l.id);if(prev.length>=3){showT("Maximum 3 biens à comparer","err");return prev;}return[...prev,l];});}

  const unreadCount=notifs.filter(n=>!n.is_read).length;
  const ini=user?(user.email||"?")[0].toUpperCase():null;

  const filtered=useMemo(()=>listings.filter(l=>{
    const q=searchQ.toLowerCase();
    if(q&&!(l.title||"").toLowerCase().includes(q)&&!(l.quartier||"").toLowerCase().includes(q)&&!(l.city||"").toLowerCase().includes(q))return false;
    if(txF!=="all"&&l.transaction_type!==txF)return false;
    if(propF!=="all"&&l.property_type!==propF)return false;
    if(advF.priceMin&&l.price<Number(advF.priceMin))return false;
    if(advF.priceMax&&l.price>Number(advF.priceMax))return false;
    if(advF.surfMin&&l.surface<Number(advF.surfMin))return false;
    if(advF.bedrooms&&(l.bedrooms||0)<Number(advF.bedrooms))return false;
    if(advF.docType&&l.document_type!==advF.docType)return false;
    if(advF.region&&l.region!==advF.region)return false;
    return true;
  }).sort((a,b)=>{
    if(sortBy==="price_asc")return a.price-b.price;
    if(sortBy==="price_desc")return b.price-a.price;
    if(sortBy==="views")return (b.views_count||0)-(a.views_count||0);
    if(sortBy==="trust")return (b.trust_score||0)-(a.trust_score||0);
    return new Date(b.created_at)-new Date(a.created_at);
  }),[listings,searchQ,txF,propF,advF,sortBy]);
  const paged=filtered.slice(0,listPage*PAGE_SIZE);
  const hasMore=paged.length<filtered.length;

  return(
    <>
      <style>{CSS}</style>
      <div>
        {/* ── NAV ── */}
        <nav className="nav">
          <div className="navi">
            <button className="logo" onClick={()=>setPage("home")}>🏡 Sene<span>Galsen</span></button>
            <div className="navl">
              <button className={`nb ${page==="home"?"on":""}`} onClick={()=>setPage("home")}>Accueil</button>
              <button className={`nb ${page==="listings"?"on":""}`} onClick={()=>setPage("listings")}>Annonces</button>
              <button className={`nb ${page==="map"?"on":""}`} onClick={()=>setPage("map")}>🗺️ Carte</button>
              <button className={`nb ${page==="prices"?"on":""}`} onClick={()=>setPage("prices")}>📊 Prix</button>
              {user&&<button className={`nb ${page==="dashboard"?"on":""}`} onClick={()=>setPage("dashboard")}>Dashboard</button>}
            </div>
            <div className="nauth">
              {user?(
                <>
                  <button className="ncta" onClick={()=>setShowForm(true)}>+ Annonce</button>
                  <div style={{position:"relative"}}>
                    <button className="nb" style={{padding:"7px 10px",fontSize:16}} onClick={()=>setShowNotif(o=>!o)}>
                      🔔{unreadCount>0&&<span className="nbadge">{unreadCount>9?"9+":unreadCount}</span>}
                    </button>
                    {showNotif&&<NotifPanel user={user} notifs={notifs} onClose={()=>setShowNotif(false)} onMarkAll={()=>{markAllRead();setShowNotif(false);}}/>}
                  </div>
                  <button className="av" onClick={()=>setPage("dashboard")} title={user.email}>
                    {ini}
                    {unreadCount>0&&<span className="nbadge" style={{top:-3,right:-3}}>{unreadCount}</span>}
                  </button>
                </>
              ):(
                <>
                  <button className="nb" onClick={()=>setShowAuth(true)}>Connexion</button>
                  <button className="ncta" onClick={()=>setShowAuth(true)}>+ Déposer une annonce</button>
                </>
              )}
            </div>
          </div>
        </nav>

        {/* ── MODALS ── */}
        {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} onSuccess={u=>{setUser(u);setShowAuth(false);loadUserData(u);showT("Bienvenue sur SeneGalsen ! 🎉");}}/>}
        {showForm&&user&&<ListingForm user={user} onClose={()=>setShowForm(false)} onSuccess={l=>{setShowForm(false);setListings(ls=>[l,...ls]);setStats(s=>({...s,total:s.total+1}));showT("✅ Annonce publiée !");open(l,"home");}}/>}
        {toast&&<div className={`toast t${toast.type}`}>{toast.msg}</div>}
        {showCmp&&cmpItems.length>=2&&<CompareModal items={cmpItems} onClose={()=>setShowCmp(false)}/>}
        {showAlert&&user&&<AlertModal user={user} currentFilters={{txF,propF,advF}} onClose={()=>setShowAlert(false)} showToast={showT}/>}
        <CompareBar items={cmpItems} onRemove={id=>setCmpItems(p=>p.filter(x=>x.id!==id))} onClear={()=>setCmpItems([])} onCompare={()=>setShowCmp(true)}/>

        {/* ── HOME ── */}
        {page==="home"&&(
          <>
            <section className="hero">
              <div className="heroi">
                <div className="htag">🇸🇳 La référence immobilière au Sénégal</div>
                <h1>Votre bien <em>idéal au Sénégal</em><br/>vous attend ici</h1>
                <p>Appartements, villas, terrains — Annonces vérifiées dans tout le Sénégal</p>
                <div className="sbox">
                  <div className="stabs">{Object.entries(TXL).map(([v,l])=><button key={v} className={`stab ${stab===v?"on":""}`} onClick={()=>setStab(v)}>{l}</button>)}</div>
                  <div className="srow">
                    <input className="si" placeholder="Quartier, ville (ex: Almadies...)" value={searchQ} onChange={e=>setSearchQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(setTxF(stab),setPage("listings"))}/>
                    <select className="si" style={{flex:"0 0 140px"}} onChange={e=>setPropF(e.target.value)}>
                      <option value="all">Type de bien</option>
                      {Object.entries(PICO).map(([v,i])=><option key={v} value={v}>{i} {v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
                    </select>
                    <button className="sbtn" onClick={()=>{setTxF(stab);setPage("listings");}}>🔍 Chercher</button>
                  </div>
                </div>
              </div>
            </section>
            <div className="sbar"><div className="sbari">{[[stats.total+"+","Annonces actives"],[stats.agencies+"+","Agences"],[stats.cities+"+","Villes"],["100%","Vérifié"]].map(([n,l])=>(<div className="st" key={l}><div className="stn">{n}</div><div className="stl">{l}</div></div>))}</div></div>
            {newCount>0&&<div style={{background:"var(--gm)",color:"#fff",textAlign:"center",padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}} onClick={()=>{setNewCount(0);window.scrollTo(0,0);window.location.reload?.();}}>🆕 {newCount} nouvelle{newCount>1?"s":""} annonce{newCount>1?"s":""} publiée{newCount>1?"s":""}  — Actualiser</div>}
            <div className="sec">
              <div className="sech"><h2 className="sectl">Annonces <span>à la une</span></h2><button className="seclink" onClick={()=>setPage("listings")}>Voir toutes →</button></div>
              <div className="grid">{loading?[1,2,3].map(i=><Skel key={i}/>):featured.map(l=><Card key={l.id} l={l} onClick={()=>open(l,"home")} favIds={favIds} onFav={toggleFav}/>)}</div>
            </div>
            <div className="sec" style={{paddingTop:0}}>
              <div className="sech"><h2 className="sectl">Dernières <span>annonces</span></h2><button className="seclink" onClick={()=>setPage("listings")}>Tout voir →</button></div>
              <div className="grid">{loading?[1,2,3,4,5,6].map(i=><Skel key={i}/>):listings.slice(0,6).map(l=><Card key={l.id} l={l} onClick={()=>open(l,"home")} favIds={favIds} onFav={toggleFav}/>)}</div>
            </div>
            <div style={{background:"var(--nv)",padding:"34px 20px",textAlign:"center"}}>
              <h2 style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:19,color:"#fff",marginBottom:6}}>🗺️ Explorez sur la carte</h2>
              <p style={{color:"rgba(255,255,255,.55)",fontSize:12,marginBottom:16}}>Visualisez les biens géolocalisés et les prix par quartier</p>
              <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                <button onClick={()=>setPage("map")} style={{background:"var(--au)",color:"#1a1a1a",padding:"9px 22px",borderRadius:100,font:"700 12px/1 var(--fd)",border:"none",cursor:"pointer"}}>Ouvrir la carte</button>
                <button onClick={()=>setPage("prices")} style={{background:"rgba(255,255,255,.12)",color:"#fff",padding:"9px 22px",borderRadius:100,font:"700 12px/1 var(--fd)",border:"1px solid rgba(255,255,255,.25)",cursor:"pointer"}}>📊 Prix par quartier</button>
              </div>
            </div>
            <div className="promo"><h2>Vous êtes une agence immobilière ?</h2><p>Publiez vos annonces, gérez vos clients et boostez votre visibilité.</p><button className="pbtn" onClick={()=>setShowAuth(true)}>🚀 Essai gratuit 30 jours</button></div>
          </>
        )}

        {/* ── LISTINGS ── */}
        {page==="listings"&&(
          <div className="sec">
            <h1 className="sectl" style={{marginBottom:18}}>Toutes les annonces <span style={{fontWeight:400,fontSize:15,color:"var(--mu)"}}>({filtered.length} résultats)</span></h1>
            <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
              <input className="si" style={{flex:1,minWidth:180}} placeholder="Rechercher par quartier, ville..." value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
            </div>
            <div className="fils">
              <span className="flab">Transaction :</span>
              {[["all","Tous"],["vente","Vente"],["location","Location"],["location_saisonniere","Saisonnier"]].map(([v,l])=><button key={v} className={`fbt ${txF===v?"on":""}`} onClick={()=>setTxF(v)}>{l}</button>)}
            </div>
            <div className="fils">
              <span className="flab">Type :</span>
              {[["all","Tous"],["appartement","🏢"],["maison","🏠"],["villa","🏡"],["terrain","🌿"],["bureau","💼"],["commerce","🏪"]].map(([v,l])=><button key={v} className={`fbt ${propF===v?"on":""}`} onClick={()=>setPropF(v)} title={v}>{l} {v!=="all"?v.charAt(0).toUpperCase()+v.slice(1):""}</button>)}
            </div>
            <AdvFilters filters={advF} onChange={(k,v)=>setAdvF(f=>({...f,[k]:v}))} onReset={()=>setAdvF({})}/>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10,fontWeight:800,color:"var(--mu)",textTransform:"uppercase",letterSpacing:".5px",alignSelf:"center"}}>Trier :</span>
                {[["date","Plus récentes"],["price_asc","Prix ↑"],["price_desc","Prix ↓"],["views","Plus vues"],["trust","Confiance"]].map(([v,l])=>(
                  <button key={v} className={`fbt ${sortBy===v?"on":""}`} onClick={()=>setSortBy(v)} style={{fontSize:10,padding:"5px 10px"}}>{l}</button>
                ))}
              </div>
              <button className="fbt" onClick={()=>user?setShowAlert(true):setShowAuth(true)} style={{display:"flex",alignItems:"center",gap:5}}>🔔 Créer une alerte</button>
            </div>
            {loading?<div className="grid">{[1,2,3,4,5,6].map(i=><Skel key={i}/>)}</div>:filtered.length===0?(
              <div style={{textAlign:"center",padding:"48px 20px",color:"var(--mu)"}}>
                <div style={{fontSize:38,marginBottom:8}}>🔍</div>
                <div style={{fontFamily:"var(--fd)",fontSize:16,fontWeight:700,color:"var(--tx)",marginBottom:5}}>Aucun résultat</div>
                <div style={{fontSize:12}}>Modifiez vos filtres ou votre recherche.</div>
                <button className="fbt" style={{marginTop:12}} onClick={()=>{setSearchQ("");setTxF("all");setPropF("all");setAdvF({});setSortBy("date");}}>Réinitialiser tout</button>
              </div>
            ):(
              <>
                <div className="grid">{paged.map(l=>(
                  <div key={l.id} style={{position:"relative"}}>
                    <Card l={l} onClick={()=>open(l,"listings")} favIds={favIds} onFav={toggleFav}/>
                    <button onClick={()=>toggleCmp(l)} title={cmpItems.find(x=>x.id===l.id)?"Retirer du comparateur":"Ajouter au comparateur"} style={{position:"absolute",bottom:46,right:10,background:cmpItems.find(x=>x.id===l.id)?"var(--nv)":"rgba(255,255,255,.92)",color:cmpItems.find(x=>x.id===l.id)?"#fff":"var(--mu)",border:"1.5px solid var(--br)",borderRadius:7,padding:"3px 8px",fontSize:10,fontWeight:700,cursor:"pointer",zIndex:10}}>
                      {cmpItems.find(x=>x.id===l.id)?"⚖️ ✓":"⚖️ Comparer"}
                    </button>
                  </div>
                ))}</div>
                {hasMore&&<div className="loadmore-wrap"><button className="loadmore-btn" onClick={()=>setListPage(p=>p+1)}>Voir plus d'annonces ({filtered.length-paged.length} restantes)</button></div>}
                {!hasMore&&filtered.length>PAGE_SIZE&&<div style={{textAlign:"center",padding:"20px 0",fontSize:12,color:"var(--mu)"}}>✅ Toutes les {filtered.length} annonces affichées</div>}
              </>
            )}
          </div>
        )}

        {/* ── MAP ── */}
        {page==="map"&&<MapPage listings={listings} onSelect={l=>open(l,"map")}/>}

        {/* ── PRICES ── */}
        {page==="prices"&&<div><div style={{maxWidth:1280,margin:"0 auto",padding:"20px 20px 0"}}><button className="bkb" onClick={()=>setPage("home")}>← Accueil</button><h1 style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:20,marginTop:14,marginBottom:4}}>📊 Marché immobilier sénégalais</h1><p style={{fontSize:13,color:"var(--mu)",marginBottom:0}}>Prix médians par quartier, mis à jour en temps réel depuis les annonces actives</p></div><PriceTable/></div>}

        {/* ── DETAIL ── */}
        {page==="detail"&&selected&&<DetailPage l={selected} user={user} onBack={()=>{setPage(prevPage);window.scrollTo(0,0);}} onOpenListing={l=>open(l,"detail")} onShowAgency={(id)=>showAgency(id,"detail")} favIds={favIds} onFav={toggleFav} showToast={showT}/>}

        {/* ── AGENCY PAGE ── */}
        {page==="agency"&&agencyId&&<AgencyPage agencyId={agencyId} onBack={()=>{setPage(prevPage);window.scrollTo(0,0);}} onOpenListing={l=>open(l,"agency")} favIds={favIds} onFav={toggleFav}/>}

        {/* ── DASHBOARD ── */}
        {page==="dashboard"&&user&&<Dashboard user={user} onOpenListing={l=>open(l,"dashboard")} onShowAgency={id=>showAgency(id,"dashboard")} onLogout={logout} favIds={favIds} onFav={toggleFav}/>}

        {/* FOOTER */}
        <footer className="footer">
          <div className="flogo">🏡 Sene<span>Galsen</span> Immobilier</div>
          <p style={{fontSize:11,marginBottom:9}}>La plateforme immobilière de référence au Sénégal</p>
          <div className="flinks">
            {["Accueil","Annonces","Carte","Prix","Agences","Contact","Mentions légales"].map(l=><span key={l} className="flnk" onClick={()=>{if(l==="Annonces")setPage("listings");else if(l==="Carte")setPage("map");else if(l==="Prix")setPage("prices");else if(l==="Accueil")setPage("home");}}>{l}</span>)}
          </div>
          <p style={{fontSize:10,opacity:.35}}>© 2026 SeneGalsen Immobilier · Dakar, Sénégal</p>
        </footer>
      </div>
    </>
  );
}
