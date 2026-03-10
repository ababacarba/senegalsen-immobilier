
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
    gt(col, val) { _params.push(`${col}=gt.${encodeURIComponent(val)}`); return api; },
    gte(col, val) { _params.push(`${col}=gte.${encodeURIComponent(val)}`); return api; },
    lt(col, val) { _params.push(`${col}=lt.${encodeURIComponent(val)}`); return api; },
    lte(col, val) { _params.push(`${col}=lte.${encodeURIComponent(val)}`); return api; },
    like(col, val) { _params.push(`${col}=like.${encodeURIComponent(val)}`); return api; },
    ilike(col, val) { _params.push(`${col}=ilike.${encodeURIComponent(val)}`); return api; },
    is(col, val) { _params.push(`${col}=is.${val}`); return api; },
    not(col, op, val) { _params.push(`${col}=not.${op}.${encodeURIComponent(val)}`); return api; },
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
      // Timeout 12s — évite les spinners bloqués si réseau lent
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
      try {
        const qs = _params.length ? "?" + _params.join("&") : "";
        const res = await fetch(_url + qs, {
          method: _method,
          headers: { ...sbHeaders(), ..._headers },
          body: _body ? JSON.stringify(_body) : undefined,
          signal: ctrl?.signal,
        });
        if (timer) clearTimeout(timer);
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
      } catch (e) {
        if (timer) clearTimeout(timer);
        resolve({ data: null, error: { message: e.name === 'AbortError' ? 'Délai réseau dépassé' : e.message }, count: null });
      }
    },
    // Fix: .catch() manquait sur le thenable — causa tous les spinners bloqués
    catch(fn) { return Promise.resolve(this).catch(fn); },
    finally(fn) { return Promise.resolve(this).finally(fn); }
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

// ─── Helper async robuste : setSaving(true) ... finally setSaving(false) ───
// Utilisé partout pour éviter les spinners bloqués en cas d'erreur réseau
async function withAsync(setLoading, fn, onErr){
  setLoading(true);
  try{ return await fn(); }
  catch(e){ onErr?.(e?.message||"Erreur réseau"); }
  finally{ setLoading(false); }
}

// ─────────────────────────────────────────────────────────
// Helper utilitaire : async avec setLoading/setSaving garanti
// Évite les spinners bloqués en cas d'erreur réseau inattendue
// ─────────────────────────────────────────────────────────
async function withLoading(setFn, asyncFn, onError){
  setFn(true);
  try{ await asyncFn(); }
  catch(e){ onError&&onError(e); }
  finally{ setFn(false); }
}

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
const CSS=``;

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// SYSTÈME "BIEN VÉRIFIÉ" — SENEGALSEN IMMOBILIER
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// SYSTÈME DE VÉRIFICATION SENEGALSEN — v2
// Conçu pour être lisible par tout utilisateur, même non averti.
// Principe : on ne marque "vérifié" que ce qui l'EST vraiment.
// Les informations déclarées par le vendeur restent distinctes.
// ══════════════════════════════════════════════════════════

// ─── Niveaux de confiance globaux (basés sur vérifications réelles) ───
const VLevels = {
  none:    {
    label:"Annonce non vérifiée",
    short:"Non vérifié",
    icon:"⚪",
    color:"#64748b", bg:"#f8fafc", border:"#e2e8f0",
    desc:"Cette annonce n'a fait l'objet d'aucune vérification de la part de SeneGalsen. Les informations proviennent uniquement du vendeur.",
    advice:"Soyez prudent. Demandez à rencontrer le vendeur, à visiter le bien et à vérifier les documents de propriété avant tout versement.",
    stars:1
  },
  partial: {
    label:"Vérification partielle",
    short:"Partielle",
    icon:"🟡",
    color:"#b45309", bg:"#fffbeb", border:"#fde68a",
    desc:"Certains éléments (identité, documents ou photos) ont été contrôlés par SeneGalsen. La visite terrain n'a pas encore été effectuée.",
    advice:"Des éléments ont été vérifiés, mais la visite physique manque encore. Nous vous recommandons de visiter le bien avant tout engagement.",
    stars:2
  },
  checked: {
    label:"Vendeur identifié",
    short:"ID vérifiée",
    icon:"🔵",
    color:"#1d4ed8", bg:"#eff6ff", border:"#bfdbfe",
    desc:"L'identité ou le statut professionnel du vendeur a été contrôlé et confirmé par SeneGalsen.",
    advice:"Le vendeur est identifié et sérieux. La visite terrain reste recommandée avant la signature.",
    stars:3
  },
  inspected: {
    label:"Bien inspecté sur place ✅",
    short:"Inspecté",
    icon:"✅",
    color:"#15803d", bg:"#f0fdf4", border:"#86efac",
    desc:"Un agent SeneGalsen s'est déplacé sur place, a visité le bien et a rédigé un rapport indépendant. C'est le niveau de confiance maximum.",
    advice:"Cette annonce offre les meilleures garanties disponibles sur SeneGalsen. Le rapport de notre agent est disponible ci-dessous.",
    stars:5
  },
};

// Calcul du niveau réel — AUCUNE triche avec les données self-declared
function getVLevel(l) {
  if (l.is_physically_verified) return "inspected";
  if (l.seller_verified || l.docs_verified || l.photos_verified) return "partial";
  if (l.is_verified) return "checked";
  return "none";
}

// ─── Badge compact pour les cards ───────────────────────
function TrustPill({listing}) {
  const lk = getVLevel(listing);
  const lv = VLevels[lk];
  return (
    <div style={{display:"flex",alignItems:"center",gap:3}}>
      <span style={{
        fontSize:9, padding:"2px 7px", borderRadius:100,
        background:lv.bg, color:lv.color, fontWeight:700,
        border:`1px solid ${lv.border}`,
        letterSpacing:".1px", whiteSpace:"nowrap"
      }}>{lv.icon} {lv.short}</span>
      <span style={{fontSize:10,color:"var(--mu)"}}>👁 {listing.views_count||0}</span>
    </div>
  );
}

// ─── Panneau de vérification complet (fiche annonce) ────
function VerificationPanel({listing, ownerProfile, inspections=[], user, onInspect}) {
  const lk = getVLevel(listing);
  const lv = VLevels[lk];
  const [expanded, setExpanded] = React.useState(lk !== "none");
  const [showDetails, setShowDetails] = React.useState(false);

  // Checks réels (pas de triche)
  const checks = {
    seller:    listing.seller_verified || (ownerProfile?.is_verified && (ownerProfile?.role==="agence"||ownerProfile?.role==="promoteur")),
    physical:  listing.is_physically_verified,
    docs:      listing.docs_verified,        // UNIQUEMENT si vraiment contrôlé
    photos:    listing.photos_verified,      // UNIQUEMENT si vraiment contrôlé
  };
  const countDone = Object.values(checks).filter(Boolean).length;

  // Infos déclarées par l'annonceur (pour la section 1)
  const declared = [
    { k:"Prix", v:fmt(listing.price)+(listing.transaction_type==="location"?" / mois":""), ok:true },
    { k:"Type de document", v:listing.document_type?DOC[listing.document_type]?.l||listing.document_type:"Non renseigné", ok:!!listing.document_type },
    { k:"Surface", v:listing.surface?listing.surface+" m²":"Non renseignée", ok:!!listing.surface },
    { k:"Description", v:listing.description&&listing.description.length>30?"Fournie":"Non fournie", ok:!!(listing.description&&listing.description.length>30) },
  ];

  const communityCount = listing.community_inspections_count || 0;

  return (
    <div style={{background:"#fff",border:`2px solid ${lv.border}`,borderRadius:12,overflow:"hidden",boxShadow:"var(--sh)"}}>

      {/* ── En-tête statut global ── */}
      <button
        onClick={()=>setExpanded(v=>!v)}
        style={{width:"100%",background:lv.bg,padding:"14px 16px",display:"flex",alignItems:"center",gap:12,border:"none",cursor:"pointer",textAlign:"left"}}
      >
        <div style={{flexShrink:0,textAlign:"center"}}>
          <div style={{fontSize:26,lineHeight:1,marginBottom:3}}>{lv.icon}</div>
          <div style={{display:"flex",gap:2,justifyContent:"center"}}>
            {[1,2,3,4,5].map(s=>(
              <div key={s} style={{width:6,height:6,borderRadius:50,background:s<=(lv.stars||0)?lv.color:"#e2e8f0",transition:".2s"}}/>
            ))}
          </div>
        </div>
        <div style={{flex:1}}>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:14,color:lv.color,marginBottom:2}}>{lv.label}</div>
          <div style={{fontSize:11,color:"#374151",lineHeight:1.5,marginBottom:4}}>{lv.desc}</div>
          {lv.advice&&<div style={{fontSize:10,background:lv.color+"18",color:lv.color,borderRadius:6,padding:"4px 8px",fontWeight:600,lineHeight:1.5}}>
            💡 {lv.advice}
          </div>}
        </div>
        <span style={{color:"var(--mu)",fontSize:16,flexShrink:0,marginLeft:4}}>{expanded?"▲":"▼"}</span>
      </button>

      {expanded && (
        <div style={{padding:"0 0 4px"}}>

          {/* ── SECTION 1 : Ce que l'annonceur déclare ── */}
          <div style={{padding:"12px 16px 4px",borderTop:"1px solid var(--br)"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
              <div style={{width:3,height:16,background:"#94a3b8",borderRadius:2}}/>
              <div style={{fontSize:11,fontWeight:800,color:"#374151",textTransform:"uppercase",letterSpacing:".5px"}}>📋 Ce que l'annonceur déclare</div>
            </div>
            <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 12px",marginBottom:6}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 16px"}}>
                {declared.map(({k,v,ok})=>(
                  <div key={k} style={{fontSize:11}}>
                    <span style={{color:"var(--mu)",fontWeight:600}}>{k} : </span>
                    <span style={{fontWeight:700,color:ok?"#1e293b":"#94a3b8"}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:8,background:"#fef3c7",border:"1px solid #fde68a",borderRadius:6,padding:"7px 10px",fontSize:10,color:"#92400e",lineHeight:1.6}}>
                ⚠️ <strong>Information non vérifiée.</strong> Ces données sont déclarées par le vendeur.
                SeneGalsen n'a pas encore confirmé leur exactitude de manière indépendante.
              </div>
            </div>
          </div>

          {/* ── SECTION 2 : Ce que SeneGalsen a vérifié ── */}
          <div style={{padding:"12px 16px 4px"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
              <div style={{width:3,height:16,background:"#0a5c36",borderRadius:2}}/>
              <div style={{fontSize:11,fontWeight:800,color:"#374151",textTransform:"uppercase",letterSpacing:".5px"}}>🔍 Ce que SeneGalsen a contrôlé</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[
                {
                  ico:"🪪", title:"Identité du vendeur",
                  done: checks.seller,
                  doneLabel: ownerProfile?.role==="agence"?"Agence vérifiée": ownerProfile?.role==="promoteur"?"Promoteur vérifié":"Vendeur vérifié",
                  pendingLabel:"Non encore contrôlée",
                  detail: checks.seller
                    ? "L'identité ou le statut professionnel du vendeur a été contrôlé par nos équipes."
                    : "L'équipe SeneGalsen n'a pas encore vérifié l'identité de ce vendeur."
                },
                {
                  ico:"🏠", title:"Visite physique du bien",
                  done: checks.physical,
                  doneLabel:"Agent SeneGalsen sur place",
                  pendingLabel:"Pas encore effectuée",
                  detail: checks.physical
                    ? "Un agent SeneGalsen s'est déplacé, a visité le bien et a rédigé un rapport indépendant ci-dessous."
                    : "Aucun agent SeneGalsen n'a encore visité ce bien. Le rapport sera disponible après inspection."
                },
                {
                  ico:"📄", title:"Documents de propriété",
                  done: checks.docs,
                  doneLabel:"Titre foncier contrôlé",
                  pendingLabel:"Non encore contrôlés",
                  detail: checks.docs
                    ? "Les documents de propriété ont été examinés et jugés conformes par SeneGalsen."
                    : listing.document_type
                      ? `Le vendeur déclare posséder un ${DOC[listing.document_type]?.l||listing.document_type}. Ce document n'a pas encore été examiné par SeneGalsen.`
                      : "Aucun document de propriété n'a été renseigné."
                },
                {
                  ico:"📸", title:"Authenticité des photos",
                  done: checks.photos,
                  doneLabel:"Photos certifiées sur place",
                  pendingLabel:"Non certifiées",
                  detail: checks.photos
                    ? "Les photos ont été prises par un agent SeneGalsen sur place. Elles correspondent à l'état réel du bien."
                    : "Les photos proviennent du vendeur. SeneGalsen n'a pas encore confirmé qu'elles correspondent au bien réel."
                },
              ].map(item=>(
                <VerifCheckRow key={item.title} {...item} showDetails={showDetails}/>
              ))}
            </div>
            <button
              onClick={()=>setShowDetails(v=>!v)}
              style={{background:"none",border:"none",fontSize:10,color:"var(--g)",cursor:"pointer",fontWeight:700,padding:"6px 0",width:"100%",textAlign:"left"}}
            >
              {showDetails?"▲ Masquer les explications":"▼ Voir les explications détaillées"}
            </button>
          </div>

          {/* ── SECTION 3 : Ce que la communauté dit ── */}
          <div style={{padding:"0 16px 12px"}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
              <div style={{width:3,height:16,background:"#4f46e5",borderRadius:2}}/>
              <div style={{fontSize:11,fontWeight:800,color:"#374151",textTransform:"uppercase",letterSpacing:".5px"}}>👥 Ce que la communauté dit</div>
            </div>
            {communityCount===0 ? (
              <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 12px",fontSize:11,color:"#64748b"}}>
                Aucun membre SeneGalsen n'a encore visité ce bien.{" "}
                {user&&<span style={{color:"#4f46e5",fontWeight:700,cursor:"pointer"}} onClick={onInspect}>Vous l'avez visité ? Partagez votre avis →</span>}
              </div>
            ):(
              <div>
                <div style={{background:"#eef2ff",borderRadius:8,padding:"10px 12px",marginBottom:6,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:22}}>👥</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:"#3730a3"}}>{communityCount} inspection{communityCount>1?"s":""} communautaire{communityCount>1?"s":""}</div>
                    <div style={{fontSize:10,color:"#4338ca"}}>Des membres SeneGalsen ont visité ce bien</div>
                  </div>
                </div>
                {inspections.slice(0,2).map(ins=>(
                  <div key={ins.id} style={{background:"#fafafa",borderRadius:8,padding:"9px 12px",marginBottom:5,border:"1px solid #e8e8e8"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontWeight:700,fontSize:11,display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:22,height:22,borderRadius:50,background:"#4f46e5",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800}}>
                          {(ins.profiles?.full_name||"?")[0].toUpperCase()}
                        </div>
                        {ins.profiles?.full_name||"Inspecteur"}
                      </div>
                      <span style={{fontSize:9,color:"var(--mu)"}}>{new Date(ins.created_at).toLocaleDateString("fr-SN")}</span>
                    </div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:ins.notes?4:0}}>
                      {ins.rating&&<span style={{color:"#f59e0b",fontSize:12}}>{"★".repeat(ins.rating)}{"☆".repeat(5-ins.rating)}</span>}
                      {ins.confirmed_info&&<span style={{background:"#f0fdf4",color:"#15803d",fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:100}}>✓ Infos confirmées</span>}
                      {ins.contested_info&&<span style={{background:"#fef2f2",color:"#dc2626",fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:100}}>⚠ Infos contestées</span>}
                      {ins.building_state&&<span style={{background:"var(--bg)",color:"var(--mu)",fontSize:9,padding:"1px 6px",borderRadius:100,border:"1px solid var(--br)"}}>
                        État : {ins.building_state==="bon"?"✅ Bon":ins.building_state==="moyen"?"⚠️ Moyen":"❌ Mauvais"}
                      </span>}
                    </div>
                    {ins.notes&&<div style={{fontSize:10,color:"var(--mu)",fontStyle:"italic"}}>"{ins.notes.slice(0,100)}{ins.notes.length>100?"…":""}"</div>}
                  </div>
                ))}
                {user&&<button onClick={onInspect} style={{width:"100%",background:"#eef2ff",border:"1.5px solid #c7d2fe",borderRadius:8,padding:"7px",fontSize:11,fontWeight:700,color:"#4338ca",cursor:"pointer"}}>+ Ajouter mon inspection</button>}
              </div>
            )}
          </div>

          {/* ── Récap visuel : progression de vérification ── */}
          <div style={{borderTop:"1px solid var(--br)",padding:"12px 16px",background:"#fafafa"}}>
            <div style={{fontSize:10,fontWeight:700,color:"var(--mu)",marginBottom:8,textTransform:"uppercase",letterSpacing:".5px"}}>
              Résumé — {countDone} vérification{countDone>1?"s":""} SeneGalsen sur 4
            </div>
            <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:8}}>
              {[
                {ico:"🪪",label:"Vendeur",ok:checks.seller},
                {ico:"🏠",label:"Visite",ok:checks.physical},
                {ico:"📄",label:"Docs",ok:checks.docs},
                {ico:"📸",label:"Photos",ok:checks.photos},
              ].map(({ico,label,ok},i,arr)=>(
                <React.Fragment key={label}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,flex:1}}>
                    <div style={{
                      width:34,height:34,borderRadius:50,
                      background:ok?"linear-gradient(135deg,#0a5c36,#16a34a)":"#f1f5f9",
                      border:`2px solid ${ok?"#16a34a":"#e2e8f0"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:15,
                      boxShadow:ok?"0 2px 6px #16a34a30":"none",
                      transition:".2s"
                    }}>
                      {ok?<span style={{color:"#fff",fontWeight:800,fontSize:13}}>✓</span>:<span style={{fontSize:14,opacity:.5}}>{ico}</span>}
                    </div>
                    <div style={{fontSize:8,fontWeight:700,color:ok?"#15803d":"#94a3b8",textAlign:"center"}}>{label}</div>
                  </div>
                  {i<arr.length-1&&<div style={{height:2,flex:.6,background:ok&&arr[i+1]?.ok?"linear-gradient(90deg,#16a34a,#16a34a)":ok?"linear-gradient(90deg,#16a34a,#e2e8f0)":"#e2e8f0",marginBottom:14,transition:".3s"}}/>}
                </React.Fragment>
              ))}
            </div>
            {communityCount>0&&(
              <div style={{display:"flex",alignItems:"center",gap:6,background:"#eef2ff",borderRadius:6,padding:"5px 10px",fontSize:10,color:"#4338ca",fontWeight:600}}>
                <span>👥</span>
                <span>{communityCount} membre{communityCount>1?"s":""} SeneGalsen {communityCount>1?"ont":"a"} également visité ce bien</span>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// Ligne de check individuelle (utilisée dans VerificationPanel)
function VerifCheckRow({ico,title,done,doneLabel,pendingLabel,detail,showDetails}){
  return(
    <div style={{background:done?"#f0fdf4":"#fafafa",borderRadius:8,border:`1.5px solid ${done?"#86efac":"#e2e8f0"}`,padding:"9px 12px"}}>
      <div style={{display:"flex",alignItems:"center",gap:9}}>
        <div style={{width:32,height:32,borderRadius:50,background:done?"#dcfce7":"#f1f5f9",border:`2px solid ${done?"#16a34a":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>
          {done?"✅":"⏳"}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            <span style={{fontWeight:700,fontSize:12}}>{ico} {title}</span>
            <span style={{fontSize:10,padding:"1px 7px",borderRadius:100,fontWeight:700,
              background:done?"#dcfce7":"#fef3c7",
              color:done?"#15803d":"#92400e",
              border:`1px solid ${done?"#86efac":"#fcd34d"}`
            }}>{done?doneLabel:pendingLabel}</span>
          </div>
          {showDetails&&<div style={{fontSize:10,color:"#475569",marginTop:4,lineHeight:1.6}}>{detail}</div>}
        </div>
      </div>
    </div>
  );
}

// Legacy Trust — conservé pour compatibilité mais simplifié
function Trust({score,lg,listing}){
  if(!listing)return null;
  if(lg) return null; // remplacé par VerificationPanel dans DetailPage
  // Version card: délègue à TrustPill
  return <TrustPill listing={listing}/>;
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
          <VLevelBadge level={getVLevel(l)}/>
          {l.is_investment_deal&&<InvestBadge yield_pct={l.expected_yield}/>}
        </div>
        <button className="cfav" onClick={e=>{e.stopPropagation();onFav&&onFav(l.id,!isFav)}} title={isFav?"Retirer des favoris":"Ajouter aux favoris"}>
          {isFav?"❤️":"🤍"}
        </button>
      </div>
      <div className="cbod">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:4}}>
          <div className="cpri">{fmt(l.price)}{l.transaction_type==="location"&&<small>/mois</small>}</div>
          {l.surface>0&&<div style={{fontSize:10,color:"var(--mu)",fontWeight:600,flexShrink:0}}>{Math.round(l.price/l.surface).toLocaleString("fr")} F/m²</div>}
        </div>
        <div className="ctit">{PICO[l.property_type]} {l.title}</div>
        <div className="cloc">📍 {l.quartier}, {l.city}</div>
        <div className="cmeta">
          {l.surface&&<div className="cmi">📐<strong>{l.surface}</strong>m²</div>}
          {l.rooms&&<div className="cmi">🏠<strong>{l.rooms}</strong>p.</div>}
          {l.bedrooms&&<div className="cmi">🛏<strong>{l.bedrooms}</strong></div>}
          {l.tour_360_url&&<div className="cmi" title="Visite 360°"><span style={{background:"#7c3aed22",color:"#7c3aed",borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700}}>360°</span></div>}
          {l.video_url&&<div className="cmi" title="Vidéo disponible"><span style={{background:"#0ea5e922",color:"#0ea5e9",borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700}}>▶</span></div>}
          {doc&&<div className="cmi"><span style={{background:doc.b,color:doc.c,borderRadius:3,padding:"1px 5px",fontSize:9,fontWeight:700}}>{doc.l}</span></div>}
        </div>

      </div>
      <div className="cft"><TrustPill listing={l}/></div>
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
const DEMO_ACCOUNTS=[
  {role:"admin",   icon:"🔐", label:"Admin",     email:"admin@senegalsen.sn",    name:"Amadou Diallo",  color:"#dc2626"},
  {role:"agence",  icon:"🏢", label:"Agence",    email:"agence@senegalsen.sn",   name:"Fatou Sall",     color:"#0a5c36"},
  {role:"agent",   icon:"🏡", label:"Agent",     email:"agent@senegalsen.sn",    name:"Moussa Ndiaye",  color:"#2563eb"},
  {role:"promoteur",icon:"🏗️",label:"Promoteur", email:"promoteur@senegalsen.sn",name:"Ibrahima Kane",  color:"#7c3aed"},
];

// ══════════════════════════════════════════════════════════
// AUTH MODAL — inscription multi-étapes Résident / Diaspora
// ══════════════════════════════════════════════════════════
const DIASPORA_COUNTRIES=[
  "France","Belgique","Canada","États-Unis","Italie","Espagne","Allemagne","Suisse","Portugal",
  "Pays-Bas","Royaume-Uni","Maroc","Côte d'Ivoire","Guinée","Mauritanie","Gabon","Cameroun",
  "Sénégal (autre ville)","Autre"
];
const NATIONALITIES=["Sénégalaise","Française","Belge","Canadienne","Américaine","Italienne","Espagnole","Autre"];
const INVEST_TYPES=[
  {k:"terrain",l:"🌿 Terrain"},
  {k:"appartement",l:"🏢 Appartement"},
  {k:"maison",l:"🏠 Maison"},
  {k:"villa",l:"🏡 Villa"},
  {k:"locatif",l:"💰 Investissement locatif"},
  {k:"commerce",l:"🏪 Local commercial"},
];
const BUDGET_RANGES=[
  {v:"",l:"Non défini"},
  {v:"10000000",l:"< 10M FCFA (< 15K€)"},
  {v:"30000000",l:"10–30M FCFA (15–45K€)"},
  {v:"60000000",l:"30–60M FCFA (45–90K€)"},
  {v:"100000000",l:"60–100M FCFA (90–150K€)"},
  {v:"200000000",l:"100–200M FCFA (150–300K€)"},
  {v:"500000000",l:"> 200M FCFA (> 300K€)"},
];

function AuthModal({onClose,onSuccess}){
  const [tab,setTab]=useState("login");
  // Signup multi-étapes
  const [signupStep,setSignupStep]=useState(0); // 0=choix type, 1=infos base, 2=diaspora extras
  const [userType,setUserType]=useState(null); // "resident" | "diaspora"
  // Champs communs
  const [firstName,setFirstName]=useState(""), [lastName,setLastName]=useState("");
  const [email,setEmail]=useState(""), [pass,setPass]=useState(""), [passConfirm,setPassConfirm]=useState("");
  // Champs diaspora
  const [countryRes,setCountryRes]=useState("France");
  const [cityRes,setCityRes]=useState(""), [nationality,setNationality]=useState("Sénégalaise");
  const [budget,setBudget]=useState(""), [propTypes,setPropTypes]=useState([]);
  const [zone,setZone]=useState("");
  // États
  const [loading,setLoading]=useState(false), [err,setErr]=useState(""), [ok,setOk]=useState("");
  const [demoLoading,setDemoLoading]=useState(null);
  const [showPass,setShowPass]=useState(false);

  function togglePropType(k){setPropTypes(t=>t.includes(k)?t.filter(x=>x!==k):[...t,k]);}
  function goToStep(n){setSignupStep(n);setErr("");setOk("");}
  function goToTab(t){setTab(t);setErr("");setOk("");setSignupStep(0);}

  async function login(e){
    e.preventDefault();setErr("");setLoading(true);
    const{data,error}=await sb.auth.signInWithPassword({email,password:pass});
    setLoading(false);
    if(error){setErr(error.message||"Identifiants incorrects");return;}
    onSuccess(data.user);
  }

  async function signup(e){
    if(e&&e.preventDefault)e.preventDefault();
    setErr("");
    // Validation: type de compte obligatoire
    if(!userType){setErr("Veuillez sélectionner votre type de compte.");return;}
    if(pass!==passConfirm){setErr("Les mots de passe ne correspondent pas.");return;}
    if(pass.length<8){setErr("Mot de passe trop court (min. 8 caractères).");return;}
    if(!firstName.trim()||!lastName.trim()){setErr("Prénom et nom requis.");return;}
    setLoading(true);
    const fullName=`${firstName.trim()} ${lastName.trim()}`;

    // Tous les champs passés en metadata — le trigger handle_new_user les persiste
    // dans public.profiles et auto-confirme l'email (connexion immédiate possible)
    // Sécurité: userType ne peut jamais être null en DB
    const safeUserType = userType || "resident";
    const metadata={
      full_name:fullName,
      user_type:safeUserType,
      ...(safeUserType==="diaspora"&&{
        country_residence:countryRes||null,
        city_residence:cityRes||null,
        nationality:nationality||"Sénégalaise",
        investment_budget:budget||null,
        property_type_interest:propTypes.length>0?propTypes:null,
        zone_interest:zone||null,
      })
    };

    const{error:signUpError}=await sb.auth.signUp({email,password:pass,options:{data:metadata}});
    if(signUpError){setErr(signUpError.message||"Erreur lors de l\'inscription.");setLoading(false);return;}

    // Connexion immédiate — le trigger DB a auto-confirmé l'email
    const{data:loginData,error:loginError}=await sb.auth.signInWithPassword({email,password:pass});
    setLoading(false);

    if(loginError){
      // Fallback : compte créé mais connexion différée (email non encore confirmé)
      setOk(userType==="diaspora"
        ?"🎉 Compte Diaspora créé ! Cliquez le lien reçu par email puis reconnectez-vous."
        :"✅ Compte créé ! Vérifiez vos emails puis reconnectez-vous.");
      return;
    }

    // Succès — connexion immédiate
    onSuccess(loginData.user);
    // Note: DiasporaWelcome sera déclenché dans App.onSuccess via profil DB
  }
  async function demoLogin(account){
    setDemoLoading(account.role);setErr("");
    const{data,error}=await sb.auth.signInWithPassword({email:account.email,password:"Demo1234!"});
    setDemoLoading(null);
    if(error){setErr("Erreur démo : "+error.message);return;}
    onSuccess(data.user);
  }

  const passOk = !passConfirm || pass===passConfirm;
  const step1Valid = firstName.trim()&&lastName.trim()&&email.trim()&&pass.length>=8&&pass===passConfirm;

  const DemoBlock=()=>(
    <div style={{background:"linear-gradient(135deg,#0a5c36 0%,#1a3a5c 100%)",borderRadius:12,padding:"14px 16px",marginBottom:18}}>
      <div style={{color:"#fff",fontWeight:800,fontSize:12,marginBottom:10,display:"flex",alignItems:"center",gap:6,textTransform:"uppercase",letterSpacing:".5px"}}>⚡ Connexion démo rapide</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
        {DEMO_ACCOUNTS.map(acc=>(
          <button key={acc.role} onClick={()=>demoLogin(acc)} disabled={demoLoading!==null}
            style={{background:"rgba(255,255,255,.12)",border:"1.5px solid rgba(255,255,255,.25)",borderRadius:9,padding:"9px 10px",cursor:"pointer",transition:".18s",textAlign:"left",opacity:demoLoading&&demoLoading!==acc.role?.5:1}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{fontSize:18}}>{acc.icon}</span>
              <div>
                <div style={{color:"#fff",fontWeight:700,fontSize:12}}>{demoLoading===acc.role?"Connexion...":acc.label}</div>
                <div style={{color:"rgba(255,255,255,.6)",fontSize:9}}>{acc.name}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div style={{color:"rgba(255,255,255,.45)",fontSize:9,marginTop:9,textAlign:"center"}}>Mot de passe démo : Demo1234!</div>
    </div>
  );

  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:tab==="signup"&&signupStep===2?500:440}}>
        <div className="mhd">
          <div className="mtit">
            {tab==="signup"
              ?signupStep===0?"👤 Créer un compte":signupStep===1?"📝 Inscription":"🌍 Profil Diaspora"
              :"🏡 SeneGalsen"}
          </div>
          <button className="mcls" onClick={onClose}>✕</button>
        </div>
        <div className="mbd">

          {/* ── DÉMO + TABS (login et step 0 uniquement) ── */}
          {(tab==="login"||(tab==="signup"&&signupStep===0))&&<DemoBlock/>}
          {(tab==="login"||(tab==="signup"&&signupStep===0))&&(
            <div className="divd">{tab==="login"?"ou connectez-vous avec votre compte":"ou créez un compte gratuitement"}</div>
          )}
          {(tab==="login"||(tab==="signup"&&signupStep===0))&&(
            <div className="mtabs">
              <button className={`mtab ${tab==="login"?"on":""}`} onClick={()=>goToTab("login")}>Connexion</button>
              <button className={`mtab ${tab==="signup"?"on":""}`} onClick={()=>goToTab("signup")}>Inscription</button>
            </div>
          )}

          {err&&<div className="al ale">❌ {err}</div>}
          {ok&&<div className="al alo">{ok}</div>}

          {/* ── LOGIN ── */}
          {tab==="login"&&(
            <form onSubmit={login}>
              <div className="fg"><label className="fl">Email <span>*</span></label><input className="fi" type="email" placeholder="votre@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
              <div className="fg"><label className="fl">Mot de passe <span>*</span></label><input className="fi" type="password" placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} required/></div>
              <button className="fbt2 fbg" type="submit" disabled={loading}>{loading?"Connexion...":"Se connecter"}</button>
              <p style={{textAlign:"center",fontSize:11,color:"var(--mu)",marginTop:10}}>Pas de compte ? <button type="button" onClick={()=>goToTab("signup")} style={{color:"var(--g)",fontWeight:700,background:"none",border:"none",cursor:"pointer"}}>S'inscrire gratuitement</button></p>
            </form>
          )}

          {/* ── STEP 0 : Choix profil ── */}
          {tab==="signup"&&signupStep===0&&(
            <div>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:17,marginBottom:6}}>Quel est votre profil ?</div>
                <div style={{color:"var(--mu)",fontSize:12}}>Choisissez pour personnaliser votre expérience</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
                <button type="button" onClick={()=>setUserType("resident")}
                  className={`auth-type-card${userType==="resident"?" selected":""}`}>
                  <div className="auth-type-ico">🇸🇳</div>
                  <div className="auth-type-title">Résident</div>
                  <div className="auth-type-desc">Je vis au Sénégal et souhaite acheter, vendre ou louer un bien.</div>
                  {userType==="resident"&&<div className="auth-type-check">✓</div>}
                </button>
                <button type="button" onClick={()=>setUserType("diaspora")}
                  className={`auth-type-card${userType==="diaspora"?" selected":""}`}>
                  <div className="auth-type-ico">🌍</div>
                  <div className="auth-type-title">Diaspora / Expatrié</div>
                  <div className="auth-type-desc">Je vis à l'étranger et souhaite investir ou acquérir un bien au Sénégal.</div>
                  {userType==="diaspora"&&<div className="auth-type-check">✓</div>}
                </button>
              </div>
              {userType&&(
                <button className="fbt2 fbg" onClick={()=>goToStep(1)}>
                  {userType===null?"Choisissez votre profil ↑":userType==="diaspora"?"🌍 Continuer — Diaspora / Expatrié":"🇸🇳 Continuer — Résident →"}
                </button>
              )}
            </div>
          )}

          {/* ── STEP 1 : Infos de base ── */}
          {tab==="signup"&&signupStep===1&&(
            <form onSubmit={userType==="diaspora"?e=>{e.preventDefault();if(step1Valid)goToStep(2);}:signup}>
              <div className="auth-step-header">
                <button type="button" className="auth-back" onClick={()=>goToStep(0)}>← Retour</button>
                <div className="auth-step-title">
                  {userType==="diaspora"
                    ?<><span className="auth-step-badge diaspora">🌍 Diaspora</span> Vos informations</>
                    :<><span className="auth-step-badge resident">🇸🇳 Résident</span> Vos informations</>}
                </div>
                <div className="auth-step-dots">
                  <span className="dot on"/>
                  <span className={`dot${userType==="diaspora"?" on":""}`}/>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                <div className="fg"><label className="fl">Prénom <span>*</span></label><input className="fi" autoFocus placeholder="Ibrahima" value={firstName} onChange={e=>setFirstName(e.target.value)} required/></div>
                <div className="fg"><label className="fl">Nom <span>*</span></label><input className="fi" placeholder="Diallo" value={lastName} onChange={e=>setLastName(e.target.value)} required/></div>
              </div>
              <div className="fg"><label className="fl">Email <span>*</span></label><input className="fi" type="email" placeholder="votre@email.com" value={email} onChange={e=>setEmail(e.target.value)} required/></div>
              <div className="fg" style={{position:"relative"}}>
                <label className="fl">Mot de passe <span>*</span></label>
                <input className="fi" type={showPass?"text":"password"} placeholder="Min. 8 caractères" value={pass} onChange={e=>setPass(e.target.value)} minLength={8} required style={{paddingRight:42}}/>
                <button type="button" onClick={()=>setShowPass(s=>!s)} style={{position:"absolute",right:10,top:32,background:"none",border:"none",cursor:"pointer",fontSize:15,color:"var(--mu)"}}>{showPass?"🙈":"👁"}</button>
              </div>
              <div className="fg">
                <label className="fl">Confirmer le mot de passe <span>*</span></label>
                <input className="fi" type="password" placeholder="Répétez le mot de passe" value={passConfirm} onChange={e=>setPassConfirm(e.target.value)} required
                  style={{borderColor:passConfirm&&!passOk?"#ef4444":undefined}}/>
                {passConfirm&&!passOk&&<div style={{color:"#ef4444",fontSize:10,marginTop:3}}>Les mots de passe ne correspondent pas</div>}
              </div>
              {userType==="diaspora"?(
                <button type="submit" className="fbt2 fbg" disabled={!step1Valid}>
                  Continuer — Profil Diaspora →
                </button>
              ):(
                <button type="submit" className="fbt2 fbg" disabled={loading||!step1Valid}>
                  {loading?"Création du compte...":"🇸🇳 Créer mon compte"}
                </button>
              )}
            </form>
          )}

          {/* ── STEP 2 : Profil Diaspora ── */}
          {tab==="signup"&&signupStep===2&&(
            <form onSubmit={signup}>
              <div className="auth-step-header">
                <button type="button" className="auth-back" onClick={()=>goToStep(1)}>← Retour</button>
                <div className="auth-step-title"><span className="auth-step-badge diaspora">🌍 Diaspora</span> Profil investisseur</div>
                <div className="auth-step-dots"><span className="dot on"/><span className="dot on"/></div>
              </div>

              <div className="diaspora-form-section">
                <div className="diaspora-form-title">📍 Localisation</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  <div className="fg">
                    <label className="fl">Pays de résidence <span>*</span></label>
                    <select className="fi" value={countryRes} onChange={e=>setCountryRes(e.target.value)} required>
                      {DIASPORA_COUNTRIES.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label className="fl">Ville de résidence</label><input className="fi" placeholder="Paris, Bruxelles..." value={cityRes} onChange={e=>setCityRes(e.target.value)}/></div>
                  <div className="fg">
                    <label className="fl">Nationalité</label>
                    <select className="fi" value={nationality} onChange={e=>setNationality(e.target.value)}>
                      {NATIONALITIES.map(n=><option key={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="diaspora-form-section">
                <div className="diaspora-form-title">🏠 Projet immobilier <span style={{fontWeight:400,color:"var(--mu)"}}>(optionnel mais recommandé)</span></div>
                <div className="fg">
                  <label className="fl">Budget d'investissement</label>
                  <select className="fi" value={budget} onChange={e=>setBudget(e.target.value)}>
                    {BUDGET_RANGES.map(b=><option key={b.v} value={b.v}>{b.l}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label className="fl">Type(s) de bien recherché(s)</label>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginTop:4}}>
                    {INVEST_TYPES.map(({k,l})=>(
                      <div key={k} className={`fchip${propTypes.includes(k)?" on":""}`} onClick={()=>togglePropType(k)} style={{fontSize:11,padding:"7px 5px",textAlign:"center",cursor:"pointer"}}>
                        {l}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="fg">
                  <label className="fl">Zone d'intérêt au Sénégal</label>
                  <select className="fi" value={zone} onChange={e=>setZone(e.target.value)}>
                    <option value="">Non précisé</option>
                    {REGIONS.map(r=><option key={r}>{r}</option>)}
                    <option value="Almadies / Ngor">Almadies / Ngor (Dakar)</option>
                    <option value="Plateau / Centre">Plateau / Centre (Dakar)</option>
                    <option value="Saly / Mbour">Saly / Mbour (balnéaire)</option>
                    <option value="Thiès / Ziguinchor">Thiès / Ziguinchor</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="fbt2 fbg" disabled={loading||!countryRes} style={{background:"linear-gradient(135deg,#0a5c36,#1e3a5f)"}}>
                {loading?"Création du compte...":"🌍 Créer mon compte Diaspora"}
              </button>
              <p style={{textAlign:"center",fontSize:10,color:"var(--mu)",marginTop:8}}>
                Vous pourrez compléter ces informations depuis votre tableau de bord.
              </p>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MODAL BIENVENUE DIASPORA
// ══════════════════════════════════════════════════════════
function DiasporaWelcomeModal({profile,onClose,onBrowse,onEstim}){
  const steps=[
    {ico:"🔍",t:"Explorez les annonces",d:"Filtrez par ville, budget, type de bien. Toutes les annonces affichent le score de confiance SeneGalsen."},
    {ico:"📡",t:"Demandez une visite vidéo",d:"Sur n'importe quelle annonce, cliquez 'Visite à distance' pour une visite WhatsApp ou Zoom."},
    {ico:"💱",t:"Consultez les prix en devises",d:"Chaque prix est convertible en EUR, USD, CAD et GBP directement sur la fiche du bien."},
    {ico:"💰",t:"Simulez votre rentabilité",d:"Notre calculateur estime le rendement locatif brut et net de votre investissement."},
    {ico:"✅",t:"Biens vérifiés physiquement",d:"Le badge 🏅 confirme qu'un agent SeneGalsen a visité le bien et authentifié les documents."},
  ];
  return(
    <div className="ov" style={{zIndex:9999}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:520}}>
        <div style={{background:"linear-gradient(135deg,#0a5c36,#1e3a5f)",borderRadius:"12px 12px 0 0",padding:"28px 24px",textAlign:"center",position:"relative"}}>
          <button className="mcls" onClick={onClose} style={{position:"absolute",top:12,right:12,color:"rgba(255,255,255,.7)"}}>✕</button>
          <div style={{fontSize:52,marginBottom:10}}>🌍</div>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:22,color:"#fff",marginBottom:6}}>
            Bienvenue, {profile?.full_name?.split(" ")[0]||"cher membre"} !
          </div>
          <div style={{color:"rgba(255,255,255,.75)",fontSize:13,lineHeight:1.6}}>
            Votre compte Diaspora est créé. Voici comment investir en toute sécurité au Sénégal depuis {profile?.country_residence||"l'étranger"}.
          </div>
        </div>
        <div className="mbd">
          {profile?.country_residence&&(
            <div style={{background:"var(--gl)",border:"1.5px solid var(--gm)",borderRadius:10,padding:"10px 14px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}>
              <span style={{fontSize:22}}>📍</span>
              <div style={{fontSize:12,color:"var(--g)"}}>
                <strong>Profil Diaspora — {profile.country_residence}</strong>
                {profile.zone_interest&&<span> · Zone : {profile.zone_interest}</span>}
                {profile.investment_budget&&<span> · Budget : {parseInt(profile.investment_budget).toLocaleString("fr")} FCFA</span>}
              </div>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
            {steps.map((s,i)=>(
              <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"10px 12px",background:"var(--bg)",borderRadius:10,border:"1px solid var(--br)"}}>
                <div style={{width:32,height:32,borderRadius:50,background:"var(--g)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14}}>{s.ico}</div>
                <div><div style={{fontWeight:700,fontSize:13,marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:"var(--mu)",lineHeight:1.5}}>{s.d}</div></div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <button className="fbt2 fbg" onClick={onBrowse}>🏠 Voir les annonces</button>
            <button className="fbt2" style={{background:"var(--bg)",border:"1.5px solid var(--br)",color:"var(--tx)",fontWeight:700}} onClick={onEstim}>💰 Simuler un investissement</button>
          </div>
          <p style={{textAlign:"center",fontSize:10,color:"var(--mu)",marginTop:12}}>
            📧 Un email de confirmation a été envoyé à votre adresse. Vérifiez vos spams si nécessaire.
          </p>
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
      const ico=L.divIcon({className:"",html:`<div style="background:${tx.bg};color:${tx.color};padding:3px 8px;border-radius:100px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.28);font-family:'Plus Jakarta Sans',sans-serif;border:2px solid rgba(255,255,255,.5)">${l.price>=1e6?(l.price/1e6).toFixed(0)+"M":(l.price/1e3).toFixed(0)+"K"}</div>`,iconAnchor:[0,0]});
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
function AgencyPage({agencyId,onBack,onOpenListing,favIds,onFav,user,showToast}){
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
  const [showVisit,setShowVisit]=useState(false);
  const [ownerProfile,setOwnerProfile]=useState(null);
  const [showReport,setShowReport]=useState(false);
  const [showMortgage,setShowMortgage]=useState(false);
  const [mktStats,setMktStats]=useState(null);
  const [inspections,setInspections]=useState([]);
  const [showInspectModal,setShowInspectModal]=useState(false);
  useEffect(()=>{
    sb.rpc("increment_listing_views",{listing_uuid:l.id}).catch(()=>{});
    sb.rpc("get_similar_listings",{p_listing_id:l.id,p_property_type:l.property_type,p_transaction_type:l.transaction_type,p_quartier:l.quartier||"",p_price:l.price,p_limit:4}).then(({data})=>setSimilar(data||[]));
    if(l.agency_id)sb.from("agencies").select("*").eq("id",l.agency_id).single().then(({data})=>setAgency(data));
    if(l.owner_id)sb.from("profiles").select("*").eq("id",l.owner_id).single().then(({data})=>setOwnerProfile(data));
    if(user){sb.from("recently_viewed").upsert({user_id:user.id,listing_id:l.id,viewed_at:new Date().toISOString()},{onConflict:"user_id,listing_id"}).catch(()=>{});}
    if(l.quartier){
      sb.from("market_stats").select("*").eq("quartier",l.quartier).eq("property_type",l.property_type).eq("transaction_type",l.transaction_type).single()
        .then(({data})=>{if(data)setMktStats(data);});
    }
    // Charger les inspections communautaires validées
    sb.from("property_inspections").select("*,profiles(full_name,inspector_level,inspector_score)").eq("listing_id",l.id).eq("status","validated").order("created_at",{ascending:false}).limit(5)
      .then(({data})=>{if(data)setInspections(data);});
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
      {showVisit&&<VisitRequestModal listing={l} user={user} onClose={()=>setShowVisit(false)} showToast={showToast}/>}
      {showReport&&<ReportModal listing={l} user={user} onClose={()=>setShowReport(false)} showToast={showToast}/>}
      {showMortgage&&<MortgageModal price={l.price} onClose={()=>setShowMortgage(false)}/>}
      {showInspectModal&&<CommunityInspectionModal listing={l} user={user} onClose={()=>setShowInspectModal(false)} showToast={showToast}/>}
      <button className="bkb" onClick={onBack}>← Retour</button>
      <div className="detl">
        <div>
          <ImageGallery listing={l}/>
          <div className="dtags">
            <span className="bdg" style={{...tx,padding:"5px 12px",borderRadius:7,fontSize:12}}>{TXL[l.transaction_type]}</span>
            <span className="tag" style={{background:"#f3f4f6",color:"#374151"}}>{PICO[l.property_type]} {l.property_type}</span>
            {l.is_verified&&<span className="tag" style={{background:"#dcfce7",color:"#166534"}}>✅ Vérifié</span>}
            {l.is_physically_verified&&<span style={{background:"#dcfce7",color:"#15803d",fontWeight:700,fontSize:11,padding:"4px 10px",borderRadius:6,border:"1px solid #86efac"}}>✅ Inspecté sur place</span>}
            {l.is_premium&&<span className="tag" style={{background:"var(--al)",color:"#92400e"}}>⭐ Premium</span>}
          </div>
          {l.video_url&&(
            <div style={{marginBottom:12,borderRadius:"var(--r)",overflow:"hidden",border:"1px solid var(--br)"}}>
              <div style={{background:"#000",borderRadius:"var(--r)",padding:"8px 12px 6px",display:"flex",alignItems:"center",gap:6,marginBottom:0}}>
                <span style={{color:"#ef4444",fontSize:12}}>▶</span>
                <span style={{color:"#fff",fontSize:11,fontWeight:700}}>Vidéo de présentation</span>
              </div>
              <video controls style={{width:"100%",display:"block",maxHeight:320,background:"#000"}} src={l.video_url} poster={l.cover_image}>Votre navigateur ne supporte pas la vidéo.</video>
            </div>
          )}
          {l.tour_360_url&&(
            <div style={{marginBottom:12,border:"1px solid #c4b5fd",borderRadius:"var(--r)",overflow:"hidden"}}>
              <div style={{background:"linear-gradient(135deg,#7c3aed,#6d28d9)",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:16}}>🌐</span>
                  <span style={{color:"#fff",fontWeight:700,fontSize:12}}>Visite virtuelle 360°</span>
                </div>
                <a href={l.tour_360_url} target="_blank" rel="noopener noreferrer" style={{color:"#e9d5ff",fontSize:10,fontWeight:700}}>Ouvrir en plein écran ↗</a>
              </div>
              <iframe src={l.tour_360_url} style={{width:"100%",height:280,border:"none",display:"block"}} title="Visite 360°" allow="fullscreen"/>
            </div>
          )}
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
          {/* ── Rubrique 1 : Description du propriétaire ── */}
          {l.description&&(
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
                <div style={{width:4,height:20,background:"var(--g)",borderRadius:2,flexShrink:0}}/>
                <div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14}}>Description du propriétaire</div>
                <span style={{fontSize:10,background:"var(--bg)",color:"var(--mu)",padding:"2px 8px",borderRadius:100,border:"1px solid var(--br)",fontWeight:600}}>rédigée par l'annonceur</span>
              </div>
              <p style={{fontSize:13,lineHeight:1.75,color:"#374151",background:"#fafafa",borderRadius:9,padding:"13px 16px",border:"1px solid var(--br)",margin:0}}>{l.description}</p>
            </div>
          )}

          {/* ── Rubrique 2 : Avis SeneGalsen (agent vérificateur) ── */}
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
              <div style={{width:4,height:20,background:l.is_physically_verified?"#16a34a":"#94a3b8",borderRadius:2,flexShrink:0}}/>
              <div style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:14}}>Rapport SeneGalsen</div>
              {l.is_physically_verified
                ? <span style={{fontSize:10,background:"#dcfce7",color:"#16a34a",padding:"2px 8px",borderRadius:100,fontWeight:700}}>🏅 Vérifié sur place</span>
                : <span style={{fontSize:10,background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:100,fontWeight:600}}>⏳ En attente de vérification</span>
              }
            </div>
            {l.agent_verified_description
              ? (
                <div style={{background:l.is_physically_verified?"linear-gradient(135deg,#f0fdf4,#ecfdf5)":"var(--bg)",border:`1.5px solid ${l.is_physically_verified?"#86efac":"var(--br)"}`,borderRadius:10,padding:"15px 18px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <div style={{width:38,height:38,borderRadius:50,background:"linear-gradient(135deg,#0a5c36,#1e3a5f)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🏅</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:12,color:"#065f46"}}>
                        {l.agent_verified_by_name||"Agent SeneGalsen"}
                      </div>
                      {l.agent_verified_date&&(
                        <div style={{fontSize:10,color:"var(--mu)",marginTop:1}}>
                          Visité le {new Date(l.agent_verified_date).toLocaleDateString("fr-SN",{day:"2-digit",month:"long",year:"numeric"})}
                        </div>
                      )}
                    </div>
                  </div>
                  <p style={{fontSize:13,lineHeight:1.75,color:"#065f46",margin:0}}>{l.agent_verified_description}</p>
                </div>
              ) : (
                <div style={{background:"var(--bg)",borderRadius:10,padding:"18px",textAlign:"center",border:"1.5px dashed var(--br)"}}>
                  <div style={{fontSize:28,marginBottom:8}}>🏅</div>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--tx)",marginBottom:4}}>Ce bien n'a pas encore été inspecté</div>
                  <div style={{fontSize:12,color:"var(--mu)",lineHeight:1.6,marginBottom:12}}>
                    Nos agents SeneGalsen visitent physiquement les biens et rédigent un rapport indépendant.
                    Ce rapport confirme ou corrige les informations de l'annonce.
                  </div>
                  <a href="#" onClick={e=>{e.preventDefault();}} style={{fontSize:11,color:"var(--g)",fontWeight:700,textDecoration:"none"}}>
                    🔗 En savoir plus sur la vérification terrain →
                  </a>
                </div>
              )
            }
          </div>

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
              <CurrencyWidget amountXOF={l.price}/>
            </div>
            <div className="ccbd">
              {l.surface>0&&<div style={{background:"var(--bg)",borderRadius:8,padding:"8px 12px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,color:"var(--mu)",fontWeight:600}}>Prix au m²</span>
                <span style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:13,color:"var(--g)"}}>{Math.round(l.price/l.surface).toLocaleString("fr")} FCFA</span>
              </div>}
              {mktStats&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 12px",marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:800,color:"#1e3a5f",marginBottom:4}}>📊 Marché {l.quartier}</div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--tx)"}}>
                  <span>Médiane : <strong>{(mktStats.median_price||0).toLocaleString("fr")} F</strong></span>
                  <span>{mktStats.listing_count} annonces</span>
                </div>
                {mktStats.avg_price_per_m2&&<div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>Moy. {mktStats.avg_price_per_m2.toLocaleString("fr")} F/m² dans ce quartier</div>}
              </div>}
              {/* ══ SYSTÈME DE VÉRIFICATION SENEGALSEN ══ */}
              <VerificationPanel
                listing={l}
                ownerProfile={ownerProfile}
                inspections={inspections}
                user={user}
                onInspect={()=>setShowInspectModal(true)}
              />
              {l.is_investment_deal&&<InvestBadge yield_pct={l.expected_yield} lg/>}
              <button className="btn btg">📞 Appeler l'annonceur</button>
              <WaBtnPro listing={l} ownerProfile={ownerProfile} showToast={showToast}/>
              <button className="btn bto" onClick={handleContact}>✉️ Envoyer un message</button>
              <button className="btn" style={{background:"linear-gradient(135deg,#0ea5e9,#0284c7)",color:"#fff",fontWeight:700,fontSize:13}} onClick={()=>setShowVisit(true)}>📡 Visite à distance</button>
              {l.transaction_type!=="location"&&<button className="btn bty" onClick={()=>setShowSim(true)}>📊 Simuler la rentabilité</button>}
              {l.transaction_type!=="location"&&<button className="btn" style={{background:"linear-gradient(135deg,#0a5c36,#16a34a)",color:"#fff",fontWeight:700,fontSize:13}} onClick={()=>setShowMortgage(true)}>🏦 Calculer mon crédit</button>}
              <ShareBtn listing={l} showToast={showToast}/>
              <button className="btn" style={{background:"var(--bg)",color:"var(--tx)",border:"1.5px solid var(--br)",fontWeight:600,fontSize:12}} onClick={()=>onFav(l.id,!favIds.includes(l.id))}>
                {favIds.includes(l.id)?"❤️ Retirer des favoris":"🤍 Ajouter aux favoris"}
              </button>
              <div style={{fontSize:10,color:"var(--mu)",textAlign:"center"}}>👁 {l.views_count} vues · 📩 {l.contacts_count} contacts</div>
              <button onClick={()=>setShowReport(true)} style={{background:"none",border:"none",fontSize:10,color:"#ef4444",cursor:"pointer",width:"100%",textAlign:"center",marginTop:4,padding:"4px 0"}}>🚩 Signaler cette annonce</button>
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
      {(l.agency_id||l.owner_id)&&(
        <div style={{padding:"0 0 40px"}}>
          <div className="sech" style={{marginBottom:18,paddingTop:32}}><h2 className="sectl">Avis sur <span>l'annonceur</span></h2></div>
          <ReviewsBlock
            targetId={l.agency_id||l.owner_id}
            targetType={l.agency_id?"agency":"agent"}
            user={user}
            showToast={showToast}
          />
        </div>
      )}
      <WaFloat listing={l} ownerProfile={ownerProfile}/>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// ADVANCED FILTER PANEL
// ══════════════════════════════════════════════════════════
const PRICE_STEPS=[0,5e6,10e6,20e6,30e6,50e6,75e6,100e6,150e6,200e6,300e6,500e6,1e9];
const fmtStep=v=>v>=1e9?"1 Md+":v>=1e6?(v/1e6).toFixed(0)+"M":v>=1e3?(v/1e3).toFixed(0)+"K":"0";

function AdvFilters({filters,onChange,onReset}){
  const [open,setOpen]=useState(false);
  const activeCount=[filters.priceMin,filters.priceMax,filters.surfMin,filters.surfMax,filters.bedrooms,filters.docType,filters.region,filters.investOnly,filters.verifiedOnly,filters.vConfidence].filter(Boolean).length;
  return(
    <div style={{marginBottom:14}}>
      <button className={`fbt ${activeCount>0?"on":""}`} onClick={()=>setOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:6}}>
        🎚️ Filtres avancés {activeCount>0&&<span style={{background:"var(--g)",color:"#fff",borderRadius:50,fontSize:9,fontWeight:700,padding:"1px 6px",minWidth:16,textAlign:"center"}}>{activeCount}</span>}
      </button>
      {open&&(
        <div className="advfil" style={{marginTop:8}}>
          {/* Prix */}
          <div style={{marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:11,color:"var(--mu)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>💰 Budget</div>
            <div className="advfilg" style={{gridTemplateColumns:"1fr 1fr"}}>
              <div className="fg">
                <label className="fl">Prix minimum</label>
                <select className="fi" value={filters.priceMin||""} onChange={e=>onChange("priceMin",e.target.value)}>
                  <option value="">Pas de minimum</option>
                  {PRICE_STEPS.filter(v=>v>0).map(v=><option key={v} value={v}>{fmtStep(v)} FCFA</option>)}
                </select>
              </div>
              <div className="fg">
                <label className="fl">Prix maximum</label>
                <select className="fi" value={filters.priceMax||""} onChange={e=>onChange("priceMax",e.target.value)}>
                  <option value="">Pas de maximum</option>
                  {PRICE_STEPS.filter(v=>v>0).map(v=><option key={v} value={v}>{fmtStep(v)} FCFA</option>)}
                </select>
              </div>
            </div>
          </div>
          {/* Surface */}
          <div style={{marginBottom:12}}>
            <div style={{fontWeight:700,fontSize:11,color:"var(--mu)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>📐 Surface</div>
            <div className="advfilg" style={{gridTemplateColumns:"1fr 1fr"}}>
              <div className="fg">
                <label className="fl">Surface min (m²)</label>
                <select className="fi" value={filters.surfMin||""} onChange={e=>onChange("surfMin",e.target.value)}>
                  <option value="">Toute surface</option>
                  {[20,30,50,70,100,150,200,300,500].map(v=><option key={v} value={v}>{v} m²</option>)}
                </select>
              </div>
              <div className="fg">
                <label className="fl">Surface max (m²)</label>
                <select className="fi" value={filters.surfMax||""} onChange={e=>onChange("surfMax",e.target.value)}>
                  <option value="">Pas de max</option>
                  {[50,100,150,200,300,500,1000].map(v=><option key={v} value={v}>{v} m²</option>)}
                </select>
              </div>
            </div>
          </div>
          {/* Autres */}
          <div className="advfilg">
            <div className="fg">
              <label className="fl">Chambres min</label>
              <select className="fi" value={filters.bedrooms||""} onChange={e=>onChange("bedrooms",e.target.value)}>
                <option value="">Tout</option>
                {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}+ chambre{n>1?"s":""}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Document foncier</label>
              <select className="fi" value={filters.docType||""} onChange={e=>onChange("docType",e.target.value)}>
                <option value="">Tout</option>
                {Object.entries(DOC).map(([v,{l}])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Région</label>
              <select className="fi" value={filters.region||""} onChange={e=>onChange("region",e.target.value)}>
                <option value="">Toutes régions</option>
                {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {/* Niveau de confiance */}
          <div className="fg">
            <label className="fl">🔍 Niveau de vérification</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {[
                ["","Tous"],
                ["partial","🟡 Docs vérifiés"],
                ["checked","🔵 Vendeur ID"],
                ["inspected","✅ Inspecté"],
              ].map(([v,l])=>(
                <button
                  key={v}
                  onClick={()=>onChange("vConfidence",v||"")}
                  style={{fontSize:10,padding:"4px 10px",borderRadius:100,border:`1.5px solid ${filters.vConfidence===v?"var(--g)":"var(--br)"}`,background:filters.vConfidence===v?"var(--gl)":"#fff",color:filters.vConfidence===v?"var(--g)":"var(--tx)",fontWeight:filters.vConfidence===v?700:400,cursor:"pointer"}}
                >{l}</button>
              ))}
            </div>
          </div>
          {/* Checkboxes spéciales */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:4}}>
            {[["investOnly","💰 Bon investissement"],["premiumOnly","⭐ Premium"],["videoOnly","▶ Vidéo"],["tour360Only","🌐 360°"]].map(([k,l])=>(
              <label key={k} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,fontWeight:600,color:filters[k]?"var(--g)":"var(--tx)"}}>
                <input type="checkbox" checked={!!filters[k]} onChange={e=>onChange(k,e.target.checked||"")} style={{accentColor:"var(--g)"}}/>{l}
              </label>
            ))}
          </div>
          <button className="fbt" onClick={onReset} style={{marginTop:10,color:"#ef4444"}}>🗑 Réinitialiser tous les filtres</button>
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
    try{
      const{error}=await sb.from("listings").update({
        title:form.title,description:form.description,
        price:parseInt(String(form.price).replace(/\D/g,""))||listing.price,
        surface:parseFloat(form.surface)||null,rooms:parseInt(form.rooms)||null,
        bedrooms:parseInt(form.bedrooms)||null,bathrooms:parseInt(form.bathrooms)||null,
        cover_image:form.cover_image,quartier:form.quartier,city:form.city,
        is_negotiable:form.is_negotiable,status:form.status,updated_at:new Date().toISOString()
      }).eq("id",listing.id);
      if(error){setErr(error.message);return;}
      onSaved({...listing,...form,price:parseInt(String(form.price).replace(/\D/g,""))||listing.price});
      onClose();
    }catch(e){setErr(e.message);}finally{setSaving(false);}
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
function ParticulierDash({user,profile,myList,convs,favIds,favListings,alerts,loading,onOpenListing,onShowAgency,showDT,setEditListing,setShowProfileEdit,toggleStatus,del,boost,toggleAlert,deleteAlert,setProfile,onFav,setPage,onBoost}){
  const [verifListing, setVerifListing] = useState(null); // listing pour lequel on demande verif
  const [boostListing, setBoostListing] = useState(null);  // listing à booster
  const [tab,setTab]=useState("overview");
  const totV=myList.reduce((s,l)=>s+(l.views_count||0),0);
  const totC=myList.reduce((s,l)=>s+(l.contacts_count||0),0);
  const act=myList.filter(l=>l.status==="active").length;
  const unread=convs.filter(c=>c.last_message_at>new Date(Date.now()-3600000).toISOString()).length;
  const [recentlyViewedUser,setRecentlyViewedUser]=useState([]);
  useEffect(()=>{
    if(user)sb.from("recently_viewed").select("*,listings(*)").eq("user_id",user.id).order("viewed_at",{ascending:false}).limit(6).then(({data})=>{if(data)setRecentlyViewedUser(data.filter(r=>r.listings).map(r=>r.listings));});
  },[]);
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
          {verifListing&&<VerifRequestModal listing={verifListing} user={user} profile={profile} onClose={()=>setVerifListing(null)} showToast={showDT}/>}
          {boostListing&&<PromoBoostModal listing={boostListing} user={user} onClose={()=>setBoostListing(null)} showToast={showDT}/>}
          {tab==="listings"&&<MyListingsTab myList={myList} onOpenListing={onOpenListing} setEditListing={setEditListing} toggleStatus={toggleStatus} del={del} boost={boost} onRequestVerif={setVerifListing} user={user} profile={profile}/>}
          {tab==="messages"&&<MessagesTab convs={convs} onOpenListing={onOpenListing}/>}
          {tab==="favorites"&&<FavoritesTab favListings={favListings} favIds={favIds} onFav={onFav} onOpenListing={onOpenListing}/>}
          {tab==="alerts"&&<AlertsTab alerts={alerts} toggleAlert={toggleAlert} deleteAlert={deleteAlert}/>}
          {tab==="billing"&&<BillingTab user={user} profile={profile} showToast={showDT}/>}
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
    try{
      const specs=agSpec.split(",").map(s=>s.trim()).filter(Boolean);
      await sb.from("profiles").update({bio:agBio,experience_years:parseInt(agExp)||0,specialties:specs}).eq("id",user.id);
      setProfile(p=>({...p,bio:agBio,experience_years:parseInt(agExp)||0,specialties:specs}));
      showDT("✅ Profil agent mis à jour !");
      setShowEditProfile(false);
    }catch(e){showDT("Erreur: "+e.message,"err");}finally{setSavingProfile(false);}
  }

  const navs=[
    {k:"overview",i:"📊",l:"Vue d'ensemble"},
    {k:"listings",i:"🏠",l:`Mes annonces (${myList.length})`},
    {k:"leads",i:"📩",l:`Leads (${convs.length})${unread>0?" ●":""}`},
    {k:"agency",i:"🏢",l:"Mon agence"},
    {k:"billing",i:"💳",l:"Abonnement"},
    {k:"profile",i:"👤",l:"Mon profil"},
  ];

  return(
    <DashLayout navs={navs} tab={tab} setTab={setTab} profile={profile} user={user} roleLabel="🏡 Agent immobilier">
      {loading?<div className="ldr"><div className="spin"/></div>:(
        <>
          {tab==="overview"&&(
            <>
              <PlanBanner user={user} onManage={()=>setTab("billing")}/>
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
          {tab==="listings"&&<MyListingsTab myList={myList} onOpenListing={onOpenListing} setEditListing={setEditListing} toggleStatus={toggleStatus} del={del} boost={boost} onRequestVerif={l=>showDT("🔍 Utilisez le Dashboard Annonces")} user={user} profile={profile}/>}
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
          {tab==="billing"&&<BillingTab user={user} profile={profile} showToast={showDT}/>}
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
// CRM IMPORT — Import CSV de 100 annonces en 1 clic
// ══════════════════════════════════════════════════════════
const CRM_COLS=[
  {k:"title",          lb:"Titre *",                   req:true,  ex:"Villa 4 pièces Almadies"},
  {k:"transaction_type",lb:"Type transaction *",        req:true,  ex:"vente / location"},
  {k:"property_type",  lb:"Type de bien *",             req:true,  ex:"appartement / maison / villa / terrain / bureau / commerce"},
  {k:"price",          lb:"Prix FCFA *",                req:true,  ex:"45000000"},
  {k:"city",           lb:"Ville *",                    req:true,  ex:"Dakar"},
  {k:"quartier",       lb:"Quartier",                   req:false, ex:"Almadies"},
  {k:"surface",        lb:"Surface m²",                 req:false, ex:"120"},
  {k:"rooms",          lb:"Pièces",                     req:false, ex:"4"},
  {k:"bedrooms",       lb:"Chambres",                   req:false, ex:"3"},
  {k:"bathrooms",      lb:"Salles de bain",             req:false, ex:"2"},
  {k:"description",    lb:"Description",                req:false, ex:"Belle villa avec piscine..."},
  {k:"cover_image",    lb:"URL Photo principale",       req:false, ex:"https://..."},
  {k:"address",        lb:"Adresse",                    req:false, ex:"Rue 10, Villa 3"},
  {k:"document_type",  lb:"Document (titre_foncier...)",req:false, ex:"titre_foncier / bail / permis_occuper"},
  {k:"is_negotiable",  lb:"Négociable (1/0)",           req:false, ex:"1"},
  {k:"expected_yield", lb:"Rendement % (invest.)",      req:false, ex:"7.5"},
];
const CRM_VALID={
  transaction_type:["vente","location","location_saisonniere"],
  property_type:["appartement","maison","villa","terrain","bureau","commerce"],
};

function parseCsvLine(line){
  const r=[]; let cur="",inQ=false;
  for(const c of line){
    if(c==='"'){inQ=!inQ;}
    else if(c===','&&!inQ){r.push(cur.trim());cur="";}
    else{cur+=c;}
  }
  r.push(cur.trim());
  return r;
}
function validateCrmRow(row){
  const e=[];
  if(!row.title||row.title.length<3) e.push("Titre trop court");
  if(!CRM_VALID.transaction_type.includes((row.transaction_type||"").toLowerCase())) e.push(`transaction_type invalide: "${row.transaction_type||""}"`);
  if(!CRM_VALID.property_type.includes((row.property_type||"").toLowerCase())) e.push(`property_type invalide: "${row.property_type||""}"`);
  if(!row.price||isNaN(parseInt((row.price||"").replace(/\s/g,"")))) e.push("Prix invalide");
  if(!row.city||row.city.length<2) e.push("Ville manquante");
  return e;
}
function normalizeCrmRow(raw,agencyId,userId){
  return{
    agency_id:agencyId, owner_id:userId,
    title:(raw.title||"").slice(0,200),
    transaction_type:(raw.transaction_type||"vente").toLowerCase(),
    property_type:(raw.property_type||"appartement").toLowerCase(),
    price:parseInt((raw.price||"0").replace(/[\s\u00a0]/g,""))||0,
    city:(raw.city||"Dakar").slice(0,100),
    region:({"Dakar":"Dakar","Thiès":"Thiès","Mbour":"Thiès","Saint-Louis":"Saint-Louis","Ziguinchor":"Ziguinchor","Kaolack":"Kaolack","Touba":"Diourbel","Tambacounda":"Tambacounda","Kolda":"Kolda"})[raw.city]||"Dakar",
    quartier:raw.quartier||null, address:raw.address||null,
    surface:raw.surface?parseFloat(raw.surface):null,
    rooms:raw.rooms?parseInt(raw.rooms):null,
    bedrooms:raw.bedrooms?parseInt(raw.bedrooms):null,
    bathrooms:raw.bathrooms?parseInt(raw.bathrooms):null,
    description:raw.description||null,
    cover_image:raw.cover_image||null,
    document_type:raw.document_type||null,
    is_negotiable:["1","oui","true","yes"].includes((raw.is_negotiable||"").toLowerCase()),
    expected_yield:raw.expected_yield?parseFloat(raw.expected_yield):null,
    is_investment_deal:!!raw.expected_yield,
    status:"active",
  };
}

function CrmImportPanel({user,profile,agencyId,showDT,onImported}){
  const [step,setStep]=useState("upload");
  const [rawRows,setRawRows]=useState([]);
  const [headers,setHeaders]=useState([]);
  const [colMap,setColMap]=useState({});
  const [preview,setPreview]=useState([]);
  const [progress,setProgress]=useState({done:0,total:0,errs:[]});
  const [logs,setLogs]=useState([]);
  const [loadingLogs,setLoadingLogs]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const fileRef=useRef(null);

  useEffect(()=>{loadLogs();},[]);

  async function loadLogs(){
    setLoadingLogs(true);
    try{const{data}=await sb.from("crm_imports").select("*").eq("imported_by",user.id).order("created_at",{ascending:false}).limit(10);if(data)setLogs(data);}catch(_){}
    setLoadingLogs(false);
  }

  function handleFile(e){
    const file=e.target.files?.[0]; if(!file)return;
    const ext=file.name.split(".").pop().toLowerCase();
    if(!["csv","txt"].includes(ext)){showDT("⚠️ Format CSV requis. Exportez votre fichier Excel en CSV depuis Fichier → Enregistrer sous.","err");return;}
    const reader=new FileReader();
    reader.onload=ev=>{
      const text=ev.target.result;
      // Détecter séparateur (virgule, point-virgule, tab)
      const firstLine=text.split(/\r?\n/)[0]||"";
      const sep=firstLine.includes(";")?";":(firstLine.includes("\t")?"\t":",");
      const parseLine=l=>{
        const vals=[]; let cur="",inQ=false;
        for(const c of l){if(c==='"'){inQ=!inQ;}else if(c===sep&&!inQ){vals.push(cur.trim());cur="";}else{cur+=c;}}
        vals.push(cur.trim()); return vals;
      };
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2){showDT("Fichier vide ou invalide","err");return;}
      const hdrs=parseLine(lines[0]).map(h=>h.replace(/^"|"$/g,"").trim());
      const rows=lines.slice(1,101).filter(l=>l.trim()).map(l=>{
        const cols=parseLine(l);
        const obj={};
        hdrs.forEach((h,i)=>{obj[h]=(cols[i]||"").replace(/^"|"$/g,"").trim();});
        return obj;
      });
      setHeaders(hdrs); setRawRows(rows);
      const auto={};
      CRM_COLS.forEach(col=>{
        const aliases=[col.k,...(col.aliases||[])];
        const m=hdrs.find(h=>aliases.some(a=>h.toLowerCase()===a||h.toLowerCase().replace(/[\s_-]/g,"")===a.replace(/_/g,"")));
        if(m)auto[col.k]=m;
      });
      setColMap(auto); setStep("mapping");
      showDT(`📋 ${rows.length} ligne${rows.length>1?"s":""} détectée${rows.length>1?"s":""}. Vérifiez le mapping.`);
    };
    reader.readAsText(file,"UTF-8");
  }

  function buildPreview(){
    const mapped=rawRows.map((raw,i)=>{
      const norm={};
      CRM_COLS.forEach(col=>{if(colMap[col.k])norm[col.k]=raw[colMap[col.k]]||"";});
      return{...norm,_idx:i+1,_errs:validateCrmRow(norm)};
    });
    setPreview(mapped); setStep("preview");
  }

  async function startImport(){
    const valid=preview.filter(r=>r._errs.length===0);
    if(!valid.length){showDT("Aucune ligne valide à importer","err");return;}
    setStep("importing"); setProgress({done:0,total:valid.length,errs:[]});
    let ok=0; const importErrs=[];
    const CHUNK=10;
    for(let i=0;i<valid.length;i+=CHUNK){
      const chunk=valid.slice(i,i+CHUNK).map(r=>normalizeCrmRow(r,agencyId,user.id));
      try{
        const{error}=await sb.from("listings").insert(chunk);
        if(error){importErrs.push(`Lignes ${i+1}–${Math.min(i+CHUNK,valid.length)}: ${error.message}`);}
        else{ok+=chunk.length;}
      }catch(e){importErrs.push(`Lignes ${i+1}–${Math.min(i+CHUNK,valid.length)}: ${e.message}`);}
      setProgress(p=>({...p,done:Math.min(i+CHUNK,valid.length),errs:importErrs}));
      await new Promise(r=>setTimeout(r,150));
    }
    try{
      await sb.from("crm_imports").insert({
        agency_id:agencyId, imported_by:user.id,
        filename:fileRef.current?.files?.[0]?.name||"import.csv",
        total_rows:valid.length, success_rows:ok, error_rows:importErrs.length,
        errors:importErrs, status:"done", completed_at:new Date().toISOString(),
      });
    }catch(_){}
    setProgress(p=>({...p,done:valid.length}));
    setStep("done"); loadLogs();
    if(ok>0)onImported(ok);
  }

  function downloadTemplate(){
    const hdr=CRM_COLS.map(c=>c.k).join(",");
    const ex1=[
      "Villa Almadies","villa","vente","Dakar","Almadies","350000000","320",
      "5","3","3","Magnifique villa avec piscine","https://example.com/photo.jpg",
      "titre_foncier","oui","non","14.7281","-17.5038","0"
    ].join(",");
    const ex2=[
      "Appartement Plateau","appartement","location","Dakar","Plateau","450000","85",
      "3","2","1","Appartement meublé vue mer","https://example.com/apt.jpg",
      "bail","non","non","14.6928","-17.4467","8.5"
    ].join(",");
    const blob=new Blob([hdr+"\n"+ex1+"\n"+ex2],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download="modele_import_senegalsen.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ══ Génération de 100 annonces réalistes 1-clic ══════════════════
  function buildDemoRows(){
    const TYPES=["villa","appartement","maison","terrain","bureau","commerce","studio"];
    const TX=["vente","vente","vente","location","location","location_saisonniere"];
    const CITIES=["Dakar","Dakar","Dakar","Dakar","Thiès","Mbour","Saint-Louis","Ziguinchor","Kaolack"];
    const QUARTIERS={
      Dakar:["Almadies","Plateau","Mermoz","Sacré-Cœur","Point E","Liberté","Ngor","Ouakam","Parcelles Assainies","Grand Yoff","HLM","Fann","Medina","Yoff","Pikine"],
      "Thiès":["Centre","Thiès Nord","Thiès Sud","Randoulène"],
      "Mbour":["Saly","Mbour Centre","Joal","Nianing"],
      "Saint-Louis":["Centre","Guet Ndar","Sor","Langue de Barbarie"],
      "Ziguinchor":["Centre","Tilène","Boucotte"],
      "Kaolack":["Centre","Médina Baye","Ndoffane"],
    };
    const IMGS_APT=["https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600","https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600","https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600","https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600"];
    const IMGS_VIL=["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=600","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600","https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600","https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600"];
    const IMGS_TER=["https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600","https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600"];
    const IMGS_BUR=["https://images.unsplash.com/photo-1497366216548-37526070297c?w=600","https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=600"];
    const DOCS=["titre_foncier","titre_foncier","bail","droit_superficie","promesse_vente"];
    const rnd=(min,max)=>Math.floor(Math.random()*(max-min+1))+min;
    const pick=(arr)=>arr[Math.floor(Math.random()*arr.length)];
    const rows=[];
    for(let i=0;i<100;i++){
      const type=pick(TYPES);
      const tx=pick(TX);
      const city=pick(CITIES);
      const qs=QUARTIERS[city]||QUARTIERS["Dakar"];
      const q=pick(qs);
      let price,surf,rooms,beds,baths,img;
      if(type==="terrain"){
        price=rnd(15,250)*1000000;surf=rnd(150,2000);rooms=0;beds=0;baths=0;img=pick(IMGS_TER);
      }else if(type==="villa"){
        price=tx==="location"?rnd(200,900)*10000:rnd(80,600)*1000000;surf=rnd(180,600);rooms=rnd(5,10);beds=rnd(3,7);baths=rnd(2,5);img=pick(IMGS_VIL);
      }else if(type==="appartement"||type==="studio"){
        price=tx==="location"?rnd(80,600)*1000:rnd(15,120)*1000000;surf=rnd(25,150);rooms=rnd(1,5);beds=rnd(0,4);baths=rnd(1,2);img=pick(IMGS_APT);
      }else if(type==="bureau"||type==="commerce"){
        price=tx==="location"?rnd(150,1500)*1000:rnd(20,300)*1000000;surf=rnd(30,500);rooms=rnd(2,8);beds=0;baths=rnd(1,2);img=pick(IMGS_BUR);
      }else{
        price=tx==="location"?rnd(100,500)*1000:rnd(30,200)*1000000;surf=rnd(60,400);rooms=rnd(3,8);beds=rnd(2,5);baths=rnd(1,3);img=pick(IMGS_VIL);
      }
      const titles={villa:"Villa",appartement:"Appartement",maison:"Maison",terrain:"Terrain",bureau:"Bureau",commerce:"Local commercial",studio:"Studio"};
      const descs=[
        `${titles[type]} ${tx==="location"?"à louer":"à vendre"} de ${surf}m² à ${q}, ${city}. Bien entretenu, idéal pour ${type==="bureau"?"professionnel":"famille"}.`,
        `Magnifique ${titles[type].toLowerCase()} en ${tx==="location"?"location":"vente"} dans le quartier ${q}. Surface de ${surf}m², ${rooms} pièces.`,
        `${titles[type]} exceptionnel à ${q} — ${surf}m², proche commodités, documentation complète.`,
      ];
      rows.push({
        title:`${titles[type]} ${q} ${surf}m²`,
        property_type:type,
        transaction_type:tx,
        city,quartier:q,
        price:String(price),
        surface:String(surf),
        rooms:String(rooms),
        bedrooms:String(beds),
        bathrooms:String(baths),
        description:pick(descs),
        cover_image:img,
        document_type:pick(DOCS),
        is_negotiable:Math.random()>0.4?"oui":"non",
        latitude:String((14.6928+Math.random()*0.5).toFixed(4)),
        longitude:String((-17.4467-Math.random()*0.5).toFixed(4)),
      });
    }
    return rows;
  }

  async function importDemo(){
    const demoRows=buildDemoRows();
    const valid=demoRows.map((r,i)=>({...r,_idx:i+1,_errs:[]}));
    setPreview(valid); setStep("importing"); setProgress({done:0,total:valid.length,errs:[]});
    let ok=0; const importErrs=[];
    // Import par chunks de 20 avec barre de progression animée
    const CHUNK=20;
    for(let i=0;i<valid.length;i+=CHUNK){
      const chunk=valid.slice(i,i+CHUNK);
      try{
        const rows=chunk.map(r=>normalizeCrmRow(r,agencyId,user.id));
        const{error}=await sb.from("listings").insert(rows);
        if(error){importErrs.push(error.message);}else{ok+=chunk.length;}
      }catch(e){importErrs.push(String(e.message||e));}
      setProgress({done:Math.min(i+CHUNK,valid.length),total:valid.length,errs:importErrs});
      await new Promise(r=>setTimeout(r,180));
    }
    try{await sb.from("crm_imports").insert({agency_id:agencyId,imported_by:user.id,filename:"demo_100_annonces.csv",total_rows:valid.length,success_rows:ok,error_rows:importErrs.length,errors:importErrs,status:"done",completed_at:new Date().toISOString(),notes:"Import démo 100 annonces"});}catch(_){}
    setStep("done"); loadLogs();
    if(ok>0)onImported(ok);
  }

  const validCount=preview.filter(r=>r._errs.length===0).length;
  const errCount=preview.filter(r=>r._errs.length>0).length;
  const STEPS_LBL=[["upload","📁 Upload"],["mapping","🔗 Mapping"],["preview","👁 Aperçu"],["importing","⚙️ Import"],["done","✅ Terminé"]];
  const stepIdx=STEPS_LBL.findIndex(([k])=>k===step);
  const pct=progress.total>0?Math.round(progress.done/progress.total*100):0;

  return(
    <div>
      {/* ══ HERO IMPORT ══ */}
      {step==="upload"&&(
        <div style={{background:"linear-gradient(135deg,#0a5c36 0%,#1a3a5c 100%)",borderRadius:14,padding:"22px 20px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:14}}>
            <div>
              <div style={{color:"#fff",fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:4}}>
                ⚡ Import 100 annonces en 1 clic
              </div>
              <div style={{color:"rgba(255,255,255,.65)",fontSize:12,marginBottom:12}}>
                Testez l'import massif avec <strong style={{color:"var(--au)"}}>100 annonces générées automatiquement</strong> — villas, appartements, terrains dans tout le Sénégal
              </div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button onClick={importDemo}
                  style={{background:"var(--au)",color:"#1a1a1a",border:"none",borderRadius:9,padding:"10px 22px",fontSize:13,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:7,boxShadow:"0 4px 18px rgba(234,179,8,.35)"}}>
                  ⚡ Importer 100 annonces démo →
                </button>
                <button onClick={downloadTemplate}
                  style={{background:"rgba(255,255,255,.12)",color:"#fff",border:"1.5px solid rgba(255,255,255,.3)",borderRadius:9,padding:"10px 18px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  ⬇️ Télécharger le modèle CSV
                </button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7,minWidth:160}}>
              {[["🏠","7 types de biens"],["🌍","9 villes couvertes"],["📄","Données 100% réalistes"],["⚙️","Import par chunks"],].map(([ico,txt])=>(
                <div key={txt} style={{display:"flex",alignItems:"center",gap:8,color:"rgba(255,255,255,.8)",fontSize:11}}>
                  <span style={{fontSize:15}}>{ico}</span>{txt}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div>
          <div className="dtit2" style={{marginBottom:3}}>📥 Import CSV personnalisé</div>
          <div style={{fontSize:12,color:"var(--mu)"}}>Importez vos propres annonces via fichier CSV ou Excel</div>
        </div>
        {step!=="upload"&&(
          <button onClick={downloadTemplate} style={{background:"var(--bg)",border:"1.5px solid var(--br)",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
            ⬇️ Modèle CSV
          </button>
        )}
      </div>

      {/* Stepper */}
      <div style={{display:"flex",borderRadius:10,overflow:"hidden",border:"1px solid var(--br)",marginBottom:18}}>
        {STEPS_LBL.map(([k,l],i)=>(
          <div key={k} style={{flex:1,padding:"8px 2px",textAlign:"center",fontSize:10,fontWeight:700,
            background:step===k?"var(--g)":i<stepIdx?"var(--gl)":"var(--bg)",
            color:step===k?"#fff":i<stepIdx?"var(--g)":"var(--mu)",
            borderRight:i<STEPS_LBL.length-1?"1px solid var(--br)":"none",transition:".15s"}}>
            {l}
          </div>
        ))}
      </div>

      {/* ── UPLOAD ── */}
      {step==="upload"&&(
        <>
          <div
            onClick={()=>fileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files?.[0];if(f){const dt=new DataTransfer();dt.items.add(f);fileRef.current.files=dt.files;handleFile({target:{files:dt.files}});}}}
            style={{border:`2.5px dashed ${dragOver?"var(--g)":"var(--br)"}`,borderRadius:"var(--r)",padding:"36px 20px",textAlign:"center",cursor:"pointer",background:dragOver?"var(--gl)":"#fff",transition:".18s"}}
          >
            <div style={{fontSize:48,marginBottom:10}}>📁</div>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,marginBottom:5}}>Déposez votre fichier CSV ici</div>
            <div style={{fontSize:12,color:"var(--mu)",marginBottom:16}}>ou cliquez pour parcourir · Max 100 lignes · Encodage UTF-8 · Séparateur , ou ;</div>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={handleFile}/>
            <span style={{background:"var(--g)",color:"#fff",padding:"9px 22px",borderRadius:100,fontSize:13,fontWeight:700}}>📂 Choisir un fichier CSV</span>
          </div>
          {/* Info colonnes */}
          <div style={{marginTop:14,background:"var(--bg)",borderRadius:10,padding:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:8}}>Colonnes supportées</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {CRM_COLS.map(c=><span key={c.k} style={{fontSize:10,padding:"3px 8px",borderRadius:100,background:c.req?"#dcfce7":"var(--bg)",border:`1px solid ${c.req?"#a7f3d0":"var(--br)"}`,color:c.req?"#166534":"var(--mu)",fontWeight:c.req?700:400}}>{c.k}{c.req?"":" ?"}</span>)}
            </div>
            <div style={{fontSize:10,color:"var(--mu)",marginTop:6}}>🟢 Obligatoire &nbsp;⬜ Optionnel</div>
          </div>
        </>
      )}

      {/* ── MAPPING ── */}
      {step==="mapping"&&(
        <>
          <div style={{background:"var(--gl)",border:"1px solid #a7f3d0",borderRadius:9,padding:11,marginBottom:14,fontSize:12,color:"#166534",display:"flex",gap:6,alignItems:"center"}}>
            <span>✅</span>
            <span><strong>{rawRows.length} lignes</strong> détectées · <strong>{headers.length} colonnes</strong> trouvées · Vérifiez et ajustez le mapping</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10,marginBottom:16}}>
            {CRM_COLS.map(col=>(
              <div key={col.k} style={{background:"#fff",border:"1.5px solid var(--br)",borderRadius:8,padding:10}}>
                <div style={{fontSize:10,fontWeight:700,marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:col.req?"var(--g)":"var(--mu)"}}>{col.k}{col.req?" *":""}</span>
                  {colMap[col.k]&&<span style={{fontSize:9,background:"var(--gl)",color:"var(--g)",padding:"1px 6px",borderRadius:100,fontWeight:700}}>✓</span>}
                </div>
                <select className="fi" style={{fontSize:11,padding:"5px 8px"}} value={colMap[col.k]||""} onChange={e=>setColMap(m=>({...m,[col.k]:e.target.value||undefined}))}>
                  <option value="">— Non mappé —</option>
                  {headers.map(h=><option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="fbt2" style={{flex:1,background:"var(--bg)",color:"var(--tx)",border:"1.5px solid var(--br)"}} onClick={()=>{setStep("upload");setRawRows([]);setHeaders([]);}}>← Retour</button>
            <button className="fbt2 fbg" style={{flex:2}} onClick={buildPreview}>👁 Prévisualiser →</button>
          </div>
        </>
      )}

      {/* ── PREVIEW ── */}
      {step==="preview"&&(
        <>
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{flex:1,background:"var(--gl)",border:"1px solid #a7f3d0",borderRadius:9,padding:"10px 14px",minWidth:120}}>
              <div style={{fontSize:22,fontWeight:800,color:"var(--g)",fontFamily:"var(--fd)"}}>{validCount}</div>
              <div style={{fontSize:11,color:"#166534"}}>✅ Valides</div>
            </div>
            {errCount>0&&<div style={{flex:1,background:"var(--rl)",border:"1px solid #fca5a5",borderRadius:9,padding:"10px 14px",minWidth:120}}>
              <div style={{fontSize:22,fontWeight:800,color:"var(--rd)",fontFamily:"var(--fd)"}}>{errCount}</div>
              <div style={{fontSize:11,color:"#991b1b"}}>⚠️ Avec erreurs</div>
            </div>}
          </div>
          <div style={{maxHeight:300,overflowY:"auto",border:"1px solid var(--br)",borderRadius:9,marginBottom:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead>
                <tr style={{background:"var(--bg)",position:"sticky",top:0}}>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid var(--br)",color:"var(--mu)"}}>#</th>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid var(--br)"}}>Titre</th>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid var(--br)"}}>Type</th>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid var(--br)"}}>Prix</th>
                  <th style={{padding:"8px 10px",textAlign:"left",fontWeight:700,borderBottom:"1px solid var(--br)"}}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0,50).map(r=>(
                  <tr key={r._idx} style={{borderBottom:"1px solid var(--br)",background:r._errs.length?"#fff7f7":"#fff"}}>
                    <td style={{padding:"7px 10px",color:"var(--mu)"}}>{r._idx}</td>
                    <td style={{padding:"7px 10px",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.title||<span style={{color:"var(--mu)"}}>—</span>}</td>
                    <td style={{padding:"7px 10px"}}>{r.property_type||"—"}</td>
                    <td style={{padding:"7px 10px",fontWeight:700,color:"var(--g)"}}>{r.price?parseInt(r.price).toLocaleString("fr-SN")+" F":"—"}</td>
                    <td style={{padding:"7px 10px"}}>
                      {r._errs.length?<span style={{color:"var(--rd)",fontSize:10}}>❌ {r._errs.join(", ")}</span>:<span style={{color:"#16a34a",fontWeight:700}}>✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="fbt2" style={{flex:1,background:"var(--bg)",color:"var(--tx)",border:"1.5px solid var(--br)"}} onClick={()=>setStep("mapping")}>← Mapping</button>
            <button className="fbt2 fbg" style={{flex:2}} onClick={startImport} disabled={validCount===0}>
              ⚡ Importer {validCount} annonce{validCount>1?"s":""} →
            </button>
          </div>
        </>
      )}

      {/* ── IMPORTING ── */}
      {step==="importing"&&(
        <div style={{textAlign:"center",padding:"30px 20px"}}>
          <div style={{fontSize:48,marginBottom:12}}>⚙️</div>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:16,marginBottom:6}}>Import en cours…</div>
          <div style={{fontSize:12,color:"var(--mu)",marginBottom:16}}>{progress.done} / {progress.total} annonces traitées</div>
          <div style={{background:"var(--br)",borderRadius:100,height:10,overflow:"hidden",maxWidth:320,margin:"0 auto 12px"}}>
            <div style={{background:"var(--g)",height:"100%",width:pct+"%",borderRadius:100,transition:"width .3s"}}/>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:"var(--g)"}}>{pct}%</div>
          {progress.errs.length>0&&<div style={{marginTop:10,fontSize:11,color:"var(--rd)"}}>⚠️ {progress.errs.length} erreur(s)</div>}
        </div>
      )}

      {/* ── DONE ── */}
      {step==="done"&&(
        <div style={{textAlign:"center",padding:"24px 20px"}}>
          <div style={{fontSize:48,marginBottom:10}}>🎉</div>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:6}}>Import terminé !</div>
          <div style={{fontSize:13,color:"var(--mu)",marginBottom:6}}>
            <strong style={{color:"var(--g)"}}>{progress.total-progress.errs.length} annonce{progress.total-progress.errs.length>1?"s":""}</strong> importée{progress.total-progress.errs.length>1?"s":""} avec succès
            {progress.errs.length>0&&<span style={{color:"var(--rd)"}}> · {progress.errs.length} erreur(s)</span>}
          </div>
          {progress.errs.length>0&&(
            <div style={{background:"var(--rl)",borderRadius:8,padding:10,marginBottom:12,fontSize:11,textAlign:"left",maxHeight:100,overflowY:"auto"}}>
              {progress.errs.map((e,i)=><div key={i} style={{color:"var(--rd)",marginBottom:2}}>• {e}</div>)}
            </div>
          )}
          <button className="fbt2 fbg" style={{maxWidth:280,margin:"0 auto"}} onClick={()=>{setStep("upload");setRawRows([]);setPreview([]);setProgress({done:0,total:0,errs:[]});}}>
            📁 Nouvel import
          </button>
        </div>
      )}

      {/* ── HISTORIQUE ── */}
      {logs.length>0&&step==="upload"&&(
        <div style={{marginTop:20}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--mu)",textTransform:"uppercase",letterSpacing:".4px",marginBottom:8}}>Historique des imports</div>
          {loadingLogs?<div style={{fontSize:12,color:"var(--mu)"}}>Chargement…</div>:(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {logs.map(l=>(
                <div key={l.id} style={{background:"#fff",border:"1.5px solid var(--br)",borderRadius:9,padding:"10px 13px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:12,marginBottom:2}}>{l.filename||"import.csv"}</div>
                    <div style={{fontSize:11,color:"var(--mu)"}}>{new Date(l.created_at).toLocaleDateString("fr-SN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}{l.notes&&<span style={{marginLeft:6,fontStyle:"italic"}}>· {l.notes}</span>}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                    {l.success_rows>0&&<span style={{fontSize:11,fontWeight:700,color:"#16a34a",background:"#dcfce7",padding:"2px 9px",borderRadius:100}}>✓ {l.success_rows} importées</span>}
                    {l.error_rows>0&&<span style={{fontSize:11,fontWeight:700,color:"var(--rd)",background:"var(--rl)",padding:"2px 9px",borderRadius:100}}>✗ {l.error_rows} erreurs</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function AgenceDash({ user, profile, myList, loading, onOpenListing, showDT, setEditListing, setShowProfileEdit, toggleStatus, del, boost, setProfile }) {
  const [tab, setTab] = useState("overview");
  const [agencyInfo, setAgencyInfo] = useState(null);
  const [agents, setAgents] = useState([]);
  const [allListings, setAllListings] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [agenceVisits, setAgenceVisits] = useState([]);
  const [editingAgency, setEditingAgency] = useState(false);
  const [agForm, setAgForm] = useState({});
  const [savingAg, setSavingAg] = useState(false);
  const [agLoading, setAgLoading] = useState(true);
  const agencyId = profile.agency_id;
  useEffect(() => {
    loadAgency();
  }, []);
  async function loadAgency() {
    setAgLoading(true);
    const agId = profile.agency_id;
    if (!agId) {
      setAgLoading(false);
      return;
    }
    try {
      const [{ data: ag }, { data: ags }, { data: ls }, { data: rv }, { data: vreqs }] = await Promise.all([
        sb.from("agencies").select("*").eq("id", agId).single(),
        sb.from("profiles").select("*").eq("agency_id", agId).neq("id", user.id),
        sb.from("listings").select("*").eq("agency_id", agId).order("created_at", { ascending: false }),
        sb.from("reviews").select("*").eq("agency_id", agId).order("created_at", { ascending: false }),
        // Charger les demandes de visite pour les annonces de l'agence
        sb.from("visit_requests").select("*,listings(id,title,cover_image,property_type,quartier)").in(
          "listing_id",
          // On doit d'abord avoir les ids — on les charge après si nécessaire
          []
        )
      ]);
      if (ag) {
        setAgencyInfo(ag);
        setAgForm({ name: ag.name || "", email: ag.email || "", phone: ag.phone || "", whatsapp: ag.whatsapp || "", address: ag.address || "", description: ag.description || "" });
      }
      if (ags) setAgents(ags);
      if (ls) {
        setAllListings(ls);
        // Charger les visites maintenant qu'on a les listing IDs
        if (ls.length > 0) {
          const ids = ls.map(l => l.id);
          const { data: vr } = await sb.from("visit_requests")
            .select("*,listings(id,title,cover_image,property_type,quartier)")
            .in("listing_id", ids)
            .order("created_at", { ascending: false });
          if (vr) setAgenceVisits(vr);
        }
      }
      if (rv) setReviews(rv);
    } catch(e) {
      console.warn("AgenceDash.loadAgency:", e);
    } finally {
      setAgLoading(false);
    }
  }
  async function updateAgenceVisit(visitId, newStatus) {
    const { error } = await sb.from("visit_requests").update({ status: newStatus }).eq("id", visitId);
    if (error) { showDT("❌ " + error.message, "err"); return; }
    setAgenceVisits(vs => vs.map(v => v.id === visitId ? { ...v, status: newStatus } : v));
    showDT(newStatus === "confirmed" ? "✅ Visite confirmée !" : newStatus === "done" ? "✔ Visite marquée effectuée" : "Statut mis à jour");
  }
  async function saveAgency() {
    setSavingAg(true);
    const { error } = await sb.from("agencies").update(agForm).eq("id", profile.agency_id);
    setSavingAg(false);
    if (error) {
      showDT("\u274C " + error.message, "err");
      return;
    }
    setAgencyInfo((a) => ({ ...a, ...agForm }));
    showDT("\u2705 Informations agence mises \xE0 jour !");
    setEditingAgency(false);
  }
  const totV = allListings.reduce((s, l) => s + (l.views_count || 0), 0);
  const totC = allListings.reduce((s, l) => s + (l.contacts_count || 0), 0);
  const act = allListings.filter((l) => l.status === "active").length;
  const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
  const PLANS = { free: { l: "Gratuit", c: "#94a3b8" }, basic: { l: "Basic", c: "#3b82f6" }, premium: { l: "Premium", c: "#f59e0b" }, vip: { l: "VIP", c: "#0a5c36" } };
  const navs = [
    { k: "overview", i: "\u{1F4CA}", l: "Vue d'ensemble" },
    { k: "listings", i: "\u{1F3E0}", l: `Annonces (${allListings.length})` },
    { k: "import", i: "\u26A1", l: "Import CRM" },
    { k: "visits", i: "\u{1F4E1}", l: "Visites" },
    { k: "team", i: "\u{1F465}", l: `\xC9quipe (${agents.length + 1})` },
    { k: "reviews", i: "\u2B50", l: `Avis (${reviews.length})` },
    { k: "billing", i: "\u{1F4B3}", l: "Abonnement" },
    { k: "agency_profile", i: "\u{1F3E2}", l: "Profil agence" },
    { k: "profile", i: "\u{1F464}", l: "Mon compte" }
  ];
  return /* @__PURE__ */ React.createElement(DashLayout, { navs, tab, setTab, profile, user, roleLabel: "\u{1F3E2} Agence" }, agLoading ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : !profile.agency_id ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 10 } }, "\u{1F3E2}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 15 } }, "Aucune agence associ\xE9e"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", marginTop: 5 } }, "Contactez l'administrateur pour cr\xE9er ou associer votre agence.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "overview" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, borderRadius: 12, background: agencyInfo && PLANS[agencyInfo.subscription_plan] ? PLANS[agencyInfo.subscription_plan].c : "var(--g)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 } }, (agencyInfo && agencyInfo.name || "A")[0]), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 17, display: "flex", alignItems: "center", gap: 7 } }, agencyInfo && agencyInfo.name, agencyInfo && agencyInfo.is_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 } }, "\u2705 V\xE9rifi\xE9e")), agencyInfo && /* @__PURE__ */ React.createElement("span", { style: { background: PLANS[agencyInfo.subscription_plan] ? PLANS[agencyInfo.subscription_plan].c : "var(--g)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, "Plan ", agencyInfo.subscription_plan && PLANS[agencyInfo.subscription_plan] ? PLANS[agencyInfo.subscription_plan].l : agencyInfo.subscription_plan))), /* @__PURE__ */ React.createElement("div", { className: "kpig" }, [["\u{1F3E0}", allListings.length, "Annonces"], ["\u2705", act, "Actives"], ["\u{1F441}", totV.toLocaleString("fr"), "Vues"], ["\u{1F4E9}", totC, "Contacts"], ["\u{1F465}", agents.length + 1, "Agents"], ["\u2B50", avgRating || "\u2014", "Note moy."]].map(([ico, val, lbl]) => /* @__PURE__ */ React.createElement("div", { className: "kpi", key: lbl }, /* @__PURE__ */ React.createElement("div", { className: "kpiic" }, ico), /* @__PURE__ */ React.createElement("div", { className: "kpiv" }, val), /* @__PURE__ */ React.createElement("div", { className: "kpil" }, lbl)))), /* @__PURE__ */ React.createElement("div", {
  style: { display:"flex", gap:12, marginBottom:18, flexWrap:"wrap" }
},
  /* @__PURE__ */ React.createElement("div", {
    onClick: () => setTab("import"),
    style: { flex:"1 1 220px", minWidth:200, background:"linear-gradient(135deg,#0a5c36,#1a3a5c)", borderRadius:12, padding:"16px 18px", cursor:"pointer", display:"flex", alignItems:"center", gap:14, boxShadow:"0 4px 18px rgba(10,92,54,.25)", transition:".18s" }
  },
    /* @__PURE__ */ React.createElement("div", { style:{ fontSize:36 } }, "⚡"),
    /* @__PURE__ */ React.createElement("div", null,
      /* @__PURE__ */ React.createElement("div", { style:{ color:"#fff", fontFamily:"var(--fd)", fontWeight:800, fontSize:14, marginBottom:3 } }, "Import 100 annonces en 1 clic"),
      /* @__PURE__ */ React.createElement("div", { style:{ color:"rgba(255,255,255,.65)", fontSize:11 } }, "Importez tout votre portefeuille via CSV ou démo →")
    )
  ),
  allListings.length === 0 && /* @__PURE__ */ React.createElement("div", {
    onClick: () => setTab("listings"),
    style: { flex:"1 1 220px", minWidth:200, background:"#fff", border:"1.5px dashed var(--br)", borderRadius:12, padding:"16px 18px", cursor:"pointer", display:"flex", alignItems:"center", gap:14 }
  },
    /* @__PURE__ */ React.createElement("div", { style:{ fontSize:36 } }, "🏠"),
    /* @__PURE__ */ React.createElement("div", null,
      /* @__PURE__ */ React.createElement("div", { style:{ fontFamily:"var(--fd)", fontWeight:700, fontSize:13, marginBottom:3 } }, "Aucune annonce encore"),
      /* @__PURE__ */ React.createElement("div", { style:{ fontSize:11, color:"var(--mu)" } }, "Importez en masse ou publiez une à une")
    )
  )
), allListings.length > 0 && /* @__PURE__ */ React.createElement(PerformanceChart, { myList: allListings }), /* @__PURE__ */ React.createElement(RecentListingsTable, { myList: allListings, onOpenListing, onViewAll: () => setTab("listings"), title: "Dernières annonces de l'agence" })), tab === "listings" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3E0} Toutes les annonces de l'agence (", allListings.length, ")"), allListings.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 32 } }, "\u{1F3E0}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Aucune annonce publi\xE9e")) : /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 580 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Bien"), /* @__PURE__ */ React.createElement("th", null, "Prix"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Boost"), /* @__PURE__ */ React.createElement("th", null, "Vérif."), /* @__PURE__ */ React.createElement("th", null, "Vues"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, allListings.map((l) => /* @__PURE__ */ React.createElement("tr", { key: l.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, alignItems: "center" } }, /* @__PURE__ */ React.createElement("img", { src: l.cover_image || "", alt: "", style: { width: 38, height: 30, borderRadius: 4, objectFit: "cover", flexShrink: 0 }, onError: (e) => e.target.style.display = "none" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 11 } }, PICO[l.property_type], " ", (l.title || "").slice(0, 22)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "\u{1F4CD} ", l.quartier)))), /* @__PURE__ */ React.createElement("td", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 11, color: "var(--g)" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "sdot" }, /* @__PURE__ */ React.createElement("span", { className: `dot ${l.status === "active" ? "dg" : l.status === "archived" ? "dr" : "dy"}` }), l.status)), /* @__PURE__ */ React.createElement("td", null, l.is_premium ? /* @__PURE__ */ React.createElement("span", { className: "boost-badge" }, "\u2B50 Premium") : /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => onBoost ? onBoost(l) : boost(l.id) }, "\u{1F680} Boost")), /* @__PURE__ */ React.createElement("td", null, onRequestVerif ? /* @__PURE__ */ React.createElement("button", { className: "btn-verif btn-verif-sm", onClick: (e) => { e.stopPropagation(); onRequestVerif(l); }, title: "Demander une vérification payante" }, getVLevel(l) !== "none" ? "🔍 Améliorer" : "🔍 Vérifier") : null), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 11, color: "var(--mu)" } }, "\u{1F441} ", l.views_count || 0), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "abtns" }, /* @__PURE__ */ React.createElement("button", { className: "ab abv", onClick: () => onOpenListing(l), title: "Voir" }, "\u{1F441}"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => setEditListing(l), title: "Modifier" }, "\u270F\uFE0F"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => toggleStatus(l.id, l.status) }, l.status === "active" ? "\u23F8" : "\u25B6"), /* @__PURE__ */ React.createElement("button", { className: "ab abd", onClick: () => del(l.id) }, "\u{1F5D1}"))))))))), tab === "import" && /* @__PURE__ */ React.createElement(React.Fragment, null,
  /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u26A1 Import CRM \u2014 100 annonces en 1 clic"),
  /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginBottom: 16 } },
    "\u{1F4A1} Importez votre portefeuille d'annonces en masse via CSV ou utilisez l'import d\xE9mo pour voir la fonctionnalit\xE9 en action."
  ),
  /* @__PURE__ */ React.createElement(CrmImportPanel, {
    user,
    profile,
    agencyId: profile.agency_id,
    showDT,
    onImported: (n) => {
      showDT("\u2705 " + n + " annonce" + (n > 1 ? "s" : "") + " import\xE9e" + (n > 1 ? "s" : "") + " avec succ\xE8s !");
      loadAgency();
    }
  })
), tab === "visits" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F4E1} Demandes de visites \xE0 distance"), /* @__PURE__ */ React.createElement(VisitRequestsPanel, { visitReqs: agenceVisits, onUpdateStatus: updateAgenceVisit })), tab === "team" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F465} \xC9quipe (", agents.length + 1, " membres)"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { className: "dash-card", style: { display: "flex", gap: 12, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "dav", style: { width: 44, height: 44, fontSize: 15, margin: 0, flexShrink: 0 } }, (profile.full_name || user.email || "?")[0].toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, profile.full_name || user.email), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, user.email)), /* @__PURE__ */ React.createElement("span", { style: { background: "var(--gl)", color: "var(--g)", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 100 } }, "\u{1F3E2} Responsable")), agents.map((ag) => /* @__PURE__ */ React.createElement("div", { key: ag.id, className: "dash-card", style: { display: "flex", gap: 12, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "dav", style: { width: 44, height: 44, fontSize: 15, margin: 0, flexShrink: 0 } }, (ag.full_name || ag.id || "A")[0].toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, ag.full_name || "Agent"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, ag.phone || "\u2014"), ag.bio && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2, fontStyle: "italic" } }, ag.bio.slice(0, 60), ag.bio.length > 60 ? "\u2026" : "")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, ag.experience_years > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, ag.experience_years, " ans exp."), ag.is_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 } }, "\u2705 V\xE9rifi\xE9")))), agents.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "20px", color: "var(--mu)", fontSize: 12 } }, "Aucun agent rattach\xE9 encore. Les agents qui s'inscrivent et choisissent votre agence appara\xEEtront ici."))), tab === "reviews" && /* @__PURE__ */ React.createElement(
    ReviewsBlock,
    {
      reviews,
      targetId: profile.agency_id,
      targetType: "agency",
      user,
      showToast: showDT
    }
  ), tab === "billing" && React.createElement(BillingTab, { user, profile, showToast: showDT }), tab === "agency_profile" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3E2} Profil agence"), /* @__PURE__ */ React.createElement("div", { className: "dash-card", style: { maxWidth: 540 } }, !editingAgency ? /* @__PURE__ */ React.createElement(React.Fragment, null, [["\u{1F3F7}\uFE0F Nom", agencyInfo && agencyInfo.name], ["\u{1F4E7} Email", agencyInfo && agencyInfo.email || "\u2014"], ["\u{1F4F1} T\xE9l\xE9phone", agencyInfo && agencyInfo.phone || "\u2014"], ["\u{1F4AC} WhatsApp", agencyInfo && agencyInfo.whatsapp || "\u2014"], ["\u{1F4CD} Adresse", agencyInfo && agencyInfo.address || "\u2014"], ["\u{1F4DD} Description", agencyInfo && agencyInfo.description || "\u2014"], ["\u{1F48E} Plan", agencyInfo && agencyInfo.subscription_plan], ["\u2705 V\xE9rifi\xE9e", agencyInfo && agencyInfo.is_verified ? "Oui" : "En attente"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--br)", fontSize: 12, gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 600, flexShrink: 0 } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, textAlign: "right" } }, v))), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 14, width: "100%" }, onClick: () => setEditingAgency(true) }, "\u270F\uFE0F Modifier les informations"), agencyInfo && !agencyInfo.is_verified && /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginTop: 10 } }, "\u26A0\uFE0F Votre agence est en attente de v\xE9rification. Nous vous contacterons sous 48h.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Nom de l'agence"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: agForm.name || "", onChange: (e) => setAgForm((f) => ({ ...f, name: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Email"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "email", value: agForm.email || "", onChange: (e) => setAgForm((f) => ({ ...f, email: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "T\xE9l\xE9phone"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: agForm.phone || "", onChange: (e) => setAgForm((f) => ({ ...f, phone: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "WhatsApp"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: agForm.whatsapp || "", onChange: (e) => setAgForm((f) => ({ ...f, whatsapp: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Adresse"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: agForm.address || "", onChange: (e) => setAgForm((f) => ({ ...f, address: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", rows: 3, value: agForm.description || "", onChange: (e) => setAgForm((f) => ({ ...f, description: e.target.value })) }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } }, /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { flex: 1 }, onClick: saveAgency, disabled: savingAg }, savingAg ? "Sauvegarde..." : "\u{1F4BE} Sauvegarder"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { flex: 1 }, onClick: () => setEditingAgency(false) }, "Annuler"))))), tab === "profile" && /* @__PURE__ */ React.createElement(ProfileTab, { user, profile, setShowProfileEdit, showDT })));
}
const PIPELINE_STEPS = ["nouveau", "contacte", "visite", "offre", "signe", "perdu"];
const PIPELINE_LABELS = { nouveau: "\u{1F195} Nouveau", contacte: "\u{1F4DE} Contact\xE9", visite: "\u{1F3E0} Visite", offre: "\u{1F4CB} Offre", signe: "\u2705 Sign\xE9", perdu: "\u274C Perdu" };
const PIPELINE_COLORS = { nouveau: "#3b82f6", contacte: "#f59e0b", visite: "#8b5cf6", offre: "#06b6d4", signe: "#16a34a", perdu: "#dc2626" };
const PROJECT_STATUS = { etude: { l: "\u{1F50D} \xC9tude", c: "#6b7280" }, construction: { l: "\u{1F3D7}\uFE0F Construction", c: "#f59e0b" }, commercialisation: { l: "\u{1F680} Commercialisation", c: "#3b82f6" }, livre: { l: "\u2705 Livr\xE9", c: "#16a34a" }, archive: { l: "\u{1F4E6} Archiv\xE9", c: "#94a3b8" } };
function PromoteurDash({ user, profile, loading, onOpenListing, showDT, setShowProfileEdit }) {
  const [tab, setTab] = useState("overview");
  const [promoteurInfo, setPromoteurInfo] = useState(null);
  const [projects, setProjects] = useState([]);
  const [leads, setLeads] = useState([]);
  const [pLoading, setPLoading] = useState(true);
  const [editingProj, setEditingProj] = useState(null);
  const [showNewProj, setShowNewProj] = useState(false);
  const [editingPromoteur, setEditingPromoteur] = useState(false);
  const [pForm, setPForm] = useState({});
  const [savingP, setSavingP] = useState(false);
  const [newProj, setNewProj] = useState({ name: "", description: "", city: "Dakar", quartier: "", total_lots: 0, lots_available: 0, price_from: 0, price_to: 0, status: "commercialisation", delivery_date: "" });
  const [savingProj, setSavingProj] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  useEffect(() => {
    loadPromoteur();
  }, []);
  async function loadPromoteur() {
    setPLoading(true);
    const [{ data: pr }, { data: pj }, { data: ld }] = await Promise.all([
      sb.from("promoteurs").select("*").eq("owner_id", user.id).single(),
      sb.from("projects").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }),
      sb.from("project_leads").select("*,projects(name)").eq("promoteur_id", user.id).order("created_at", { ascending: false })
    ]);
    if (pr) {
      setPromoteurInfo(pr);
      setPForm({ name: pr.name || "", email: pr.email || "", phone: pr.phone || "", whatsapp: pr.whatsapp || "", address: pr.address || "", description: pr.description || "" });
    }
    if (pj) setProjects(pj);
    if (ld) setLeads(ld);
    setPLoading(false);
  }
  async function saveProject() {
    setSavingProj(true);
    if (editingProj) {
      await sb.from("projects").update(newProj).eq("id", editingProj.id);
      setProjects((ps) => ps.map((p) => p.id === editingProj.id ? { ...p, ...newProj } : p));
      showDT("\u2705 Projet mis \xE0 jour !");
    } else {
      const { data } = await sb.from("projects").insert([{ ...newProj, owner_id: user.id, promoteur_id: promoteurInfo && promoteurInfo.id }]).select().single();
      if (data) setProjects((ps) => [data, ...ps]);
      showDT("\u2705 Projet cr\xE9\xE9 !");
    }
    setSavingProj(false);
    setShowNewProj(false);
    setEditingProj(null);
    setNewProj({ name: "", description: "", city: "Dakar", quartier: "", total_lots: 0, lots_available: 0, price_from: 0, price_to: 0, status: "commercialisation", delivery_date: "" });
  }
  async function deleteProject(id) {
    if (!confirm("Supprimer ce projet ?")) return;
    await sb.from("projects").delete().eq("id", id);
    setProjects((ps) => ps.filter((p) => p.id !== id));
    showDT("\u{1F5D1} Projet supprim\xE9");
  }
  async function updateLeadStatus(id, status) {
    await sb.from("project_leads").update({ status }).eq("id", id);
    setLeads((ls) => ls.map((l) => l.id === id ? { ...l, status } : l));
    showDT("\u2705 Statut mis \xE0 jour");
  }
  async function savePromoteur() {
    setSavingP(true);
    const { error } = await sb.from("promoteurs").update(pForm).eq("id", promoteurInfo && promoteurInfo.id);
    setSavingP(false);
    if (error) {
      showDT("\u274C " + error.message, "err");
      return;
    }
    setPromoteurInfo((p) => ({ ...p, ...pForm }));
    showDT("\u2705 Informations mises \xE0 jour !");
    setEditingPromoteur(false);
  }
  const totProjects = projects.length;
  const totLots = projects.reduce((s, p) => s + p.total_lots, 0);
  const totAvail = projects.reduce((s, p) => s + p.lots_available, 0);
  const totLeads = leads.length;
  const totSigned = leads.filter((l) => l.status === "signe").length;
  const totViews = projects.reduce((s, p) => s + p.views_count, 0);
  const navs = [
    { k: "overview", i: "\u{1F4CA}", l: "Vue d'ensemble" },
    { k: "projects", i: "\u{1F3D7}\uFE0F", l: `Projets (${projects.length})` },
    { k: "crm", i: "\u{1F4E9}", l: `CRM Leads (${leads.length})` },
    { k: "company", i: "\u{1F3DB}\uFE0F", l: "Mon entreprise" },
    { k: "billing", i: "\u{1F4B3}", l: "Abonnement" },
    { k: "profile", i: "\u{1F464}", l: "Mon compte" }
  ];
  const filteredLeads = filterStatus === "all" ? leads : leads.filter((l) => l.status === filterStatus);
  return /* @__PURE__ */ React.createElement(DashLayout, { navs, tab, setTab, profile, user, roleLabel: "\u{1F3D7}\uFE0F Promoteur" }, pLoading ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "overview" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 } }, promoteurInfo && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, borderRadius: 12, background: "var(--nv)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 } }, (promoteurInfo.name || "P")[0]), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 7 } }, promoteurInfo.name, promoteurInfo.is_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 } }, "\u2705 V\xE9rifi\xE9")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)" } }, promoteurInfo.city)))), /* @__PURE__ */ React.createElement("div", { className: "kpig" }, [["\u{1F3D7}\uFE0F", totProjects, "Projets"], ["\u{1F3D8}\uFE0F", totLots, "Lots totaux"], ["\u{1F7E2}", totAvail, "Lots disponibles"], ["\u{1F4E9}", totLeads, "Leads"], ["\u2705", totSigned, "Sign\xE9s"], ["\u{1F441}", totViews, "Vues totales"]].map(([ico, val, lbl]) => /* @__PURE__ */ React.createElement("div", { className: "kpi", key: lbl }, /* @__PURE__ */ React.createElement("div", { className: "kpiic" }, ico), /* @__PURE__ */ React.createElement("div", { className: "kpiv" }, val), /* @__PURE__ */ React.createElement("div", { className: "kpil" }, lbl)))), /* @__PURE__ */ React.createElement("div", { className: "dtit2", style: { marginTop: 10 } }, "\u{1F3D7}\uFE0F Projets r\xE9cents"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, projects.slice(0, 3).map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "dash-card", style: { display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }, onClick: () => setTab("projects") }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7, marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, fontSize: 13 } }, p.name), /* @__PURE__ */ React.createElement("span", { style: { background: PROJECT_STATUS[p.status] ? PROJECT_STATUS[p.status].c : "#ccc", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, PROJECT_STATUS[p.status] ? PROJECT_STATUS[p.status].l : p.status)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, "\u{1F4CD} ", p.quartier, ", ", p.city, " \xB7 ", p.lots_available, "/", p.total_lots, " lots disponibles")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 14, color: "var(--g)" } }, fmt(p.price_from)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "d\xE8s")))))), tab === "projects" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "dtit2", style: { marginBottom: 0 } }, "\u{1F3D7}\uFE0F Mes projets immobiliers"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { padding: "8px 16px" }, onClick: () => {
    setEditingProj(null);
    setNewProj({ name: "", description: "", city: "Dakar", quartier: "", total_lots: 0, lots_available: 0, price_from: 0, price_to: 0, status: "commercialisation", delivery_date: "" });
    setShowNewProj(true);
  } }, "+ Nouveau projet")), showNewProj && /* @__PURE__ */ React.createElement("div", { className: "dash-card", style: { marginBottom: 16, background: "#f0fdf4", border: "1px solid #86efac" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#16a34a" } }, editingProj ? "\u270F\uFE0F Modifier" : "\u2795 Nouveau", " projet"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Nom du projet *"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: newProj.name, onChange: (e) => setNewProj((p) => ({ ...p, name: e.target.value })), placeholder: "R\xE9sidence Les Palmiers" })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", rows: 2, value: newProj.description, onChange: (e) => setNewProj((p) => ({ ...p, description: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Ville"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: newProj.city, onChange: (e) => setNewProj((p) => ({ ...p, city: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Quartier"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: newProj.quartier, onChange: (e) => setNewProj((p) => ({ ...p, quartier: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Total lots"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", value: newProj.total_lots, onChange: (e) => setNewProj((p) => ({ ...p, total_lots: parseInt(e.target.value) || 0 })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Lots disponibles"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", value: newProj.lots_available, onChange: (e) => setNewProj((p) => ({ ...p, lots_available: parseInt(e.target.value) || 0 })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Prix d\xE8s (FCFA)"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", value: newProj.price_from, onChange: (e) => setNewProj((p) => ({ ...p, price_from: parseInt(e.target.value) || 0 })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Prix jusqu'\xE0 (FCFA)"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", value: newProj.price_to, onChange: (e) => setNewProj((p) => ({ ...p, price_to: parseInt(e.target.value) || 0 })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Statut"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: newProj.status, onChange: (e) => setNewProj((p) => ({ ...p, status: e.target.value })) }, Object.entries(PROJECT_STATUS).map(([v, { l }]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, l)))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Livraison pr\xE9vue"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: newProj.delivery_date, onChange: (e) => setNewProj((p) => ({ ...p, delivery_date: e.target.value })), placeholder: "T4 2026" }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } }, /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { flex: 1 }, onClick: saveProject, disabled: savingProj || !newProj.name }, savingProj ? "Sauvegarde..." : "\u{1F4BE} Sauvegarder"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { flex: 1 }, onClick: () => {
    setShowNewProj(false);
    setEditingProj(null);
  } }, "Annuler"))), projects.length === 0 && !showNewProj ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40 } }, "\u{1F3D7}\uFE0F"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Aucun projet encore"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", marginTop: 4 } }, 'Cliquez "+ Nouveau projet" pour commencer.')) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, projects.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "dash-card" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } }, p.cover_image && /* @__PURE__ */ React.createElement("img", { src: p.cover_image, alt: "", style: { width: 72, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }, onError: (e) => e.target.style.display = "none" }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, fontSize: 14 } }, p.name), /* @__PURE__ */ React.createElement("span", { style: { background: PROJECT_STATUS[p.status] ? PROJECT_STATUS[p.status].c : "#ccc", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, PROJECT_STATUS[p.status] ? PROJECT_STATUS[p.status].l : p.status), p.delivery_date && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--mu)" } }, "Livraison: ", p.delivery_date)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 6 } }, "\u{1F4CD} ", p.quartier && p.quartier + ", ", p.city), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 14, flexWrap: "wrap" } }, [["\u{1F3D8}\uFE0F", `${p.lots_available}/${p.total_lots} lots`], ["\u{1F4B0}", `${fmt(p.price_from)} \u2014 ${fmt(p.price_to)}`], ["\u{1F441}", `${p.views_count || 0} vues`], ["\u{1F4E9}", `${p.leads_count || 0} leads`]].map(([ico, val]) => /* @__PURE__ */ React.createElement("span", { key: ico, style: { fontSize: 10, color: "var(--mu)" } }, ico, " ", val)))), /* @__PURE__ */ React.createElement("div", { className: "abtns" }, /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => {
    setEditingProj(p);
    setNewProj({ name: p.name, description: p.description || "", city: p.city, quartier: p.quartier || "", total_lots: p.total_lots, lots_available: p.lots_available, price_from: p.price_from, price_to: p.price_to, status: p.status, delivery_date: p.delivery_date || "" });
    setShowNewProj(true);
  } }, "\u270F\uFE0F"), /* @__PURE__ */ React.createElement("button", { className: "ab abd", onClick: () => deleteProject(p.id) }, "\u{1F5D1}"))))))), tab === "crm" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F4E9} CRM \u2014 Pipeline Leads (", leads.length, ")"), /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginBottom: 14 } }, "\u{1F4A1} Suivez vos prospects du premier contact jusqu'\xE0 la signature."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 } }, [["all", "Tous"], ["nouveau", "Nouveaux"], ["contacte", "Contact\xE9s"], ["visite", "Visites"], ["offre", "Offres"], ["signe", "Sign\xE9s"], ["perdu", "Perdus"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${filterStatus === v ? "on" : ""}`, onClick: () => setFilterStatus(v), style: { fontSize: 10 } }, v !== "all" && PIPELINE_LABELS[v] ? PIPELINE_LABELS[v] : l, " ", v !== "all" ? `(${leads.filter((ld) => ld.status === v).length})` : ""))), filteredLeads.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36 } }, "\u{1F4E9}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Aucun lead ", filterStatus !== "all" ? `"${filterStatus}"` : "")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, filteredLeads.map((lead) => /* @__PURE__ */ React.createElement("div", { key: lead.id, className: "dash-card" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 40, height: 40, borderRadius: 9, background: PIPELINE_COLORS[lead.status] || "#ccc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, PIPELINE_LABELS[lead.status] ? PIPELINE_LABELS[lead.status].slice(0, 2) : "\u{1F4E9}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 120 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, lead.name || "Prospect"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, lead.email || "", lead.phone && " \xB7 " + lead.phone), lead.projects && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--g)", marginTop: 2 } }, "\u{1F3D7}\uFE0F ", lead.projects.name), lead.message && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 4, fontStyle: "italic" } }, '"', lead.message.slice(0, 80), lead.message.length > 80 ? "\u2026" : "", '"'), lead.budget > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2 } }, "Budget: ", fmt(lead.budget))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "var(--mu)" } }, ago(lead.created_at)), /* @__PURE__ */ React.createElement("select", { style: { fontSize: 10, padding: "3px 6px", border: "1px solid var(--br)", borderRadius: 6, background: "#fff", cursor: "pointer", fontWeight: 700, color: PIPELINE_COLORS[lead.status] || "#333" }, value: lead.status, onChange: (e) => updateLeadStatus(lead.id, e.target.value) }, PIPELINE_STEPS.map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, PIPELINE_LABELS[s]))))))))), tab === "billing" && React.createElement(BillingTab, { user, profile, showToast: showDT }), tab === "company" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3DB}\uFE0F Mon entreprise"), !promoteurInfo ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36 } }, "\u{1F3DB}\uFE0F"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Aucun profil promoteur"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", marginTop: 4 } }, "Contactez l'administrateur pour cr\xE9er votre profil promoteur.")) : /* @__PURE__ */ React.createElement("div", { className: "dash-card", style: { maxWidth: 520 } }, !editingPromoteur ? /* @__PURE__ */ React.createElement(React.Fragment, null, [["\u{1F3F7}\uFE0F Nom", promoteurInfo.name], ["\u{1F4E7} Email", promoteurInfo.email || "\u2014"], ["\u{1F4F1} T\xE9l\xE9phone", promoteurInfo.phone || "\u2014"], ["\u{1F4AC} WhatsApp", promoteurInfo.whatsapp || "\u2014"], ["\u{1F4CD} Adresse", promoteurInfo.address || "\u2014"], ["\u{1F310} Site web", promoteurInfo.website || "\u2014"], ["\u2705 V\xE9rifi\xE9", promoteurInfo.is_verified ? "Oui" : "En attente"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--br)", fontSize: 12, gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 600 } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, textAlign: "right" } }, v))), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 14, width: "100%" }, onClick: () => setEditingPromoteur(true) }, "\u270F\uFE0F Modifier"), !promoteurInfo.is_verified && /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginTop: 10 } }, "\u26A0\uFE0F En attente de v\xE9rification par nos \xE9quipes.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Nom de l'entreprise"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: pForm.name || "", onChange: (e) => setPForm((f) => ({ ...f, name: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Email"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "email", value: pForm.email || "", onChange: (e) => setPForm((f) => ({ ...f, email: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "T\xE9l\xE9phone"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: pForm.phone || "", onChange: (e) => setPForm((f) => ({ ...f, phone: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "WhatsApp"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: pForm.whatsapp || "", onChange: (e) => setPForm((f) => ({ ...f, whatsapp: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Adresse"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: pForm.address || "", onChange: (e) => setPForm((f) => ({ ...f, address: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Description"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", rows: 3, value: pForm.description || "", onChange: (e) => setPForm((f) => ({ ...f, description: e.target.value })) }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12 } }, /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { flex: 1 }, onClick: savePromoteur, disabled: savingP }, savingP ? "Sauvegarde..." : "\u{1F4BE} Sauvegarder"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { flex: 1 }, onClick: () => setEditingPromoteur(false) }, "Annuler"))))), tab === "profile" && /* @__PURE__ */ React.createElement(ProfileTab, { user, profile, setShowProfileEdit, showDT })));
}
function AdminDash({ user, profile, showDT }) {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [allListings, setAllListings] = useState([]);
  const [agencies, setAgencies] = useState([]);
  const [promoteurs, setPromoteurs] = useState([]);
  const [adminLoading, setAdminLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [listingSearch, setListingSearch] = useState("");
  const [listingFilter, setListingFilter] = useState("all");
  useEffect(() => {
    loadAdmin();
  }, []);
  async function loadAdmin() {
    setAdminLoading(true);
    const [{ data: st }, { data: us }, { data: ls }, { data: ag }, { data: pr }] = await Promise.all([
      sb.from("admin_stats").select("*").single(),
      sb.from("profiles").select("id,full_name,phone,role,is_verified,created_at,email:id").order("created_at", { ascending: false }).limit(100),
      sb.from("listings").select("id,title,property_type,transaction_type,price,status,is_verified,is_physically_verified,is_featured,trust_score,quartier,city,created_at,views_count,owner_id").order("created_at", { ascending: false }).limit(100),
      sb.from("agencies").select("*").order("created_at", { ascending: false }),
      sb.from("promoteurs").select("*").order("created_at", { ascending: false })
    ]);
    if (st) setStats(st);
    if (us) setUsers(us);
    if (ls) setAllListings(ls);
    if (ag) setAgencies(ag);
    if (pr) setPromoteurs(pr);
    setAdminLoading(false);
  }
  async function updateUserRole(id, role) {
    const { error } = await sb.from("profiles").update({ role }).eq("id", id);
    if (error) {
      showDT("\u274C " + error.message, "err");
      return;
    }
    setUsers((us) => us.map((u) => u.id === id ? { ...u, role } : u));
    showDT("\u2705 R\xF4le mis \xE0 jour");
  }
  async function verifyUser(id, val) {
    await sb.from("profiles").update({ is_verified: val }).eq("id", id);
    setUsers((us) => us.map((u) => u.id === id ? { ...u, is_verified: val } : u));
    showDT(val ? "\u2705 Utilisateur v\xE9rifi\xE9" : "V\xE9rification retir\xE9e");
  }
  async function updateListingStatus(id, status) {
    await sb.from("listings").update({ status }).eq("id", id);
    setAllListings((ls) => ls.map((l) => l.id === id ? { ...l, status } : l));
    showDT("\u2705 Annonce mise \xE0 jour");
  }
  async function verifyListing(id, val) {
    const ts = val ? 95 : 0;
    await sb.from("listings").update({ is_verified: val, trust_score: ts }).eq("id", id);
    setAllListings((ls) => ls.map((l) => l.id === id ? { ...l, is_verified: val, trust_score: ts } : l));
    showDT(val ? "\u2705 Annonce v\xE9rifi\xE9e" : "V\xE9rification retir\xE9e");
  }
  const [verifyModal, setVerifyModal] = useState(null); // {id, listing}
  async function physicalVerifyListing(id, val) {
    if (val) {
      // Ouvrir modal pour saisir le rapport agent
      const listing = allListings.find(l => l.id === id);
      setVerifyModal({ id, listing });
      return;
    }
    // Retrait vérification
    const ts = 80;
    await sb.from("listings").update({
      is_physically_verified: false,
      physically_verified_at: null,
      trust_score: ts,
      agent_verified_description: null,
      agent_verified_by_name: null,
      agent_verified_date: null,
    }).eq("id", id);
    setAllListings(ls => ls.map(l => l.id === id ? { ...l, is_physically_verified: false, trust_score: ts } : l));
    showDT("Vérification physique retirée");
  }
  async function submitVerifyModal(agentDesc, agentName) {
    if (!verifyModal) return;
    const { id } = verifyModal;
    const ts = 100;
    await sb.from("listings").update({
      is_physically_verified: true,
      physically_verified_at: new Date().toISOString(),
      agent_verified_description: agentDesc || null,
      agent_verified_by_name: agentName || null,
      agent_verified_date: new Date().toISOString().slice(0, 10),
      trust_score: ts,
      is_verified: true,
    }).eq("id", id);
    setAllListings(ls => ls.map(l => l.id === id ? { ...l, is_physically_verified: true, trust_score: ts, agent_verified_description: agentDesc, agent_verified_by_name: agentName } : l));
    showDT("\u{1F3C5} Bien vérifié terrain — rapport enregistré !");
    setVerifyModal(null);
  }
  async function featureListing(id, val) {
    await sb.from("listings").update({ is_featured: val }).eq("id", id);
    setAllListings((ls) => ls.map((l) => l.id === id ? { ...l, is_featured: val } : l));
    showDT(val ? "\u2B50 Annonce mise en avant" : "Mise en avant retir\xE9e");
  }
  async function verifyAgency(id, val) {
    await sb.from("agencies").update({ is_verified: val }).eq("id", id);
    setAgencies((ag) => ag.map((a) => a.id === id ? { ...a, is_verified: val } : a));
    showDT(val ? "\u2705 Agence v\xE9rifi\xE9e" : "V\xE9rification retir\xE9e");
  }
  async function updateAgencyPlan(id, plan) {
    await sb.from("agencies").update({ subscription_plan: plan }).eq("id", id);
    setAgencies((ag) => ag.map((a) => a.id === id ? { ...a, subscription_plan: plan } : a));
    showDT("\u2705 Plan mis \xE0 jour");
  }
  async function verifyPromoteur(id, val) {
    await sb.from("promoteurs").update({ is_verified: val }).eq("id", id);
    setPromoteurs((ps) => ps.map((p) => p.id === id ? { ...p, is_verified: val } : p));
    showDT(val ? "\u2705 Promoteur v\xE9rifi\xE9" : "V\xE9rification retir\xE9e");
  }
  async function deleteListingAdmin(id) {
    if (!confirm("Supprimer d\xE9finitivement cette annonce ?")) return;
    await sb.from("listings").delete().eq("id", id);
    setAllListings((ls) => ls.filter((l) => l.id !== id));
    showDT("\u{1F5D1} Annonce supprim\xE9e");
  }
  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return !q || (u.full_name || "").toLowerCase().includes(q) || (u.id || "").includes(q);
  });
  const filteredListings = allListings.filter((l) => {
    const q = listingSearch.toLowerCase();
    const matchQ = !q || (l.title || "").toLowerCase().includes(q) || (l.quartier || "").toLowerCase().includes(q);
    const matchF = listingFilter === "all" || l.status === listingFilter || listingFilter === "pending_verify" && !l.is_verified && l.status === "active";
    return matchQ && matchF;
  });
  const ROLES = ["particulier", "agent", "agence", "promoteur", "admin"];
  const [adminReports, setAdminReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  useEffect(() => {
    sb.from("listing_reports").select("*,listings(title,cover_image,quartier,city,price),profiles!reporter_id(full_name,email)").order("created_at", { ascending: false }).limit(50).then(({ data }) => {
      setAdminReports(data || []);
      setReportsLoading(false);
    });
  }, []);
  async function updateAdminReport(id, status) {
    await sb.from("listing_reports").update({ status }).eq("id", id);
    setAdminReports((rr) => rr.map((r) => r.id === id ? { ...r, status } : r));
    showDT("\u2705 Signalement mis \xE0 jour");
  }
  const pendingReports = adminReports.filter((r) => r.status === "pending").length;
  const navs = [
    { k: "overview", i: "\u{1F4CA}", l: "Vue d'ensemble" },
    { k: "users", i: "\u{1F465}", l: `Utilisateurs (${users.length})` },
    { k: "listings", i: "\u{1F3E0}", l: `Annonces (${allListings.length})` },
    { k: "verifications", i: "🔍", l: "Vérifications" },
    { k: "revenue", i: "💰", l: "Revenus" },
    { k: "reports", i: "\u{1F6A9}", l: `Signalements${pendingReports > 0 ? " (" + pendingReports + ")" : ""}` },
    { k: "agencies", i: "\u{1F3E2}", l: `Agences (${agencies.length})` },
    { k: "promoteurs", i: "\u{1F3D7}\uFE0F", l: `Promoteurs (${promoteurs.length})` },
    { k: "profile", i: "\u{1F464}", l: "Mon compte" }
  ];
  return React.createElement(React.Fragment, null,
    verifyModal && React.createElement(AgentVerifyReportModal, {
      listing: verifyModal.listing,
      agentName: profile?.full_name || "",
      onConfirm: submitVerifyModal,
      onClose: () => setVerifyModal(null)
    }),
    React.createElement(DashLayout, { navs, tab, setTab, profile, user, roleLabel: "\u{1F510} Administrateur", adminMode: true }, adminLoading ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "overview" && stats && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F4CA} Statistiques plateforme"), /* @__PURE__ */ React.createElement("div", { className: "kpig" }, [["\u{1F465}", stats.total_users, "Utilisateurs"], ["\u{1F3E0}", stats.active_listings, "Annonces actives"], ["\u23F3", stats.pending_listings, "En attente"], ["\u{1F3E2}", stats.total_agencies, "Agences"], ["\u2705", stats.verified_agencies, "V\xE9rifi\xE9es"], ["\u{1F441}", (stats.total_views || 0).toLocaleString("fr"), "Vues totales"]].map(([ico, val, lbl]) => /* @__PURE__ */ React.createElement("div", { className: "kpi", key: lbl }, /* @__PURE__ */ React.createElement("div", { className: "kpiic" }, ico), /* @__PURE__ */ React.createElement("div", { className: "kpiv" }, val), /* @__PURE__ */ React.createElement("div", { className: "kpil" }, lbl)))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 4 } }, /* @__PURE__ */ React.createElement("div", { className: "dash-card" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 10 } }, "\u{1F465} R\xE9partition par r\xF4le"), [["particulier", "\u{1F64B} Particuliers"], ["agent", "\u{1F3E1} Agents"], ["agence", "\u{1F3E2} Agences"], ["promoteur", "\u{1F3D7}\uFE0F Promoteurs"], ["admin", "\u{1F510} Admins"]].map(([role, label]) => {
    const count = users.filter((u) => u.role === role).length;
    const pct = users.length > 0 ? Math.round(count / users.length * 100) : 0;
    return /* @__PURE__ */ React.createElement("div", { key: role, style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 } }, /* @__PURE__ */ React.createElement("span", null, label), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700 } }, count)), /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: "var(--bg)", borderRadius: 3 } }, /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: "var(--g)", borderRadius: 3, width: pct + "%" } })));
  })), /* @__PURE__ */ React.createElement("div", { className: "dash-card" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 10 } }, "\u{1F3E0} Statuts annonces"), [["active", "\u2705 Actives", "#16a34a"], ["pending", "\u23F3 En attente", "#f59e0b"], ["archived", "\u{1F4E6} Archiv\xE9es", "#94a3b8"], ["sold", "\u{1F4B0} Vendues", "#3b82f6"]].map(([status, label, color]) => {
    const count = allListings.filter((l) => l.status === status).length;
    const pct = allListings.length > 0 ? Math.round(count / allListings.length * 100) : 0;
    return /* @__PURE__ */ React.createElement("div", { key: status, style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 } }, /* @__PURE__ */ React.createElement("span", null, label), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700 } }, count)), /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: "var(--bg)", borderRadius: 3 } }, /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: color, borderRadius: 3, width: pct + "%" } })));
  }))), /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginTop: 14 } }, "\u{1F4C5} Annonces cette semaine : ", /* @__PURE__ */ React.createElement("strong", null, stats.listings_this_week), " \xB7 Agents : ", /* @__PURE__ */ React.createElement("strong", null, stats.total_agents), " \xB7 Promoteurs : ", /* @__PURE__ */ React.createElement("strong", null, stats.total_promoteurs))), tab === "users" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F465} Gestion des utilisateurs (", filteredUsers.length, ")"), /* @__PURE__ */ React.createElement("input", { className: "fi", style: { marginBottom: 12 }, placeholder: "Rechercher par nom ou ID...", value: userSearch, onChange: (e) => setUserSearch(e.target.value) }), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 640 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Utilisateur"), /* @__PURE__ */ React.createElement("th", null, "R\xF4le"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Inscrit"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, filteredUsers.map((u) => /* @__PURE__ */ React.createElement("tr", { key: u.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 11 } }, u.full_name || "Sans nom"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)", fontFamily: "monospace" } }, u.id.slice(0, 16), "\u2026"), u.phone && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, u.phone)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("select", { style: { fontSize: 10, padding: "3px 5px", border: "1px solid var(--br)", borderRadius: 5, cursor: "pointer", fontWeight: 700 }, value: u.role || "particulier", onChange: (e) => updateUserRole(u.id, e.target.value) }, ROLES.map((r) => /* @__PURE__ */ React.createElement("option", { key: r, value: r }, r)))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { background: u.is_verified ? "#dcfce7" : "#fef3c7", color: u.is_verified ? "#16a34a" : "#92400e", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, u.is_verified ? "\u2705 V\xE9rifi\xE9" : "\u23F3 En attente")), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 10, color: "var(--mu)" } }, u.created_at ? new Date(u.created_at).toLocaleDateString("fr-SN") : "\u2014"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "abtns" }, /* @__PURE__ */ React.createElement("button", { className: "ab abe", title: u.is_verified ? "Retirer v\xE9rification" : "V\xE9rifier", onClick: () => verifyUser(u.id, !u.is_verified) }, u.is_verified ? "\u274C" : "\u2705"))))))))), tab === "listings" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3E0} Mod\xE9ration annonces (", filteredListings.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("input", { className: "fi", style: { flex: "1 1 180px" }, placeholder: "Rechercher...", value: listingSearch, onChange: (e) => setListingSearch(e.target.value) }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap" } }, [["all", "Toutes"], ["active", "Actives"], ["pending", "En attente"], ["archived", "Archiv\xE9es"], ["pending_verify", "\xC0 v\xE9rifier"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${listingFilter === v ? "on" : ""}`, onClick: () => setListingFilter(v), style: { fontSize: 10 } }, l)))), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 700 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Annonce"), /* @__PURE__ */ React.createElement("th", null, "Prix"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Trust"), /* @__PURE__ */ React.createElement("th", null, "Vues"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, filteredListings.map((l) => /* @__PURE__ */ React.createElement("tr", { key: l.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 11, display: "flex", alignItems: "center", gap: 5 } }, PICO[l.property_type], " ", (l.title || "").slice(0, 28), l.is_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 8, padding: "1px 4px", borderRadius: 3 } }, "\u2705"), l.is_featured && /* @__PURE__ */ React.createElement("span", { style: { background: "#fef3c7", color: "#92400e", fontSize: 8, padding: "1px 4px", borderRadius: 3 } }, "\u2B50")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "\u{1F4CD} ", l.quartier, ", ", l.city, " \xB7 ", ago(l.created_at))), /* @__PURE__ */ React.createElement("td", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 11, color: "var(--g)" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("select", { style: { fontSize: 9, padding: "2px 4px", border: "1px solid var(--br)", borderRadius: 4 }, value: l.status, onChange: (e) => updateListingStatus(l.id, e.target.value) }, ["active", "pending", "archived", "sold", "rented"].map((s) => /* @__PURE__ */ React.createElement("option", { key: s, value: s }, s)))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800, fontSize: 11, color: l.trust_score >= 80 ? "#16a34a" : l.trust_score >= 60 ? "#d97706" : "#dc2626" } }, l.trust_score || 0, "%")), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 10, color: "var(--mu)" } }, "\u{1F441} ", l.views_count || 0), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "abtns" }, /* @__PURE__ */ React.createElement("button", { className: "ab abe", title: l.is_verified ? "Retirer v\xE9rification" : "V\xE9rifier", onClick: () => verifyListing(l.id, !l.is_verified) }, l.is_verified ? "\u274C Unverify" : "\u2705 Verify"), /* @__PURE__ */ React.createElement("button", { className: "ab", style: { background: l.is_physically_verified ? "#fef3c7" : "#f9fafb", color: l.is_physically_verified ? "#92400e" : "#6b7280", border: "1px solid " + (l.is_physically_verified ? "#f59e0b" : "#e5e7eb") }, title: l.is_physically_verified ? "Retirer v\xE9rif. physique" : "Marquer v\xE9rifi\xE9 sur place", onClick: () => physicalVerifyListing(l.id, !l.is_physically_verified) }, l.is_physically_verified ? "\u{1F3C5} Physique" : "\u{1F50D} Site"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", title: l.is_featured ? "Retirer mise en avant" : "Mettre en avant", onClick: () => featureListing(l.id, !l.is_featured) }, l.is_featured ? "\u274C Unfeature" : "\u2B50 Feature"), /* @__PURE__ */ React.createElement("button", { className: "ab abd", onClick: () => deleteListingAdmin(l.id) }, "\u{1F5D1}"))))))))), tab === "reports" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "dtit2", style: { marginBottom: 0 } }, "\u{1F6A9} Signalements d'annonces"), pendingReports > 0 && /* @__PURE__ */ React.createElement("span", { style: { background: "#fef2f2", border: "1px solid #fca5a5", color: "#ef4444", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 100 } }, pendingReports, " en attente")), reportsLoading ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : adminReports.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36, marginBottom: 8 } }, "\u2705"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, "Aucun signalement")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, adminReports.map((r) => {
    const sc = { pending: { bg: "#fffbeb", bd: "#fbbf24", c: "#92400e", l: "\u23F3 En attente" }, reviewed: { bg: "#ecfdf5", bd: "#6ee7b7", c: "#065f46", l: "\u2705 Trait\xE9" }, dismissed: { bg: "#f3f4f6", bd: "#d1d5db", c: "#6b7280", l: "\u2014 Ignor\xE9" } };
    const s = sc[r.status] || sc.pending;
    const RLABELS = { fausse_annonce: "Annonce mensong\xE8re", prix_errone: "Prix erron\xE9", photos_trompeuses: "Photos trompeuses", escroquerie: "Escroquerie", doublon: "Doublon", autre: "Autre" };
    return /* @__PURE__ */ React.createElement("div", { key: r.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: "12px 14px", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" } }, r.listings?.cover_image && /* @__PURE__ */ React.createElement("img", { src: r.listings.cover_image, alt: "", style: { width: 60, height: 46, borderRadius: 6, objectFit: "cover", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 120 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12, marginBottom: 2 } }, r.listings?.title || "Annonce supprim\xE9e"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginBottom: 4 } }, "\u{1F4CD} ", r.listings?.quartier, ", ", r.listings?.city), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { background: "#fef2f2", color: "#ef4444", fontWeight: 700, fontSize: 10, padding: "2px 6px", borderRadius: 4 } }, RLABELS[r.reason] || r.reason), /* @__PURE__ */ React.createElement("span", { style: { background: s.bg, border: `1px solid ${s.bd}`, color: s.c, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, s.l)), r.details && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", fontStyle: "italic", marginTop: 4 } }, '"', r.details, '"'), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)", marginTop: 3 } }, "Par : ", r.profiles?.full_name || r.profiles?.email || "Anonyme", " \xB7 ", ago(r.created_at))), r.status === "pending" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexShrink: 0, flexDirection: "column" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => updateAdminReport(r.id, "reviewed"), style: { fontSize: 10, padding: "4px 9px", borderRadius: 6, border: "1.5px solid #16a34a", background: "#ecfdf5", color: "#16a34a", cursor: "pointer", fontWeight: 700 } }, "\u2705 Traiter"), /* @__PURE__ */ React.createElement("button", { onClick: () => updateAdminReport(r.id, "dismissed"), style: { fontSize: 10, padding: "4px 9px", borderRadius: 6, border: "1.5px solid #d1d5db", background: "#f3f4f6", color: "#6b7280", cursor: "pointer", fontWeight: 700 } }, "\u2717 Ignorer"))));
  }))), tab === "verifications" && React.createElement(VerifRequestsAdminTab, { showDT, adminProfile: profile }),
    tab === "revenue" && React.createElement(RevenueAdminTab, { showDT }),
    tab === "agencies" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3E2} Gestion agences (", agencies.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 640 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Agence"), /* @__PURE__ */ React.createElement("th", null, "Ville"), /* @__PURE__ */ React.createElement("th", null, "Plan"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, agencies.map((ag) => /* @__PURE__ */ React.createElement("tr", { key: ag.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, ag.name), ag.email && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, ag.email)), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 11 } }, ag.city), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("select", { style: { fontSize: 10, padding: "3px 5px", border: "1px solid var(--br)", borderRadius: 5, cursor: "pointer", fontWeight: 700 }, value: ag.subscription_plan, onChange: (e) => updateAgencyPlan(ag.id, e.target.value) }, ["free", "basic", "premium", "vip"].map((p) => /* @__PURE__ */ React.createElement("option", { key: p, value: p }, p)))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { background: ag.is_verified ? "#dcfce7" : "#fef3c7", color: ag.is_verified ? "#16a34a" : "#92400e", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, ag.is_verified ? "\u2705 V\xE9rifi\xE9e" : "\u23F3 En attente")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => verifyAgency(ag.id, !ag.is_verified) }, ag.is_verified ? "\u274C Unverify" : "\u2705 V\xE9rifier")))))))), tab === "promoteurs" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3D7}\uFE0F Gestion promoteurs (", promoteurs.length, ")"), promoteurs.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36 } }, "\u{1F3D7}\uFE0F"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Aucun promoteur inscrit")) : /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 580 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Promoteur"), /* @__PURE__ */ React.createElement("th", null, "Ville"), /* @__PURE__ */ React.createElement("th", null, "Contact"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, promoteurs.map((p) => /* @__PURE__ */ React.createElement("tr", { key: p.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 12 } }, p.name), p.email && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, p.email)), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 11 } }, p.city), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 10, color: "var(--mu)" } }, p.phone || "\u2014"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { background: p.is_verified ? "#dcfce7" : "#fef3c7", color: p.is_verified ? "#16a34a" : "#92400e", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, p.is_verified ? "\u2705 V\xE9rifi\xE9" : "\u23F3 En attente")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => verifyPromoteur(p.id, !p.is_verified) }, p.is_verified ? "\u274C Unverify" : "\u2705 V\xE9rifier")))))))), tab === "profile" && /* @__PURE__ */ React.createElement(ProfileTab, { user, profile, setShowProfileEdit: () => showDT("Modif profil admin", ""), showDT }))));
}
function DashLayout({ children, navs, tab, setTab, profile, user, roleLabel, adminMode }) {
  const ini = (profile && profile.full_name || user.email || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return /* @__PURE__ */ React.createElement("div", { className: "dash" }, /* @__PURE__ */ React.createElement("div", { className: "dashg" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "dpc" }, /* @__PURE__ */ React.createElement("div", { className: "dav" }, ini), /* @__PURE__ */ React.createElement("div", { className: "dname" }, profile && profile.full_name || user.email && user.email.split("@")[0]), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", margin: "2px 0 5px" } }, user.email), /* @__PURE__ */ React.createElement("span", { className: "drole" }, roleLabel || "\u{1F464} " + (profile && profile.role || "Utilisateur")), adminMode && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "3px 8px", fontSize: 9, fontWeight: 700, color: "#dc2626", textAlign: "center" } }, "\u{1F510} MODE ADMIN")), /* @__PURE__ */ React.createElement("div", { className: "dside" }, navs.map(({ k, i, l }) => /* @__PURE__ */ React.createElement("button", { key: k, className: `dnb ${tab === k ? "on" : ""}`, onClick: () => setTab(k) }, i, " ", l)))), /* @__PURE__ */ React.createElement("div", null, children)));
}
function PerformanceChart({ myList, title }) {
  if (!myList || myList.length === 0) return null;
  const mx = Math.max(...myList.map((x) => x.views_count || 0), 1);
  return /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, marginBottom: 16, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 14, marginBottom: 12 } }, title || "\u{1F4C8} Performance par annonce (vues)"), myList.slice(0, 5).map((l) => {
    const w = Math.round((l.views_count || 0) / mx * 100);
    return /* @__PURE__ */ React.createElement("div", { key: l.id, className: "cbrw" }, /* @__PURE__ */ React.createElement("div", { className: "cblbl", title: l.title }, (l.title || "").slice(0, 11), l.title && l.title.length > 11 ? "\u2026" : ""), /* @__PURE__ */ React.createElement("div", { className: "cbwrp" }, /* @__PURE__ */ React.createElement("div", { className: "cbfil", style: { width: w + "%" } })), /* @__PURE__ */ React.createElement("div", { className: "cbval" }, l.views_count || 0));
  }));
}
function RecentListingsTable({ myList, onOpenListing, onViewAll, title }) {
  return /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 15px", borderBottom: "1px solid var(--br)", fontFamily: "var(--fd)", fontWeight: 700, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" } }, title || "Annonces r\xE9centes", " ", /* @__PURE__ */ React.createElement("button", { className: "ab abv", onClick: onViewAll }, "Voir toutes \u2192")), myList.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: 24, textAlign: "center", color: "var(--mu)", fontSize: 12 } }, 'Aucune annonce. D\xE9posez via "+ Annonce".') : /* @__PURE__ */ React.createElement("table", { className: "dtbl" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Annonce"), /* @__PURE__ */ React.createElement("th", null, "Prix"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Vues"))), /* @__PURE__ */ React.createElement("tbody", null, myList.slice(0, 5).map((l) => /* @__PURE__ */ React.createElement("tr", { key: l.id, style: { cursor: "pointer" }, onClick: () => onOpenListing(l) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 11 } }, PICO[l.property_type], " ", (l.title || "").slice(0, 24), "\u2026"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "\u{1F4CD} ", l.quartier)), /* @__PURE__ */ React.createElement("td", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 11, color: "var(--g)", whiteSpace: "nowrap" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "sdot" }, /* @__PURE__ */ React.createElement("span", { className: `dot ${l.status === "active" ? "dg" : l.status === "archived" ? "dr" : "dy"}` }), l.status)), /* @__PURE__ */ React.createElement("td", { style: { color: "var(--mu)", fontSize: 11 } }, "\u{1F441} ", l.views_count || 0))))));
}
function MyListingsTab({ myList, onOpenListing, setEditListing, toggleStatus, del, boost, onRequestVerif, user, profile }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F3E0} Mes annonces (", myList.length, ")"), myList.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 32, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 32, marginBottom: 8 } }, "\u{1F3E0}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginBottom: 4 } }, "Aucune annonce"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)" } }, 'Cliquez sur "+ Annonce" pour commencer.')) : /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "auto", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 560 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Bien"), /* @__PURE__ */ React.createElement("th", null, "Prix"), /* @__PURE__ */ React.createElement("th", null, "Statut"), /* @__PURE__ */ React.createElement("th", null, "Boost"), /* @__PURE__ */ React.createElement("th", null, "Vues"), /* @__PURE__ */ React.createElement("th", null, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, myList.map((l) => /* @__PURE__ */ React.createElement("tr", { key: l.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, alignItems: "center" } }, /* @__PURE__ */ React.createElement("img", { src: l.cover_image || "", alt: "", style: { width: 38, height: 30, borderRadius: 4, objectFit: "cover", flexShrink: 0 }, onError: (e) => e.target.style.display = "none" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 11 } }, (l.title || "").slice(0, 22), "\u2026"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "\u{1F4CD} ", l.quartier)))), /* @__PURE__ */ React.createElement("td", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 11, color: "var(--g)", whiteSpace: "nowrap" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "sdot" }, /* @__PURE__ */ React.createElement("span", { className: `dot ${l.status === "active" ? "dg" : l.status === "archived" ? "dr" : "dy"}` }), l.status)), /* @__PURE__ */ React.createElement("td", null, l.is_premium ? /* @__PURE__ */ React.createElement("span", { className: "boost-badge" }, "\u2B50 Premium") : /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => boost(l.id) }, "\u{1F680} Boost")), /* @__PURE__ */ React.createElement("td", null, onRequestVerif ? /* @__PURE__ */ React.createElement("button", { className: "btn-verif btn-verif-sm", onClick: (e) => { e.stopPropagation(); onRequestVerif(l); }, title: "Demander une vérification payante" }, getVLevel(l) !== "none" ? "🔍 Améliorer" : "🔍 Vérifier") : null), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 11, color: "var(--mu)" } }, "\u{1F441} ", l.views_count || 0), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "abtns" }, /* @__PURE__ */ React.createElement("button", { className: "ab abv", onClick: () => onOpenListing(l), title: "Voir" }, "\u{1F441}"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => setEditListing(l), title: "Modifier" }, "\u270F\uFE0F"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => toggleStatus(l.id, l.status), title: l.status === "active" ? "Archiver" : "R\xE9activer" }, l.status === "active" ? "\u23F8" : "\u25B6"), /* @__PURE__ */ React.createElement("button", { className: "ab abd", onClick: () => del(l.id), title: "Supprimer" }, "\u{1F5D1}")))))))));
}
function MessagesTab({ convs, onOpenListing }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F4AC} Mes conversations (", convs.length, ")"), convs.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 28, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 7 } }, "\u{1F4AC}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, "Aucune conversation"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 3 } }, "Les messages envoy\xE9s via les annonces appara\xEEtront ici.")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, convs.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: 12, padding: 13, display: "flex", gap: 11, alignItems: "center", cursor: "pointer", boxShadow: "var(--sh)", transition: ".18s" }, onClick: () => c.listing_id && onOpenListing({ id: c.listing_id, ...c.listings }) }, /* @__PURE__ */ React.createElement("div", { style: { width: 44, height: 36, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--bg)" } }, c.listings && c.listings.cover_image && /* @__PURE__ */ React.createElement("img", { src: c.listings.cover_image, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" }, onError: (e) => e.target.style.display = "none" })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c.listings && c.listings.property_type && PICO[c.listings.property_type] || "\u{1F3E0}", " ", c.listings && c.listings.title || "Annonce"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 1 } }, "Dernier message \xB7 ", ago(c.last_message_at))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--g)", fontWeight: 700 } }, "\u2192")))));
}
function FavoritesTab({ favListings, favIds, onFav, onOpenListing }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u2764\uFE0F Mes favoris (", favIds.length, ")"), favListings.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 28, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 7 } }, "\u{1F90D}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, "Aucun favori"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 3 } }, "Cliquez \u2764\uFE0F sur les annonces pour les sauvegarder.")) : /* @__PURE__ */ React.createElement("div", { className: "grid" }, favListings.map((l) => /* @__PURE__ */ React.createElement(Card, { key: l.id, l, onClick: () => onOpenListing(l), favIds, onFav }))));
}
function AlertsTab({ alerts, toggleAlert, deleteAlert }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "dtit2", style: { marginBottom: 0 } }, "\u{1F514} Mes alertes de recherche")), /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginBottom: 14 } }, "\u{1F4A1} Recevez une notification d\xE8s qu'une annonce correspond \xE0 vos crit\xE8res. Cr\xE9ez des alertes depuis la page Annonces."), alerts.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 28, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 7 } }, "\u{1F514}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, "Aucune alerte"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 3 } }, 'Allez sur la page Annonces, filtrez et cliquez "Cr\xE9er une alerte".')) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, alerts.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: 12, padding: 14, boxShadow: "var(--sh)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 38, height: 38, borderRadius: 9, background: a.is_active ? "var(--gl)" : "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, "\u{1F514}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, a.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" } }, a.filters && a.filters.transaction_type && /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", padding: "1px 5px", borderRadius: 3 } }, TXL[a.filters.transaction_type]), a.filters && a.filters.property_type && /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", padding: "1px 5px", borderRadius: 3 } }, a.filters.property_type), a.filters && a.filters.region && /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", padding: "1px 5px", borderRadius: 3 } }, "\u{1F4CD} ", a.filters.region), a.filters && a.filters.price_max && /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", padding: "1px 5px", borderRadius: 3 } }, "Max ", fmtM(a.filters.price_max)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: a.is_active ? "var(--g)" : "var(--mu)" } }, a.is_active ? "\u25CF Active" : "\u25CB Inactive"), /* @__PURE__ */ React.createElement("button", { className: "ab abe", onClick: () => toggleAlert(a.id, a.is_active) }, a.is_active ? "\u23F8" : "\u25B6"), /* @__PURE__ */ React.createElement("button", { className: "ab abd", onClick: () => deleteAlert(a.id) }, "\u{1F5D1}"))))));
}
function ProfileTab({ user, profile, setShowProfileEdit, showDT }) {
  const ini = (profile && profile.full_name || user.email || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const isDiaspora = profile && profile.user_type === "diaspora";
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F464} Mon profil"), isDiaspora && /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#ecfdf5,#eff6ff)", border: "1.5px solid #a7f3d0", borderRadius: "var(--r)", padding: "14px 16px", maxWidth: 480, marginBottom: 14, display: "flex", gap: 12, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 40, height: 40, borderRadius: 50, background: "linear-gradient(135deg,#0a5c36,#1e3a5f)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 } }, "\u{1F30D}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: "#065f46", marginBottom: 4 } }, "Compte Diaspora / Expatri\xE9"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 11, color: "#047857" } }, profile.country_residence && /* @__PURE__ */ React.createElement("span", null, "\u{1F4CD} ", profile.country_residence, profile.city_residence ? `, ${profile.city_residence}` : ""), profile.nationality && /* @__PURE__ */ React.createElement("span", null, "\u{1FAAA} ", profile.nationality), profile.zone_interest && /* @__PURE__ */ React.createElement("span", null, "\u{1F5FA}\uFE0F Zone : ", profile.zone_interest), profile.investment_budget && /* @__PURE__ */ React.createElement("span", null, "\u{1F4B0} Budget : ", parseInt(profile.investment_budget).toLocaleString("fr"), " FCFA"), profile.property_type_interest && profile.property_type_interest.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { gridColumn: "span 2" } }, "\u{1F3E0} Int\xE9r\xEAts : ", profile.property_type_interest.join(", "))))), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 20, maxWidth: 480, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 13, marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", { className: "dav", style: { width: 60, height: 60, fontSize: 22, margin: 0 } }, ini), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 16 } }, profile && profile.full_name || "\u2014"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)" } }, user.email), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { className: "drole" }, "\u{1F464} ", profile && profile.role || "Utilisateur"), isDiaspora && /* @__PURE__ */ React.createElement("span", { style: { background: "linear-gradient(135deg,#0a5c36,#1e3a5f)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, "\u{1F30D} Diaspora")))), [["\u{1F4E7} Email", user.email], ["\u{1F4F1} T\xE9l\xE9phone", profile && profile.phone || "Non renseign\xE9"], ["\u{1F4AC} WhatsApp", profile && profile.whatsapp || "Non renseign\xE9"], ["\u2705 V\xE9rifi\xE9", profile && profile.is_verified ? "Compte v\xE9rifi\xE9" : "En attente de v\xE9rification"], ["\u{1F4C5} Inscrit le", new Date(user.created_at).toLocaleDateString("fr-SN", { day: "numeric", month: "long", year: "numeric" })]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--br)", fontSize: 12, gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 600, flexShrink: 0 } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, textAlign: "right" } }, v))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { flex: 1 }, onClick: () => setShowProfileEdit(true) }, "\u270F\uFE0F Modifier le profil"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { flex: 1 }, onClick: () => {
    navigator.clipboard.writeText(user.email);
    showDT("\u{1F4CB} Email copi\xE9 !");
  } }, "\u{1F4CB} Copier email")), profile && !profile.is_verified && /* @__PURE__ */ React.createElement("div", { className: "al awi", style: { marginTop: 12 } }, "\u26A0\uFE0F Votre compte n'est pas encore v\xE9rifi\xE9. V\xE9rifiez votre email.")), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, maxWidth: 480, marginTop: 14, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 14, marginBottom: 12 } }, "\u{1F510} S\xE9curit\xE9"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { marginBottom: 8 }, onClick: () => sb.auth.resetPasswordForEmail(user.email).then(() => showDT("\u{1F4E7} Email de r\xE9initialisation envoy\xE9 !")) }, "\u{1F511} Changer le mot de passe"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, color: "var(--mu)" } }, "Un email vous sera envoy\xE9 pour r\xE9initialiser votre mot de passe.")));
}
function EmptyState({ icon, title, sub }) {
  return /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 8 } }, icon), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, title), sub && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 4 } }, sub));
}
function Dashboard({ user, onOpenListing, onShowAgency, onLogout, favIds, onFav, initialProfile }) {
  const [myList, setMyList] = useState([]);
  const [convs, setConvs] = useState([]);
  const [favListings, setFavListings] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  // initialProfile = appProfile depuis App (évite flash ParticulierDash)
  const [profile, setProfile] = useState(initialProfile || null);
  const [profileRetries, setProfileRetries] = useState(0);
  const [editListing, setEditListing] = useState(null);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [dToast, setDToast] = useState(null);
  const showDT = (msg, type = "ok") => {
    setDToast({ msg, type });
    setTimeout(() => setDToast(null), 3200);
  };
  useEffect(() => { load(); }, []);
  // Retry si profile toujours null après load (race condition signup → trigger)
  useEffect(() => {
    if (!loading && !profile && profileRetries < 3) {
      const t = setTimeout(() => {
        setProfileRetries(r => r + 1);
        loadProfile();
      }, 800 * (profileRetries + 1));
      return () => clearTimeout(t);
    }
  }, [loading, profile, profileRetries]);

  async function loadProfile() {
    const { data: p } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (p) setProfile(p);
  }

  async function load() {
    setLoading(true);
    try {
      const [{ data: p }, { data: l }, { data: cv }, { data: al }, fl] = await Promise.all([
        sb.from("profiles").select("*").eq("id", user.id).single(),
        sb.from("listings").select("*").or(`owner_id.eq.${user.id},agency_id.eq.${user.id}`).order("created_at", { ascending: false }),
        sb.from("conversations").select("*,listings(title,cover_image,property_type)").or("participant_a.eq." + user.id + ",participant_b.eq." + user.id).order("last_message_at", { ascending: false }).limit(10),
        sb.from("alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        favIds.length > 0 ? sb.from("listings").select("*").in("id", favIds) : Promise.resolve({ data: [] })
      ]);
      if (p) setProfile(p);
      if (l) setMyList(l);
      if (cv) setConvs(cv);
      if (al) setAlerts(al);
      if (fl && fl.data) setFavListings(fl.data);
    } catch (e) {
      console.warn("Dashboard.load:", e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (favIds.length > 0) sb.from("listings").select("*").in("id", favIds).then(({ data }) => setFavListings(data || []));
    else setFavListings([]);
  }, [favIds]);
  async function toggleStatus(id, cur) {
    const ns = cur === "active" ? "archived" : "active";
    await sb.from("listings").update({ status: ns }).eq("id", id);
    setMyList((ls) => ls.map((l) => l.id === id ? { ...l, status: ns } : l));
    showDT(ns === "active" ? "\u2705 Annonce r\xE9activ\xE9e" : "\u{1F4E6} Annonce archiv\xE9e");
  }
  async function del(id) {
    if (!confirm("Supprimer d\xE9finitivement cette annonce ?")) return;
    await sb.from("listings").delete().eq("id", id);
    setMyList((ls) => ls.filter((l) => l.id !== id));
    showDT("\u{1F5D1} Annonce supprim\xE9e");
  }
  async function boost(id) {
    await sb.rpc("boost_listing", { p_listing_id: id, p_days: 7 });
    setMyList((ls) => ls.map((l) => l.id === id ? { ...l, is_premium: true } : l));
    showDT("\u2B50 Annonce boost\xE9e 7 jours !");
  }
  async function toggleAlert(id, cur) {
    await sb.from("alerts").update({ is_active: !cur }).eq("id", id);
    setAlerts((al) => al.map((a) => a.id === id ? { ...a, is_active: !cur } : a));
  }
  async function deleteAlert(id) {
    await sb.from("alerts").delete().eq("id", id);
    setAlerts((al) => al.filter((a) => a.id !== id));
    showDT("Alerte supprim\xE9e");
  }
  // ── RBAC Routing ──────────────────────────────────────────────────
  // Priorité : role pro > user_type diaspora > particulier
  // Jamais afficher ParticulierDash si le profil n'est pas encore chargé
  const role = profile ? (profile.role || "particulier") : null;
  const isDiaspora = profile && profile.user_type === "diaspora";
  const roleLabel = !profile ? "⏳ Chargement..." 
    : role === "admin" ? "🔐 Admin"
    : role === "agence" ? "🏢 Agence"
    : role === "agent" ? "🏡 Agent"
    : role === "promoteur" ? "🏗️ Promoteur"
    : isDiaspora ? "🌍 Diaspora"
    : "👤 Particulier";

  function renderDashboard() {
    // Spinner pendant chargement profil (évite flash ParticulierDash)
    if (!profile) return /* @__PURE__ */ React.createElement("div", { className: "ldr" }, 
      /* @__PURE__ */ React.createElement("div", { className: "spin" }),
      profileRetries > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, fontSize: 12, color: "var(--mu)" } }, "Chargement du profil… (" + profileRetries + "/3)")
    );
    if (role === "admin") return /* @__PURE__ */ React.createElement(AdminDash, { user, profile, showDT });
    if (role === "agence") return /* @__PURE__ */ React.createElement(AgenceDash, { ...sharedProps });
    if (role === "promoteur") return /* @__PURE__ */ React.createElement(PromoteurDash, { ...sharedProps });
    if (role === "agent") return /* @__PURE__ */ React.createElement(AgentDash, { ...sharedProps });
    if (isDiaspora) return /* @__PURE__ */ React.createElement(DiasporaDash, { user, profile, favIds, favListings, convs, loading, onOpenListing, showDT, setShowProfileEdit, onFav });
    return /* @__PURE__ */ React.createElement(ParticulierDash, { ...sharedProps });
  }

  const sharedProps = { user, profile, myList, convs, favIds, favListings, alerts, loading, onOpenListing, onShowAgency, showDT, setEditListing, setShowProfileEdit, toggleStatus, del, boost, toggleAlert, deleteAlert, setProfile, onFav };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, editListing && /* @__PURE__ */ React.createElement(ListingEditModal, { user, listing: editListing, onClose: () => setEditListing(null), onSaved: (updated) => {
    setMyList((ls) => ls.map((l) => l.id === updated.id ? updated : l));
    showDT("\u2705 Annonce mise \xE0 jour !");
  } }), showProfileEdit && profile && /* @__PURE__ */ React.createElement(ProfileEditModal, { user, profile, onClose: () => setShowProfileEdit(false), onSaved: (p) => {
    setProfile((prev) => ({ ...prev, ...p }));
    showDT("\u2705 Profil mis \xE0 jour !");
  } }), dToast && /* @__PURE__ */ React.createElement("div", { className: "toast t" + dToast.type, style: { zIndex: 1100 } }, dToast.msg), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--nv)", padding: "6px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#fff", fontSize: 11, fontWeight: 700 } }, roleLabel), profile && profile.is_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 100 } }, "\u2705 V\xE9rifi\xE9")), /* @__PURE__ */ React.createElement("button", { className: "dnb", onClick: onLogout, style: { color: "#ef4444", fontSize: 11, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 7, padding: "4px 10px" } }, "\u{1F6AA} D\xE9connexion")), renderDashboard());
}
const INVEST_STATUS_LABELS = { en_recherche: "\u{1F50D} En recherche", en_negociation: "\u{1F91D} En n\xE9gociation", offre_faite: "\u{1F4DD} Offre faite", finalise: "\u2705 Finalis\xE9", abandonne: "\u274C Abandonn\xE9" };
const INVEST_STATUS_COLORS = { en_recherche: "#2563eb", en_negociation: "#d97706", offre_faite: "#7c3aed", finalise: "#16a34a", abandonne: "#ef4444" };
function DiasporaDash({ user, profile, favIds, favListings, convs, loading, onOpenListing, showDT, setShowProfileEdit, onFav }) {
  const [tab, setTab] = useState("overview");
  const [visitReqs, setVisitReqs] = useState([]);
  const [investProjs, setInvestProjs] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loadExtra, setLoadExtra] = useState(true);
  const [showNewProj, setShowNewProj] = useState(false);
  const [projForm, setProjForm] = useState({ title: "", budget: "", property_type: "appartement", zone: "", status: "en_recherche", notes: "" });
  const [savingProj, setSavingProj] = useState(false);
  const homeCurrency = useMemo(() => {
    const c = profile?.country_residence || "";
    if (["Canada", "Qu\xE9bec"].some((x) => c.includes(x))) return "CAD";
    if (["\xC9tats-Unis", "USA"].some((x) => c.includes(x))) return "USD";
    if (["Maroc"].some((x) => c.includes(x))) return "MAD";
    if (["Royaume-Uni"].some((x) => c.includes(x))) return "GBP";
    return "EUR";
  }, [profile]);
  function convertAmt(xof) {
    const rate = RATES[homeCurrency] || 1;
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: homeCurrency, maximumFractionDigits: 0 }).format(xof * rate);
  }
  useEffect(() => {
    loadExtra2();
  }, []);
  async function loadExtra2() {
    setLoadExtra(true);
    const [{ data: vr }, { data: ip }, { data: al }] = await Promise.all([
      sb.from("visit_requests").select("*,listings(title,cover_image,price,property_type,quartier)").eq("requester_id", user.id).order("created_at", { ascending: false }),
      sb.from("investment_projects").select("*,listings(title,cover_image,price,property_type,quartier)").eq("user_id", user.id).order("created_at", { ascending: false }),
      sb.from("alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false })
    ]);
    if (vr) setVisitReqs(vr);
    if (ip) setInvestProjs(ip);
    if (al) setAlerts(al);
    setLoadExtra(false);
  }
  async function saveProj(e) {
    e.preventDefault();
    if (!projForm.title.trim()) {
      showDT("Titre requis", "err");
      return;
    }
    setSavingProj(true);
    const { error } = await sb.from("investment_projects").insert([{
      user_id: user.id,
      title: projForm.title,
      budget: projForm.budget ? parseInt(projForm.budget) : null,
      property_type: projForm.property_type,
      zone: projForm.zone || null,
      status: projForm.status,
      notes: projForm.notes || null
    }]);
    setSavingProj(false);
    if (error) {
      showDT("Erreur: " + error.message, "err");
      return;
    }
    showDT("\u2705 Projet cr\xE9\xE9 !");
    setShowNewProj(false);
    setProjForm({ title: "", budget: "", property_type: "appartement", zone: "", status: "en_recherche", notes: "" });
    loadExtra2();
  }
  async function updateProjStatus(id, status) {
    await sb.from("investment_projects").update({ status }).eq("id", id);
    setInvestProjs((pp) => pp.map((p) => p.id === id ? { ...p, status } : p));
    showDT("\u2705 Statut mis \xE0 jour");
  }
  async function deleteProj(id) {
    if (!confirm("Supprimer ce projet ?")) return;
    await sb.from("investment_projects").delete().eq("id", id);
    setInvestProjs((pp) => pp.filter((p) => p.id !== id));
    showDT("Projet supprim\xE9");
  }
  const pendingVisits = visitReqs.filter((v) => v.status === "pending").length;
  const activeProjs = investProjs.filter((p) => p.status !== "finalise" && p.status !== "abandonne").length;
  const navs = [
    { k: "overview", i: "\u{1F4CA}", l: "Tableau de bord" },
    { k: "search", i: "\u{1F50D}", l: "Biens Diaspora" },
    { k: "favorites", i: "\u2764\uFE0F", l: `Favoris (${favIds.length})` },
    { k: "visits", i: "\u{1F4E1}", l: `Visites vid\xE9o${pendingVisits > 0 ? ` (${pendingVisits})` : ""}` },
    { k: "projects", i: "\u{1F4BC}", l: `Mes projets (${investProjs.length})` },
    { k: "messages", i: "\u{1F4AC}", l: `Messages (${convs.length})` },
    { k: "alerts", i: "\u{1F514}", l: `Alertes (${alerts.filter((a) => a.is_active).length})` },
    { k: "profile", i: "\u{1F30D}", l: "Mon profil Diaspora" }
  ];
  return /* @__PURE__ */ React.createElement(DashLayout, { navs, tab, setTab, profile, user, roleLabel: "\u{1F30D} Diaspora / Investisseur" }, loading || loadExtra ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, tab === "overview" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#0a5c36 0%,#1e3a5f 100%)", borderRadius: "var(--r)", padding: "20px 24px", marginBottom: 20, position: "relative", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", right: 0, top: 0, bottom: 0, width: "35%", backgroundImage: "url(https://images.unsplash.com/photo-1599009944997-cd0a89f2de77?w=400)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.15 } }), /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 48, height: 48, borderRadius: 50, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 } }, "\u{1F30D}"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { color: "#fff", fontFamily: "var(--fd)", fontWeight: 800, fontSize: 18 } }, "Bonjour, ", profile?.full_name?.split(" ")[0] || "Investisseur", " \u{1F44B}"), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 11, marginTop: 2 } }, profile?.country_residence && /* @__PURE__ */ React.createElement(React.Fragment, null, "\u{1F4CD} ", profile.country_residence, profile?.city_residence ? `, ${profile.city_residence}` : ""), profile?.zone_interest && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 Zone cible : ", /* @__PURE__ */ React.createElement("strong", { style: { color: "#fff" } }, profile.zone_interest))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, profile?.investment_budget && /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", gap: 6, background: "rgba(255,255,255,.12)", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#fff", alignItems: "center" } }, "\u{1F4B0} Budget : ", /* @__PURE__ */ React.createElement("strong", null, parseInt(profile.investment_budget).toLocaleString("fr"), " FCFA"), /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.7 } }, "\u2248 ", convertAmt(parseInt(profile.investment_budget)))), profile?.property_type_interest?.map((t) => /* @__PURE__ */ React.createElement("span", { key: t, style: { background: "rgba(255,255,255,.15)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 100 } }, PICO[t] || "\u{1F3E0}", " ", t))))), /* @__PURE__ */ React.createElement("div", { className: "kpig", style: { gridTemplateColumns: "repeat(4,1fr)", marginBottom: 18 } }, [["\u2764\uFE0F", favIds.length, "Favoris"], ["\u{1F4E1}", visitReqs.length, "Visites demand\xE9es"], ["\u{1F4BC}", activeProjs, "Projets actifs"], ["\u{1F4AC}", convs.length, "Messages"]].map(([ico, val, lbl]) => /* @__PURE__ */ React.createElement("div", { className: "kpi", key: lbl }, /* @__PURE__ */ React.createElement("div", { className: "kpiic" }, ico), /* @__PURE__ */ React.createElement("div", { className: "kpiv" }, val), /* @__PURE__ */ React.createElement("div", { className: "kpil" }, lbl)))), pendingVisits > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: "var(--r)", padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22 } }, "\u{1F4E1}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, pendingVisits, " demande", pendingVisits > 1 ? "s" : "", " de visite en attente"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)" } }, "En cours de traitement par les agences.")), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { fontSize: 11, padding: "6px 12px" }, onClick: () => setTab("visits") }, "Voir \u2192")), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, marginBottom: 16, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, marginBottom: 14, color: "var(--tx)" } }, "\u{1F5FA}\uFE0F Votre parcours investisseur"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 } }, [
    { n: 1, ico: "\u{1F50D}", t: "Recherche", d: "Parcourez les annonces diaspora", done: favIds.length > 0 },
    { n: 2, ico: "\u{1F4E1}", t: "Visite vid\xE9o", d: "Visite \xE0 distance WhatsApp/Zoom", done: visitReqs.length > 0 },
    { n: 3, ico: "\u{1F4AC}", t: "Contact", d: "\xC9changez avec l'agence", done: convs.length > 0 },
    { n: 4, ico: "\u{1F4BC}", t: "Projet", d: "Suivez votre dossier", done: investProjs.length > 0 },
    { n: 5, ico: "\u2705", t: "Achat", d: "Documents & notaire", done: investProjs.some((p) => p.status === "finalise") }
  ].map((s) => /* @__PURE__ */ React.createElement("div", { key: s.n, style: { background: s.done ? "var(--gl)" : "var(--bg)", border: `1.5px solid ${s.done ? "var(--g)" : "var(--br)"}`, borderRadius: 10, padding: "10px 8px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 30, height: 30, borderRadius: 50, background: s.done ? "var(--g)" : "var(--br)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, margin: "0 auto 6px" } }, s.done ? "\u2713" : s.ico), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 10, color: s.done ? "var(--g)" : "var(--tx)" } }, s.t), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8, color: "var(--mu)", marginTop: 2, lineHeight: 1.4 } }, s.d))))), favListings.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 15px", borderBottom: "1px solid var(--br)", fontFamily: "var(--fd)", fontWeight: 700, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" } }, "\u2764\uFE0F Biens sauvegard\xE9s", /* @__PURE__ */ React.createElement("button", { className: "ab abv", onClick: () => setTab("favorites") }, "Voir tous \u2192")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10, padding: 12 } }, favListings.slice(0, 4).map((l) => /* @__PURE__ */ React.createElement("div", { key: l.id, style: { border: "1px solid var(--br)", borderRadius: 10, overflow: "hidden", cursor: "pointer" }, onClick: () => onOpenListing(l) }, /* @__PURE__ */ React.createElement("img", { src: l.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300", alt: "", style: { width: "100%", height: 90, objectFit: "cover", display: "block" } }), /* @__PURE__ */ React.createElement("div", { style: { padding: "7px 9px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 10, marginBottom: 2 } }, (l.title || "").slice(0, 24), "\u2026"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 11, color: "var(--g)" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#2563eb", fontWeight: 600 } }, "\u2248 ", convertAmt(l.price)), l.is_investment_deal && l.expected_yield && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { background: "#dcfce7", color: "#16a34a", fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 100 } }, "\u{1F4B0} ", l.expected_yield, "% / an"))))))), investProjs.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 15px", borderBottom: "1px solid var(--br)", fontFamily: "var(--fd)", fontWeight: 700, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" } }, "\u{1F4BC} Mes projets", /* @__PURE__ */ React.createElement("button", { className: "ab abv", onClick: () => setTab("projects") }, "G\xE9rer \u2192")), investProjs.slice(0, 3).map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, style: { padding: "10px 15px", borderBottom: "1px solid var(--bg)", display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, p.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2 } }, PICO[p.property_type] || "\u{1F3E0}", " ", p.property_type, p.zone && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 \u{1F4CD} ", p.zone), p.budget && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", parseInt(p.budget).toLocaleString("fr"), " FCFA"))), /* @__PURE__ */ React.createElement("span", { style: { background: INVEST_STATUS_COLORS[p.status] + "22", color: INVEST_STATUS_COLORS[p.status], fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 100, flexShrink: 0 } }, INVEST_STATUS_LABELS[p.status]))))), tab === "search" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F50D} Biens recommand\xE9s Diaspora"), /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#ecfdf5,#eff6ff)", border: "1.5px solid #a7f3d0", borderRadius: "var(--r)", padding: "12px 16px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, "\u{1F4A1}"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#065f46", lineHeight: 1.6 } }, "Les biens avec ", /* @__PURE__ */ React.createElement("strong", null, "\u{1F4B0} Bon investissement"), " ont un rendement estim\xE9. ", /* @__PURE__ */ React.createElement("strong", null, "\u{1F3C5} V\xE9rifi\xE9 terrain"), " = contr\xF4le physique par nos agents. Cliquez ", /* @__PURE__ */ React.createElement("strong", null, "\u{1F4E1} Visite \xE0 distance"), " sur n'importe quelle fiche annonce pour demander une visite vid\xE9o gratuite.")), /* @__PURE__ */ React.createElement(DiasporaListingsPanel, { onOpenListing, favIds, onFav, convertAmt, homeCurrency })), tab === "favorites" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u2764\uFE0F Biens sauvegard\xE9s (", favListings.length, ")"), favListings.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 36, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 8 } }, "\u2764\uFE0F"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 5 } }, "Aucun bien sauvegard\xE9"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 14 } }, "Cliquez \u2764\uFE0F sur une annonce pour sauvegarder."), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: () => setTab("search") }, "\u{1F50D} Parcourir les biens")) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 } }, favListings.map((l) => /* @__PURE__ */ React.createElement("div", { key: l.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)", cursor: "pointer" }, onClick: () => onOpenListing(l) }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("img", { src: l.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400", alt: "", style: { width: "100%", height: 140, objectFit: "cover", display: "block" } }), l.is_investment_deal && l.expected_yield && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 8, left: 8, background: "#0a5c36", color: "#fff", fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 100 } }, "\u{1F4B0} ", l.expected_yield, "% / an"), /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
    e.stopPropagation();
    onFav(l.id, false);
  }, style: { position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.5)", border: "none", borderRadius: 50, width: 28, height: 28, cursor: "pointer", color: "#ef4444", fontSize: 14 } }, "\u2665")), /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12, marginBottom: 3 } }, l.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginBottom: 6 } }, "\u{1F4CD} ", l.quartier, " \xB7 ", PICO[l.property_type] || "", " ", l.property_type), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, color: "var(--g)" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#2563eb", fontWeight: 600 } }, "\u2248 ", convertAmt(l.price))))))), tab === "visits" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F4E1} Mes visites \xE0 distance"), /* @__PURE__ */ React.createElement("div", { style: { background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: "var(--r)", padding: "11px 14px", marginBottom: 16, fontSize: 11, color: "#1e3a5f", display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, "\u{1F4E1}"), /* @__PURE__ */ React.createElement("span", null, "Demandez une visite ", /* @__PURE__ */ React.createElement("strong", null, "WhatsApp ou Zoom"), ` sur n'importe quelle annonce via le bouton "\u{1F4E1} Visite \xE0 distance" sur la fiche du bien.`)), visitReqs.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 36, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 8 } }, "\u{1F4E1}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 5 } }, "Aucune visite demand\xE9e"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 14 } }, 'Ouvrez une annonce et cliquez "\u{1F4E1} Visite \xE0 distance".'), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: () => setTab("search") }, "\u{1F50D} Trouver un bien")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, visitReqs.map((v) => {
    const sc = { pending: { bg: "#fffbeb", bd: "#fbbf24", c: "#92400e", l: "\u23F3 En attente" }, confirmed: { bg: "#ecfdf5", bd: "#6ee7b7", c: "#065f46", l: "\u2705 Confirm\xE9e" }, declined: { bg: "#fef2f2", bd: "#fca5a5", c: "#991b1b", l: "\u274C Refus\xE9e" }, done: { bg: "#f5f3ff", bd: "#c4b5fd", c: "#4c1d95", l: "\u2714 Effectu\xE9e" } };
    const s = sc[v.status] || sc.pending;
    return /* @__PURE__ */ React.createElement("div", { key: v.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, padding: "12px 14px", alignItems: "flex-start" } }, v.listings?.cover_image && /* @__PURE__ */ React.createElement("img", { src: v.listings.cover_image, alt: "", style: { width: 68, height: 52, borderRadius: 7, objectFit: "cover", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, v.listings?.title || "Bien supprim\xE9"), /* @__PURE__ */ React.createElement("span", { style: { background: s.bg, border: `1px solid ${s.bd}`, color: s.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, s.l)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", display: "flex", gap: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F4C5} ", v.preferred_date || "\u2014"), /* @__PURE__ */ React.createElement("span", null, "\u{1F550} ", v.preferred_time || "\u2014"), /* @__PURE__ */ React.createElement("span", null, v.visit_type === "video" ? "\u{1F4F9} Vid\xE9o" : v.visit_type === "photos" ? "\u{1F4F8} Photos" : "\u{1F91D} Pr\xE9sentiel")), v.message && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 10, color: "var(--mu)", fontStyle: "italic", padding: "5px 8px", background: "var(--bg)", borderRadius: 5 } }, '"', v.message, '"'))), v.status === "confirmed" && /* @__PURE__ */ React.createElement("div", { style: { background: "#ecfdf5", borderTop: "1px solid #6ee7b7", padding: "7px 14px", fontSize: 11, color: "#065f46" } }, "\u2705 ", /* @__PURE__ */ React.createElement("strong", null, "Confirm\xE9e !"), " L'agent vous contactera par WhatsApp/email pour la session vid\xE9o."));
  }))), tab === "projects" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "dtit2", style: { marginBottom: 0 } }, "\u{1F4BC} Mes projets d'investissement"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { fontSize: 12 }, onClick: () => setShowNewProj((p) => !p) }, showNewProj ? "\u2715 Annuler" : "+ Nouveau projet")), showNewProj && /* @__PURE__ */ React.createElement("form", { onSubmit: saveProj, style: { background: "#fff", border: "1.5px solid var(--g)", borderRadius: "var(--r)", padding: 18, marginBottom: 16, boxShadow: "0 0 0 4px var(--gl)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, marginBottom: 12, color: "var(--g)" } }, "\u{1F4DD} Nouveau projet"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "span 2" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Titre ", /* @__PURE__ */ React.createElement("span", null, "*")), /* @__PURE__ */ React.createElement("input", { className: "fi", placeholder: "Ex: Appartement locatif Almadies", value: projForm.title, onChange: (e) => setProjForm((f) => ({ ...f, title: e.target.value })), required: true })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Budget (FCFA)"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", placeholder: "45000000", value: projForm.budget, onChange: (e) => setProjForm((f) => ({ ...f, budget: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Type de bien"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: projForm.property_type, onChange: (e) => setProjForm((f) => ({ ...f, property_type: e.target.value })) }, Object.keys(PICO).map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, PICO[k], " ", k)))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Zone"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: projForm.zone, onChange: (e) => setProjForm((f) => ({ ...f, zone: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Non pr\xE9cis\xE9"), REGIONS.map((r) => /* @__PURE__ */ React.createElement("option", { key: r }, r)), /* @__PURE__ */ React.createElement("option", { value: "Almadies / Ngor" }, "Almadies / Ngor"), /* @__PURE__ */ React.createElement("option", { value: "Saly / Mbour" }, "Saly / Mbour"))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Statut"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: projForm.status, onChange: (e) => setProjForm((f) => ({ ...f, status: e.target.value })) }, Object.entries(INVEST_STATUS_LABELS).map(([k, v]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, v)))), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "span 2" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Notes"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", rows: 2, value: projForm.notes, onChange: (e) => setProjForm((f) => ({ ...f, notes: e.target.value })), placeholder: "Crit\xE8res, remarques...", style: { resize: "vertical" } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { type: "submit", className: "fbt2 fbg", disabled: savingProj }, savingProj ? "..." : "\u{1F4BC} Cr\xE9er"))), investProjs.length === 0 && !showNewProj ? /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 36, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 40, marginBottom: 8 } }, "\u{1F4BC}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 5 } }, "Aucun projet"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 14 } }, "Cr\xE9ez un projet pour suivre votre recherche jusqu'\xE0 l'achat."), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: () => setShowNewProj(true) }, "+ Cr\xE9er mon premier projet")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, investProjs.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: "14px 16px", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 13 } }, p.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 3 } }, PICO[p.property_type] || "\u{1F3E0}", " ", p.property_type, p.zone && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 \u{1F4CD} ", p.zone), p.budget && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 \u{1F4B0} ", parseInt(p.budget).toLocaleString("fr"), " FCFA ", /* @__PURE__ */ React.createElement("span", { style: { color: "#2563eb" } }, "\u2248 ", convertAmt(p.budget))))), /* @__PURE__ */ React.createElement("span", { style: { background: INVEST_STATUS_COLORS[p.status] + "22", color: INVEST_STATUS_COLORS[p.status], fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 100 } }, INVEST_STATUS_LABELS[p.status])), p.notes && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", fontStyle: "italic", padding: "6px 10px", background: "var(--bg)", borderRadius: 6, marginBottom: 8 } }, "\u{1F4DD} ", p.notes), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 } }, Object.entries(INVEST_STATUS_LABELS).filter(([k]) => k !== p.status).slice(0, 3).map(([k, v]) => /* @__PURE__ */ React.createElement("button", { key: k, onClick: () => updateProjStatus(p.id, k), style: { fontSize: 9, padding: "3px 8px", borderRadius: 100, border: `1px solid ${INVEST_STATUS_COLORS[k]}`, background: "#fff", color: INVEST_STATUS_COLORS[k], cursor: "pointer", fontWeight: 700 } }, v)), /* @__PURE__ */ React.createElement("button", { onClick: () => deleteProj(p.id), style: { fontSize: 9, padding: "3px 8px", borderRadius: 100, border: "1px solid #fca5a5", background: "#fff", color: "#ef4444", cursor: "pointer", fontWeight: 700, marginLeft: "auto" } }, "\u{1F5D1}")))))), tab === "messages" && /* @__PURE__ */ React.createElement(MessagesTab, { convs, onOpenListing }), tab === "alerts" && /* @__PURE__ */ React.createElement(
    AlertsTab,
    {
      alerts,
      toggleAlert: async (id, cur) => {
        await sb.from("alerts").update({ is_active: !cur }).eq("id", id);
        setAlerts((al) => al.map((a) => a.id === id ? { ...a, is_active: !cur } : a));
      },
      deleteAlert: async (id) => {
        await sb.from("alerts").delete().eq("id", id);
        setAlerts((al) => al.filter((a) => a.id !== id));
        showDT("Alerte supprim\xE9e");
      }
    }
  ), tab === "profile" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "dtit2" }, "\u{1F30D} Mon profil Diaspora"), /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#0a5c36,#1e3a5f)", borderRadius: "var(--r)", padding: "18px 22px", marginBottom: 14, display: "flex", gap: 14, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 52, height: 52, borderRadius: 50, background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "#fff", flexShrink: 0 } }, (profile?.full_name || user.email || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 16, color: "#fff" } }, profile?.full_name || "\u2014"), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 11, marginTop: 1 } }, user.email), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(255,255,255,.2)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, "\u{1F30D} Diaspora"), profile?.country_residence && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(255,255,255,.2)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, "\u{1F4CD} ", profile.country_residence), profile?.nationality && /* @__PURE__ */ React.createElement("span", { style: { background: "rgba(255,255,255,.2)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100 } }, "\u{1FAAA} ", profile.nationality)))), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, marginBottom: 12, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 12, marginBottom: 10 } }, "\u{1F4CD} Localisation"), [["Pays de r\xE9sidence", profile?.country_residence || "\u2014"], ["Ville", profile?.city_residence || "\u2014"], ["Nationalit\xE9", profile?.nationality || "\u2014"], ["Email", user.email], ["T\xE9l\xE9phone", profile?.phone || "Non renseign\xE9"], ["WhatsApp", profile?.whatsapp || "Non renseign\xE9"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--bg)", fontSize: 12, gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 600 } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, textAlign: "right" } }, v)))), /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, marginBottom: 12, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 12, marginBottom: 10 } }, "\u{1F3E0} Projet immobilier"), [
    ["Budget max", profile?.investment_budget ? `${parseInt(profile.investment_budget).toLocaleString("fr")} FCFA \u2248 ${convertAmt(parseInt(profile.investment_budget))}` : "\u2014"],
    ["Types souhait\xE9s", profile?.property_type_interest?.map((t) => `${PICO[t] || ""} ${t}`).join(", ") || "\u2014"],
    ["Zone d'int\xE9r\xEAt", profile?.zone_interest || "\u2014"]
  ].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--bg)", fontSize: 12, gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 600 } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, textAlign: "right" } }, v)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: () => setShowProfileEdit(true) }, "\u270F\uFE0F Modifier le profil"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", onClick: () => sb.auth.resetPasswordForEmail(user.email).then(() => showDT("\u{1F4E7} Email envoy\xE9 !")) }, "\u{1F511} Changer MDP")))));
}
function DiasporaListingsPanel({ onOpenListing, favIds, onFav, convertAmt, homeCurrency }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    sb.from("listings").select("*").eq("status", "active").or("is_investment_deal.eq.true,diaspora_highlight.eq.true,is_physically_verified.eq.true").order("is_investment_deal", { ascending: false }).order("created_at", { ascending: false }).limit(24).then(({ data }) => {
      setItems(data || []);
      setLoading(false);
    });
  }, []);
  const filtered = filter === "invest" ? items.filter((l) => l.is_investment_deal) : filter === "verified" ? items.filter((l) => l.is_physically_verified) : items;
  if (loading) return /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" }));
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" } }, [["all", "\u{1F30D} Tous"], ["invest", "\u{1F4B0} Investissement"], ["verified", "\u{1F3C5} V\xE9rifi\xE9s terrain"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, onClick: () => setFilter(k), style: { padding: "6px 14px", borderRadius: 100, border: `1.5px solid ${filter === k ? "var(--g)" : "var(--br)"}`, background: filter === k ? "var(--g)" : "#fff", color: filter === k ? "#fff" : "var(--tx)", fontWeight: 700, fontSize: 11, cursor: "pointer" } }, l))), filtered.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: 32, color: "var(--mu)", fontSize: 12 } }, "Aucun bien dans cette cat\xE9gorie.") : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 } }, filtered.map((l) => {
    const isFav = favIds.includes(l.id);
    return /* @__PURE__ */ React.createElement("div", { key: l.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)", cursor: "pointer" }, onClick: () => onOpenListing(l) }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("img", { src: l.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400", alt: "", style: { width: "100%", height: 130, objectFit: "cover", display: "block" } }), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 6, left: 6, display: "flex", gap: 4, flexWrap: "wrap" } }, l.is_investment_deal && l.expected_yield && /* @__PURE__ */ React.createElement("span", { style: { background: "#0a5c36", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 100 } }, "\u{1F4B0} ", l.expected_yield, "%/an"), l.is_physically_verified && /* @__PURE__ */ React.createElement("span", { style: { background: "#1e3a5f", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 100 } }, "\u{1F3C5} V\xE9rifi\xE9")), /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
      e.stopPropagation();
      onFav(l.id, !isFav);
    }, style: { position: "absolute", top: 6, right: 6, background: "rgba(255,255,255,.85)", border: "none", borderRadius: 50, width: 28, height: 28, cursor: "pointer", fontSize: 14, color: isFav ? "#ef4444" : "#aaa" } }, isFav ? "\u2665" : "\u2661")), /* @__PURE__ */ React.createElement("div", { style: { padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 11, marginBottom: 3 } }, (l.title || "").slice(0, 30), l.title?.length > 30 ? "\u2026" : ""), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)", marginBottom: 5 } }, "\u{1F4CD} ", l.quartier, ", ", l.city), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, color: "var(--g)" } }, fmt(l.price)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#2563eb", fontWeight: 600 } }, "\u2248 ", convertAmt(l.price), " ", homeCurrency)));
  })));
}
function ImageGallery({ listing }) {
  const [imgs, setImgs] = useState([]);
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  useEffect(() => {
    const base = listing.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=900";
    sb.from("listing_images").select("url,position").eq("listing_id", listing.id).order("position").then(({ data }) => {
      if (data && data.length > 0) {
        const all = [base, ...data.map((d) => d.url).filter((u) => u !== base)];
        setImgs(all);
      } else {
        setImgs([base]);
      }
    });
  }, [listing.id]);
  const cur = imgs[idx] || listing.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=900";
  const prev = () => setIdx((i) => (i - 1 + imgs.length) % imgs.length);
  const next = () => setIdx((i) => (i + 1) % imgs.length);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, lightbox && /* @__PURE__ */ React.createElement("div", { onClick: () => setLightbox(false), style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.95)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" } }, /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
    e.stopPropagation();
    prev();
  }, style: { position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.15)", border: "none", borderRadius: 50, width: 44, height: 44, cursor: "pointer", color: "#fff", fontSize: 20 } }, "\u2039"), /* @__PURE__ */ React.createElement("img", { src: cur, alt: "", style: { maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 10 }, onClick: (e) => e.stopPropagation() }), /* @__PURE__ */ React.createElement("button", { onClick: (e) => {
    e.stopPropagation();
    next();
  }, style: { position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,.15)", border: "none", borderRadius: 50, width: 44, height: 44, cursor: "pointer", color: "#fff", fontSize: 20 } }, "\u203A"), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", color: "rgba(255,255,255,.6)", fontSize: 11 } }, idx + 1, " / ", imgs.length), /* @__PURE__ */ React.createElement("button", { onClick: () => setLightbox(false), style: { position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.15)", border: "none", borderRadius: 50, width: 34, height: 34, cursor: "pointer", color: "#fff", fontSize: 18 } }, "\u2715")), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", borderRadius: "var(--r)", overflow: "hidden", marginBottom: 12, background: "#000" } }, /* @__PURE__ */ React.createElement(
    "img",
    {
      className: "gmain",
      src: cur,
      alt: listing.title,
      style: { width: "100%", objectFit: "cover", cursor: "zoom-in", display: "block" },
      onError: (e) => e.target.src = "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=900",
      onClick: () => setLightbox(true)
    }
  ), imgs.length > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { onClick: prev, style: { position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.45)", border: "none", borderRadius: 50, width: 36, height: 36, cursor: "pointer", color: "#fff", fontSize: 18 } }, "\u2039"), /* @__PURE__ */ React.createElement("button", { onClick: next, style: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.45)", border: "none", borderRadius: 50, width: 36, height: 36, cursor: "pointer", color: "#fff", fontSize: 18 } }, "\u203A"), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 } }, imgs.map((_, i) => /* @__PURE__ */ React.createElement("div", { key: i, onClick: () => setIdx(i), style: { width: i === idx ? 20 : 7, height: 7, borderRadius: 100, background: i === idx ? "#fff" : "rgba(255,255,255,.5)", cursor: "pointer", transition: "width .2s" } }))), /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.5)", borderRadius: 100, padding: "2px 8px", fontSize: 10, color: "#fff", fontWeight: 700 } }, idx + 1, "/", imgs.length, " \u{1F4F7}")), /* @__PURE__ */ React.createElement("button", { onClick: () => setLightbox(true), style: { position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,.45)", border: "none", borderRadius: 7, padding: "3px 8px", cursor: "pointer", color: "#fff", fontSize: 10, fontWeight: 700 } }, "\u{1F50D} Agrandir")), imgs.length > 1 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 } }, imgs.map((u, i) => /* @__PURE__ */ React.createElement(
    "img",
    {
      key: i,
      src: u,
      alt: "",
      onClick: () => setIdx(i),
      style: { width: 72, height: 52, objectFit: "cover", borderRadius: 7, flexShrink: 0, cursor: "pointer", border: i === idx ? "2.5px solid var(--g)" : "2px solid transparent", opacity: i === idx ? 1 : 0.7, transition: "all .15s" }
    }
  ))));
}
function SearchAutocomplete({ value, onChange, onSubmit, listings }) {
  const [show, setShow] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const ref = useRef(null);
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setShow(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setShow(false);
      return;
    }
    const q = value.toLowerCase();
    const seen = /* @__PURE__ */ new Set();
    const results = [];
    for (const l of listings) {
      const candidates = [l.quartier || "", l.city || "", l.commune || ""];
      for (const c of candidates) {
        if (c && c.toLowerCase().includes(q) && !seen.has(c.toLowerCase())) {
          seen.add(c.toLowerCase());
          results.push({ type: c === l.quartier ? "\u{1F4CD}" : "\u{1F3D9}\uFE0F", label: c, sub: c === l.quartier ? l.city : "Ville" });
        }
      }
      if (results.length >= 6) break;
    }
    setSuggestions(results.slice(0, 6));
    setShow(results.length > 0);
  }, [value, listings]);
  return /* @__PURE__ */ React.createElement("div", { ref, style: { flex: 1, position: "relative" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "si",
      style: { width: "100%", boxSizing: "border-box" },
      placeholder: "Quartier, ville (ex: Almadies...)",
      value,
      onChange: (e) => {
        onChange(e.target.value);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter") {
          setShow(false);
          onSubmit();
        }
        if (e.key === "Escape") setShow(false);
      },
      onFocus: () => {
        if (suggestions.length > 0) setShow(true);
      },
      autoComplete: "off"
    }
  ), show && suggestions.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid var(--br)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 200, overflow: "hidden" } }, suggestions.map((s, i) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: i,
      onClick: () => {
        onChange(s.label);
        setShow(false);
        onSubmit();
      },
      style: { width: "100%", padding: "10px 14px", background: "none", border: "none", borderBottom: i < suggestions.length - 1 ? "1px solid var(--bg)" : "none", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", textAlign: "left", fontSize: 13 }
    },
    /* @__PURE__ */ React.createElement("span", null, s.type),
    /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, color: "var(--tx)" } }, s.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)" } }, s.sub, " \xB7 ", listings.filter((l) => (l.quartier || l.city || l.commune || "").toLowerCase() === s.label.toLowerCase() && l.status === "active").length, " annonce(s)"))
  )), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    setShow(false);
    onSubmit();
  }, style: { width: "100%", padding: "9px 14px", background: "var(--gl)", border: "none", cursor: "pointer", fontSize: 12, color: "var(--g)", fontWeight: 700, textAlign: "left" } }, '\u{1F50D} Voir tous les r\xE9sultats pour "', value, '"')));
}
function PriceSparkline({ listingId, currentPrice }) {
  const [history2, setHistory] = useState([]);
  useEffect(() => {
    sb.from("price_history").select("*").eq("listing_id", listingId).order("changed_at").limit(8).then(({ data }) => {
      if (data && data.length > 0) {
        const pts2 = [...data.map((h) => ({ price: Number(h.new_price), date: h.changed_at })), { price: currentPrice, date: (/* @__PURE__ */ new Date()).toISOString() }];
        setHistory(pts2);
      }
    });
  }, [listingId]);
  if (history2.length < 2) return null;
  const prices = history2.map((h) => h.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const W = 260, H = 60, pad = 8;
  const pw = W - pad * 2, ph = H - pad * 2;
  const pts = history2.map((h, i) => {
    const x = pad + i / (history2.length - 1) * pw;
    const y = pad + ph - (h.price - min) / range * ph;
    return `${x},${y}`;
  }).join(" ");
  const first = prices[0], last = prices[prices.length - 1];
  const delta = ((last - first) / first * 100).toFixed(1);
  const up = last >= first;
  return /* @__PURE__ */ React.createElement("div", { className: "sparkline-wrap" }, /* @__PURE__ */ React.createElement("div", { className: "sparkline-title" }, "\u{1F4C9} Historique des prix", /* @__PURE__ */ React.createElement("span", { className: "sparkline-delta", style: { background: up ? "#dcfce7" : "#fee2e2", color: up ? "#16a34a" : "#dc2626" } }, up ? "+" : "", delta, "%")), /* @__PURE__ */ React.createElement("svg", { width: "100%", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: { height: 60 } }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("linearGradient", { id: "sg", x1: "0", y1: "0", x2: "0", y2: "1" }, /* @__PURE__ */ React.createElement("stop", { offset: "0%", stopColor: up ? "#0a5c36" : "#dc2626", stopOpacity: ".15" }), /* @__PURE__ */ React.createElement("stop", { offset: "100%", stopColor: up ? "#0a5c36" : "#dc2626", stopOpacity: "0" }))), /* @__PURE__ */ React.createElement("polygon", { points: `${pad},${H} ${pts} ${W - pad},${H}`, fill: "url(#sg)" }), /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: up ? "#0a5c36" : "#dc2626", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }), history2.map((h, i) => {
    const x = pad + i / (history2.length - 1) * pw;
    const y = pad + ph - (h.price - min) / range * ph;
    return /* @__PURE__ */ React.createElement("circle", { key: i, cx: x, cy: y, r: i === history2.length - 1 ? 4 : 2.5, fill: up ? "#0a5c36" : "#dc2626" });
  })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--mu)", marginTop: 4 } }, /* @__PURE__ */ React.createElement("span", null, new Date(history2[0].date).toLocaleDateString("fr-SN")), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, color: up ? "#16a34a" : "#dc2626" } }, fmt(last)), /* @__PURE__ */ React.createElement("span", null, "Aujourd'hui")));
}
function ShareBtn({ listing, showToast: showToast2 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function click(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);
  const url = `https://senegalsen-immo.vercel.app/annonce/${listing.id}`;
  const title = `${listing.title} \u2014 ${fmt(listing.price)}`;
  const waMsg = encodeURIComponent(`\u{1F3E1} *SeneGalsen Immobilier*
${title}
\u{1F4CD} ${listing.quartier}, ${listing.city}
${url}`);
  async function share(method) {
    setOpen(false);
    sb.rpc("increment_shares", { listing_uuid: listing.id }).catch(() => {
    });
    if (method === "native" && navigator.share) {
      await navigator.share({ title, text: `${listing.title} \u2014 ${listing.quartier}`, url });
      return;
    }
    if (method === "copy") {
      await navigator.clipboard.writeText(url);
      showToast2("\u{1F517} Lien copi\xE9 !");
      return;
    }
    if (method === "wa") {
      window.open(`https://wa.me/?text=${waMsg}`, "_blank");
      return;
    }
    if (method === "fb") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
      return;
    }
  }
  return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" }, ref }, /* @__PURE__ */ React.createElement("button", { className: "btn", style: { background: "var(--bg)", color: "var(--tx)", border: "1.5px solid var(--br)", fontWeight: 600, fontSize: 12 }, onClick: () => setOpen((o) => !o) }, "\u{1F517} Partager"), open && /* @__PURE__ */ React.createElement("div", { className: "share-popup" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 11, color: "var(--mu)", marginBottom: 7, textTransform: "uppercase", letterSpacing: ".4px" } }, "Partager l'annonce"), navigator.share && /* @__PURE__ */ React.createElement("button", { className: "share-btn-item", onClick: () => share("native") }, "\u{1F4E4} Partager via..."), /* @__PURE__ */ React.createElement("button", { className: "share-btn-item", onClick: () => share("copy") }, "\u{1F517} Copier le lien"), /* @__PURE__ */ React.createElement("button", { className: "share-btn-item", onClick: () => share("wa") }, "\u{1F4AC} WhatsApp"), /* @__PURE__ */ React.createElement("button", { className: "share-btn-item", onClick: () => share("fb") }, "\u{1F4D8} Facebook")));
}
function CompareBar({ items, onRemove, onClear, onCompare }) {
  if (items.length === 0) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "cmpbar" }, /* @__PURE__ */ React.createElement("span", { className: "cmpbar-title" }, "\u2696\uFE0F Comparer (", items.length, "/3)"), /* @__PURE__ */ React.createElement("div", { className: "cmp-items" }, items.map((l) => /* @__PURE__ */ React.createElement("div", { key: l.id, className: "cmp-item" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, PICO[l.property_type]), /* @__PURE__ */ React.createElement("span", { className: "cmp-item-name" }, (l.title || "").slice(0, 22)), /* @__PURE__ */ React.createElement("button", { className: "cmp-rm", onClick: () => onRemove(l.id) }, "\u2715"))), items.length < 3 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "rgba(255,255,255,.4)", alignSelf: "center" } }, "+ Ajoutez jusqu'\xE0 3 biens")), /* @__PURE__ */ React.createElement("button", { className: "btn btg", style: { padding: "8px 16px", fontSize: 12, width: "auto" }, onClick: onCompare, disabled: items.length < 2 }, "Comparer \u2192"), /* @__PURE__ */ React.createElement("button", { className: "btn", style: { padding: "7px 12px", fontSize: 11, width: "auto", background: "rgba(255,255,255,.1)", color: "#fff", border: "none" }, onClick: onClear }, "\u2715 Vider"));
}
function CompareModal({ items, onClose }) {
  const rows = [
    ["Prix", (l) => fmt(l.price) + (l.transaction_type === "location" ? "/mois" : "")],
    ["Type", (l) => PICO[l.property_type] + " " + l.property_type],
    ["Transaction", (l) => TXL[l.transaction_type] || l.transaction_type],
    ["Surface", (l) => l.surface ? l.surface + " m\xB2" : "\u2014"],
    ["Pi\xE8ces", (l) => l.rooms || "\u2014"],
    ["Chambres", (l) => l.bedrooms || "\u2014"],
    ["Sdb", (l) => l.bathrooms || "\u2014"],
    ["Quartier", (l) => l.quartier || "\u2014"],
    ["Ville", (l) => l.city || "\u2014"],
    ["Document", (l) => DOC[l.document_type]?.l || "\u2014"],
    ["Trust Score", (l) => /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800, color: l.trust_score >= 80 ? "#16a34a" : l.trust_score >= 60 ? "#d97706" : "#dc2626" } }, l.trust_score || 0, "%")],
    ["Vues", (l) => "\u{1F441} " + (l.views_count || 0)],
    ["Piscine", (l) => /* @__PURE__ */ React.createElement("span", { className: l.features?.piscine ? "cmp-badge-ok" : "cmp-badge-no" }, l.features?.piscine ? "\u2705" : "\u2014")],
    ["Parking", (l) => /* @__PURE__ */ React.createElement("span", { className: l.features?.parking ? "cmp-badge-ok" : "cmp-badge-no" }, l.features?.parking ? "\u2705" : "\u2014")],
    ["Clim", (l) => /* @__PURE__ */ React.createElement("span", { className: l.features?.climatisation ? "cmp-badge-ok" : "cmp-badge-no" }, l.features?.climatisation ? "\u2705" : "\u2014")],
    ["Meubl\xE9", (l) => /* @__PURE__ */ React.createElement("span", { className: l.features?.meuble ? "cmp-badge-ok" : "cmp-badge-no" }, l.features?.meuble ? "\u2705" : "\u2014")],
    ["Vue mer", (l) => /* @__PURE__ */ React.createElement("span", { className: l.features?.vue_mer ? "cmp-badge-ok" : "cmp-badge-no" }, l.features?.vue_mer ? "\u2705" : "\u2014")]
  ];
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "cmp-modal" }, /* @__PURE__ */ React.createElement("div", { className: "mhd", style: { padding: "18px 18px 0" } }, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u2696\uFE0F Comparatif"), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px", overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "cmp-table", style: { minWidth: 480 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { width: 110 } }), items.map((l) => /* @__PURE__ */ React.createElement("th", { key: l.id }, /* @__PURE__ */ React.createElement("img", { className: "cmp-img", src: l.cover_image || "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300", alt: "", onError: (e) => e.target.src = "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=300" }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, lineHeight: 1.3 } }, (l.title || "").slice(0, 30)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, opacity: 0.75, marginTop: 2 } }, "\u{1F4CD} ", l.quartier, ", ", l.city))))), /* @__PURE__ */ React.createElement("tbody", null, rows.map(([label, fn]) => /* @__PURE__ */ React.createElement("tr", { key: label }, /* @__PURE__ */ React.createElement("td", null, label), items.map((l) => /* @__PURE__ */ React.createElement("td", { key: l.id }, typeof fn(l) === "object" ? fn(l) : String(fn(l)))))))))));
}
function AlertModal({ user, currentFilters, onClose, showToast: showToast2 }) {
  const [label, setLabel] = useState("Mon alerte immo");
  const [txType, setTxType] = useState(currentFilters?.txF && currentFilters.txF !== "all" ? currentFilters.txF : "");
  const [propType, setPropType] = useState(currentFilters?.propF && currentFilters.propF !== "all" ? currentFilters.propF : "");
  const [region, setRegion] = useState(currentFilters?.advF?.region || "");
  const [pMax, setPMax] = useState(currentFilters?.advF?.priceMax || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const filters = {};
    if (txType) filters.transaction_type = txType;
    if (propType) filters.property_type = propType;
    if (region) filters.region = region;
    if (pMax) filters.price_max = parseInt(pMax);
    await sb.from("alerts").insert([{ user_id: user.id, label, filters, is_active: true }]);
    setSaving(false);
    showToast2("\u{1F514} Alerte cr\xE9\xE9e ! Vous serez notifi\xE9 des nouvelles annonces.");
    onClose();
  }
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal" }, /* @__PURE__ */ React.createElement("div", { className: "mhd" }, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u{1F514} Cr\xE9er une alerte"), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "mbd" }, /* @__PURE__ */ React.createElement("div", { className: "al awi" }, "\u{1F4A1} Vous recevrez une notification d\xE8s qu'une nouvelle annonce correspond \xE0 vos crit\xE8res."), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Nom de l'alerte"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: label, onChange: (e) => setLabel(e.target.value), placeholder: "Mon alerte villa Almadies" })), /* @__PURE__ */ React.createElement("div", { className: "alert-filters" }, /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Type de transaction"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: txType, onChange: (e) => setTxType(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Tous"), Object.entries(TXL).map(([v, l]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, l)))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Type de bien"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: propType, onChange: (e) => setPropType(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Tous"), Object.entries(PICO).map(([v, i]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, i, " ", v.charAt(0).toUpperCase() + v.slice(1))))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "R\xE9gion"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: region, onChange: (e) => setRegion(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Toutes"), REGIONS.map((r) => /* @__PURE__ */ React.createElement("option", { key: r, value: r }, r)))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Prix max (FCFA)"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", value: pMax, onChange: (e) => setPMax(e.target.value), placeholder: "Illimit\xE9" }))), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: save, disabled: saving || !label }, saving ? "Enregistrement..." : "\u{1F514} Sauvegarder l'alerte"))));
}
function ProfileEditModal({ user, profile, onClose, onSaved }) {
  const [name, setName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [wa, setWa] = useState(profile?.whatsapp || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setSaving(true); setErr("");
    try {
      const { error } = await sb.from("profiles").update({ full_name: name, phone, whatsapp: wa }).eq("id", user.id);
      if (error) { setErr(error.message); return; }
      onSaved({ full_name: name, phone, whatsapp: wa });
      onClose();
    } catch(e) { setErr(e.message); } finally { setSaving(false); }
  }
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal" }, /* @__PURE__ */ React.createElement("div", { className: "mhd" }, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u270F\uFE0F Modifier le profil"), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "mbd" }, err && /* @__PURE__ */ React.createElement("div", { className: "al ale" }, "\u274C ", err), /* @__PURE__ */ React.createElement("div", { className: "pedit-grid" }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Nom complet"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: name, onChange: (e) => setName(e.target.value), placeholder: "Ibrahima Diallo" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "T\xE9l\xE9phone"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: phone, onChange: (e) => setPhone(e.target.value), placeholder: "+221 77 000 00 00" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "WhatsApp"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: wa, onChange: (e) => setWa(e.target.value), placeholder: "+221 77 000 00 00" }))), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: save, disabled: saving }, saving ? "Enregistrement..." : "\u{1F4BE} Sauvegarder"))));
}
function WaBtnPro({ listing, ownerProfile, showToast: showToast2 }) {
  const phone = (ownerProfile?.whatsapp || ownerProfile?.phone || "221770000000").replace(/\D/g, "");
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://senegalsen-immobilier.vercel.app";
  const msg = `Bonjour ! \u{1F44B}

Je suis int\xE9ress\xE9(e) par votre bien sur *SeneGalsen Immobilier* :

\u{1F3E0} *${listing.title}*
\u{1F4B0} ${new Intl.NumberFormat("fr-SN").format(listing.price)} FCFA${listing.transaction_type === "location" ? "/mois" : ""}
\u{1F4CD} ${listing.quartier || ""}, ${listing.city || "Dakar"}

\u{1F517} ${siteUrl}

Pouvez-vous me donner plus d'informations ?`;
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  async function handleWaClick() {
    await sb.from("listings").update({ contacts_count: (listing.contacts_count || 0) + 1 }).eq("id", listing.id).catch(() => {
    });
    window.open(waUrl, "_blank", "noopener");
    showToast2 && showToast2("\u{1F4AC} Ouverture WhatsApp...");
  }
  return /* @__PURE__ */ React.createElement("button", { className: "btn-wa-pro", onClick: handleWaClick }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, "\u{1F4AC}"), /* @__PURE__ */ React.createElement("span", null, "Contacter sur WhatsApp"), /* @__PURE__ */ React.createElement("span", { className: "wa-pulse" }));
}
function WaFloat({ listing, ownerProfile }) {
  const phone = (ownerProfile?.whatsapp || ownerProfile?.phone || "221770000000").replace(/\D/g, "");
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://senegalsen-immobilier.vercel.app";
  const msg = `Bonjour ! Je suis int\xE9ress\xE9(e) par *${listing.title}* \u2014 ${new Intl.NumberFormat("fr-SN").format(listing.price)} FCFA. ${siteUrl}`;
  return /* @__PURE__ */ React.createElement("a", { className: "wa-float", href: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, target: "_blank", rel: "noopener", title: "Contacter sur WhatsApp" }, /* @__PURE__ */ React.createElement("span", { className: "wa-tooltip" }, "Contacter sur WhatsApp"), "\u{1F4AC}");
}
const ESTIMATION_VILLES = ["Dakar", "Thi\xE8s", "Saint-Louis", "Ziguinchor", "Kaolack", "Mbour", "Touba", "Diourbel", "Tambacounda", "Kolda"];
const ESTIMATION_QUARTIERS_DAKAR = ["Almadies", "Plateau", "Point E", "Mermoz", "Sacr\xE9-C\u0153ur", "Ouakam", "Ngor", "Yoff", "Libert\xE9", "Parcelles Assainies", "Grand Dakar", "Pikine", "Gu\xE9diawaye", "Rufisque", "S\xE9bikotane"];
function EstimationModal({ onClose, listings = [] }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ property_type: "appartement", transaction_type: "vente", city: "Dakar", quartier: "", surface: "", rooms: "" });
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const f = (v) => new Intl.NumberFormat("fr-SN").format(Math.round(v));
  function computeEstimate() {
    const pool = listings.filter(
      (l) => l.status === "active" && l.property_type === form.property_type && l.transaction_type === form.transaction_type && l.price > 0
    );
    const local = pool.filter(
      (l) => form.quartier && l.quartier && l.quartier.toLowerCase().includes(form.quartier.toLowerCase()) || l.city && l.city.toLowerCase().includes(form.city.toLowerCase())
    );
    const sample = local.length >= 3 ? local : pool;
    if (sample.length === 0) return null;
    const prices = sample.map((l) => l.price).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const q1 = prices[Math.floor(prices.length * 0.25)] || median * 0.75;
    const q3 = prices[Math.floor(prices.length * 0.75)] || median * 1.25;
    let adjusted = median;
    if (form.surface && sample[0]?.surface) {
      const medSurf = sample.map((l) => l.surface || 0).filter(Boolean).sort((a, b) => a - b);
      const medianSurf = medSurf[Math.floor(medSurf.length / 2)] || 100;
      const ppm2 = median / medianSurf;
      adjusted = ppm2 * parseFloat(form.surface);
    }
    const confidence = local.length >= 5 ? "high" : local.length >= 2 ? "medium" : "low";
    return {
      median: adjusted,
      min: adjusted * 0.82,
      max: adjusted * 1.2,
      price_per_m2: form.surface ? adjusted / parseFloat(form.surface) : median / (sample[0]?.surface || 100),
      similar_count: local.length,
      total_count: sample.length,
      confidence
    };
  }
  function handleEstimate() {
    setErr("");
    const r = computeEstimate();
    if (!r) {
      setErr("Pas assez de donn\xE9es pour ce secteur. Essayez une ville plus grande.");
      return;
    }
    setResult(r);
    setStep(2);
  }
  async function submitLead() {
    if (!email.includes("@")) { setErr("Email invalide"); return; }
    setSaving(true); setErr("");
    const _safeT = new Promise(res => setTimeout(() => res({ timeout: true }), 8000));
    try {
      Promise.race([
        sb.from("estimation_leads").insert({
          email, phone: phone || null,
          property_type: form.property_type, transaction_type: form.transaction_type,
          surface: form.surface ? parseFloat(form.surface) : null,
          rooms: form.rooms ? parseInt(form.rooms) : null,
          quartier: form.quartier || null, city: form.city,
          estimated_price_min: result?.min ? Math.round(result.min) : null,
          estimated_price_max: result?.max ? Math.round(result.max) : null,
        }),
        _safeT
      ]).catch(() => {});
      fetch(`${SB_URL}/functions/v1/send-estimation-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SB_KEY },
        body: JSON.stringify({
          email,
          estimation: {
            median: result.median, min: result.min, max: result.max,
            price_per_m2: result.price_per_m2, confidence: result.confidence,
            similar_count: result.similar_count || result.total_count || 0,
          },
          details: {
            property_type: form.property_type, transaction_type: form.transaction_type,
            city: form.city, quartier: form.quartier || null,
            surface: form.surface || null, rooms: form.rooms || null,
          }
        })
      }).catch(() => {});
    } catch (e) { console.warn("submitLead:", e); }
    setSaving(false);
    setStep(3);
  }
  const confidenceLabels = { high: "\u{1F7E2} Haute confiance", medium: "\u{1F7E1} Confiance mod\xE9r\xE9e", low: "\u{1F534} Donn\xE9es limit\xE9es" };
  const confidenceClass = { high: "conf-high", medium: "conf-medium", low: "conf-low" };
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { maxWidth: 460 } }, /* @__PURE__ */ React.createElement("div", { className: "mhd" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u{1F4B0} Estimer mon bien"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 2 } }, "Estimation instantan\xE9e \u2014 march\xE9 r\xE9el SeneGalsen")), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "mbd" }, step === 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Type de bien"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.property_type, onChange: (e) => setForm((f2) => ({ ...f2, property_type: e.target.value })) }, [["appartement", "\u{1F3E2} Appartement"], ["maison", "\u{1F3E0} Maison"], ["villa", "\u{1F3E1} Villa"], ["terrain", "\u{1F33F} Terrain"], ["bureau", "\u{1F3E2} Bureau"], ["commerce", "\u{1F3EA} Commerce"]].map(([v, l]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, l)))), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Transaction"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.transaction_type, onChange: (e) => setForm((f2) => ({ ...f2, transaction_type: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "vente" }, "\u{1F511} Vente"), /* @__PURE__ */ React.createElement("option", { value: "location" }, "\u{1F4CB} Location")))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Ville"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.city, onChange: (e) => setForm((f2) => ({ ...f2, city: e.target.value, quartier: "" })) }, ["Dakar", "Thi\xE8s", "Saint-Louis", "Ziguinchor", "Kaolack", "Mbour", "Touba", "Diourbel"].map((v) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, v)))), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Quartier ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 400 } }, "(optionnel)")), form.city === "Dakar" ? /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.quartier, onChange: (e) => setForm((f2) => ({ ...f2, quartier: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Tous quartiers"), ["Almadies", "Plateau", "Point E", "Mermoz", "Sacr\xE9-C\u0153ur", "Ouakam", "Ngor", "Yoff", "Libert\xE9", "Parcelles Assainies"].map((q) => /* @__PURE__ */ React.createElement("option", { key: q, value: q }, q))) : /* @__PURE__ */ React.createElement("input", { className: "fi", placeholder: "Ex: Centre-ville", value: form.quartier, onChange: (e) => setForm((f2) => ({ ...f2, quartier: e.target.value })) }))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Surface (m\xB2)"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "number", placeholder: "Ex: 80", value: form.surface, onChange: (e) => setForm((f2) => ({ ...f2, surface: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Pi\xE8ces"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.rooms, onChange: (e) => setForm((f2) => ({ ...f2, rooms: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Non pr\xE9cis\xE9"), [1, 2, 3, 4, 5, 6].map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n }, n, " pi\xE8ce", n > 1 ? "s" : "")), /* @__PURE__ */ React.createElement("option", { value: "7" }, "7+")))), err && /* @__PURE__ */ React.createElement("div", { className: "al ale", style: { marginTop: 10 } }, err), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--gl)", border: "1px solid #bbf7d0", borderRadius: 9, padding: 10, marginTop: 12, fontSize: 11, color: "#166534", display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement("span", null, "\u26A1"), /* @__PURE__ */ React.createElement("span", null, "R\xE9sultat ", /* @__PURE__ */ React.createElement("strong", null, "instantan\xE9"), " bas\xE9 sur ", listings.length, "+ annonces r\xE9elles SeneGalsen")), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 14 }, onClick: handleEstimate }, "\u{1F4CA} Calculer l'estimation")), step === 2 && result && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 32, marginBottom: 6 } }, "\u{1F389}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 16 } }, "Votre estimation est pr\xEAte !"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", marginTop: 4 } }, "Laissez votre email pour recevoir le d\xE9tail et les annonces similaires")), /* @__PURE__ */ React.createElement("div", { className: "estim-lead-gate" }, /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Email ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--rd)" } }, "*")), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "email", placeholder: "votre@email.com", value: email, onChange: (e) => setEmail(e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "T\xE9l\xE9phone ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 400 } }, "(optionnel)")), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "tel", placeholder: "+221 77 000 00 00", value: phone, onChange: (e) => setPhone(e.target.value) }))), err && /* @__PURE__ */ React.createElement("div", { className: "al ale", style: { marginTop: 10 } }, err), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 14 }, onClick: submitLead, disabled: saving }, saving ? "\u23F3 Enregistrement..." : "\u{1F513} Voir mon estimation gratuite"), /* @__PURE__ */ React.createElement("button", { style: { background: "none", color: "var(--mu)", fontSize: 12, marginTop: 6, border: "none", cursor: "pointer", width: "100%", padding: "6px" }, onClick: () => setStep(1) }, "\u2190 Modifier les crit\xE8res")), step === 3 && result && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "estim-result" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, opacity: 0.75 } }, "Estimation ", form.transaction_type === "location" ? "locative" : "de vente", " \u2014 ", form.city, form.quartier && `, ${form.quartier}`), /* @__PURE__ */ React.createElement("div", { className: "estim-price" }, f(result.median), " FCFA", form.transaction_type === "location" ? "/mois" : ""), /* @__PURE__ */ React.createElement("div", { className: "estim-range" }, "Fourchette : ", f(result.min), " \u2014 ", f(result.max), " FCFA"), /* @__PURE__ */ React.createElement("span", { className: `estim-confidence ${confidenceClass[result.confidence || "low"]}` }, confidenceLabels[result.confidence || "low"], " \xB7 ", result.similar_count || result.total_count, " annonces analys\xE9es"), /* @__PURE__ */ React.createElement("div", { className: "estim-bar" }, /* @__PURE__ */ React.createElement("div", { className: "estim-bar-fill", style: { width: `${result.confidence === "high" ? 85 : result.confidence === "medium" ? 60 : 35}%` } })), result.price_per_m2 && /* @__PURE__ */ React.createElement("div", { className: "estim-kpi-row" }, /* @__PURE__ */ React.createElement("div", { className: "estim-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "estim-kpi-v" }, f(result.price_per_m2)), /* @__PURE__ */ React.createElement("div", { className: "estim-kpi-l" }, "FCFA/m\xB2")), form.transaction_type === "vente" && /* @__PURE__ */ React.createElement("div", { className: "estim-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "estim-kpi-v" }, f(result.median * 0.06 / 12)), /* @__PURE__ */ React.createElement("div", { className: "estim-kpi-l" }, "FCFA/mois en location")))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, padding: 12, background: "var(--bg)", borderRadius: 10, fontSize: 11, color: "var(--mu)" } }, "\u26A0\uFE0F Estimation indicative bas\xE9e sur les annonces actives. Pour une \xE9valuation pr\xE9cise, consultez un agent certifi\xE9."), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 12 }, onClick: onClose }, "\u{1F50D} Voir les annonces similaires"), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbo", style: { marginTop: 8 }, onClick: () => {
    setStep(1);
    setResult(null);
    setEmail("");
    setPhone("");
  } }, "Nouvelle estimation")))));
}


// ══════════════════════════════════════════════════════════
// SYSTÈME DE MONÉTISATION COMPLET — KËR.JOM
// ══════════════════════════════════════════════════════════

// ─── Données statiques des plans ─────────────────────────
const PLANS_DATA = {
  particulier: [
    {
      tier:"free", label:"Gratuit", price:0, popular:false,
      features:["1 annonce gratuite / mois","Durée 30 jours","Contact acheteurs","Photos illimitées"],
      cta:"Commencer gratuitement", color:"#64748b",
    },
    {
      tier:"credit", label:"Annonce sup.", price:2000, popular:false,
      features:["1 annonce supplémentaire","Durée 30 jours","Toutes les fonctionnalités"],
      cta:"Acheter un crédit", color:"#0891b2", oneshot:true,
    },
  ],
  agent: [
    {
      tier:"starter", label:"Starter", price:15000, popular:false,
      features:["10 annonces actives","Profil agent","Annuaire agents","Protection photos"],
      cta:"Choisir Starter", color:"#0891b2",
    },
    {
      tier:"pro", label:"Pro", price:30000, popular:true,
      features:["30 annonces actives","Annonces vérifiées","Statistiques avancées","Badge agent vérifié"],
      cta:"Choisir Pro", color:"#0a5c36",
    },
    {
      tier:"premium", label:"Premium", price:60000, popular:false,
      features:["Annonces illimitées","Vérifications incluses","Visibilité prioritaire","Support prioritaire"],
      cta:"Choisir Premium", color:"#1e3a5f",
    },
  ],
  agence: [
    {
      tier:"starter", label:"Starter", price:75000, popular:false,
      features:["100 annonces","Page agence complète","Gestion agents","Statistiques"],
      cta:"Choisir Starter", color:"#0891b2",
    },
    {
      tier:"pro", label:"Pro", price:150000, popular:true,
      features:["300 annonces","Mini site web agence","Import annonces CSV","Support dédié"],
      cta:"Choisir Pro", color:"#0a5c36",
    },
    {
      tier:"illimite", label:"Illimité", price:300000, popular:false,
      features:["Annonces illimitées","Agents illimités","Visibilité premium","API export annonces"],
      cta:"Choisir Illimité", color:"#1e3a5f",
    },
  ],
  promoteur: [
    {
      tier:"starter", label:"Starter", price:50000, popular:false,
      features:["2 programmes","10 annonces","Page promoteur","Formulaires leads"],
      cta:"Choisir Starter", color:"#0891b2",
    },
    {
      tier:"pro", label:"Pro", price:100000, popular:true,
      features:["5 programmes","25 annonces","Actualités projets","Analytics avancés"],
      cta:"Choisir Pro", color:"#0a5c36",
    },
    {
      tier:"premium", label:"Premium", price:200000, popular:false,
      features:["Programmes illimités","Annonces illimitées","Promotion homepage","Support dédié"],
      cta:"Choisir Premium", color:"#1e3a5f",
    },
  ],
};

const BILLING_CYCLES = [
  { k:"monthly", label:"Mensuel",    discount:0,   months:1  },
  { k:"3m",      label:"3 mois",     discount:5,   months:3  },
  { k:"6m",      label:"6 mois",     discount:10,  months:6  },
  { k:"12m",     label:"12 mois",    discount:20,  months:12 },
];

const PAY_METHODS_LIST = [
  { k:"wave",         ico:"🌊", label:"Wave",              color:"#0ea5e9" },
  { k:"orange_money", ico:"🟠", label:"Orange Money",      color:"#f97316" },
  { k:"free_money",   ico:"🟣", label:"Free Money",        color:"#7c3aed" },
  { k:"bank_transfer",ico:"🏦", label:"Virement bancaire", color:"#64748b" },
];

const PROMO_TYPES = {
  top: {
    ico:"🔝", label:"Annonce TOP", color:"#b45309", bg:"#fffbeb", border:"#fde68a",
    desc:"Remonte votre annonce en tête des résultats de recherche.",
    prices:[{days:1,price:2000},{days:3,price:4000},{days:7,price:7000},{days:30,price:15000}],
  },
  vedette: {
    ico:"⭐", label:"Annonce VEDETTE", color:"#7e22ce", bg:"#fdf4ff", border:"#e9d5ff",
    desc:"Mise en avant sur la homepage et en haut de toutes les listes.",
    prices:[{days:7,price:10000},{days:30,price:30000}],
  },
};

const ROLE_LABEL = { particulier:"Particulier", agent:"Agent", agence:"Agence", promoteur:"Promoteur" };

// ─── Page publique Abonnements / Tarifs ──────────────────
function PricingPage({ onBack, user, profile, onSubscribe }) {
  const userRole = profile?.role || "agent";
  const [tab, setTab] = React.useState(userRole !== "admin" ? userRole : "agent");
  const [cycle, setCycle] = React.useState("monthly");
  const plans = PLANS_DATA[tab] || PLANS_DATA.agent;
  const cyc  = BILLING_CYCLES.find(c=>c.k===cycle) || BILLING_CYCLES[0];

  function calcPrice(base) {
    if(!base) return 0;
    return Math.round(base * cyc.months * (1 - cyc.discount/100));
  }

  return(
    <div>
      <div className="pricing-hero">
        <button className="bkb" onClick={onBack} style={{position:"absolute",left:20,top:20,background:"rgba(255,255,255,.15)",color:"#fff",border:"1px solid rgba(255,255,255,.3)"}}>← Retour</button>
        <div style={{fontSize:36,marginBottom:8}}>🏠</div>
        <h1>Choisissez votre formule</h1>
        <p>Des offres adaptées à chaque profil immobilier. Sans engagement.</p>
      </div>

      {/* Tabs par rôle */}
      <div className="pricing-tabs">
        {[["particulier","👤 Particulier"],["agent","🏠 Agent"],["agence","🏢 Agence"],["promoteur","🏗️ Promoteur"]].map(([k,l])=>(
          <button key={k} className={`pricing-tab${tab===k?" on":""}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* Durée abonnement (sauf particulier) */}
      {tab !== "particulier" && (
        <div style={{display:"flex",gap:6,justifyContent:"center",padding:"16px 20px 0",flexWrap:"wrap"}}>
          {BILLING_CYCLES.map(c=>(
            <button
              key={c.k}
              onClick={()=>setCycle(c.k)}
              style={{padding:"6px 14px",borderRadius:100,border:`2px solid ${cycle===c.k?"var(--g)":"var(--br)"}`,
                background:cycle===c.k?"var(--gl)":"#fff",fontSize:11,fontWeight:700,cursor:"pointer",
                color:cycle===c.k?"var(--g)":"var(--tx)",display:"flex",alignItems:"center",gap:5}}
            >
              {c.label}
              {c.discount>0&&<span className="cycle-badge">-{c.discount}%</span>}
            </button>
          ))}
        </div>
      )}

      {/* Grille de plans */}
      <div className="plan-grid">
        {plans.map(plan=>{
          const total = calcPrice(plan.price);
          const monthly = plan.oneshot ? plan.price : (cyc.months>1 ? Math.round(total/cyc.months) : plan.price);
          return(
            <div key={plan.tier} className={`plan-card${plan.popular?" popular":""}`}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12}}>
                <div>
                  <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:16,color:plan.color,marginBottom:2}}>{plan.label}</div>
                  <div style={{fontSize:10,color:"var(--mu)"}}>{ROLE_LABEL[tab]}</div>
                </div>
                {plan.popular&&<span style={{background:"var(--gl)",color:"var(--g)",fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:100}}>⭐ Populaire</span>}
              </div>
              <div style={{marginBottom:14}}>
                <div className="plan-price-big">
                  {plan.price===0?"Gratuit":total.toLocaleString("fr")}<span> FCFA</span>
                </div>
                {plan.price>0&&cyc.months>1&&(
                  <div style={{fontSize:10,color:"var(--mu)",marginTop:3}}>
                    soit {monthly.toLocaleString("fr")} FCFA/mois · Économie {Math.round(plan.price*cyc.months - total).toLocaleString("fr")} FCFA
                  </div>
                )}
                {plan.price>0&&cyc.months===1&&<div style={{fontSize:10,color:"var(--mu)",marginTop:3}}>par mois</div>}
              </div>
              <ul className="plan-feat">
                {plan.features.map(f=><li key={f}>{f}</li>)}
              </ul>
              <button
                onClick={()=>onSubscribe(tab, plan, cycle)}
                style={{
                  background: plan.price===0?"var(--bg)":plan.popular?`linear-gradient(135deg,${plan.color},${plan.color}dd)`:`${plan.color}`,
                  color: plan.price===0?"var(--tx)":"#fff",
                  border: plan.price===0?"2px solid var(--br)":"none",
                  borderRadius:10, padding:"12px", fontWeight:800, fontSize:13,
                  cursor:"pointer", fontFamily:"var(--fd)", marginTop:"auto",
                  boxShadow: plan.popular?"0 4px 14px "+plan.color+"44":"none",
                  transition:".15s",
                }}
              >{plan.cta}</button>
            </div>
          );
        })}
      </div>

      {/* Promotions annonces */}
      <div style={{maxWidth:1100,margin:"0 auto",padding:"0 20px 32px"}}>
        <div style={{background:"linear-gradient(135deg,#1e3a5f,#0a5c36)",borderRadius:16,padding:"24px",color:"#fff"}}>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:6}}>🚀 Boostez vos annonces</div>
          <div style={{fontSize:12,opacity:.8,marginBottom:16}}>Augmentez la visibilité de n'importe quelle annonce, quel que soit votre plan.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {Object.entries(PROMO_TYPES).map(([key,pt])=>(
              <div key={key} style={{background:"rgba(255,255,255,.1)",borderRadius:12,padding:"14px 16px"}}>
                <div style={{fontWeight:700,marginBottom:6}}>{pt.ico} {pt.label}</div>
                <div style={{fontSize:10,opacity:.8,marginBottom:8}}>{pt.desc}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {pt.prices.map(pp=>(
                    <span key={pp.days} style={{background:"rgba(255,255,255,.15)",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:700}}>
                      {pp.days}j → {pp.price.toLocaleString("fr")} F
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Garanties */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12,marginTop:20}}>
          {[
            ["🔒","Paiement sécurisé","Wave, Orange Money, virement"],
            ["🔄","Sans engagement","Résiliation à tout moment"],
            ["🛡️","Satisfaction garantie","Remboursé si problème"],
            ["📞","Support 7j/7","Équipe basée à Dakar"],
          ].map(([ico,title,sub])=>(
            <div key={title} style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:"14px",display:"flex",gap:10,alignItems:"flex-start",boxShadow:"var(--sh)"}}>
              <span style={{fontSize:22}}>{ico}</span>
              <div>
                <div style={{fontWeight:700,fontSize:12}}>{title}</div>
                <div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de souscription (3 étapes) ────────────────────
function SubscribeModal({ role, plan, cycle: initCycle, user, profile, onClose, showToast }) {
  const [step, setStep]   = React.useState("cycle"); // cycle | pay | done
  const [cycle, setCycle] = React.useState(initCycle || "monthly");
  const [payMethod, setPayMethod] = React.useState("wave");
  const [phone, setPhone] = React.useState(profile?.phone || "");
  const [saving, setSaving] = React.useState(false);
  const [subId, setSubId] = React.useState(null);

  const cyc   = BILLING_CYCLES.find(c=>c.k===cycle) || BILLING_CYCLES[0];
  const total = plan?.oneshot ? plan.price : Math.round((plan?.price||0) * cyc.months * (1 - cyc.discount/100));
  const saved = plan?.oneshot ? 0 : Math.round((plan?.price||0) * cyc.months * cyc.discount/100);

  async function confirmSub() {
    if (!phone.trim()) { showToast("Téléphone requis","err"); return; }
    setSaving(true);
    try {
      // Créer transaction
      const { data: tx, error: txErr } = await sb.from("transactions").insert({
        user_id: user.id,
        type: plan?.oneshot ? "listing_credit" : "subscription",
        status: "pending",
        amount_xof: total,
        payment_method: payMethod,
        description: `${plan?.label} - ${plan?.oneshot?"Crédit annonce":cyc.label}`,
        metadata: { plan_tier: plan?.tier, role, cycle }
      }).select().single();
      if (txErr) throw txErr;

      if (!plan?.oneshot) {
        // Créer l'abonnement
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + cyc.months);
        const { data: sub, error: subErr } = await sb.from("subscriptions").insert({
          user_id: user.id,
          plan_id: tx.id, // on utilisera l'id tx comme référence
          status: "pending",
          billing_cycle: cycle,
          price_paid: total,
          expires_at: expiresAt.toISOString(),
          payment_method: payMethod,
        }).select().single();
        if (subErr) throw subErr;
        setSubId(sub?.id);
      } else {
        // Crédit unitaire
        await sb.from("listing_credits").insert({
          user_id: user.id,
          type: "purchased",
          amount: 1,
          price_paid: total,
          expires_at: new Date(Date.now() + 30*24*3600*1000).toISOString(),
          transaction_id: tx.id,
        });
      }

      setStep("done");
      showToast("🎉 Demande envoyée ! Procédez au paiement.");
    } catch(e) {
      showToast("❌ "+e.message, "err");
    } finally {
      setSaving(false);
    }
  }

  if (step === "done") return (
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:420,textAlign:"center",padding:"40px 28px"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:52,marginBottom:12}}>🎉</div>
        <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:8,color:"var(--g)"}}>
          Commande enregistrée !
        </div>
        <div style={{fontSize:13,color:"#374151",lineHeight:1.7,marginBottom:20}}>
          Envoyez <strong>{total.toLocaleString("fr")} FCFA</strong> par <strong>{payMethod.replace("_"," ").toUpperCase()}</strong> au numéro :<br/>
          <span style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:16,color:"var(--g)"}}>+221 77 000 00 00</span><br/>
          <span style={{fontSize:11,color:"var(--mu)"}}>Référence : {(profile?.full_name||"").slice(0,10).toUpperCase() || "KERRJOM"} {plan?.tier?.toUpperCase()}</span>
        </div>
        <div style={{background:"var(--bg)",borderRadius:10,padding:"12px 14px",textAlign:"left",fontSize:11,marginBottom:18}}>
          <div style={{fontWeight:700,marginBottom:4}}>📋 Votre commande</div>
          <div style={{color:"var(--mu)"}}>Plan : <strong style={{color:"var(--tx)"}}>{plan?.label}</strong></div>
          {!plan?.oneshot&&<div style={{color:"var(--mu)"}}>Durée : <strong style={{color:"var(--tx)"}}>{cyc.label}</strong></div>}
          <div style={{color:"var(--mu)"}}>Montant : <strong style={{color:"var(--g)"}}>{total.toLocaleString("fr")} FCFA</strong></div>
          <div style={{color:"var(--mu)"}}>Via : <strong style={{color:"var(--tx)"}}>{payMethod.replace("_"," ").toUpperCase()}</strong></div>
        </div>
        <div style={{fontSize:10,color:"var(--mu)",marginBottom:16}}>
          Votre plan sera activé dans l'heure suivant la confirmation de paiement.<br/>
          Support : verif@senegalsen.sn · +221 77 000 00 00
        </div>
        <button className="fbt2 fbg" style={{width:"100%"}} onClick={onClose}>Compris !</button>
      </div>
    </div>
  );

  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:520,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          {step==="pay"&&<button onClick={()=>setStep("cycle")} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"var(--mu)"}}>←</button>}
          <div style={{flex:1}}>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:17}}>
              {step==="cycle"?"📦 Choisir la durée":"💳 Paiement"}
            </div>
            <div style={{fontSize:10,color:"var(--mu)"}}>{ROLE_LABEL[role]} · {plan?.label}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)"}}>×</button>
        </div>

        {/* Étape 1 : durée (non disponible pour oneshot) */}
        {step==="cycle"&&!plan?.oneshot&&(
          <div className="sub-modal-step">
            <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:16}}>
              {BILLING_CYCLES.map(c=>{
                const t = Math.round((plan?.price||0)*c.months*(1-c.discount/100));
                const sv = Math.round((plan?.price||0)*c.months*c.discount/100);
                return(
                  <button
                    key={c.k}
                    className={`cycle-btn${cycle===c.k?" active":""}`}
                    onClick={()=>setCycle(c.k)}
                  >
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:18,height:18,borderRadius:50,border:`2px solid ${cycle===c.k?"var(--g)":"#d1d5db"}`,background:cycle===c.k?"var(--g)":"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {cycle===c.k&&<div style={{width:7,height:7,borderRadius:50,background:"#fff"}}/>}
                        </div>
                        <div>
                          <div style={{fontWeight:700,fontSize:13}}>{c.label}</div>
                          <div style={{fontSize:10,color:"var(--mu)"}}>
                            {Math.round(t/c.months).toLocaleString("fr")} FCFA/mois
                          </div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:"var(--g)"}}>
                          {t.toLocaleString("fr")} <span style={{fontSize:10,fontWeight:500}}>FCFA</span>
                        </div>
                        {sv>0&&<span className="cycle-badge">Économie {sv.toLocaleString("fr")} F</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button className="fbt2 fbg" style={{width:"100%"}} onClick={()=>setStep("pay")}>
              Continuer →
            </button>
          </div>
        )}

        {/* Étape 1 pour oneshot : direct sur paiement */}
        {step==="cycle"&&plan?.oneshot&&(
          <div className="sub-modal-step">
            <div style={{background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:12,padding:"16px",marginBottom:16,textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:8}}>📋</div>
              <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,marginBottom:4}}>Crédit d'annonce</div>
              <div style={{fontSize:12,color:"#374151"}}>1 annonce supplémentaire · Durée 30 jours</div>
              <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:22,color:"var(--g)",marginTop:8}}>
                {plan.price.toLocaleString("fr")} <span style={{fontSize:12,fontWeight:500}}>FCFA</span>
              </div>
            </div>
            <button className="fbt2 fbg" style={{width:"100%"}} onClick={()=>setStep("pay")}>Continuer →</button>
          </div>
        )}

        {/* Étape 2 : paiement */}
        {step==="pay"&&(
          <div className="sub-modal-step">
            {/* Récap */}
            <div style={{background:"var(--gl)",border:"1.5px solid var(--g)",borderRadius:12,padding:"14px 16px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,color:"var(--g)",fontWeight:600}}>{plan?.label} · {plan?.oneshot?"1 crédit":cyc.label}</div>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:22,color:"var(--g)"}}>
                  {total.toLocaleString("fr")} <span style={{fontSize:12,fontWeight:500}}>FCFA</span>
                </div>
              </div>
              {saved>0&&<span className="cycle-badge" style={{fontSize:10}}>Économie {saved.toLocaleString("fr")} F</span>}
            </div>

            {/* Méthode */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Mode de paiement</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {PAY_METHODS_LIST.map(m=>(
                  <button
                    key={m.k}
                    className={`pay-method-btn${payMethod===m.k?" active":""}`}
                    onClick={()=>setPayMethod(m.k)}
                    style={{justifyContent:"flex-start"}}
                  >
                    <span style={{fontSize:20}}>{m.ico}</span>
                    <span style={{color:payMethod===m.k?m.color:"inherit",fontWeight:700}}>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="fg" style={{marginBottom:14}}>
              <label className="fl">Téléphone de contact *</label>
              <input className="fi" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+221 77 000 00 00"/>
            </div>

            <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"11px 14px",marginBottom:16,fontSize:10,color:"#92400e",lineHeight:1.7}}>
              <strong>📋 Procédure :</strong> Cliquez "Confirmer" → envoyez le paiement via {payMethod.replace("_"," ").toUpperCase()} → votre plan est activé dans l'heure.
            </div>

            <button className="fbt2 fbg" style={{width:"100%"}} onClick={confirmSub} disabled={saving||!phone.trim()}>
              {saving?"Enregistrement…":"✅ Confirmer la commande"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal Boost Annonce (TOP / VEDETTE) ─────────────────
function PromoBoostModal({ listing, user, onClose, showToast }) {
  const [type, setType]   = React.useState("top");
  const [days, setDays]   = React.useState(7);
  const [payMethod, setPay] = React.useState("wave");
  const [phone, setPhone] = React.useState("");
  const [step, setStep]   = React.useState("choose"); // choose | pay | done
  const [saving, setSaving] = React.useState(false);

  const pt    = PROMO_TYPES[type];
  const price = pt?.prices.find(p=>p.days===days)?.price || pt?.prices[0]?.price || 0;

  async function submit() {
    if(!phone.trim()) { showToast("Téléphone requis","err"); return; }
    setSaving(true);
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + days);

      const { data: tx } = await sb.from("transactions").insert({
        user_id: user.id, type:"promotion", status:"pending",
        amount_xof: price, payment_method: payMethod,
        description: `Boost ${type.toUpperCase()} ${days}j — "${listing?.title?.slice(0,30)}"`,
        metadata: { listing_id: listing?.id, promo_type: type, days }
      }).select().single();

      await sb.from("listing_promotions").insert({
        listing_id: listing?.id, user_id: user.id,
        type, duration_days: days, price_paid: price,
        status: "pending", expires_at: expiresAt.toISOString(),
        transaction_id: tx?.id,
      });

      setStep("done");
      showToast(`🚀 Boost ${type.toUpperCase()} enregistré !`);
    } catch(e) {
      showToast("❌ "+e.message,"err");
    } finally {
      setSaving(false);
    }
  }

  if (step === "done") return (
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:420,textAlign:"center",padding:"40px 28px"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:52,marginBottom:12}}>{pt.ico}</div>
        <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:8,color:pt.color}}>Boost activé !</div>
        <div style={{fontSize:13,color:"#374151",lineHeight:1.7,marginBottom:20}}>
          Envoyez <strong>{price.toLocaleString("fr")} FCFA</strong> par <strong>{payMethod.replace("_"," ").toUpperCase()}</strong> pour activer votre boost de <strong>{days} jours</strong>.
        </div>
        <button className="fbt2 fbg" style={{width:"100%"}} onClick={onClose}>Parfait !</button>
      </div>
    </div>
  );

  return (
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:500,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:17}}>🚀 Booster cette annonce</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)"}}>×</button>
        </div>

        {/* Annonce */}
        <div style={{display:"flex",gap:9,alignItems:"center",background:"var(--bg)",borderRadius:9,padding:"9px 12px",marginBottom:14,border:"1px solid var(--br)"}}>
          {listing?.cover_image&&<img src={listing.cover_image} alt="" style={{width:44,height:36,borderRadius:6,objectFit:"cover",flexShrink:0}}/>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{listing?.title}</div>
            <div style={{fontSize:10,color:"var(--mu)"}}>📍 {listing?.quartier}, {listing?.city} · {fmt(listing?.price||0)}</div>
          </div>
        </div>

        {/* Choix type */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          {Object.entries(PROMO_TYPES).map(([k,p])=>(
            <div
              key={k}
              className={`boost-option${type===k?" sel":""}`}
              onClick={()=>{setType(k); setDays(p.prices[1]?.days||p.prices[0]?.days);}}
            >
              <div style={{fontSize:24,marginBottom:4}}>{p.ico}</div>
              <div style={{fontWeight:800,fontSize:13,color:p.color,marginBottom:3}}>{p.label}</div>
              <div style={{fontSize:10,color:"#475569",lineHeight:1.4}}>{p.desc}</div>
            </div>
          ))}
        </div>

        {/* Durées */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Durée</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {pt.prices.map(p=>(
              <button
                key={p.days}
                onClick={()=>setDays(p.days)}
                style={{padding:"7px 14px",borderRadius:8,border:`2px solid ${days===p.days?pt.color:"var(--br)"}`,
                  background:days===p.days?pt.bg:"#fff",
                  fontWeight:days===p.days?800:400,cursor:"pointer",fontSize:11,
                  color:days===p.days?pt.color:"var(--tx)"}}
              >
                {p.days} jour{p.days>1?"s":""} · <strong>{p.price.toLocaleString("fr")} F</strong>
              </button>
            ))}
          </div>
        </div>

        {/* Récap prix */}
        <div style={{background:pt.bg,border:`1.5px solid ${pt.border}`,borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:11,color:pt.color,fontWeight:600}}>{pt.ico} {pt.label} · {days} jours</div>
          <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:20,color:pt.color}}>{price.toLocaleString("fr")} <span style={{fontSize:11,fontWeight:500}}>FCFA</span></div>
        </div>

        {/* Paiement */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Paiement</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {PAY_METHODS_LIST.map(m=>(
              <button key={m.k} className={`pay-method-btn${payMethod===m.k?" active":""}`} onClick={()=>setPay(m.k)}>
                <span style={{fontSize:18}}>{m.ico}</span>
                <span style={{color:payMethod===m.k?m.color:"inherit",fontSize:11}}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="fg" style={{marginBottom:14}}>
          <label className="fl">Téléphone</label>
          <input className="fi" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+221 77 000 00 00"/>
        </div>

        <button className="fbt2 fbg" style={{width:"100%",background:`linear-gradient(135deg,${pt.color},${pt.color}cc)`}} onClick={submit} disabled={saving||!phone.trim()}>
          {saving?"…":"🚀 Confirmer le boost — "+price.toLocaleString("fr")+" FCFA"}
        </button>
      </div>
    </div>
  );
}


// ─── Bannière plan actuel (dans overview dashboard) ──────
function PlanBanner({ user, onManage }) {
  const [sub, setSub] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(()=>{
    sb.from("subscriptions").select("*,subscription_plans(name,tier,role)")
      .eq("user_id",user.id).eq("status","active").order("created_at",{ascending:false}).limit(1)
      .then(({data})=>{ setSub(data?.[0]||null); setLoaded(true); });
  },[]);
  if (!loaded) return null;
  const daysLeft = sub?.expires_at ? Math.max(0,Math.round((new Date(sub.expires_at)-Date.now())/(86400000))) : null;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,background:sub?"var(--gl)":"#fef3c7",
      border:`1.5px solid ${sub?"var(--g)":"#fde68a"}`,borderRadius:10,padding:"9px 14px",
      marginBottom:14,fontSize:11,cursor:"pointer",flexWrap:"wrap"}} onClick={onManage}>
      <span style={{fontSize:18}}>{sub?"📦":"⚡"}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:700,color:sub?"var(--g)":"#92400e"}}>
          {sub ? `Plan ${sub.subscription_plans?.name||"actif"} — actif` : "Aucun abonnement actif"}
        </div>
        <div style={{fontSize:9,color:"var(--mu)",marginTop:1}}>
          {sub && daysLeft!==null ? `Expire dans ${daysLeft} jour${daysLeft>1?"s":""}` : "Passez à un plan payant pour plus de fonctionnalités"}
        </div>
      </div>
      <span style={{background:sub?"var(--g)":"#f59e0b",color:"#fff",fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:100,whiteSpace:"nowrap"}}>
        {sub?"🔄 Gérer":"🚀 Souscrire"}
      </span>
    </div>
  );
}

// ─── DashBillingTab : onglet Abonnement par dashboard ───
// Entièrement auto-suffisant : SubscribeModal inline, chargement DB, plans filtrés par rôle
function BillingTab({ user, profile, showToast }) {
  const role = profile?.role || "particulier";
  const plans = PLANS_DATA[role] || PLANS_DATA.particulier;

  const [subs, setSubs]       = React.useState([]);
  const [txs, setTxs]         = React.useState([]);
  const [credits, setCredits] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [subTarget, setSubTarget] = React.useState(null); // {plan, cycle}

  React.useEffect(()=>{ load(); },[]);

  async function load(){
    setLoading(true);
    const [s,t,c] = await Promise.all([
      sb.from("subscriptions").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(5),
      sb.from("transactions").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(20),
      sb.from("listing_credits").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(10),
    ]);
    setSubs(s.data||[]);
    setTxs(t.data||[]);
    setCredits(c.data||[]);
    setLoading(false);
  }

  const activeSub   = subs.find(s=>s.status==="active" || s.status==="pending");
  const totalPaid   = txs.filter(t=>t.status==="paid").reduce((s,t)=>s+t.amount_xof,0);
  const pendingTxs  = txs.filter(t=>t.status==="pending");
  const availCreds  = credits.reduce((s,c)=>s+(c.amount-c.used),0);

  const TX_STATUS = { paid:"tx-paid", pending:"tx-pending", failed:"tx-failed", refunded:"tx-refunded" };
  const TX_ICONS  = { subscription:"📦", listing_credit:"📋", promotion:"🚀", verification:"🔍", refund:"↩️" };

  // Couleurs par rôle pour les plans
  const ROLE_ACCENT = { particulier:"#0891b2", agent:"#0a5c36", agence:"#1e3a5f", promoteur:"#7c3aed" };
  const accent = ROLE_ACCENT[role] || "#0a5c36";

  return (
    <div>
      {/* Modal souscription inline */}
      {subTarget && (
        <SubscribeModal
          role={role}
          plan={subTarget.plan}
          cycle={subTarget.cycle}
          user={user}
          profile={profile}
          onClose={()=>{ setSubTarget(null); load(); }}
          showToast={showToast}
        />
      )}

      <div className="dtit2">{role==="particulier"?"💳 Mes annonces & Paiements":"💳 Abonnement & Facturation"}</div>

      {loading ? <div className="ldr"><div className="spin"/></div> : (<>

        {/* ── Statut abonnement actuel ─ */}
        {activeSub ? (
          <div className="billing-plan-card" style={{marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:10,opacity:.7,marginBottom:4}}>Votre abonnement actuel</div>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:22,marginBottom:4}}>
                  {activeSub.price_paid?.toLocaleString("fr")} <span style={{fontSize:12,fontWeight:400}}>FCFA</span>
                </div>
                <div style={{fontSize:11,opacity:.8}}>
                  {activeSub.billing_cycle==="monthly"?"Mensuel":activeSub.billing_cycle==="3m"?"3 mois":activeSub.billing_cycle==="6m"?"6 mois":"12 mois"}
                  {activeSub.expires_at && <> · Expire le {new Date(activeSub.expires_at).toLocaleDateString("fr-SN")}</>}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
                <span style={{background:activeSub.status==="active"?"#dcfce7":"#fde68a",color:activeSub.status==="active"?"#15803d":"#92400e",fontSize:10,fontWeight:800,padding:"4px 10px",borderRadius:100}}>
                  {activeSub.status==="active"?"✅ Actif":"⏳ En attente paiement"}
                </span>
                <button className="fbt2 fbo" style={{fontSize:10,padding:"5px 12px"}} onClick={()=>setSubTarget({plan:plans[1]||plans[0],cycle:"monthly"})}>
                  🔄 Changer de plan
                </button>
              </div>
            </div>
            {activeSub.status==="pending" && (
              <div style={{marginTop:10,background:"rgba(255,255,255,.12)",borderRadius:8,padding:"10px 12px",fontSize:11,lineHeight:1.6}}>
                💳 Envoyez <strong>{activeSub.price_paid?.toLocaleString("fr")} FCFA</strong> par {activeSub.payment_method?.replace("_"," ").toUpperCase()} au <strong>+221 77 000 00 00</strong> pour activer votre plan.
              </div>
            )}
          </div>
        ) : (
          <div style={{background:"#f8fafc",border:"2px dashed #cbd5e1",borderRadius:14,padding:"18px",textAlign:"center",marginBottom:16}}>
            <div style={{fontSize:28,marginBottom:6}}>📦</div>
            <div style={{fontWeight:700,fontSize:13,marginBottom:3}}>Aucun abonnement actif</div>
            <div style={{fontSize:11,color:"var(--mu)",marginBottom:12}}>Choisissez un plan ci-dessous pour profiter de toutes les fonctionnalités.</div>
          </div>
        )}

        {/* ── Plans disponibles (role-aware) ─────── */}
        {role === "particulier" ? (
          /* Particulier : UI Freemium simple */
          <div style={{marginBottom:18}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>🎯 Votre modèle</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {/* Plan gratuit */}
              <div style={{background:"#f0fdf4",border:"2px solid #86efac",borderRadius:14,padding:"18px 16px"}}>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:"#15803d",marginBottom:6}}>✅ Plan Gratuit</div>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:26,color:"#0a5c36",marginBottom:8}}>0 <span style={{fontSize:12,fontWeight:400,color:"var(--mu)"}}>FCFA</span></div>
                <ul className="plan-feat">
                  {["1 annonce gratuite / mois","Durée 30 jours","Contact acheteurs","Photos illimitées"].map(f=><li key={f} style={{fontSize:11}}>{f}</li>)}
                </ul>
                <div style={{textAlign:"center",fontSize:11,color:"#15803d",fontWeight:700,marginTop:8}}>✓ Votre plan actuel</div>
              </div>
              {/* Crédit supplémentaire */}
              <div style={{background:"#eff6ff",border:"2px solid #bfdbfe",borderRadius:14,padding:"18px 16px"}}>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:"#1d4ed8",marginBottom:6}}>➕ Annonce supplémentaire</div>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:26,color:"#1d4ed8",marginBottom:8}}>2 000 <span style={{fontSize:12,fontWeight:400,color:"var(--mu)"}}>FCFA</span></div>
                <ul className="plan-feat">
                  {["1 annonce supplémentaire","Durée 30 jours","Toutes les fonctionnalités"].map(f=><li key={f} style={{fontSize:11}}>{f}</li>)}
                </ul>
                <button
                  onClick={()=>setSubTarget({plan:PLANS_DATA.particulier[1], cycle:"monthly"})}
                  style={{width:"100%",padding:"9px",borderRadius:8,border:"none",
                    background:"linear-gradient(135deg,#1d4ed8,#2563eb)",
                    color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer",marginTop:8,fontFamily:"var(--fd)"}}
                >Acheter 1 crédit → 2 000 F</button>
              </div>
              {/* Boost annonce */}
              <div style={{background:"#fdf4ff",border:"2px solid #e9d5ff",borderRadius:14,padding:"18px 16px"}}>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:"#7e22ce",marginBottom:6}}>🚀 Boosts disponibles</div>
                <div style={{marginBottom:8}}>
                  {[["🔝 TOP","Remonter en tête","2 000 F / 1j"],["⭐ VEDETTE","Homepage + tête de liste","10 000 F / 7j"]].map(([ico,d,p])=>(
                    <div key={ico} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #e9d5ff",fontSize:11}}>
                      <span style={{fontWeight:600,color:"#7e22ce"}}>{ico} <span style={{color:"#374151",fontWeight:400}}>{d}</span></span>
                      <span style={{fontWeight:800,color:"#7e22ce"}}>{p}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"var(--mu)"}}>Disponible sur chaque annonce publiée.</div>
              </div>
            </div>
          </div>
        ) : (
          /* Agents / Agences / Promoteurs : grille plans mensuels */
          <>
            <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>
              {activeSub ? "🔄 Changer de plan" : "🚀 Choisir un plan"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:18}}>
              {plans.map(plan=>{
                const isActive = activeSub && activeSub.price_paid === plan.price;
                return (
                  <div key={plan.tier} className={`plan-card${plan.popular?" popular":""}`}
                    style={{borderColor:isActive?accent:"",background:isActive?accent+"09":""}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:isActive?accent:plan.color||accent}}>
                        {plan.label}
                      </div>
                      {isActive && <span style={{background:accent+"22",color:accent,fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:100}}>✓ Actif</span>}
                      {plan.popular && !isActive && <span style={{background:"var(--gl)",color:"var(--g)",fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:100}}>⭐ Pop.</span>}
                    </div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:22,color:accent,lineHeight:1}}>
                        {plan.price===0?"Gratuit":plan.price.toLocaleString("fr")}
                        {plan.price>0&&<span style={{fontSize:11,fontWeight:400,color:"var(--mu)"}}> F/mois</span>}
                      </div>
                    </div>
                    <ul className="plan-feat" style={{marginBottom:10}}>
                      {plan.features.map(f=><li key={f} style={{fontSize:11}}>{f}</li>)}
                    </ul>
                    {plan.price>0 && !isActive && (
                      <button
                        onClick={()=>setSubTarget({plan, cycle:"monthly"})}
                        style={{width:"100%",padding:"10px",borderRadius:8,border:"none",
                          background:`linear-gradient(135deg,${accent},${accent}cc)`,
                          color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer",fontFamily:"var(--fd)"}}
                      >{plan.cta}</button>
                    )}
                    {plan.price===0 && <div style={{textAlign:"center",fontSize:11,color:"var(--mu)",padding:"8px 0"}}>Plan par défaut</div>}
                    {isActive && plan.price>0 && <div style={{textAlign:"center",fontSize:11,color:accent,fontWeight:700,padding:"8px 0"}}>✓ Plan actuel</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Réductions durée (non-particulier) ── */}
        {role !== "particulier" && (
          <div style={{background:"linear-gradient(135deg,var(--g),#1e3a5f)",borderRadius:12,padding:"14px 16px",marginBottom:16,color:"#fff"}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>🎁 Réductions sur abonnement longue durée</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[["3 mois","-5%"],["6 mois","-10%"],["12 mois","-20%"]].map(([d,r])=>(
                <div key={d} style={{background:"rgba(255,255,255,.15)",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700}}>
                  {d} → <span style={{color:"#86efac"}}>{r}</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:10,opacity:.7,marginTop:6}}>Sélectionnable lors de la souscription.</div>
          </div>
        )}

        {/* ── KPIs ── */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
          {[["💰","Total payé",totalPaid.toLocaleString("fr")+" F"],["⏳","En attente",pendingTxs.length+" tx"],["📋","Crédits dispo",availCreds]].map(([ico,lbl,val])=>(
            <div key={lbl} className="rev-kpi" style={{textAlign:"center",padding:"10px"}}>
              <div style={{fontSize:18}}>{ico}</div>
              <div className="rev-val" style={{fontSize:15}}>{val}</div>
              <div className="rev-lbl">{lbl}</div>
            </div>
          ))}
        </div>

        {/* ── Crédits annonces (particulier) ── */}
        {credits.length > 0 && (
          <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:"12px 16px",marginBottom:14,boxShadow:"var(--sh)"}}>
            <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>📋 Crédits d'annonces</div>
            {credits.map(c=>(
              <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--bg)",fontSize:11}}>
                <span style={{fontWeight:600}}>{c.amount-c.used} crédit{c.amount-c.used>1?"s":""} disponible{c.amount-c.used>1?"s":""}
                  <span style={{color:"var(--mu)",fontWeight:400,marginLeft:5}}>({c.type==="free_monthly"?"gratuit":"acheté"})</span>
                </span>
                {c.expires_at && <span style={{fontSize:9,color:"var(--mu)"}}>Exp. {new Date(c.expires_at).toLocaleDateString("fr-SN")}</span>}
              </div>
            ))}
          </div>
        )}

        {/* ── Historique transactions ── */}
        <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,boxShadow:"var(--sh)"}}>
          <div style={{padding:"11px 16px",borderBottom:"1px solid var(--br)",fontWeight:700,fontSize:12}}>📜 Historique des paiements</div>
          {txs.length===0 ? (
            <div style={{padding:"20px",textAlign:"center",fontSize:12,color:"var(--mu)"}}>Aucune transaction</div>
          ) : (
            <div style={{padding:"0 16px"}}>
              {txs.map(tx=>(
                <div key={tx.id} className="tx-row">
                  <div style={{width:30,height:30,borderRadius:7,background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{TX_ICONS[tx.type]||"💳"}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11}}>{tx.description||tx.type}</div>
                    <div style={{fontSize:9,color:"var(--mu)"}}>{new Date(tx.created_at).toLocaleDateString("fr-SN")} · {tx.payment_method?.replace(/_/g," ").toUpperCase()}</div>
                  </div>
                  <div style={{fontFamily:"var(--fd)",fontWeight:800,color:"var(--g)",whiteSpace:"nowrap",fontSize:12}}>{tx.amount_xof?.toLocaleString("fr")} F</div>
                  <span className={TX_STATUS[tx.status]||"tx-pending"} style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:100,whiteSpace:"nowrap"}}>
                    {tx.status==="paid"?"✅ Payé":tx.status==="pending"?"⏳ Attente":tx.status==="failed"?"❌ Échoué":"↩️"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button className="fbt2 fbo" style={{marginTop:12,width:"100%"}} onClick={load}>🔄 Actualiser</button>
      </>)}
    </div>
  );
}

// ─── Onglet Admin : Revenus & Transactions ───────────────
function RevenueAdminTab({ showDT }) {
  const [txs, setTxs]       = React.useState([]);
  const [subs, setSubs]     = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState("all");
  const [period, setPeriod] = React.useState("30"); // jours

  React.useEffect(()=>{ load(); },[]);

  async function load(){
    setLoading(true);
    const since = new Date(); since.setDate(since.getDate()-parseInt(period||30));
    const [t,s] = await Promise.all([
      sb.from("transactions").select("*,profiles!user_id(full_name,role)").order("created_at",{ascending:false}).limit(200),
      sb.from("subscriptions").select("*,profiles!user_id(full_name,role),subscription_plans(name,role,tier)").eq("status","active").order("created_at",{ascending:false}).limit(100),
    ]);
    setTxs(t.data||[]);
    setSubs(s.data||[]);
    setLoading(false);
  }

  async function markPaid(txId){
    await sb.from("transactions").update({status:"paid",paid_at:new Date().toISOString()}).eq("id",txId);
    // Activer les abonnements liés
    await sb.from("subscriptions").update({status:"active"}).eq("status","pending");
    setTxs(ts=>ts.map(t=>t.id===txId?{...t,status:"paid"}:t));
    showDT("✅ Transaction marquée payée");
  }

  async function cancelSub(subId){
    await sb.from("subscriptions").update({status:"cancelled",cancelled_at:new Date().toISOString()}).eq("id",subId);
    setSubs(ss=>ss.filter(s=>s.id!==subId));
    showDT("Abonnement annulé");
  }

  const filtered = filter==="all"?txs:txs.filter(t=>t.status===filter);
  const revenue   = txs.filter(t=>t.status==="paid").reduce((s,t)=>s+t.amount_xof,0);
  const pending   = txs.filter(t=>t.status==="pending").reduce((s,t)=>s+t.amount_xof,0);
  const bySrc = { subscription:0, listing_credit:0, promotion:0, verification:0 };
  txs.filter(t=>t.status==="paid").forEach(t=>{ bySrc[t.type]=(bySrc[t.type]||0)+t.amount_xof; });

  const TX_STATUS_CSS = { paid:"tx-paid", pending:"tx-pending", failed:"tx-failed", refunded:"tx-refunded" };
  const TX_ICONS = { subscription:"📦", listing_credit:"📋", promotion:"🚀", verification:"🔍", refund:"↩️" };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div className="dtit2" style={{marginBottom:0}}>💰 Revenus & Transactions</div>
        <button className="fbt2 fbo" style={{fontSize:11,padding:"6px 12px"}} onClick={load}>🔄 Actualiser</button>
      </div>

      {/* KPIs revenus */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:16}}>
        {[
          ["💰","Revenus confirmés",revenue.toLocaleString("fr")+" F","#15803d"],
          ["⏳","En attente",pending.toLocaleString("fr")+" F","#b45309"],
          ["📦","Abonnements actifs",subs.length,"#1d4ed8"],
          ["🚀","Promotions",bySrc.promotion.toLocaleString("fr")+" F","#7e22ce"],
        ].map(([ico,lbl,val,c])=>(
          <div key={lbl} className="rev-kpi">
            <div style={{fontSize:18,marginBottom:4}}>{ico}</div>
            <div className="rev-val" style={{color:c}}>{val}</div>
            <div className="rev-lbl">{lbl}</div>
          </div>
        ))}
      </div>

      {/* Répartition par source */}
      <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:"14px 16px",marginBottom:14,boxShadow:"var(--sh)"}}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>📊 Répartition par source</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[
            {k:"subscription",l:"Abonnements",ico:"📦"},
            {k:"listing_credit",l:"Crédits annonces",ico:"📋"},
            {k:"promotion",l:"Boosts",ico:"🚀"},
            {k:"verification",l:"Vérifications",ico:"🔍"},
          ].map(({k,l,ico})=>{
            const val = bySrc[k]||0;
            const pct = revenue>0 ? Math.round(val/revenue*100) : 0;
            return(
              <div key={k}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                  <span style={{fontWeight:600}}>{ico} {l}</span>
                  <span style={{color:"var(--g)",fontWeight:700}}>{val.toLocaleString("fr")} F <span style={{color:"var(--mu)",fontWeight:400}}>({pct}%)</span></span>
                </div>
                <div style={{background:"var(--bg)",borderRadius:100,height:6,overflow:"hidden"}}>
                  <div style={{background:"var(--g)",height:"100%",width:pct+"%",borderRadius:100,transition:".4s"}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Abonnements actifs */}
      {subs.length>0&&(
        <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:"14px 16px",marginBottom:14,boxShadow:"var(--sh)"}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>📦 Abonnements actifs ({subs.length})</div>
          <div style={{overflowX:"auto"}}>
            <table className="dtbl" style={{minWidth:520}}>
              <thead><tr><th>Utilisateur</th><th>Plan</th><th>Cycle</th><th>Prix</th><th>Expire</th><th>Actions</th></tr></thead>
              <tbody>
                {subs.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontSize:11}}>
                      <div style={{fontWeight:600}}>{s.profiles?.full_name||"—"}</div>
                      <div style={{fontSize:9,color:"var(--mu)"}}>{s.profiles?.role}</div>
                    </td>
                    <td><span style={{fontWeight:700,fontSize:11}}>{s.subscription_plans?.name||"—"}</span></td>
                    <td style={{fontSize:10}}>{s.billing_cycle}</td>
                    <td style={{fontFamily:"var(--fd)",fontWeight:700,fontSize:11,color:"var(--g)"}}>{s.price_paid?.toLocaleString("fr")} F</td>
                    <td style={{fontSize:10,color:"var(--mu)"}}>{s.expires_at?new Date(s.expires_at).toLocaleDateString("fr-SN"):"—"}</td>
                    <td><button className="ab abd" onClick={()=>cancelSub(s.id)}>✕ Annuler</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions */}
      <div style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,boxShadow:"var(--sh)"}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid var(--br)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div style={{fontWeight:700,fontSize:13}}>📜 Toutes les transactions</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {[["all","Toutes"],["pending","En attente"],["paid","Payées"],["failed","Échouées"]].map(([v,l])=>(
              <button key={v} className={`fbt${filter===v?" on":""}`} style={{fontSize:10}} onClick={()=>setFilter(v)}>{l}</button>
            ))}
          </div>
        </div>
        {loading?<div style={{padding:20,textAlign:"center"}}><div className="spin"/></div>:
        filtered.length===0?<div style={{padding:"24px",textAlign:"center",color:"var(--mu)",fontSize:12}}>Aucune transaction</div>:(
          <div style={{padding:"0 16px"}}>
            {filtered.map(tx=>(
              <div key={tx.id} className="tx-row">
                <div style={{width:32,height:32,borderRadius:8,background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{TX_ICONS[tx.type]||"💳"}</div>
                <div style={{minWidth:0}}>
                  <div style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.profiles?.full_name||"—"}</div>
                  <div style={{fontSize:9,color:"var(--mu)"}}>{tx.description?.slice(0,40)} · {new Date(tx.created_at).toLocaleDateString("fr-SN")}</div>
                </div>
                <div style={{fontFamily:"var(--fd)",fontWeight:800,color:"var(--g)",whiteSpace:"nowrap",fontSize:12}}>{tx.amount_xof?.toLocaleString("fr")} F</div>
                <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
                  <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:100,whiteSpace:"nowrap"}} className={TX_STATUS_CSS[tx.status]||"tx-pending"}>
                    {tx.status==="paid"?"✅":tx.status==="pending"?"⏳":tx.status==="failed"?"❌":"↩️"} {tx.status}
                  </span>
                  {tx.status==="pending"&&<button className="ab abe" style={{fontSize:9,padding:"2px 7px"}} onClick={()=>markPaid(tx.id)}>✅ Marquer payé</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// SYSTÈME DE MONÉTISATION — VÉRIFICATION PAYANTE
// ══════════════════════════════════════════════════════════

// Config des niveaux de vérification (peut être surchargée par les prix DB)
const VERIF_TIERS = {
  partial: {
    level:"partial", icon:"🟡", color:"#b45309", bg:"#fffbeb", border:"#fde68a",
    label:"Vérification partielle",
    pitch:"Documents contrôlés + photos certifiées",
    defaultPrice: 15000, delay:"2 jours ouvrés",
    features:["Documents de propriété contrôlés","Photos certifiées sur place","Badge 🟡 sur votre annonce","Rapport écrit remis"],
  },
  checked: {
    level:"checked", icon:"🔵", color:"#1d4ed8", bg:"#eff6ff", border:"#bfdbfe",
    label:"Vendeur identifié",
    pitch:"Identité vérifiée par nos équipes",
    defaultPrice: 25000, delay:"3 jours ouvrés",
    recommended: true,
    features:["Tout le niveau Partielle","Vérification d'identité (CNI / NINEA)","Numéro de téléphone vérifié","Badge 🔵 Vendeur de confiance","Priorité dans les résultats"],
  },
  inspected: {
    level:"inspected", icon:"✅", color:"#15803d", bg:"#f0fdf4", border:"#86efac",
    label:"Inspection sur place",
    pitch:"Agent SeneGalsen visite votre bien",
    defaultPrice: 75000, delay:"5 jours ouvrés",
    features:["Tout le niveau Vendeur identifié","Visite physique par un agent","Rapport d'inspection complet","Photos certifiées par l'agent","Badge ✅ Inspecté sur place","Mise en avant Premium 30j offerte"],
  }
};

const VR_STATUS_MAP = {
  pending:         { label:"En attente",      icon:"⏳", cls:"vr-status-pending" },
  payment_pending: { label:"Paiement requis", icon:"💳", cls:"vr-status-payment_pending" },
  paid:            { label:"Payé — en file",  icon:"✅", cls:"vr-status-paid" },
  in_review:       { label:"En cours",        icon:"🔍", cls:"vr-status-in_review" },
  approved:        { label:"Approuvé ✅",      icon:"🏅", cls:"vr-status-approved" },
  rejected:        { label:"Refusé",          icon:"❌", cls:"vr-status-rejected" },
  cancelled:       { label:"Annulé",          icon:"–",  cls:"vr-status-pending" },
};

// ─── Modal de demande de vérification ───────────────────
function VerifRequestModal({listing, user, profile, onClose, showToast}) {
  const [step, setStep] = React.useState("choose"); // choose | payment | confirm | done
  const [selected, setSelected] = React.useState(null); // "partial" | "checked" | "inspected"
  const [payMethod, setPayMethod] = React.useState("wave");
  const [phone, setPhone] = React.useState(profile?.phone || "");
  const [notes, setNotes] = React.useState("");
  const [availTime, setAvailTime] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [pricing, setPricing] = React.useState({});

  // Charger les prix depuis la DB
  React.useEffect(()=>{
    sb.from("verification_pricing").select("*").then(({data})=>{
      if(data){
        const map = {};
        data.forEach(p => map[p.level] = p);
        setPricing(map);
      }
    });
  },[]);

  const tier = selected ? VERIF_TIERS[selected] : null;
  const price = selected ? (pricing[selected]?.price_xof ?? tier?.defaultPrice ?? 0) : 0;

  // Vérifier si une demande est déjà en cours
  const [existingReq, setExistingReq] = React.useState(null);
  React.useEffect(()=>{
    if(!user||!listing) return;
    sb.from("verification_requests")
      .select("*")
      .eq("listing_id", listing.id)
      .neq("status","cancelled")
      .neq("status","rejected")
      .order("created_at",{ascending:false})
      .limit(1)
      .then(({data})=>{
        if(data&&data.length>0) setExistingReq(data[0]);
      });
  },[listing?.id]);

  async function submitRequest(){
    if(!selected||!phone.trim()){
      showToast("Sélectionnez un niveau et renseignez votre téléphone","err");
      return;
    }
    setSaving(true);
    try{
      const {data,error} = await sb.from("verification_requests").insert({
        listing_id: listing.id,
        requester_id: user.id,
        level: selected,
        status: "payment_pending",
        price_paid_xof: price,
        payment_method: payMethod,
        contact_phone: phone,
        contact_time: availTime,
        requester_notes: notes,
      }).select().single();

      if(error) throw error;
      setStep("done");
      showToast("🎉 Demande envoyée ! Procédez au paiement.");
    }catch(e){
      showToast("❌ "+e.message,"err");
    }finally{
      setSaving(false);
    }
  }

  const PAY_METHODS = [
    { k:"wave",         icon:"🌊", label:"Wave",              color:"#0ea5e9" },
    { k:"orange_money", icon:"🟠", label:"Orange Money",      color:"#f97316" },
    { k:"free_money",   icon:"🟣", label:"Free Money",        color:"#7c3aed" },
    { k:"bank",         icon:"🏦", label:"Virement bancaire", color:"#64748b" },
  ];

  // ─── Contenu si déjà une demande en cours ───
  if(existingReq && step==="choose"){
    const st = VR_STATUS_MAP[existingReq.status] || VR_STATUS_MAP.pending;
    const tr = VERIF_TIERS[existingReq.level];
    return(
      <div className="modal-ov" onClick={onClose}>
        <div className="modal-bx" style={{maxWidth:480}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:16}}>🔍 Suivi de vérification</div>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)"}}>×</button>
          </div>
          <div style={{background:tr?.bg||"#f8fafc",borderRadius:10,padding:"14px 16px",marginBottom:16,border:`1.5px solid ${tr?.border||"var(--br)"}`}}>
            <div style={{fontWeight:800,fontSize:14,color:tr?.color,marginBottom:2}}>{tr?.icon} {tr?.label}</div>
            <div style={{fontSize:11,color:"#374151"}}>Annonce : {listing?.title}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,background:"#f8fafc",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
            <span style={{fontSize:24}}>{st.icon}</span>
            <div>
              <div style={{fontWeight:700,fontSize:13}}>{st.label}</div>
              <div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>
                Demande #{existingReq.id.slice(0,8).toUpperCase()} · Créée le {new Date(existingReq.created_at).toLocaleDateString("fr-SN")}
              </div>
            </div>
            <span style={{marginLeft:"auto",fontSize:9,fontWeight:700,padding:"3px 9px",borderRadius:100}} className={st.cls}>{st.label}</span>
          </div>

          {existingReq.status === "payment_pending" && (
            <div style={{background:"#fff3cd",border:"1.5px solid #ffc107",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:12,color:"#856404",marginBottom:6}}>💳 Paiement en attente</div>
              <div style={{fontSize:11,color:"#856404",marginBottom:10}}>
                Envoyez {(existingReq.price_paid_xof||0).toLocaleString("fr")} FCFA par {existingReq.payment_method?.toUpperCase()} et communiquez la référence à notre équipe.
              </div>
              <div style={{fontSize:10,color:"var(--mu)"}}>
                📞 Support SeneGalsen : <strong>+221 77 000 00 00</strong><br/>
                📧 verif@senegalsen.sn
              </div>
            </div>
          )}

          {/* Timeline */}
          <div className="vr-timeline">
            {[
              {s:"payment_pending",label:"Paiement"},
              {s:"paid",          label:"Paiement confirmé"},
              {s:"in_review",     label:"Traitement en cours"},
              {s:"approved",      label:"Vérification accordée"},
            ].map((step,i)=>{
              const statuses = ["payment_pending","paid","in_review","approved","rejected"];
              const curIdx = statuses.indexOf(existingReq.status);
              const stepIdx = statuses.indexOf(step.s);
              const done = curIdx > stepIdx;
              const active = curIdx === stepIdx;
              return(
                <div key={i} className="vr-step">
                  <div className="vr-step-left">
                    <div className="vr-step-dot" style={{background:done?"#0a5c36":active?"#fef3c7":"#f1f5f9",border:`2px solid ${done?"#0a5c36":active?"#f59e0b":"#e2e8f0"}`,color:done?"#fff":active?"#92400e":"#94a3b8"}}>
                      {done?"✓":i+1}
                    </div>
                    {i<3&&<div className="vr-step-line"/>}
                  </div>
                  <div className="vr-step-body">
                    <div style={{fontSize:11,fontWeight:done||active?700:400,color:done?"#15803d":active?"#92400e":"#94a3b8",paddingTop:1}}>{step.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <button className="fbt2 fbg" style={{width:"100%",marginTop:16}} onClick={onClose}>Fermer</button>
        </div>
      </div>
    );
  }

  // ─── ÉTAPE 1 : Choisir le niveau ────────────────────────
  if(step==="choose") return(
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:560,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
          <div>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:17,marginBottom:2}}>🔍 Demander une vérification</div>
            <div style={{fontSize:11,color:"var(--mu)"}}>Choisissez le niveau qui correspond à vos besoins</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)",marginLeft:12}}>×</button>
        </div>

        {/* Annonce concernée */}
        <div style={{display:"flex",gap:10,alignItems:"center",background:"var(--bg)",borderRadius:9,padding:"9px 13px",margin:"12px 0",border:"1px solid var(--br)"}}>
          {listing?.cover_image&&<img src={listing.cover_image} alt="" style={{width:46,height:38,borderRadius:6,objectFit:"cover",flexShrink:0}}/>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{listing?.title}</div>
            <div style={{fontSize:10,color:"var(--mu)"}}>📍 {listing?.quartier}, {listing?.city}</div>
          </div>
          <TrustPill listing={listing||{}}/>
        </div>

        {/* 3 cartes d'offres */}
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          {Object.values(VERIF_TIERS).map(t=>{
            const p = pricing[t.level]?.price_xof ?? t.defaultPrice;
            const delay = pricing[t.level]?.delay_days ?? 3;
            const isSelected = selected === t.level;
            return(
              <div
                key={t.level}
                className={`verif-offer-card${isSelected?" selected":""}${t.recommended?" recommended":""}`}
                onClick={()=>setSelected(t.level)}
                style={{borderColor: isSelected ? t.color : undefined}}
              >
                <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                  {/* Sélecteur radio */}
                  <div style={{width:20,height:20,borderRadius:50,border:`2px solid ${isSelected?t.color:"#d1d5db"}`,background:isSelected?t.color:"transparent",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",transition:".15s"}}>
                    {isSelected&&<div style={{width:8,height:8,borderRadius:50,background:"#fff"}}/>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                      <span style={{fontSize:18}}>{t.icon}</span>
                      <span style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:14,color:t.color}}>{t.label}</span>
                    </div>
                    <div style={{fontSize:11,color:"#475569",marginBottom:8}}>{t.pitch}</div>
                    {/* Features */}
                    <div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:8}}>
                      {t.features.slice(0,3).map(f=>(
                        <div key={f} style={{display:"flex",gap:5,alignItems:"center",fontSize:10,color:"#475569"}}>
                          <span style={{color:t.color,fontSize:10,fontWeight:700}}>✓</span>{f}
                        </div>
                      ))}
                      {t.features.length>3&&<div style={{fontSize:10,color:"var(--mu)"}}>+ {t.features.length-3} autres avantages</div>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,color:t.color}}>
                        {p.toLocaleString("fr")} <span style={{fontSize:11,fontWeight:600}}>FCFA</span>
                      </div>
                      <div style={{fontSize:10,color:"var(--mu)",fontWeight:600}}>⏱ {delay} j. ouvrés</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Garantie */}
        <div style={{background:"#f0fdf4",borderRadius:8,padding:"9px 12px",marginBottom:14,fontSize:10,color:"#065f46",display:"flex",gap:7,alignItems:"center"}}>
          <span style={{fontSize:16}}>🛡️</span>
          <span>Si SeneGalsen ne peut pas traiter votre demande dans les délais, vous êtes <strong>remboursé intégralement</strong>.</span>
        </div>

        <button
          className="fbt2 fbg"
          style={{width:"100%",opacity:selected?1:.5}}
          onClick={()=>{if(selected)setStep("payment");}}
          disabled={!selected}
        >
          Continuer → Procéder au paiement
        </button>
      </div>
    </div>
  );

  // ─── ÉTAPE 2 : Paiement ─────────────────────────────────
  if(step==="payment") return(
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:480,maxHeight:"92vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <button onClick={()=>setStep("choose")} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"var(--mu)"}}>←</button>
          <div style={{flex:1}}>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:16}}>💳 Paiement</div>
            <div style={{fontSize:10,color:"var(--mu)"}}>{tier?.icon} {tier?.label}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)"}}>×</button>
        </div>

        {/* Récap montant */}
        <div style={{background:`${tier?.bg}`,border:`1.5px solid ${tier?.border}`,borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:11,color:tier?.color,fontWeight:600,marginBottom:2}}>Montant total</div>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:24,color:tier?.color}}>
              {price.toLocaleString("fr")} <span style={{fontSize:13,fontWeight:600}}>FCFA</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:"var(--mu)"}}>Traitement</div>
            <div style={{fontWeight:700,fontSize:12}}>{tier?.delay}</div>
          </div>
        </div>

        {/* Méthodes de paiement */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,marginBottom:8}}>Mode de paiement</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {PAY_METHODS.map(m=>(
              <button
                key={m.k}
                className={`pay-method-btn${payMethod===m.k?" active":""}`}
                onClick={()=>setPayMethod(m.k)}
              >
                <span style={{fontSize:18}}>{m.icon}</span>
                <span style={{color:payMethod===m.k?m.color:"inherit"}}>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Infos de contact */}
        <div className="fg" style={{marginBottom:10}}>
          <label className="fl">Téléphone de contact *</label>
          <input className="fi" type="tel" value={phone} onChange={e=>setPhone(e.target.value)}
            placeholder="+221 77 000 00 00"/>
        </div>
        {tier?.level==="inspected"&&(
          <div className="fg" style={{marginBottom:10}}>
            <label className="fl">Disponibilités pour la visite</label>
            <input className="fi" value={availTime} onChange={e=>setAvailTime(e.target.value)}
              placeholder="Ex : Lun-Ven 9h-17h, ou samedi matin"/>
          </div>
        )}
        <div className="fg" style={{marginBottom:14}}>
          <label className="fl">Notes pour l'agent (optionnel)</label>
          <textarea className="fi" rows={2} value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="Informations utiles pour l'agent vérificateur..."/>
        </div>

        {/* Instruction paiement */}
        <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:11,color:"#92400e"}}>
          <div style={{fontWeight:700,marginBottom:4}}>📋 Comment ça marche</div>
          <div style={{lineHeight:1.7}}>
            1. Cliquez "Confirmer la demande" ci-dessous<br/>
            2. Envoyez le paiement de <strong>{price.toLocaleString("fr")} FCFA</strong> par <strong>{payMethod.replace("_"," ").toUpperCase()}</strong><br/>
            3. Notre équipe confirme la réception et lance le traitement<br/>
            4. Vous recevez votre badge dans les délais indiqués
          </div>
        </div>

        <button
          className="fbt2 fbg"
          style={{width:"100%"}}
          onClick={submitRequest}
          disabled={saving||!phone.trim()}
        >
          {saving?"Enregistrement…":"✅ Confirmer la demande"}
        </button>
      </div>
    </div>
  );

  // ─── ÉTAPE 3 : Confirmation ──────────────────────────────
  return(
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:420,textAlign:"center",padding:"36px 24px"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:56,marginBottom:12}}>{tier?.icon}</div>
        <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:18,marginBottom:8,color:tier?.color}}>
          Demande envoyée !
        </div>
        <div style={{fontSize:13,color:"#374151",marginBottom:18,lineHeight:1.7}}>
          Votre demande de <strong>{tier?.label}</strong> a été enregistrée.<br/>
          Procédez au paiement de <strong>{price.toLocaleString("fr")} FCFA</strong> pour démarrer le traitement.
        </div>
        <div style={{background:"var(--bg)",borderRadius:10,padding:"12px 16px",marginBottom:18,textAlign:"left",fontSize:11,color:"var(--mu)"}}>
          <div style={{fontWeight:700,color:"var(--tx)",marginBottom:6}}>Paiement à envoyer :</div>
          <div>📞 SeneGalsen : <strong>+221 77 000 00 00</strong></div>
          <div>📧 verif@senegalsen.sn</div>
          <div style={{marginTop:4}}>Référence : <strong>{listing?.title?.slice(0,15).toUpperCase()}</strong></div>
        </div>
        <button className="fbt2 fbg" style={{width:"100%"}} onClick={onClose}>Compris, je vais payer</button>
      </div>
    </div>
  );
}

// ─── Mini-badge niveau vérification pour cards / tables ─
function VLevelBadge({level, size="sm"}) {
  const map = {
    none:      {icon:"⚪", label:"Non vérifié",      cls:"vbadge-none"},
    partial:   {icon:"🟡", label:"Docs vérifiés",    cls:"vbadge-partial"},
    checked:   {icon:"🔵", label:"ID vérifiée",      cls:"vbadge-checked"},
    inspected: {icon:"✅", label:"Inspecté",          cls:"vbadge-inspected"},
  };
  const v = map[level] || map.none;
  return <span className={`vbadge-pill ${v.cls}`}>{v.icon} {size!=="xs"&&v.label}</span>;
}

// ─── Onglet admin : gestion des demandes de vérification ─
function VerifRequestsAdminTab({showDT, adminProfile}) {
  const [requests, setRequests] = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [filter, setFilter]     = React.useState("all");
  const [agentNote, setAgentNote] = React.useState({});
  const [rejNote, setRejNote]   = React.useState({});
  const [showNoteFor, setShowNoteFor] = React.useState(null);
  const [showPricingEditor, setShowPricingEditor] = React.useState(false);
  const [pricing, setPricing]   = React.useState([]);

  React.useEffect(()=>{ loadAll(); },[]);

  async function loadAll(){
    setLoading(true);
    const [reqRes, priceRes] = await Promise.all([
      sb.from("verification_requests")
        .select("*,listings(title,cover_image,quartier,city,price),profiles!requester_id(full_name,phone,role)")
        .order("created_at",{ascending:false})
        .limit(100),
      sb.from("verification_pricing").select("*").order("price_xof"),
    ]);
    setRequests(reqRes.data || []);
    setPricing(priceRes.data || []);
    setLoading(false);
  }

  async function updateStatus(id, status, extra={}){
    const upd = {status, processed_at: ["approved","rejected"].includes(status)?new Date().toISOString():null, ...extra};
    await sb.from("verification_requests").update(upd).eq("id",id);
    setRequests(rs=>rs.map(r=>r.id===id?{...r,...upd}:r));
    showDT(status==="approved"?"🏅 Vérification approuvée !":status==="rejected"?"Demande refusée":status==="in_review"?"🔍 Traitement lancé":"Statut mis à jour");
    setShowNoteFor(null);
  }

  async function savePricing(level, newPrice, newDelay, role="particulier"){
    await sb.from("verification_pricing").update({price_xof:parseInt(newPrice), delay_days:parseInt(newDelay)}).eq("level",level).eq("role",role);
    setPricing(ps=>ps.map(p=>(p.level===level&&p.role===role)?{...p,price_xof:parseInt(newPrice),delay_days:parseInt(newDelay)}:p));
    showDT("✅ Tarif mis à jour");
  }

  const filtered = filter==="all"?requests:requests.filter(r=>r.status===filter);
  const stats = {
    total: requests.length,
    pending: requests.filter(r=>["pending","payment_pending"].includes(r.status)).length,
    in_review: requests.filter(r=>r.status==="in_review"||r.status==="paid").length,
    done: requests.filter(r=>r.status==="approved").length,
    revenue: requests.filter(r=>["paid","in_review","approved"].includes(r.status)).reduce((s,r)=>s+(r.price_paid_xof||0),0),
  };

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div className="dtit2" style={{marginBottom:0}}>🔍 Demandes de vérification</div>
        <button
          onClick={()=>setShowPricingEditor(v=>!v)}
          style={{fontSize:11,padding:"6px 12px",borderRadius:8,border:"1.5px solid var(--g)",background:showPricingEditor?"var(--g)":"transparent",color:showPricingEditor?"#fff":"var(--g)",cursor:"pointer",fontWeight:700}}
        >
          ⚙️ {showPricingEditor?"Fermer":"Gérer les tarifs"}
        </button>
      </div>

      {/* Éditeur de tarifs */}
{showPricingEditor&&(
        <div style={{background:"#fff",border:"1.5px solid var(--g)",borderRadius:12,padding:16,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:12}}>💰 Configuration des tarifs de vérification</div>
          <PricingEditorGrid pricing={pricing} onSave={savePricing}/>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:14}}>
        {[
          ["📥","En attente",stats.pending,"#b45309","#fffbeb"],
          ["🔍","En cours",stats.in_review,"#5b21b6","#f5f3ff"],
          ["✅","Approuvées",stats.done,"#15803d","#f0fdf4"],
          ["💰","Revenus",stats.revenue.toLocaleString("fr")+" F","#0a5c36","#ecfdf5"],
        ].map(([ico,label,val,c,bg])=>(
          <div key={label} style={{background:bg,borderRadius:10,padding:"10px 12px",border:`1px solid ${c}22`}}>
            <div style={{fontSize:16}}>{ico}</div>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:15,color:c}}>{val}</div>
            <div style={{fontSize:10,color:c,fontWeight:600}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filtres statut */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
        {[["all","Toutes"],["payment_pending","À payer"],["paid","Payées"],["in_review","En cours"],["approved","Approuvées"],["rejected","Refusées"]].map(([v,l])=>(
          <button key={v} className={`fbt${filter===v?" on":""}`} onClick={()=>setFilter(v)} style={{fontSize:10}}>{l}{v!=="all"&&` (${requests.filter(r=>r.status===v).length})`}</button>
        ))}
      </div>

      {loading?<div className="ldr"><div className="spin"/></div>:
      filtered.length===0?<div className="empty-state"><div style={{fontSize:36}}>🔍</div><div style={{fontWeight:700}}>Aucune demande</div></div>:
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(r=>{
          const t = VERIF_TIERS[r.level] || {};
          const st = VR_STATUS_MAP[r.status] || VR_STATUS_MAP.pending;
          return(
            <div key={r.id} style={{background:"#fff",border:"1px solid var(--br)",borderRadius:12,padding:"12px 14px",boxShadow:"var(--sh)"}}>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-start"}}>
                {/* Image annonce */}
                {r.listings?.cover_image&&<img src={r.listings.cover_image} alt="" style={{width:56,height:44,borderRadius:7,objectFit:"cover",flexShrink:0}}/>}

                {/* Infos principales */}
                <div style={{flex:1,minWidth:160}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:3}}>
                    <span className={`vbadge-pill vbadge-${r.level}`}>{t.icon} {t.label}</span>
                    <span style={{fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:100}} className={st.cls}>{st.icon} {st.label}</span>
                  </div>
                  <div style={{fontWeight:700,fontSize:12}}>{r.listings?.title}</div>
                  <div style={{fontSize:10,color:"var(--mu)"}}>📍 {r.listings?.quartier}, {r.listings?.city}</div>
                  <div style={{fontSize:10,color:"var(--mu)",marginTop:2}}>
                    👤 {r.profiles?.full_name||"—"} · {r.profiles?.role} · 📞 {r.contact_phone||r.profiles?.phone||"—"}
                  </div>
                </div>

                {/* Paiement */}
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:14,color:"var(--g)"}}>
                    {(r.price_paid_xof||0).toLocaleString("fr")} <span style={{fontSize:10}}>FCFA</span>
                  </div>
                  <div style={{fontSize:9,color:"var(--mu)"}}>{r.payment_method?.replace("_"," ").toUpperCase()}</div>
                  <div style={{fontSize:9,color:"var(--mu)"}}>{new Date(r.created_at).toLocaleDateString("fr-SN")}</div>
                </div>
              </div>

              {r.requester_notes&&(
                <div style={{marginTop:8,fontSize:10,color:"var(--mu)",fontStyle:"italic",borderTop:"1px solid var(--br)",paddingTop:6}}>
                  📝 "{r.requester_notes}"
                </div>
              )}

              {/* Actions admin */}
              {showNoteFor===r.id&&(
                <div style={{marginTop:8,padding:"10px",background:"var(--bg)",borderRadius:8}}>
                  <textarea className="fi" rows={2} placeholder="Note admin / motif de refus..."
                    value={rejNote[r.id]||""}
                    onChange={e=>setRejNote(n=>({...n,[r.id]:e.target.value}))}
                    style={{marginBottom:6}}/>
                  <div style={{display:"flex",gap:6}}>
                    <button className="ab abe" onClick={()=>updateStatus(r.id,"rejected",{rejection_reason:rejNote[r.id],admin_notes:rejNote[r.id]})}>❌ Confirmer le refus</button>
                    <button className="ab" onClick={()=>setShowNoteFor(null)}>Annuler</button>
                  </div>
                </div>
              )}
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8,borderTop:"1px solid var(--br)",paddingTop:8}}>
                {r.status==="payment_pending"&&<button className="ab abe" onClick={()=>updateStatus(r.id,"paid",{payment_confirmed:true,payment_date:new Date().toISOString()})}>✅ Confirmer paiement</button>}
                {(r.status==="paid")&&<button className="ab" style={{background:"#f5f3ff",color:"#5b21b6",border:"1.5px solid #c4b5fd"}} onClick={()=>updateStatus(r.id,"in_review",{assigned_agent_id:adminProfile?.id})}>🔍 Lancer traitement</button>}
                {r.status==="in_review"&&<button className="ab abe" style={{background:"#f0fdf4",color:"#15803d",border:"1.5px solid #86efac"}} onClick={()=>updateStatus(r.id,"approved",{admin_notes:"Vérification accordée par "+adminProfile?.full_name})}>🏅 Approuver</button>}
                {!["approved","rejected","cancelled"].includes(r.status)&&<button className="ab abd" onClick={()=>setShowNoteFor(r.id)}>❌ Refuser</button>}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

// ─── PricingEditorGrid : grille niveau × rôle ────────────
const VERIF_ROLES_CONFIG = [
  { k:"particulier", label:"Particulier", ico:"👤", color:"#64748b" },
  { k:"agent",       label:"Agent",       ico:"🏠", color:"#0891b2" },
  { k:"agence",      label:"Agence",      ico:"🏢", color:"#0a5c36" },
  { k:"promoteur",   label:"Promoteur",   ico:"🏗️", color:"#1e3a5f" },
];
const VERIF_LEVELS_ORDER = ["partial","checked","inspected"];

function PricingEditorGrid({ pricing, onSave }) {
  // État local : { "partial_agent": {price, delay}, ... }
  const [vals, setVals] = React.useState({});
  const [saving, setSaving] = React.useState({});

  React.useEffect(()=>{
    const init = {};
    pricing.forEach(p=>{ init[p.level+"_"+p.role] = { price: p.price_xof, delay: p.delay_days }; });
    setVals(init);
  },[pricing]);

  function setVal(level, role, field, v) {
    setVals(prev=>({...prev, [level+"_"+role]: {...(prev[level+"_"+role]||{}), [field]: v }}));
  }

  async function handleSave(level, role) {
    const key = level+"_"+role;
    const v = vals[key]; if(!v) return;
    setSaving(s=>({...s,[key]:true}));
    await onSave(level, v.price, v.delay, role);
    setSaving(s=>({...s,[key]:false}));
  }

  const tiers = VERIF_LEVELS_ORDER.map(lv=>VERIF_TIERS[lv]).filter(Boolean);

  return (
    <div style={{overflowX:"auto"}}>
      {/* En-tête des rôles */}
      <div style={{display:"grid", gridTemplateColumns:"180px repeat(4,1fr)", gap:8, minWidth:680}}>
        <div/>
        {VERIF_ROLES_CONFIG.map(r=>(
          <div key={r.k} style={{textAlign:"center",padding:"8px 4px",background:r.color+"18",borderRadius:8,border:`1.5px solid ${r.color}33`}}>
            <div style={{fontSize:18}}>{r.ico}</div>
            <div style={{fontWeight:800,fontSize:11,color:r.color}}>{r.label}</div>
          </div>
        ))}

        {/* Lignes par niveau */}
        {tiers.map(tier=>(
          <React.Fragment key={tier.level}>
            {/* Label du niveau */}
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"10px 0"}}>
              <span className={`vbadge-pill vbadge-${tier.level}`}>{tier.icon} {tier.label}</span>
            </div>
            {/* Cellule par rôle */}
            {VERIF_ROLES_CONFIG.map(r=>{
              const key = tier.level+"_"+r.k;
              const v = vals[key] || {};
              const orig = pricing.find(p=>p.level===tier.level&&p.role===r.k);
              const dirty = orig && (parseInt(v.price)!==orig.price_xof || parseInt(v.delay)!==orig.delay_days);
              return (
                <div key={r.k} style={{background:"var(--bg)",borderRadius:9,padding:"8px 10px",border:`1.5px solid ${dirty?"#f59e0b":"var(--br)"}`}}>
                  <div style={{display:"flex",gap:5,marginBottom:6}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:8,fontWeight:700,color:"var(--mu)",marginBottom:2}}>PRIX (FCFA)</div>
                      <input
                        className="fi" type="number"
                        style={{padding:"3px 6px",fontSize:11,width:"100%"}}
                        value={v.price??""} onChange={e=>setVal(tier.level,r.k,"price",e.target.value)}
                      />
                    </div>
                    <div style={{flex:"0 0 48px"}}>
                      <div style={{fontSize:8,fontWeight:700,color:"var(--mu)",marginBottom:2}}>DÉLAI (j)</div>
                      <input
                        className="fi" type="number"
                        style={{padding:"3px 6px",fontSize:11,width:"100%"}}
                        value={v.delay??""} onChange={e=>setVal(tier.level,r.k,"delay",e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    onClick={()=>handleSave(tier.level,r.k)}
                    disabled={saving[key]||!dirty}
                    style={{
                      width:"100%", padding:"4px 0", borderRadius:6, fontSize:10, fontWeight:800,
                      border:"none", cursor:dirty?"pointer":"default",
                      background:dirty?"var(--g)":"var(--br)",
                      color:dirty?"#fff":"var(--mu)", transition:".15s",
                    }}
                  >{saving[key]?"…":"💾 Sauver"}</button>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Légende */}
      <div style={{marginTop:10,fontSize:9,color:"var(--mu)",fontStyle:"italic"}}>
        🟡 Cadre orange = modification non sauvegardée · Cliquez "💾 Sauver" pour chaque cellule modifiée.
      </div>
    </div>
  );
}

// Ancien composant conservé pour compatibilité (non utilisé)
function PricingEditor({tier, pricing, onSave}){
  return null;
}


// ══════════════════════════════════════════════════════════
// MODAL RAPPORT AGENT VÉRIFICATEUR SENEGALSEN
// ══════════════════════════════════════════════════════════
function AgentVerifyReportModal({listing, agentName, onConfirm, onClose}){
  const [desc, setDesc] = useState("");
  const [name, setName] = useState(agentName||"");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(){
    setSaving(true);
    await onConfirm(desc, name);
    setSaving(false);
  }

  return(
    <div className="modal-ov" onClick={onClose}>
      <div className="modal-bx" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
        {/* En-tête */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <div style={{fontFamily:"var(--fd)",fontWeight:800,fontSize:17,marginBottom:4}}>
              🏅 Rapport de vérification terrain
            </div>
            <div style={{fontSize:12,color:"var(--mu)"}}>
              Ce rapport sera affiché publiquement sur la fiche annonce, distingué de la description du propriétaire.
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"var(--mu)",lineHeight:1,marginLeft:12}}>×</button>
        </div>

        {/* Annonce concernée */}
        {listing&&(
          <div style={{display:"flex",gap:10,alignItems:"center",background:"var(--bg)",borderRadius:9,padding:"10px 13px",marginBottom:16,border:"1px solid var(--br)"}}>
            {listing.cover_image&&<img src={listing.cover_image} alt="" style={{width:52,height:42,borderRadius:6,objectFit:"cover",flexShrink:0}}/>}
            <div>
              <div style={{fontWeight:700,fontSize:12}}>{listing.title}</div>
              <div style={{fontSize:10,color:"var(--mu)"}}>📍 {listing.quartier}, {listing.city}</div>
            </div>
          </div>
        )}

        {/* Nom de l'agent */}
        <div className="fg" style={{marginBottom:12}}>
          <label className="fl">Nom de l'agent vérificateur *</label>
          <input
            className="fi"
            value={name}
            onChange={e=>setName(e.target.value)}
            placeholder="Ex : Mamadou Diop — Agent SeneGalsen Dakar"
          />
        </div>

        {/* Rapport */}
        <div className="fg" style={{marginBottom:16}}>
          <label className="fl">
            Rapport de vérification
            <span style={{fontWeight:400,color:"var(--mu)",marginLeft:6}}>(visible sur la fiche publique)</span>
          </label>
          <textarea
            className="fi"
            rows={6}
            value={desc}
            onChange={e=>setDesc(e.target.value)}
            placeholder={"Décrivez votre constat après visite sur place :\n• État général du bien et du bâtiment\n• Conformité avec l'annonce (surface, équipements…)\n• Environnement et accessibilité\n• Points forts et remarques éventuelles\n• Recommandation globale"}
            style={{resize:"vertical",fontSize:12,lineHeight:1.7}}
          />
          <div style={{fontSize:10,color:"var(--mu)",marginTop:4}}>
            💡 Ce texte remplace la notice vide « Ce bien n'a pas encore été inspecté ». Soyez précis et objectif.
          </div>
        </div>

        {/* Alerte visible */}
        <div style={{background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#1e40af"}}>
          ℹ️ En validant, le bien recevra le badge <strong>🏅 Vérifié sur place</strong> et un score de confiance de <strong>100 / 100</strong>. Cette action est visible publiquement.
        </div>

        {/* Actions */}
        <div style={{display:"flex",gap:10}}>
          <button
            className="fbt2 fbg"
            style={{flex:1}}
            onClick={handleSubmit}
            disabled={saving||!name.trim()}
          >
            {saving?"Enregistrement…":"🏅 Valider et publier le rapport"}
          </button>
          <button className="fbt2 fbo" onClick={onClose} style={{flexShrink:0}}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function PhysicalBadge({lg=false}){
  return null; // remplacé par VerificationPanel
}
function StarPicker({ value, onChange }) {
  const [hover, setHover] = useState(0);
  const labels = ["", "Mauvais", "Passable", "Bien", "Tr\xE8s bien", "Excellent"];
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "star-picker" }, [1, 2, 3, 4, 5].map((i) => /* @__PURE__ */ React.createElement(
    "span",
    {
      key: i,
      className: i <= (hover || value) ? "on" : "",
      onMouseEnter: () => setHover(i),
      onMouseLeave: () => setHover(0),
      onClick: () => onChange(i),
      style: { opacity: i <= (hover || value) ? 1 : 0.35 }
    },
    "\u2605"
  ))), (hover || value) > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--g)", marginTop: -4 } }, labels[hover || value]));
}
function ReviewForm({ targetId, targetType, user, onSuccess, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  async function submit() {
    if (rating === 0) {
      setErr("Veuillez choisir une note.");
      return;
    }
    setLoading(true);
    setErr("");
    const payload = {
      reviewer_id: user.id,
      rating,
      comment: comment.trim() || null,
      ...targetType === "agency" ? { agency_id: targetId } : { agent_id: targetId }
    };
    const { error } = await sb.from("reviews").insert(payload);
    if (error) {
      if (error.code === "23505") {
        setErr("Vous avez d\xE9j\xE0 laiss\xE9 un avis.");
      } else {
        setErr("Erreur : " + error.message);
      }
      setLoading(false);
      return;
    }
    setDone(true);
    setLoading(false);
    setTimeout(() => {
      onSuccess && onSuccess({ ...payload, id: Date.now(), created_at: (/* @__PURE__ */ new Date()).toISOString() });
      onClose && onClose();
    }, 1200);
  }
  if (done) return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { maxWidth: 360, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 56, marginBottom: 10 } }, "\u{1F389}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 18, marginBottom: 6 } }, "Merci pour votre avis !"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--mu)" } }, "Il sera visible par tous les utilisateurs.")));
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { maxWidth: 420 } }, /* @__PURE__ */ React.createElement("div", { className: "mhd" }, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u2B50 Laisser un avis"), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "mbd" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 4 } }, "Votre note"), /* @__PURE__ */ React.createElement(StarPicker, { value: rating, onChange: setRating }), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginTop: 14, marginBottom: 6 } }, "Commentaire ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 400 } }, "(optionnel)")), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      className: "fi",
      style: { height: 90, resize: "vertical" },
      placeholder: "D\xE9crivez votre exp\xE9rience : r\xE9activit\xE9, professionnalisme, connaissance du march\xE9...",
      value: comment,
      onChange: (e) => setComment(e.target.value),
      maxLength: 500
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", textAlign: "right", marginTop: 3 } }, comment.length, "/500"), err && /* @__PURE__ */ React.createElement("div", { className: "al ale", style: { marginTop: 10 } }, err), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 14 }, onClick: submit, disabled: loading || rating === 0 }, loading ? "\u23F3 Envoi..." : "\u2705 Publier mon avis"))));
}
function ReviewsBlock({ reviews = [], targetId, targetType, user, showToast: showToast2 }) {
  const [showForm, setShowForm] = useState(false);
  const [list, setList] = useState(reviews || []);
  const [loading, setLoading] = useState(!(reviews && reviews.length > 0));
  useEffect(() => {
    if (!targetId) return;
    const col = targetType === "agency" ? "agency_id" : "agent_id";
    sb.from("reviews").select("*").eq(col, targetId).order("created_at", { ascending: false }).then(({ data }) => {
      setList(data || []);
      setLoading(false);
    });
  }, [targetId, targetType]);
  const n = list.length;
  const avg = n > 0 ? list.reduce((s, r) => s + r.rating, 0) / n : 0;
  const dist = [5, 4, 3, 2, 1].map((s) => ({ s, c: list.filter((r) => r.rating === s).length }));
  const alreadyReviewed = user && list.some((r) => r.reviewer_id === user.id);
  function handleSuccess(newReview) {
    setList((l) => [newReview, ...l]);
    showToast2 && showToast2("\u2B50 Avis publi\xE9 !");
  }
  return /* @__PURE__ */ React.createElement(React.Fragment, null, showForm && user && /* @__PURE__ */ React.createElement(ReviewForm, { targetId, targetType, user, onSuccess: handleSuccess, onClose: () => setShowForm(false) }), loading && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: 20, color: "var(--mu)", fontSize: 12 } }, "\u23F3 Chargement des avis..."), !loading && n > 0 && /* @__PURE__ */ React.createElement("div", { className: "rating-summary" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "rating-big-score" }, avg.toFixed(1)), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement(Stars, { n: Math.round(avg) })), /* @__PURE__ */ React.createElement("div", { className: "rating-big-label" }, n, " avis")), /* @__PURE__ */ React.createElement("div", null, dist.map(({ s, c }) => /* @__PURE__ */ React.createElement("div", { key: s, className: "rating-bar-row" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--mu)", width: 16, textAlign: "right", flexShrink: 0 } }, s, "\u2605"), /* @__PURE__ */ React.createElement("div", { className: "rating-bar-track" }, /* @__PURE__ */ React.createElement("div", { className: "rating-bar-fill", style: { width: n > 0 ? `${Math.round(c / n * 100)}%` : "0%" } })), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--mu)", width: 20, flexShrink: 0 } }, c))))), !loading && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 14 } }, n === 0 ? "Aucun avis pour l'instant" : `${n} avis client${n > 1 ? "s" : ""}`), user && !alreadyReviewed && /* @__PURE__ */ React.createElement("button", { className: "add-review-btn", onClick: () => setShowForm(true) }, "\u2B50 Donner un avis")), !loading && n === 0 ? /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36 } }, "\u2B50"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, marginTop: 8 } }, "Soyez le premier \xE0 laisser un avis"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 3 } }, "Partagez votre exp\xE9rience avec cette agence"), user && !alreadyReviewed && /* @__PURE__ */ React.createElement("button", { className: "add-review-btn", style: { margin: "14px auto 0" }, onClick: () => setShowForm(true) }, "\u2B50 \xC9crire un avis")) : /* @__PURE__ */ React.createElement("div", null, list.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "review-card" }, /* @__PURE__ */ React.createElement("div", { className: "review-card-header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(Stars, { n: r.rating }), /* @__PURE__ */ React.createElement("div", { className: "review-author", style: { marginTop: 4 } }, r.reviewer_name || "Utilisateur v\xE9rifi\xE9")), /* @__PURE__ */ React.createElement("div", { className: "review-date" }, ago(r.created_at))), r.comment && /* @__PURE__ */ React.createElement("p", { className: "review-comment" }, r.comment), r.reply && /* @__PURE__ */ React.createElement("div", { className: "review-reply" }, /* @__PURE__ */ React.createElement("div", { className: "review-reply-label" }, "R\xE9ponse de l'agence"), r.reply)))));
}
function AgentRatingBadge({ agentId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    sb.from("reviews").select("rating").eq("agent_id", agentId).then(({ data: d }) => {
      if (d && d.length > 0) {
        const avg = (d.reduce((s, r) => s + r.rating, 0) / d.length).toFixed(1);
        setData({ avg, n: d.length });
      }
    });
  }, [agentId]);
  if (!data) return null;
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, color: "#92400e" } }, "\u2B50 ", data.avg, " ", /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 400, color: "var(--mu)" } }, "(", data.n, ")"));
}
const MONTH_FR = ["Janvier", "F\xE9vrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Ao\xFBt", "Septembre", "Octobre", "Novembre", "D\xE9cembre"];
const DAY_FR = ["Lu", "Ma", "Me", "Je", "Ve", "Sa", "Di"];
function AvailabilityCalendar({ listingId, isOwner = false, showToast: showToast2 }) {
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ start: "", end: "", status: "occupied", label: "" });
  const [saving, setSaving] = useState(false);
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  useEffect(() => {
    sb.from("listing_availability").select("*").eq("listing_id", listingId).gte("end_date", today.toISOString().split("T")[0]).order("start_date").then(({ data }) => {
      setPeriods(data || []);
      setLoading(false);
    });
  }, [listingId]);
  const months = [];
  for (let m = 0; m < 3; m++) {
    const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  function getDayStatus(year, month, day) {
    const d = new Date(year, month, day);
    const ds = d.toISOString().split("T")[0];
    for (const p of periods) {
      if (ds >= p.start_date && ds <= p.end_date) return p.status;
    }
    return "available";
  }
  function buildMonth(year, month) {
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }
  async function addPeriod() {
    if (!addForm.start || !addForm.end) {
      showToast2 && showToast2("Dates requises", "err");
      return;
    }
    if (addForm.end < addForm.start) {
      showToast2 && showToast2("La fin doit \xEAtre apr\xE8s le d\xE9but", "err");
      return;
    }
    setSaving(true);
    const { error } = await sb.from("listing_availability").insert({
      listing_id: listingId,
      start_date: addForm.start,
      end_date: addForm.end,
      status: addForm.status,
      label: addForm.label || null
    });
    if (error) {
      showToast2 && showToast2("Erreur : " + error.message, "err");
    } else {
      const { data } = await sb.from("listing_availability").select("*").eq("listing_id", listingId).gte("end_date", today.toISOString().split("T")[0]).order("start_date");
      setPeriods(data || []);
      setShowAdd(false);
      setAddForm({ start: "", end: "", status: "occupied", label: "" });
      showToast2 && showToast2("\u2705 P\xE9riode ajout\xE9e");
    }
    setSaving(false);
  }
  async function deletePeriod(id) {
    await sb.from("listing_availability").delete().eq("id", id);
    setPeriods((p) => p.filter((x) => x.id !== id));
    showToast2 && showToast2("P\xE9riode supprim\xE9e");
  }
  const statusColors = { occupied: "#ef4444", available: "#22c55e", blocked: "#9ca3af" };
  const statusLabels = { occupied: "Occup\xE9", available: "Libre", blocked: "Bloqu\xE9" };
  if (loading) return /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: 20, color: "var(--mu)", fontSize: 12 } }, "\u23F3 Chargement du calendrier...");
  return /* @__PURE__ */ React.createElement("div", { className: "avail-calendar" }, /* @__PURE__ */ React.createElement("div", { className: "avail-cal-header" }, /* @__PURE__ */ React.createElement("div", { className: "avail-cal-title" }, "\u{1F4C5} Disponibilit\xE9"), isOwner && /* @__PURE__ */ React.createElement("button", { className: "avail-add-btn", onClick: () => setShowAdd((s) => !s) }, showAdd ? "\u2715 Annuler" : "+ Ajouter une p\xE9riode")), showAdd && isOwner && /* @__PURE__ */ React.createElement("div", { style: { background: "var(--bg)", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid var(--br)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Date de d\xE9but"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "date", value: addForm.start, min: today.toISOString().split("T")[0], onChange: (e) => setAddForm((f) => ({ ...f, start: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Date de fin"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "date", value: addForm.end, min: addForm.start || today.toISOString().split("T")[0], onChange: (e) => setAddForm((f) => ({ ...f, end: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Statut"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: addForm.status, onChange: (e) => setAddForm((f) => ({ ...f, status: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "occupied" }, "\u{1F534} Occup\xE9 / R\xE9serv\xE9"), /* @__PURE__ */ React.createElement("option", { value: "available" }, "\u{1F7E2} Libre"), /* @__PURE__ */ React.createElement("option", { value: "blocked" }, "\u26AB Bloqu\xE9"))), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "\xC9tiquette (optionnel)"), /* @__PURE__ */ React.createElement("input", { className: "fi", placeholder: "Ex: R\xE9serv\xE9, Option...", value: addForm.label, onChange: (e) => setAddForm((f) => ({ ...f, label: e.target.value })) }))), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 4 }, onClick: addPeriod, disabled: saving }, saving ? "\u23F3 Sauvegarde..." : "\u2705 Enregistrer")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 } }, months.map(({ year, month }) => {
    const cells = buildMonth(year, month);
    return /* @__PURE__ */ React.createElement("div", { key: `${year}-${month}`, className: "avail-month" }, /* @__PURE__ */ React.createElement("div", { className: "avail-month-name" }, MONTH_FR[month], " ", year), /* @__PURE__ */ React.createElement("div", { className: "avail-grid" }, DAY_FR.map((d) => /* @__PURE__ */ React.createElement("div", { key: d, className: "avail-day-name" }, d)), cells.map((day, i) => {
      if (!day) return /* @__PURE__ */ React.createElement("div", { key: `e${i}`, className: "avail-day empty" });
      const st = getDayStatus(year, month, day);
      const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      return /* @__PURE__ */ React.createElement("div", { key: day, className: `avail-day ${st}${isToday ? " today" : ""}` }, day);
    })));
  })), /* @__PURE__ */ React.createElement("div", { className: "avail-legend" }, /* @__PURE__ */ React.createElement("div", { className: "avail-legend-item" }, /* @__PURE__ */ React.createElement("div", { className: "avail-legend-dot", style: { background: "#22c55e" } }), " Disponible"), /* @__PURE__ */ React.createElement("div", { className: "avail-legend-item" }, /* @__PURE__ */ React.createElement("div", { className: "avail-legend-dot", style: { background: "#ef4444" } }), " Occup\xE9"), /* @__PURE__ */ React.createElement("div", { className: "avail-legend-item" }, /* @__PURE__ */ React.createElement("div", { className: "avail-legend-dot", style: { background: "#9ca3af" } }), " Bloqu\xE9")), periods.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "avail-period-list" }, periods.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "avail-period-item" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "avail-period-dot", style: { background: statusColors[p.status] } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, p.label || statusLabels[p.status]), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)" } }, (/* @__PURE__ */ new Date(p.start_date + "T00:00")).toLocaleDateString("fr-SN", { day: "numeric", month: "short" }), " \u2192 ", (/* @__PURE__ */ new Date(p.end_date + "T00:00")).toLocaleDateString("fr-SN", { day: "numeric", month: "short", year: "numeric" })))), isOwner && /* @__PURE__ */ React.createElement("button", { style: { background: "none", border: "none", cursor: "pointer", color: "var(--mu)", fontSize: 16, padding: "2px 6px" }, onClick: () => deletePeriod(p.id), title: "Supprimer" }, "\u2715")))));
}
function VisitRequestsPanel({ visitReqs, onUpdateStatus }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? visitReqs : visitReqs.filter((v) => v.status === filter);
  const counts = { all: visitReqs.length, pending: visitReqs.filter((v) => v.status === "pending").length, confirmed: visitReqs.filter((v) => v.status === "confirmed").length, done: visitReqs.filter((v) => v.status === "done").length };
  if (visitReqs.length === 0) return /* @__PURE__ */ React.createElement("div", { className: "empty-state" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 36, marginBottom: 8 } }, "\u{1F4E1}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, "Aucune demande de visite"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginTop: 3 } }, "Les demandes des clients diaspora appara\xEEtront ici."));
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" } }, [["all", "Toutes", counts.all], ["pending", "\u23F3 En attente", counts.pending], ["confirmed", "\u2705 Confirm\xE9es", counts.confirmed], ["done", "\u2714 Effectu\xE9es", counts.done]].map(([k, l, c]) => /* @__PURE__ */ React.createElement("button", { key: k, onClick: () => setFilter(k), className: `fbt2 ${filter === k ? "fbg" : ""}`, style: { fontSize: 10, padding: "5px 11px", display: "flex", alignItems: "center", gap: 4 } }, l, " ", c > 0 && /* @__PURE__ */ React.createElement("span", { style: { background: filter === k ? "rgba(255,255,255,.3)" : "var(--bg)", borderRadius: 50, fontSize: 9, fontWeight: 700, padding: "0px 5px", minWidth: 16, textAlign: "center" } }, c)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, filtered.map((v) => {
    const sc = { pending: { bg: "#fffbeb", bd: "#fbbf24", c: "#92400e", l: "\u23F3 En attente" }, confirmed: { bg: "#ecfdf5", bd: "#6ee7b7", c: "#065f46", l: "\u2705 Confirm\xE9e" }, declined: { bg: "#fef2f2", bd: "#fca5a5", c: "#991b1b", l: "\u274C Refus\xE9e" }, done: { bg: "#f5f3ff", bd: "#c4b5fd", c: "#4c1d95", l: "\u2714 Effectu\xE9e" } };
    const s = sc[v.status] || sc.pending;
    const requester = v.profiles || {};
    const listing = v.listings || {};
    return /* @__PURE__ */ React.createElement("div", { key: v.id, style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 13px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "flex-start" } }, listing.cover_image && /* @__PURE__ */ React.createElement("img", { src: listing.cover_image, alt: "", style: { width: 60, height: 46, borderRadius: 7, objectFit: "cover", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 6, flexWrap: "wrap", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, listing.title || "Bien inconnu"), /* @__PURE__ */ React.createElement("span", { style: { background: s.bg, border: `1px solid ${s.bd}`, color: s.c, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100, flexShrink: 0 } }, s.l)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 5 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700 } }, "\u{1F464} ", v.name || requester.full_name || "\u2014"), v.country && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--mu)" } }, "\u{1F4CD} ", v.country), v.visit_type === "video" && /* @__PURE__ */ React.createElement("span", { style: { background: "#eff6ff", color: "#1e3a5f", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4 } }, "\u{1F4F9} Vid\xE9o"), v.visit_type === "photos" && /* @__PURE__ */ React.createElement("span", { style: { background: "#f0fdf4", color: "#166534", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4 } }, "\u{1F4F8} Photos")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, fontSize: 10, color: "var(--mu)", flexWrap: "wrap" } }, v.preferred_date && /* @__PURE__ */ React.createElement("span", null, "\u{1F4C5} ", v.preferred_date), v.preferred_time && /* @__PURE__ */ React.createElement("span", null, "\u{1F550} ", v.preferred_time), v.phone && /* @__PURE__ */ React.createElement("a", { href: `tel:${v.phone}`, style: { color: "var(--g)", fontWeight: 700, textDecoration: "none" } }, "\u{1F4DE} ", v.phone), v.whatsapp && /* @__PURE__ */ React.createElement("a", { href: `https://wa.me/${v.whatsapp.replace(/\D/g, "")}`, target: "_blank", rel: "noopener noreferrer", style: { color: "#25d366", fontWeight: 700, textDecoration: "none" } }, "WhatsApp"), v.email && /* @__PURE__ */ React.createElement("a", { href: `mailto:${v.email}`, style: { color: "#2563eb", fontWeight: 700, textDecoration: "none" } }, "\u2709 ", v.email)), v.message && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 5, fontSize: 10, color: "var(--mu)", fontStyle: "italic", padding: "4px 8px", background: "var(--bg)", borderRadius: 5 } }, '"', v.message, '"')))), v.status === "pending" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, padding: "7px 13px 11px", background: "var(--bg)", borderTop: "1px solid var(--br)" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => onUpdateStatus(v.id, "confirmed"), style: { flex: 1, fontSize: 11, padding: "6px 0", background: "var(--g)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 } }, "\u2705 Confirmer la visite"), /* @__PURE__ */ React.createElement("button", { onClick: () => onUpdateStatus(v.id, "declined"), style: { fontSize: 11, padding: "6px 11px", background: "#fff", color: "#ef4444", border: "1.5px solid #fca5a5", borderRadius: 6, cursor: "pointer", fontWeight: 700 } }, "\u2717 Refuser"), /* @__PURE__ */ React.createElement("button", { onClick: () => onUpdateStatus(v.id, "done"), style: { fontSize: 11, padding: "6px 11px", background: "#f5f3ff", color: "#7c3aed", border: "1.5px solid #c4b5fd", borderRadius: 6, cursor: "pointer", fontWeight: 700 } }, "\u2714 Marquer effectu\xE9e")), v.status === "confirmed" && /* @__PURE__ */ React.createElement("div", { style: { background: "#ecfdf5", borderTop: "1.5px solid #6ee7b7", padding: "7px 13px", fontSize: 11, color: "#065f46", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" } }, "\u2705 ", /* @__PURE__ */ React.createElement("strong", null, "Visite confirm\xE9e"), " \xB7 Contactez le client :", v.whatsapp && /* @__PURE__ */ React.createElement("a", { href: `https://wa.me/${v.whatsapp.replace(/\D/g, "")}`, target: "_blank", rel: "noopener noreferrer", style: { background: "#25d366", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100, textDecoration: "none" } }, "WhatsApp"), v.phone && /* @__PURE__ */ React.createElement("a", { href: `tel:${v.phone}`, style: { background: "var(--g)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100, textDecoration: "none" } }, v.phone), /* @__PURE__ */ React.createElement("button", { onClick: () => onUpdateStatus(v.id, "done"), style: { fontSize: 10, padding: "2px 8px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 100, cursor: "pointer", fontWeight: 700, marginLeft: "auto" } }, "Marquer effectu\xE9e \u2714")));
  })));
}
const SN_BANKS = [
  { id: "bhs", name: "BHS", fullName: "Banque de l'Habitat du S\xE9n\xE9gal", rate: 8, maxYears: 25, minApport: 10, note: "Sp\xE9cialis\xE9e habitat, meilleure option" },
  { id: "sgbs", name: "SGBS", fullName: "Soci\xE9t\xE9 G\xE9n\xE9rale S\xE9n\xE9gal", rate: 9.5, maxYears: 20, minApport: 15, note: "Conditions flexibles" },
  { id: "cbao", name: "CBAO", fullName: "CBAO Groupe Attijariwafa", rate: 9, maxYears: 20, minApport: 20, note: "D\xE9lais rapides" },
  { id: "ecobank", name: "Ecobank", fullName: "Ecobank S\xE9n\xE9gal", rate: 10, maxYears: 15, minApport: 20, note: "Diaspora bienvenue" },
  { id: "bnde", name: "BNDE", fullName: "Banque Nationale pour le Dev.", rate: 8.5, maxYears: 20, minApport: 15, note: "Projets productifs" }
];
function MortgageModal({ price, onClose }) {
  const [apport, setApport] = useState(20);
  const [years, setYears] = useState(15);
  const [selectedBank, setSelectedBank] = useState("bhs");
  const bank = SN_BANKS.find((b) => b.id === selectedBank) || SN_BANKS[0];
  const montant = Math.round(price * (1 - apport / 100));
  const r = bank.rate / 100 / 12;
  const n = years * 12;
  const mensualite = r > 0 ? Math.round(montant * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) : Math.round(montant / n);
  const totalPaye = mensualite * n;
  const totalInterets = totalPaye - montant;
  const tauxEffort = mensualite / (price / 1e6 * 1e5);
  return /* @__PURE__ */ React.createElement("div", { className: "modal-ov", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-bx", style: { maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 17 } }, "\u{1F3E6} Calculateur de cr\xE9dit immobilier"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--mu)" } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, fontWeight: 700, color: "var(--mu)", textTransform: "uppercase", letterSpacing: ".5px", display: "block", marginBottom: 6 } }, "Choisir une banque"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, SN_BANKS.map((b) => /* @__PURE__ */ React.createElement("label", { key: b.id, style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: `1.5px solid ${selectedBank === b.id ? "var(--g)" : "var(--br)"}`, borderRadius: 9, cursor: "pointer", background: selectedBank === b.id ? "var(--gl)" : "#fff" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "bank", value: b.id, checked: selectedBank === b.id, onChange: () => setSelectedBank(b.id), style: { accentColor: "var(--g)" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, b.name, " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--mu)", fontWeight: 400, fontSize: 10 } }, "\u2014 ", b.fullName)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 1 } }, b.note)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, color: "var(--g)" } }, b.rate, "%"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, "max ", b.maxYears, " ans")))))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, fontWeight: 700, color: "var(--mu)", textTransform: "uppercase", letterSpacing: ".5px", display: "block", marginBottom: 5 } }, "Apport personnel"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("input", { type: "range", min: bank.minApport, max: 50, step: 5, value: apport, onChange: (e) => setApport(Number(e.target.value)), style: { flex: 1, accentColor: "var(--g)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, color: "var(--g)", minWidth: 30 } }, apport, "%")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2 } }, "Min. requis : ", bank.minApport, "%")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { style: { fontSize: 11, fontWeight: 700, color: "var(--mu)", textTransform: "uppercase", letterSpacing: ".5px", display: "block", marginBottom: 5 } }, "Dur\xE9e du pr\xEAt"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("input", { type: "range", min: 5, max: bank.maxYears, step: 1, value: Math.min(years, bank.maxYears), onChange: (e) => setYears(Number(e.target.value)), style: { flex: 1, accentColor: "var(--g)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 13, color: "var(--g)", minWidth: 40 } }, years, " ans")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "var(--mu)", marginTop: 2 } }, "Max : ", bank.maxYears, " ans"))), /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#0a5c36,#1e3a5f)", borderRadius: "var(--r)", padding: 16, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 10, marginBottom: 3 } }, "MENSUALIT\xC9 ESTIM\xC9E"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 22, color: "#fff" } }, mensualite.toLocaleString("fr")), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 10 } }, "FCFA / mois")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 10, marginBottom: 3 } }, "MONTANT EMPRUNT\xC9"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 18, color: "#fff" } }, (montant / 1e6).toFixed(1), "M"), /* @__PURE__ */ React.createElement("div", { style: { color: "rgba(255,255,255,.7)", fontSize: 10 } }, "FCFA"))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 } }, [["Apport", `${(price * apport / 100 / 1e6).toFixed(1)}M FCFA`], ["Total int\xE9r\xEAts", `${(totalInterets / 1e6).toFixed(1)}M FCFA`], ["Co\xFBt total", `${(totalPaye / 1e6).toFixed(1)}M FCFA`]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { background: "rgba(255,255,255,.1)", borderRadius: 7, padding: "6px 8px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "rgba(255,255,255,.6)", marginBottom: 2 } }, k), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 11, color: "#fff" } }, v))))), /* @__PURE__ */ React.createElement("div", { style: { background: "#fffbeb", border: "1px solid #fbbf24", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#92400e" } }, "\u26A0\uFE0F ", /* @__PURE__ */ React.createElement("strong", null, "Simulation indicative."), " Les taux peuvent varier selon votre profil et les conditions du march\xE9. Contactez directement la banque pour une offre personnalis\xE9e.")));
}
const REPORT_REASONS = {
  fausse_annonce: "Annonce mensong\xE8re ou frauduleuse",
  prix_errone: "Prix incorrect ou trompeur",
  photos_trompeuses: "Photos ne correspondant pas au bien",
  escroquerie: "Tentative d'escroquerie suspect\xE9e",
  doublon: "Annonce en double",
  autre: "Autre raison"
};
function ReportModal({ listing, user, onClose, showToast: showToast2 }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!reason) {
      showToast2("S\xE9lectionnez une raison", "err");
      return;
    }
    if (!user) {
      showToast2("Connectez-vous pour signaler", "err");
      return;
    }
    setLoading(true);
    const { error } = await sb.from("listing_reports").insert([{
      listing_id: listing.id,
      reporter_id: user.id,
      reason,
      details: details || null
    }]);
    setLoading(false);
    if (error) {
      showToast2("Erreur: " + error.message, "err");
      return;
    }
    setSent(true);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "modal-ov", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-bx", style: { maxWidth: 440 }, onClick: (e) => e.stopPropagation() }, sent ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "24px 0" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 44, marginBottom: 12 } }, "\u2705"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 16, marginBottom: 6 } }, "Signalement envoy\xE9"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", marginBottom: 20 } }, "Notre \xE9quipe examinera cette annonce dans les plus brefs d\xE9lais. Merci de contribuer \xE0 la qualit\xE9 de la plateforme."), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: onClose }, "Fermer")) : /* @__PURE__ */ React.createElement("form", { onSubmit: submit }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 15, color: "#ef4444" } }, "\u{1F6A9} Signaler cette annonce"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: onClose, style: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--mu)" } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 14 } }, "Annonce : ", /* @__PURE__ */ React.createElement("strong", null, listing.title)), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Raison du signalement ", /* @__PURE__ */ React.createElement("span", null, "*")), Object.entries(REPORT_REASONS).map(([k, v]) => /* @__PURE__ */ React.createElement("label", { key: k, style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 4, border: `1.5px solid ${reason === k ? "#ef4444" : "var(--br)"}`, borderRadius: 7, cursor: "pointer", background: reason === k ? "#fef2f2" : "#fff", fontSize: 12 } }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "reason", value: k, checked: reason === k, onChange: () => setReason(k), style: { accentColor: "#ef4444" } }), v))), /* @__PURE__ */ React.createElement("div", { className: "fg", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "D\xE9tails (optionnel)"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", rows: 3, value: details, onChange: (e) => setDetails(e.target.value), placeholder: "Pr\xE9cisez votre signalement...", style: { resize: "vertical" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { type: "submit", className: "fbt2", style: { background: "#ef4444", color: "#fff", border: "none", flex: 1 }, disabled: loading }, loading ? "Envoi..." : "\u{1F6A9} Envoyer le signalement"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "fbt2", style: { background: "var(--bg)", border: "1px solid var(--br)" }, onClick: onClose }, "Annuler")))));
}
function MarketAnalyticsPage({ listings, onBack, onOpenListing }) {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [txFilter, setTxFilter] = useState("vente");
  const [propFilter, setPropFilter] = useState("all");
  const [view, setView] = useState("quartier");
  useEffect(() => {
    sb.from("market_stats").select("*").order("listing_count", { ascending: false }).then(({ data }) => {
      setStats(data || []);
      setLoading(false);
    });
  }, []);
  const filtered = stats.filter((s) => {
    if (s.transaction_type !== txFilter) return false;
    if (propFilter !== "all" && s.property_type !== propFilter) return false;
    return true;
  });
  const totalListings = listings.filter((l) => l.status === "active").length;
  const avgPrice = listings.length > 0 ? Math.round(listings.reduce((s, l) => s + l.price, 0) / listings.length) : 0;
  const withVideo = listings.filter((l) => l.video_url).length;
  const with360 = listings.filter((l) => l.tour_360_url).length;
  const investDeals = listings.filter((l) => l.is_investment_deal).length;
  return /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 1280, margin: "0 auto", padding: "20px 20px 60px" } }, /* @__PURE__ */ React.createElement("button", { className: "bkb", onClick: onBack, style: { marginBottom: 16 } }, "\u2190 Accueil"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 22, marginBottom: 4 } }, "\u{1F4C8} Analyse du march\xE9 immobilier"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--mu)" } }, "Donn\xE9es en temps r\xE9el \xB7 ", totalListings, " annonces actives \xB7 Mis \xE0 jour automatiquement"))), /* @__PURE__ */ React.createElement("div", { className: "kpig", style: { gridTemplateColumns: "repeat(5,1fr)", marginBottom: 24 } }, [
    ["\u{1F3E0}", totalListings, "Annonces actives"],
    ["\u{1F4B0}", avgPrice > 0 ? `${(avgPrice / 1e6).toFixed(1)}M` : "\u2014", "Prix moyen FCFA"],
    ["\u{1F4BC}", investDeals, "Bons investissements"],
    ["\u25B6", withVideo, "Avec vid\xE9o"],
    ["\u{1F310}", with360, "Visite 360\xB0"]
  ].map(([ico, val, lbl]) => /* @__PURE__ */ React.createElement("div", { className: "kpi", key: lbl }, /* @__PURE__ */ React.createElement("div", { className: "kpiic" }, ico), /* @__PURE__ */ React.createElement("div", { className: "kpiv", style: { fontSize: val.toString().length > 6 ? 14 : 18 } }, val), /* @__PURE__ */ React.createElement("div", { className: "kpil" }, lbl)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "fils" }, [["vente", "Vente"], ["location", "Location"], ["location_saisonniere", "Saisonnier"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${txFilter === v ? "on" : ""}`, onClick: () => setTxFilter(v) }, l))), /* @__PURE__ */ React.createElement("select", { className: "fi", style: { flex: "0 0 auto", width: 160, fontSize: 11 }, value: propFilter, onChange: (e) => setPropFilter(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Tous types"), Object.keys(PICO).map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, PICO[k], " ", k)))), loading ? /* @__PURE__ */ React.createElement("div", { className: "ldr" }, /* @__PURE__ */ React.createElement("div", { className: "spin" })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", overflow: "hidden", boxShadow: "var(--sh)", marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 16px", borderBottom: "1px solid var(--br)", fontFamily: "var(--fd)", fontWeight: 700, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F4CA} Prix par quartier"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--mu)", fontWeight: 400 } }, filtered.length, " quartiers")), filtered.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { padding: 32, textAlign: "center", color: "var(--mu)", fontSize: 12 } }, "Aucune donn\xE9e pour ces filtres.") : /* @__PURE__ */ React.createElement("div", { style: { overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "dtbl", style: { minWidth: 600 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Quartier"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Prix m\xE9dian"), /* @__PURE__ */ React.createElement("th", null, "Prix moy. /m\xB2"), /* @__PURE__ */ React.createElement("th", null, "Min"), /* @__PURE__ */ React.createElement("th", null, "Max"), /* @__PURE__ */ React.createElement("th", null, "Annonces"))), /* @__PURE__ */ React.createElement("tbody", null, filtered.sort((a, b) => b.listing_count - a.listing_count).map((s) => {
    const maxP = Math.max(...filtered.map((x) => x.median_price || 0));
    const pct = maxP > 0 ? Math.round((s.median_price || 0) / maxP * 100) : 0;
    return /* @__PURE__ */ React.createElement("tr", { key: s.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 12 } }, "\u{1F4CD} ", s.quartier), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, s.city)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 600 } }, PICO[s.property_type] || "", " ", s.property_type)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 12, color: "var(--g)" } }, (s.median_price || 0).toLocaleString("fr"), " F"), /* @__PURE__ */ React.createElement("div", { style: { height: 4, background: "var(--bg)", borderRadius: 2, marginTop: 3, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { height: 4, background: "var(--g)", borderRadius: 2, width: pct + "%" } }))), /* @__PURE__ */ React.createElement("td", { style: { fontFamily: "var(--fd)", fontSize: 11, fontWeight: 700, color: "var(--mu)" } }, s.avg_price_per_m2 ? `${s.avg_price_per_m2.toLocaleString("fr")} F` : "\u2014"), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 10, color: "var(--mu)" } }, (s.min_price || 0).toLocaleString("fr"), " F"), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 10, color: "var(--mu)" } }, (s.max_price || 0).toLocaleString("fr"), " F"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { background: "var(--bg)", color: "var(--tx)", fontWeight: 700, fontSize: 11, padding: "3px 8px", borderRadius: 100 } }, s.listing_count)));
  }))))), propFilter === "all" && /* @__PURE__ */ React.createElement("div", { style: { background: "#fff", border: "1px solid var(--br)", borderRadius: "var(--r)", padding: 16, boxShadow: "var(--sh)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 700, fontSize: 13, marginBottom: 14 } }, "\u{1F4B9} Prix m\xE9dian par type de bien (", txFilter, ")"), Object.keys(PICO).map((type) => {
    const typeStat = stats.filter((s) => s.property_type === type && s.transaction_type === txFilter);
    const avgM = typeStat.length > 0 ? Math.round(typeStat.reduce((s, x) => s + (x.median_price || 0), 0) / typeStat.length) : 0;
    if (!avgM) return null;
    const maxAny = Math.max(...Object.keys(PICO).map((t) => {
      const ts = stats.filter((s) => s.property_type === t && s.transaction_type === txFilter);
      return ts.length > 0 ? Math.round(ts.reduce((s, x) => s + (x.median_price || 0), 0) / ts.length) : 0;
    }), 1);
    const w = Math.round(avgM / maxAny * 100);
    return /* @__PURE__ */ React.createElement("div", { key: type, className: "cbrw", style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "cblbl", style: { width: 80 } }, PICO[type], " ", type), /* @__PURE__ */ React.createElement("div", { className: "cbwrp", style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { className: "cbfil", style: { width: w + "%", minWidth: 4 } })), /* @__PURE__ */ React.createElement("div", { className: "cbval", style: { width: 100, textAlign: "right", fontWeight: 700, fontSize: 11 } }, (avgM / 1e6).toFixed(1), "M FCFA"));
  }).filter(Boolean))));
}
const RATES_DEFAULT = { EUR: 153e-5, USD: 165e-5, CAD: 225e-5, GBP: 131e-5, MAD: 0.0165, CHF: 147e-5, AED: 606e-5, SAR: 619e-5, XOF: 1 };
let _RATES_LIVE = null;
async function fetchLiveRates() {
  try {
    const r = await fetch("https://rgwozhjpufgebaiygvhr.supabase.co/functions/v1/exchange-rates");
    const d = await r.json();
    if (d.rates) _RATES_LIVE = d.rates;
  } catch (_) {
  }
}
fetchLiveRates();
const RATES = new Proxy({}, { get(_, k) {
  return (_RATES_LIVE || RATES_DEFAULT)[k] || RATES_DEFAULT[k] || 1;
} });
const RFLAG = { EUR: "\u{1F1EA}\u{1F1FA}", USD: "\u{1F1FA}\u{1F1F8}", CAD: "\u{1F1E8}\u{1F1E6}", GBP: "\u{1F1EC}\u{1F1E7}", MAD: "\u{1F1F2}\u{1F1E6}", XOF: "\u{1F1F8}\u{1F1F3}" };
const RNAME = { EUR: "Euro", USD: "Dollar US", CAD: "Dollar CA", GBP: "Livre sterling", MAD: "Dirham marocain", XOF: "Franc CFA" };
function CurrencyWidget({ amountXOF }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("EUR");
  const converted = amountXOF * (RATES[target] || 1);
  const fmt2 = (v, cur) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);
  return /* @__PURE__ */ React.createElement("div", { className: "currency-widget" }, /* @__PURE__ */ React.createElement("button", { className: "currency-toggle", onClick: () => setOpen((o) => !o), title: "Convertisseur de devises" }, "\u{1F30D} ", fmt2(converted, target)), open && /* @__PURE__ */ React.createElement("div", { className: "currency-panel" }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 12, marginBottom: 10, color: "var(--g)" } }, "\u{1F4B1} Convertisseur de devises"), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--bg)", borderRadius: 8, padding: "10px 12px", marginBottom: 12, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", marginBottom: 2 } }, "Montant en FCFA"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 18, color: "var(--g)" } }, amountXOF.toLocaleString("fr"), " XOF")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 } }, Object.keys(RATES).filter((c) => c !== "XOF").map((cur) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: cur,
      className: `currency-item${target === cur ? " active" : ""}`,
      onClick: () => setTarget(cur)
    },
    /* @__PURE__ */ React.createElement("span", null, RFLAG[cur]),
    /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 11, lineHeight: 1 } }, fmt2(amountXOF * RATES[cur], cur)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)" } }, RNAME[cur]))
  ))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "var(--mu)", textAlign: "center", marginTop: 8 } }, "Taux indicatifs \xB7 1 XOF \u2248 ", RATES[target].toFixed(5), " ", target)));
}
const COUNTRIES = ["France", "Belgique", "Canada", "\xC9tats-Unis", "Espagne", "Italie", "Allemagne", "Suisse", "Portugal", "Maroc", "C\xF4te d'Ivoire", "Autre"];
const TIME_PREFS = ["matin (8h\u201312h)", "apr\xE8s-midi (12h\u201318h)", "soir (18h\u201322h)", "flexible"];
function VisitRequestModal({ listing, user, onClose, showToast: showToast2 }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: user?.user_metadata?.full_name || "",
    email: user?.email || "",
    phone: "",
    whatsapp: "",
    country: "France",
    preferred_date: "",
    preferred_time: "apr\xE8s-midi (12h\u201318h)",
    visit_type: "video",
    message: ""
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const u = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));
  async function submit() {
    if (!form.name.trim() || !form.email.trim()) {
      setErr("Nom et email requis.");
      return;
    }
    setLoading(true);
    setErr("");
    const { error } = await sb.from("visit_requests").insert({
      listing_id: listing.id,
      requester_id: user?.id || null,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      country: form.country,
      preferred_date: form.preferred_date || null,
      preferred_time: form.preferred_time,
      visit_type: form.visit_type,
      message: form.message || null
    });
    setLoading(false);
    if (error) {
      setErr("Erreur: " + error.message);
      return;
    }
    setStep(2);
  }
  if (step === 2) return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { maxWidth: 380, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 60, marginBottom: 12 } }, "\u{1F389}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 20, marginBottom: 8 } }, "Demande envoy\xE9e !"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--mu)", fontSize: 13, lineHeight: 1.6 } }, "L'annonceur recevra votre demande et vous contactera sous 24\u201348h pour confirmer la visite ", form.visit_type === "video" ? "vid\xE9o" : "en ligne", "."), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--gl)", borderRadius: 10, padding: 14, margin: "16px 0", fontSize: 12, color: "var(--g)", fontWeight: 600 } }, "\u{1F4C5} ", form.preferred_date ? (/* @__PURE__ */ new Date(form.preferred_date + "T00:00")).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "Date flexible", " \xB7 ", form.preferred_time), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", onClick: onClose }, "Fermer")));
  return /* @__PURE__ */ React.createElement("div", { className: "ov", onClick: (e) => e.target === e.currentTarget && onClose() }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: { maxWidth: 480 } }, /* @__PURE__ */ React.createElement("div", { className: "mhd" }, /* @__PURE__ */ React.createElement("div", { className: "mtit" }, "\u{1F30D} Demander une visite \xE0 distance"), /* @__PURE__ */ React.createElement("button", { className: "mcls", onClick: onClose }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "mbd" }, /* @__PURE__ */ React.createElement("div", { className: "al", style: { background: "#eff6ff", borderColor: "#bfdbfe", color: "#1d4ed8", marginBottom: 14 } }, "\u{1F4E1} Vous pouvez demander une visite vid\xE9o, des photos suppl\xE9mentaires ou une visite par procuration depuis votre pays."), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Votre nom *"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: form.name, onChange: u("name"), placeholder: "Pr\xE9nom Nom" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Email *"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "email", value: form.email, onChange: u("email"), placeholder: "email@exemple.com" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "T\xE9l\xE9phone"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: form.phone, onChange: u("phone"), placeholder: "+33 6 12 34 56 78" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "WhatsApp"), /* @__PURE__ */ React.createElement("input", { className: "fi", value: form.whatsapp, onChange: u("whatsapp"), placeholder: "+33 6 12 34 56 78" })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Pays de r\xE9sidence"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.country, onChange: u("country") }, COUNTRIES.map((c) => /* @__PURE__ */ React.createElement("option", { key: c }, c)))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Type de visite"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.visit_type, onChange: u("visit_type") }, /* @__PURE__ */ React.createElement("option", { value: "video" }, "\u{1F4F9} Visite vid\xE9o (WhatsApp/Zoom)"), /* @__PURE__ */ React.createElement("option", { value: "photos" }, "\u{1F4F8} Photos suppl\xE9mentaires"), /* @__PURE__ */ React.createElement("option", { value: "in_person" }, "\u{1F91D} Visite par procuration"))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Date souhait\xE9e"), /* @__PURE__ */ React.createElement("input", { className: "fi", type: "date", value: form.preferred_date, min: (/* @__PURE__ */ new Date()).toISOString().split("T")[0], onChange: u("preferred_date") })), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Cr\xE9neau pr\xE9f\xE9r\xE9"), /* @__PURE__ */ React.createElement("select", { className: "fi", value: form.preferred_time, onChange: u("preferred_time") }, TIME_PREFS.map((t) => /* @__PURE__ */ React.createElement("option", { key: t }, t))))), /* @__PURE__ */ React.createElement("div", { className: "fg" }, /* @__PURE__ */ React.createElement("label", { className: "fl" }, "Message (optionnel)"), /* @__PURE__ */ React.createElement("textarea", { className: "fi", style: { height: 70, resize: "vertical" }, value: form.message, onChange: u("message"), placeholder: "Questions sp\xE9cifiques, budget, conditions de financement..." })), err && /* @__PURE__ */ React.createElement("div", { className: "al ale" }, err), /* @__PURE__ */ React.createElement("button", { className: "fbt2 fbg", style: { marginTop: 10 }, onClick: submit, disabled: loading }, loading ? "\u23F3 Envoi..." : "\u{1F4E1} Envoyer ma demande"))));
}
function InvestBadge({ yield_pct, lg = false }) {
  if (!yield_pct) return null;
  if (lg) return /* @__PURE__ */ React.createElement("div", { style: { background: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "1.5px solid #6ee7b7", borderRadius: 12, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 42, height: 42, borderRadius: 50, background: "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 } }, "\u{1F4C8}"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 13, color: "#065f46" } }, "Recommand\xE9 pour investissement"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#047857", marginTop: 2 } }, "Rendement estim\xE9 : ", /* @__PURE__ */ React.createElement("strong", null, yield_pct, "%"), " / an \xB7 Id\xE9al diaspora & expatri\xE9s")));
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 800, color: "#065f46" } }, "\u{1F4C8} ", yield_pct, "% /an");
}
function DiasporaSection({ onEstim, onBrowse }) {
  const [openGuide, setOpenGuide] = useState(false);
  const steps = [
    { ico: "\u{1F50D}", title: "Parcourez les annonces", desc: "Filtrez par ville, quartier, budget. Toutes les annonces affichent le score de confiance SeneGalsen." },
    { ico: "\u{1F4E1}", title: "Demandez une visite vid\xE9o", desc: "Sur n'importe quelle annonce, cliquez 'Visite \xE0 distance' pour contacter l'annonceur via WhatsApp ou Zoom." },
    { ico: "\u2705", title: "V\xE9rification physique", desc: "Le badge or \u{1F3C5} confirme qu'un agent SeneGalsen a visit\xE9 le bien en personne et v\xE9rifi\xE9 les documents." },
    { ico: "\u{1F4B0}", title: "Estimez votre investissement", desc: "Notre simulateur calcule le rendement locatif brut et net en FCFA, avec conversion EUR/USD/CAD." },
    { ico: "\u{1F4CB}", title: "Documents requis", desc: "Titre foncier, bail notari\xE9, d\xE9lib\xE9ration, permis d'occuper. V\xE9rifiez le type de document affich\xE9 sur chaque annonce." },
    { ico: "\u{1F91D}", title: "Finalisez \xE0 distance", desc: "Procurations, transferts via Western Union / Wave / Orange Money. Nos agents partenaires vous accompagnent." }
  ];
  const countries = [
    { flag: "\u{1F1EB}\u{1F1F7}", name: "France", info: "~800 000 S\xE9n\xE9galais" },
    { flag: "\u{1F1FA}\u{1F1F8}", name: "\xC9tats-Unis", info: "~120 000 S\xE9n\xE9galais" },
    { flag: "\u{1F1EE}\u{1F1F9}", name: "Italie", info: "~100 000 S\xE9n\xE9galais" },
    { flag: "\u{1F1EA}\u{1F1F8}", name: "Espagne", info: "~75 000 S\xE9n\xE9galais" },
    { flag: "\u{1F1E8}\u{1F1E6}", name: "Canada", info: "~50 000 S\xE9n\xE9galais" },
    { flag: "\u{1F1E7}\u{1F1EA}", name: "Belgique", info: "~40 000 S\xE9n\xE9galais" }
  ];
  return /* @__PURE__ */ React.createElement("section", { className: "diaspora-section" }, /* @__PURE__ */ React.createElement("div", { className: "diaspora-hero" }, /* @__PURE__ */ React.createElement("div", { className: "diaspora-hero-bg" }), /* @__PURE__ */ React.createElement("div", { className: "diaspora-hero-content" }, /* @__PURE__ */ React.createElement("div", { className: "diaspora-pill" }, "\u{1F30D} Pour la Diaspora & les Expatri\xE9s"), /* @__PURE__ */ React.createElement("h2", { className: "diaspora-title" }, "Investissez au S\xE9n\xE9gal", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("span", null, "depuis l'\xE9tranger")), /* @__PURE__ */ React.createElement("p", { className: "diaspora-sub" }, "Achetez, louez ou investissez en toute s\xE9curit\xE9. Visites vid\xE9o, agents v\xE9rifi\xE9s, documents authentifi\xE9s."), /* @__PURE__ */ React.createElement("div", { className: "diaspora-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn btg", style: { fontSize: 14, padding: "12px 22px" }, onClick: onBrowse }, "\u{1F3E0} Voir les annonces"), /* @__PURE__ */ React.createElement("button", { className: "btn", style: { background: "rgba(255,255,255,.15)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)", fontSize: 14, padding: "12px 22px", backdropFilter: "blur(6px)" }, onClick: onEstim }, "\u{1F4B0} Estimer un investissement")), /* @__PURE__ */ React.createElement("div", { className: "diaspora-flags" }, countries.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.name, className: "diaspora-flag-item", title: c.info }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 22 } }, c.flag), /* @__PURE__ */ React.createElement("span", null, c.name)))))), /* @__PURE__ */ React.createElement("div", { className: "diaspora-guide" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 20, marginBottom: 4 } }, "Comment investir depuis l'\xE9tranger ?"), /* @__PURE__ */ React.createElement("div", { style: { color: "var(--mu)", fontSize: 13 } }, "Votre guide complet en 6 \xE9tapes")), /* @__PURE__ */ React.createElement("button", { className: "btn", style: { background: "var(--bg)", border: "1.5px solid var(--br)", color: "var(--tx)", fontSize: 12, fontWeight: 600 }, onClick: () => setOpenGuide((o) => !o) }, openGuide ? "R\xE9duire \u2191" : "Voir le guide \u2193")), openGuide && /* @__PURE__ */ React.createElement("div", { className: "diaspora-steps" }, steps.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "diaspora-step" }, /* @__PURE__ */ React.createElement("div", { className: "diaspora-step-num" }, i + 1), /* @__PURE__ */ React.createElement("div", { className: "diaspora-step-ico" }, s.ico), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 14, marginBottom: 4 } }, s.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--mu)", lineHeight: 1.6 } }, s.desc)))))), /* @__PURE__ */ React.createElement("div", { className: "diaspora-trust" }, [
    { ico: "\u{1F3C5}", title: "V\xE9rification physique", desc: "Nos agents se d\xE9placent pour v\xE9rifier chaque bien et ses documents avant publication du badge." },
    { ico: "\u{1F4B1}", title: "Multi-devises", desc: "Consultez les prix en FCFA, EUR, USD, CAD, GBP et MAD directement sur chaque annonce." },
    { ico: "\u{1F4F9}", title: "Visite vid\xE9o", desc: "Demandez une visite WhatsApp ou Zoom sur n'importe quelle annonce, depuis n'importe quel pays." },
    { ico: "\u2696\uFE0F", title: "Documents v\xE9rifi\xE9s", desc: "Titre foncier, bail notari\xE9 et permis d'occuper affich\xE9s et v\xE9rifi\xE9s sur chaque annonce." }
  ].map((f, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "diaspora-trust-card" }, /* @__PURE__ */ React.createElement("div", { className: "diaspora-trust-ico" }, f.ico), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, marginBottom: 5 } }, f.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--mu)", lineHeight: 1.6 } }, f.desc)))));
}
function MobileNav({ page, setPage, user, setShowAuth, setShowForm, unreadCount, setShowEstim, setShowMarket }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const go = (p) => {
    setPage(p);
    close();
  };
  const items = [
    { ico: "\u{1F3E0}", label: "Accueil", page: "home" },
    { ico: "\u{1F50D}", label: "Annonces", page: "listings" },
    { ico: "\u{1F5FA}\uFE0F", label: "Carte", page: "map" },
    { ico: "\u{1F4CA}", label: "Prix du march\xE9", page: "prices" },
    ...user ? [{ ico: "\u{1F4CB}", label: "Mon Dashboard", page: "dashboard" }] : []
  ];
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: `ham-btn ${open ? "open" : ""}`, onClick: () => setOpen((o) => !o), "aria-label": "Menu" }, /* @__PURE__ */ React.createElement("span", { className: "ham-line" }), /* @__PURE__ */ React.createElement("span", { className: "ham-line" }), /* @__PURE__ */ React.createElement("span", { className: "ham-line" })), /* @__PURE__ */ React.createElement("div", { className: `nav-drawer-overlay ${open ? "open" : ""}`, onClick: close }), /* @__PURE__ */ React.createElement("div", { className: `nav-drawer ${open ? "open" : ""}` }, /* @__PURE__ */ React.createElement("div", { className: "nav-drawer-hd" }, /* @__PURE__ */ React.createElement("div", { className: "nav-drawer-logo" }, "\u{1F3E1} Sene", /* @__PURE__ */ React.createElement("span", null, "Galsen")), /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-close", onClick: close }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "nav-drawer-body" }, items.map((it) => /* @__PURE__ */ React.createElement("button", { key: it.page, className: `nav-drawer-item ${page === it.page ? "on" : ""}`, onClick: () => go(it.page) }, /* @__PURE__ */ React.createElement("span", { className: "nav-drawer-item-ico" }, it.ico), it.label, it.page === "dashboard" && unreadCount > 0 && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", background: "var(--rd)", color: "#fff", borderRadius: "100px", padding: "1px 7px", fontSize: 10, fontWeight: 800 } }, unreadCount))), /* @__PURE__ */ React.createElement("div", { className: "nav-drawer-sep" }), /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-item", style: { color: "var(--au)", fontWeight: 700 }, onClick: () => {
    setShowEstim(true);
    close();
  } }, /* @__PURE__ */ React.createElement("span", { className: "nav-drawer-item-ico" }, "\u{1F4B0}"), "Estimer mon bien"), user ? /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-item", onClick: () => {
    setShowForm(true);
    close();
  } }, /* @__PURE__ */ React.createElement("span", { className: "nav-drawer-item-ico" }, "\u2795"), "D\xE9poser une annonce") : /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-item", onClick: () => {
    setShowAuth(true);
    close();
  } }, /* @__PURE__ */ React.createElement("span", { className: "nav-drawer-item-ico" }, "\u{1F511}"), "Connexion / Inscription")), user ? /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-cta", onClick: () => {
    setShowForm(true);
    close();
  } }, "\u2795 Nouvelle annonce") : /* @__PURE__ */ React.createElement("button", { className: "nav-drawer-cta", onClick: () => {
    setShowAuth(true);
    close();
  } }, "\u{1F511} Se connecter")));
}
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e) {
    return { error: e };
  }
  render() {
    if (this.state.error) return /* @__PURE__ */ React.createElement("div", { style: { padding: 40, maxWidth: 500, margin: "40px auto", background: "#fff", borderRadius: 16, border: "1px solid #fee2e2", boxShadow: "0 4px 20px rgba(0,0,0,.08)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, textAlign: "center", marginBottom: 16 } }, "\u{1F615}"), /* @__PURE__ */ React.createElement("h2", { style: { fontFamily: "var(--fd)", color: "var(--rd)", textAlign: "center", marginBottom: 8 } }, "Une erreur est survenue"), /* @__PURE__ */ React.createElement("p", { style: { color: "var(--mu)", fontSize: 13, textAlign: "center", marginBottom: 20 } }, "Rechargez la page pour continuer."), /* @__PURE__ */ React.createElement("div", { style: { background: "#fef2f2", borderRadius: 8, padding: 12, fontSize: 11, color: "#991b1b", fontFamily: "monospace", wordBreak: "break-all" } }, this.state.error.message), /* @__PURE__ */ React.createElement("button", { onClick: () => window.location.reload(), style: { display: "block", width: "100%", marginTop: 16, background: "var(--g)", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 700, fontSize: 14, cursor: "pointer" } }, "\u{1F504} Recharger"));
    return this.props.children;
  }
}
export default function App() {
  const [page, setPage] = useState("home");
  const [prevPage, setPrevPage] = useState("home");
  const [listings, setListings] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [selected, setSelected] = useState(null);
  const [agencyId2, setAgencyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, agencies: 0, cities: 0 });
  const [searchQ, setSearchQ] = useState("");
  const [txF, setTxF] = useState("all"), [propF, setPropF] = useState("all");
  const [advF, setAdvF] = useState({});
  const [stab, setStab] = useState("vente");
  const [user, setUser] = useState(null);
  const [favIds, setFavIds] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [showAuth, setShowAuth] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showDiasporaWelcome, setShowDiasporaWelcome] = useState(false);
  const [appProfile, setAppProfile] = useState(null);
  const [showNotif, setShowNotif] = useState(false);
  const [toast, setToast] = useState(null);
  const [newCount, setNewCount] = useState(0);
  const [cmpItems, setCmpItems] = useState([]);
  const [showCmp, setShowCmp] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [showEstim, setShowEstim] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [sortBy, setSortBy] = useState("date");
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const PAGE_SIZE = 12;
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadUserData(session.user);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadUserData(session.user);
      else {
        setFavIds([]);
        setNotifs([]);
      }
    });
    loadAll();
    const rtList = sb.channel("rt-listings").on("postgres_changes", { event: "INSERT", schema: "public", table: "listings", filter: "status=eq.active" }, (payload) => {
      setListings((prev) => [payload.new, ...prev]);
      setStats((s) => ({ ...s, total: s.total + 1 }));
      setNewCount((n) => n + 1);
    }).subscribe();
    let rtNotif;
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        rtNotif = sb.channel("rt-notifs").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, (payload) => {
          setNotifs((prev) => [payload.new, ...prev]);
        }).subscribe();
      }
    });
    return () => {
      subscription.unsubscribe();
      sb.removeChannel(rtList);
      if (rtNotif) sb.removeChannel(rtNotif);
    };
  }, []);
  async function loadAll() {
    setLoading(true);
    const [{ data: all }, { data: feat }, { count }] = await Promise.all([
      sb.from("listings").select("*").eq("status", "active").order("is_featured", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("listings").select("*").eq("status", "active").eq("is_featured", true).limit(6),
      sb.from("agencies").select("id", { count: "exact", head: true })
    ]);
    if (all) {
      setListings(all);
      setStats({ total: all.length, agencies: count || 3, cities: new Set(all.map((l) => l.city)).size });
    }
    if (feat) setFeatured(feat);
    setLoading(false);
  }
  async function loadUserData(u) {
    try {
      const [{ data: favs }, { data: nots }, { data: prof }] = await Promise.all([
        sb.from("favorites").select("listing_id").eq("user_id", u.id),
        sb.from("notifications").select("*").eq("user_id", u.id).order("created_at", { ascending: false }).limit(20),
        sb.from("profiles").select("*").eq("id", u.id).single()
      ]);
      if (favs) setFavIds(favs.map((f) => f.listing_id));
      if (nots) setNotifs(nots);
      if (prof) {
        setAppProfile(prof);
      } else {
        // Race condition signup: le trigger n'a pas encore créé le profil
        // Attendre 1s et réessayer
        await new Promise(r => setTimeout(r, 1000));
        const { data: prof2 } = await sb.from("profiles").select("*").eq("id", u.id).single();
        if (prof2) setAppProfile(prof2);
      }
      const { data: rv } = await sb.from("recently_viewed").select("*,listings(*)").eq("user_id", u.id).order("viewed_at", { ascending: false }).limit(6);
      if (rv) setRecentlyViewed(rv.filter((r) => r.listings).map((r) => r.listings));
      return prof || null; // Retourner le profil pour usage dans onSuccess
    } catch (e) {
      console.warn("loadUserData:", e);
      return null;
    }
  }
  async function toggleFav(listingId, add) {
    if (!user) {
      showT("Connectez-vous pour sauvegarder des favoris", "err");
      return;
    }
    if (add) {
      await sb.from("favorites").upsert({ user_id: user.id, listing_id: listingId });
      setFavIds((f) => [...f.filter((x) => x !== listingId), listingId]);
      showT("\u2764\uFE0F Ajout\xE9 aux favoris");
    } else {
      await sb.from("favorites").delete().eq("user_id", user.id).eq("listing_id", listingId);
      setFavIds((f) => f.filter((x) => x !== listingId));
      showT("Retir\xE9 des favoris");
    }
  }
  async function markAllRead() {
    await sb.from("notifications").update({ is_read: true }).eq("user_id", user.id);
    setNotifs((n) => n.map((x) => ({ ...x, is_read: true })));
  }
  function showT(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3400);
  }
  function open(l, from) {
    setSelected(l);
    setPrevPage(from || page);
    setPage("detail");
    window.scrollTo(0, 0);
    try {
      history.replaceState(null, "", `#listing-${l.id}`);
    } catch (_) {
    }
  }
  function showAgency(id, from) {
    setAgencyId(id);
    setPrevPage(from || page);
    setPage("agency");
    window.scrollTo(0, 0);
  }
  async function logout() {
    await sb.auth.signOut();
    setUser(null);
    setPage("home");
    setFavIds([]);
    setNotifs([]);
    showT("D\xE9connect\xE9 \u2713");
  }
  useEffect(() => setListPage(1), [searchQ, txF, propF, advF, sortBy]);
  function toggleCmp(l) {
    setCmpItems((prev) => {
      if (prev.find((x) => x.id === l.id)) return prev.filter((x) => x.id !== l.id);
      if (prev.length >= 3) {
        showT("Maximum 3 biens \xE0 comparer", "err");
        return prev;
      }
      return [...prev, l];
    });
  }
  const unreadCount = notifs.filter((n) => !n.is_read).length;
  const ini = user ? (user.email || "?")[0].toUpperCase() : null;
  const filtered = useMemo(() => listings.filter((l) => {
    const q = searchQ.toLowerCase();
    if (q && !(l.title || "").toLowerCase().includes(q) && !(l.quartier || "").toLowerCase().includes(q) && !(l.city || "").toLowerCase().includes(q)) return false;
    if (txF !== "all" && l.transaction_type !== txF) return false;
    if (propF !== "all" && l.property_type !== propF) return false;
    if (advF.priceMin && l.price < Number(advF.priceMin)) return false;
    if (advF.priceMax && l.price > Number(advF.priceMax)) return false;
    if (advF.surfMin && l.surface < Number(advF.surfMin)) return false;
    if (advF.surfMax && l.surface > Number(advF.surfMax)) return false;
    if (advF.bedrooms && (l.bedrooms || 0) < Number(advF.bedrooms)) return false;
    if (advF.docType && l.document_type !== advF.docType) return false;
    if (advF.region && l.region !== advF.region) return false;
    if (advF.investOnly && !l.is_investment_deal) return false;
    if (advF.verifiedOnly && !l.is_physically_verified) return false;
    if (advF.vConfidence) {
      const lv = getVLevel(l);
      const order = ["none","partial","checked","inspected"];
      if (order.indexOf(lv) < order.indexOf(advF.vConfidence)) return false;
    }
    if (advF.premiumOnly && !l.is_premium) return false;
    if (advF.videoOnly && !l.video_url) return false;
    if (advF.tour360Only && !l.tour_360_url) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === "price_asc") return a.price - b.price;
    if (sortBy === "price_desc") return b.price - a.price;
    if (sortBy === "views") return (b.views_count || 0) - (a.views_count || 0);
    if (sortBy === "trust") return (b.trust_score || 0) - (a.trust_score || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  }), [listings, searchQ, txF, propF, advF, sortBy]);
  const paged = filtered.slice(0, listPage * PAGE_SIZE);
  const hasMore = paged.length < filtered.length;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("style", null, CSS), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("nav", { className: "nav" }, /* @__PURE__ */ React.createElement("div", { className: "navi" }, /* @__PURE__ */ React.createElement("button", { className: "logo", onClick: () => setPage("home") }, "\u{1F3E1} Sene", /* @__PURE__ */ React.createElement("span", null, "Galsen")), /* @__PURE__ */ React.createElement("div", { className: "navl" }, /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "home" ? "on" : ""}`, onClick: () => setPage("home") }, "Accueil"), /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "listings" ? "on" : ""}`, onClick: () => setPage("listings") }, "Annonces"), /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "map" ? "on" : ""}`, onClick: () => setPage("map") }, "\u{1F5FA}\uFE0F Carte"), /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "prices" ? "on" : ""}`, onClick: () => setPage("prices") }, "\u{1F4CA} Prix"), /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "market" ? "on" : ""}`, onClick: () => setPage("market") }, "\u{1F4C8} March\xE9"), /* @__PURE__ */ React.createElement("button", { className: "nb", style: { color: "var(--au)", fontWeight: 700 }, onClick: () => setShowEstim(true) }, "\u{1F4B0} Estimer"), user && /* @__PURE__ */ React.createElement("button", { className: `nb ${page === "dashboard" ? "on" : ""}`, onClick: () => setPage("dashboard"), style: { display: "flex", alignItems: "center", gap: 5 } },
            "Dashboard",
            appProfile && appProfile.user_type === "diaspora" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, background: "#dbeafe", color: "#1e40af", padding: "1px 5px", borderRadius: 100, fontWeight: 700 } }, "🌍"),
            appProfile && ["agence","agent","promoteur","admin"].includes(appProfile.role) && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, background: "#dcfce7", color: "#166534", padding: "1px 5px", borderRadius: 100, fontWeight: 700 } }, appProfile.role))), /* @__PURE__ */ React.createElement("div", { className: "nauth" }, user ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "ncta", onClick: () => setShowForm(true) }, "+ Annonce"), /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { className: "nb", style: { padding: "7px 10px", fontSize: 16 }, onClick: () => setShowNotif((o) => !o) }, "\u{1F514}", unreadCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "nbadge" }, unreadCount > 9 ? "9+" : unreadCount)), showNotif && /* @__PURE__ */ React.createElement(NotifPanel, { user, notifs, onClose: () => setShowNotif(false), onMarkAll: () => {
    markAllRead();
    setShowNotif(false);
  } })), /* @__PURE__ */ React.createElement("button", { className: "av", onClick: () => setPage("dashboard"), title: user.email }, ini, unreadCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "nbadge", style: { top: -3, right: -3 } }, unreadCount))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "nb", onClick: () => setShowAuth(true) }, "Connexion"), /* @__PURE__ */ React.createElement("button", { className: "ncta", onClick: () => setShowAuth(true) }, "+ Annonce")), React.createElement(MobileNav, { page, setPage: (p) => {
    setPage(p);
  }, user, setShowAuth, setShowForm, unreadCount, setShowEstim })))), /* @__PURE__ */ React.createElement("div", { className: "bottom-nav" }, /* @__PURE__ */ React.createElement("div", { className: "bottom-nav-inner" }, /* @__PURE__ */ React.createElement("button", { className: `bnav-item ${page === "home" ? "on" : ""}`, onClick: () => setPage("home") }, /* @__PURE__ */ React.createElement("span", { className: "bnav-ico" }, "\u{1F3E0}"), /* @__PURE__ */ React.createElement("span", { className: "bnav-label" }, "Accueil")), /* @__PURE__ */ React.createElement("button", { className: `bnav-item ${page === "listings" ? "on" : ""}`, onClick: () => setPage("listings") }, /* @__PURE__ */ React.createElement("span", { className: "bnav-ico" }, "\u{1F50D}"), /* @__PURE__ */ React.createElement("span", { className: "bnav-label" }, "Annonces")), /* @__PURE__ */ React.createElement("button", { className: `bnav-item ${page === "map" ? "on" : ""}`, onClick: () => setPage("map") }, /* @__PURE__ */ React.createElement("span", { className: "bnav-ico" }, "\u{1F5FA}\uFE0F"), /* @__PURE__ */ React.createElement("span", { className: "bnav-label" }, "Carte")), user ? /* @__PURE__ */ React.createElement("button", { className: `bnav-item ${page === "dashboard" ? "on" : ""}`, onClick: () => setPage("dashboard"), style: { position: "relative" } }, /* @__PURE__ */ React.createElement("span", { className: "bnav-ico" }, "\u{1F464}"), unreadCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "bnav-badge" }, unreadCount > 9 ? "9+" : unreadCount), /* @__PURE__ */ React.createElement("span", { className: "bnav-label" }, "Profil")) : /* @__PURE__ */ React.createElement("button", { className: "bnav-item", onClick: () => setShowAuth(true) }, /* @__PURE__ */ React.createElement("span", { className: "bnav-ico" }, "\u{1F511}"), /* @__PURE__ */ React.createElement("span", { className: "bnav-label" }, "Connexion")))), showAuth && /* @__PURE__ */ React.createElement(AuthModal, { onClose: () => setShowAuth(false), onSuccess: (u) => {
    setUser(u);
    setShowAuth(false);
    setPage("dashboard");
    showT("Bienvenue sur SeneGalsen ! \u{1F389}");
    // Charger profil DB ET détecter le type (diaspora/role pro) depuis la source de vérité
    loadUserData(u).then(() => {
      sb.from("profiles").select("user_type,role").eq("id", u.id).single().then(({ data: p }) => {
        if (p && p.user_type === "diaspora" && u?.user_metadata?.user_type === "diaspora") {
          // Montrer le welcome uniquement pour les nouveaux comptes diaspora
          setShowDiasporaWelcome(true);
        }
      });
    });
  } }), showDiasporaWelcome && /* @__PURE__ */ React.createElement(DiasporaWelcomeModal, { profile: appProfile, onClose: () => setShowDiasporaWelcome(false), onBrowse: () => {
    setShowDiasporaWelcome(false);
    setPage("listings");
  }, onEstim: () => {
    setShowDiasporaWelcome(false);
    setShowEstim(true);
  } }), showForm && user && /* @__PURE__ */ React.createElement(ListingForm, { user, onClose: () => setShowForm(false), onSuccess: (l) => {
    setShowForm(false);
    setListings((ls) => [l, ...ls]);
    setStats((s) => ({ ...s, total: s.total + 1 }));
    showT("\u2705 Annonce publi\xE9e !");
    open(l, "home");
  } }), showEstim && /* @__PURE__ */ React.createElement(EstimationModal, { listings, onClose: () => {
    setShowEstim(false);
    setPage("listings");
  } }), toast && /* @__PURE__ */ React.createElement("div", { className: `toast t${toast.type}` }, toast.msg), showCmp && cmpItems.length >= 2 && /* @__PURE__ */ React.createElement(CompareModal, { items: cmpItems, onClose: () => setShowCmp(false) }), showAlert && user && /* @__PURE__ */ React.createElement(AlertModal, { user, currentFilters: { txF, propF, advF }, onClose: () => setShowAlert(false), showToast: showT }), /* @__PURE__ */ React.createElement(CompareBar, { items: cmpItems, onRemove: (id) => setCmpItems((p) => p.filter((x) => x.id !== id)), onClear: () => setCmpItems([]), onCompare: () => setShowCmp(true) }), page === "home" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "hero" }, /* @__PURE__ */ React.createElement("div", { className: "heroi" }, /* @__PURE__ */ React.createElement("div", { className: "htag" }, "\u{1F1F8}\u{1F1F3} La r\xE9f\xE9rence immobili\xE8re au S\xE9n\xE9gal"), /* @__PURE__ */ React.createElement("h1", null, "Votre bien ", /* @__PURE__ */ React.createElement("em", null, "id\xE9al au S\xE9n\xE9gal"), /* @__PURE__ */ React.createElement("br", null), "vous attend ici"), /* @__PURE__ */ React.createElement("p", null, "Appartements, villas, terrains \u2014 Annonces v\xE9rifi\xE9es dans tout le S\xE9n\xE9gal"), /* @__PURE__ */ React.createElement("div", { className: "sbox" }, /* @__PURE__ */ React.createElement("div", { className: "stabs" }, Object.entries(TXL).map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `stab ${stab === v ? "on" : ""}`, onClick: () => setStab(v) }, l))), /* @__PURE__ */ React.createElement("div", { className: "srow" }, /* @__PURE__ */ React.createElement(SearchAutocomplete, { value: searchQ, onChange: (v) => {
    setSearchQ(v);
  }, onSubmit: () => {
    setTxF(stab);
    setPage("listings");
  }, listings }), /* @__PURE__ */ React.createElement("select", { className: "si", style: { flex: "0 0 140px" }, onChange: (e) => setPropF(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Type de bien"), Object.entries(PICO).map(([v, i]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, i, " ", v.charAt(0).toUpperCase() + v.slice(1)))), /* @__PURE__ */ React.createElement("button", { className: "sbtn", onClick: () => {
    setTxF(stab);
    setPage("listings");
  } }, "\u{1F50D} Chercher"))), /* @__PURE__ */ React.createElement("button", { className: "estim-hero-btn", onClick: () => setShowEstim(true) }, "\u{1F4B0} Estimer mon bien gratuitement \u2192"))), /* @__PURE__ */ React.createElement("div", { className: "sbar" }, /* @__PURE__ */ React.createElement("div", { className: "sbari" }, [[stats.total + "+", "Annonces actives"], [stats.agencies + "+", "Agences"], [stats.cities + "+", "Villes"], ["100%", "V\xE9rifi\xE9"]].map(([n, l]) => /* @__PURE__ */ React.createElement("div", { className: "st", key: l }, /* @__PURE__ */ React.createElement("div", { className: "stn" }, n), /* @__PURE__ */ React.createElement("div", { className: "stl" }, l))))), newCount > 0 && /* @__PURE__ */ React.createElement("div", { style: { background: "var(--gm)", color: "#fff", textAlign: "center", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }, onClick: () => {
    setNewCount(0);
    window.scrollTo(0, 0);
    window.location.reload?.();
  } }, "\u{1F195} ", newCount, " nouvelle", newCount > 1 ? "s" : "", " annonce", newCount > 1 ? "s" : "", " publi\xE9e", newCount > 1 ? "s" : "", "  \u2014 Actualiser"), /* @__PURE__ */ React.createElement("div", { className: "sec" }, /* @__PURE__ */ React.createElement("div", { className: "sech" }, /* @__PURE__ */ React.createElement("h2", { className: "sectl" }, "Annonces ", /* @__PURE__ */ React.createElement("span", null, "\xE0 la une")), /* @__PURE__ */ React.createElement("button", { className: "seclink", onClick: () => setPage("listings") }, "Voir toutes \u2192")), /* @__PURE__ */ React.createElement("div", { className: "grid" }, loading ? [1, 2, 3].map((i) => /* @__PURE__ */ React.createElement(Skel, { key: i })) : featured.map((l) => /* @__PURE__ */ React.createElement(Card, { key: l.id, l, onClick: () => open(l, "home"), favIds, onFav: toggleFav })))), /* @__PURE__ */ React.createElement("div", { className: "sec", style: { paddingTop: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "sech" }, /* @__PURE__ */ React.createElement("h2", { className: "sectl" }, "Derni\xE8res ", /* @__PURE__ */ React.createElement("span", null, "annonces")), /* @__PURE__ */ React.createElement("button", { className: "seclink", onClick: () => setPage("listings") }, "Tout voir \u2192")), /* @__PURE__ */ React.createElement("div", { className: "grid" }, loading ? [1, 2, 3, 4, 5, 6].map((i) => /* @__PURE__ */ React.createElement(Skel, { key: i })) : listings.slice(0, 6).map((l) => /* @__PURE__ */ React.createElement(Card, { key: l.id, l, onClick: () => open(l, "home"), favIds, onFav: toggleFav })))), user && recentlyViewed.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "sec", style: { paddingTop: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "sech" }, /* @__PURE__ */ React.createElement("h2", { className: "sectl" }, "R\xE9cemment ", /* @__PURE__ */ React.createElement("span", null, "consult\xE9s")), /* @__PURE__ */ React.createElement("button", { className: "seclink", onClick: () => setPage("listings") }, "Voir toutes \u2192")), /* @__PURE__ */ React.createElement("div", { className: "grid" }, recentlyViewed.slice(0, 3).map((l) => /* @__PURE__ */ React.createElement(Card, { key: l.id, l, onClick: () => open(l, "home"), favIds, onFav: toggleFav })))), /* @__PURE__ */ React.createElement(DiasporaSection, { onEstim: () => setShowEstim(true), onBrowse: () => setPage("listings") }), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--nv)", padding: "34px 20px", textAlign: "center" } }, /* @__PURE__ */ React.createElement("h2", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 19, color: "#fff", marginBottom: 6 } }, "\u{1F5FA}\uFE0F Explorez sur la carte"), /* @__PURE__ */ React.createElement("p", { style: { color: "rgba(255,255,255,.55)", fontSize: 12, marginBottom: 16 } }, "Visualisez les biens g\xE9olocalis\xE9s et les prix par quartier"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPage("map"), style: { background: "var(--au)", color: "#1a1a1a", padding: "9px 22px", borderRadius: 100, font: "700 12px/1 var(--fd)", border: "none", cursor: "pointer" } }, "Ouvrir la carte"), /* @__PURE__ */ React.createElement("button", { onClick: () => setPage("prices"), style: { background: "rgba(255,255,255,.12)", color: "#fff", padding: "9px 22px", borderRadius: 100, font: "700 12px/1 var(--fd)", border: "1px solid rgba(255,255,255,.25)", cursor: "pointer" } }, "\u{1F4CA} Prix par quartier"))), /* @__PURE__ */ React.createElement("div", { className: "promo" }, /* @__PURE__ */ React.createElement("h2", null, "Vous \xEAtes une agence immobili\xE8re ?"), /* @__PURE__ */ React.createElement("p", null, "Publiez vos annonces, g\xE9rez vos clients et boostez votre visibilit\xE9."), /* @__PURE__ */ React.createElement("button", { className: "pbtn", onClick: () => setShowAuth(true) }, "\u{1F680} Essai gratuit 30 jours"))), page === "listings" && /* @__PURE__ */ React.createElement("div", { className: "sec" }, /* @__PURE__ */ React.createElement("h1", { className: "sectl", style: { marginBottom: 18 } }, "Toutes les annonces ", /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 400, fontSize: 15, color: "var(--mu)" } }, "(", filtered.length, " r\xE9sultats)")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("input", { className: "si", style: { flex: 1, minWidth: 180 }, placeholder: "Rechercher par quartier, ville...", value: searchQ, onChange: (e) => setSearchQ(e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "fils" }, /* @__PURE__ */ React.createElement("span", { className: "flab" }, "Transaction :"), [["all", "Tous"], ["vente", "Vente"], ["location", "Location"], ["location_saisonniere", "Saisonnier"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${txF === v ? "on" : ""}`, onClick: () => setTxF(v) }, l))), /* @__PURE__ */ React.createElement("div", { className: "fils" }, /* @__PURE__ */ React.createElement("span", { className: "flab" }, "Type :"), [["all", "Tous"], ["appartement", "\u{1F3E2}"], ["maison", "\u{1F3E0}"], ["villa", "\u{1F3E1}"], ["terrain", "\u{1F33F}"], ["bureau", "\u{1F4BC}"], ["commerce", "\u{1F3EA}"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${propF === v ? "on" : ""}`, onClick: () => setPropF(v), title: v }, l, " ", v !== "all" ? v.charAt(0).toUpperCase() + v.slice(1) : ""))), /* @__PURE__ */ React.createElement(AdvFilters, { filters: advF, onChange: (k, v) => setAdvF((f) => ({ ...f, [k]: v })), onReset: () => setAdvF({}) }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, fontWeight: 800, color: "var(--mu)", textTransform: "uppercase", letterSpacing: ".5px", alignSelf: "center" } }, "Trier :"), [["date", "Plus r\xE9centes"], ["price_asc", "Prix \u2191"], ["price_desc", "Prix \u2193"], ["views", "Plus vues"], ["trust", "Confiance"]].map(([v, l]) => /* @__PURE__ */ React.createElement("button", { key: v, className: `fbt ${sortBy === v ? "on" : ""}`, onClick: () => setSortBy(v), style: { fontSize: 10, padding: "5px 10px" } }, l))), /* @__PURE__ */ React.createElement("button", { className: "fbt", onClick: () => user ? setShowAlert(true) : setShowAuth(true), style: { display: "flex", alignItems: "center", gap: 5 } }, "\u{1F514} Cr\xE9er une alerte")), loading ? /* @__PURE__ */ React.createElement("div", { className: "grid" }, [1, 2, 3, 4, 5, 6].map((i) => /* @__PURE__ */ React.createElement(Skel, { key: i }))) : filtered.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "48px 20px", color: "var(--mu)" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 38, marginBottom: 8 } }, "\u{1F50D}"), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--fd)", fontSize: 16, fontWeight: 700, color: "var(--tx)", marginBottom: 5 } }, "Aucun r\xE9sultat"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12 } }, "Modifiez vos filtres ou votre recherche."), /* @__PURE__ */ React.createElement("button", { className: "fbt", style: { marginTop: 12 }, onClick: () => {
    setSearchQ("");
    setTxF("all");
    setPropF("all");
    setAdvF({});
    setSortBy("date");
  } }, "R\xE9initialiser tout")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "grid" }, paged.map((l) => /* @__PURE__ */ React.createElement("div", { key: l.id, style: { position: "relative" } }, /* @__PURE__ */ React.createElement(Card, { l, onClick: () => open(l, "listings"), favIds, onFav: toggleFav }), /* @__PURE__ */ React.createElement("button", { onClick: () => toggleCmp(l), title: cmpItems.find((x) => x.id === l.id) ? "Retirer du comparateur" : "Ajouter au comparateur", style: { position: "absolute", bottom: 46, right: 10, background: cmpItems.find((x) => x.id === l.id) ? "var(--nv)" : "rgba(255,255,255,.92)", color: cmpItems.find((x) => x.id === l.id) ? "#fff" : "var(--mu)", border: "1.5px solid var(--br)", borderRadius: 7, padding: "3px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer", zIndex: 10 } }, cmpItems.find((x) => x.id === l.id) ? "\u2696\uFE0F \u2713" : "\u2696\uFE0F Comparer")))), hasMore && /* @__PURE__ */ React.createElement("div", { className: "loadmore-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "loadmore-btn", onClick: () => setListPage((p) => p + 1) }, "Voir plus d'annonces (", filtered.length - paged.length, " restantes)")), !hasMore && filtered.length > PAGE_SIZE && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "20px 0", fontSize: 12, color: "var(--mu)" } }, "\u2705 Toutes les ", filtered.length, " annonces affich\xE9es"))), page === "map" && /* @__PURE__ */ React.createElement(MapPage, { listings, onSelect: (l) => open(l, "map") }), page === "prices" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 1280, margin: "0 auto", padding: "20px 20px 0" } }, /* @__PURE__ */ React.createElement("button", { className: "bkb", onClick: () => setPage("home") }, "\u2190 Accueil"), /* @__PURE__ */ React.createElement("h1", { style: { fontFamily: "var(--fd)", fontWeight: 800, fontSize: 20, marginTop: 14, marginBottom: 4 } }, "\u{1F4CA} March\xE9 immobilier s\xE9n\xE9galais"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--mu)", marginBottom: 0 } }, "Prix m\xE9dians par quartier, mis \xE0 jour en temps r\xE9el depuis les annonces actives")), /* @__PURE__ */ React.createElement(PriceTable, null)), page === "verified" && /* @__PURE__ */ React.createElement(MarketingVerifiedPage, { onBack: () => setPage(prevPage || "home"), onBrowse: () => { setAdvF(f => ({...f, verifiedOnly: true})); setPage("listings"); }, onEstim: () => { setPage("home"); setShowEstim(true); } }), page === "market" && /* @__PURE__ */ React.createElement(MarketAnalyticsPage, { listings, onBack: () => setPage("home"), onOpenListing: (l) => open(l, "market") }), page === "detail" && selected && /* @__PURE__ */ React.createElement(DetailPage, { l: selected, user, onBack: () => {
    setPage(prevPage);
    window.scrollTo(0, 0);
  }, onOpenListing: (l) => open(l, "detail"), onShowAgency: (id) => showAgency(id, "detail"), favIds, onFav: toggleFav, showToast: showT }), page === "agency" && agencyId2 && /* @__PURE__ */ React.createElement(AgencyPage, { agencyId: agencyId2, onBack: () => {
    setPage(prevPage);
    window.scrollTo(0, 0);
  }, onOpenListing: (l) => open(l, "agency"), favIds, onFav: toggleFav, user, showToast: showT }), page === "dashboard" && user && /* @__PURE__ */ React.createElement(Dashboard, { user, onOpenListing: (l) => open(l, "dashboard"), onShowAgency: (id) => showAgency(id, "dashboard"), onLogout: logout, favIds, onFav: toggleFav, initialProfile: appProfile }), /* @__PURE__ */ React.createElement("footer", { className: "footer" }, /* @__PURE__ */ React.createElement("div", { className: "flogo" }, "\u{1F3E1} Sene", /* @__PURE__ */ React.createElement("span", null, "Galsen"), " Immobilier"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 11, marginBottom: 9 } }, "La plateforme immobili\xE8re de r\xE9f\xE9rence au S\xE9n\xE9gal"), /* @__PURE__ */ React.createElement("div", { className: "flinks" }, ["Accueil", "Annonces", "Carte", "Prix", "Accueil", "Bien V\xE9rifi\xE9 \u2705", "Annonces", "Carte", "Prix", "Agences", "Contact"].map((l) => /* @__PURE__ */ React.createElement("span", { key: l, className: "flnk", onClick: () => {
    if (l === "Annonces") setPage("listings");
    else if (l.includes("rifi")) setPage("verified");
    else if (l === "Carte") setPage("map");
    else if (l === "Prix") setPage("prices");
    else setPage("home");
  } }, l))), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 10, opacity: 0.35 } }, "\xA9 2026 SeneGalsen Immobilier \xB7 Dakar, S\xE9n\xE9gal"))));
}
