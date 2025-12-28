/* ===================== Firebase bootstrap ===================== */
if (!window.SUFA_FIREBASE_CONFIG || !window.SUFA_FIREBASE_CONFIG.projectId) {
  alert('config ב-index.html לא מוגדר. צריך להדביק Firebase');
  throw new Error('Missing SUFA_FIREBASE_CONFIG');
}

const el = (id)=>document.getElementById(id);

let editMode = false;
let sortState = { key: "id", dir: "asc" };
let working = { last_updated: "", drones: [] };

let fb = { enabled:false, app:null, auth:null, db:null, user:null };

function normalize(s){ return (s||"").toString().trim().toLowerCase(); }

function downloadTextFile(filename, text){
  const blob = new Blob([text], {type:"application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function boolToMark(v){ return v ? "✓" : ""; }

function statusClass(status){
  if(status === "תקין" || status === "תקין – בשלבי בדיקה") return "ok";
  if(status === "במעקב") return "warn";
  if(status === "לא תקין") return "bad";
  if(status === "נמסר") return "delivered";
  if(status === "חדש") return "new";
  return "warn";
}
function stamp(){ working.last_updated = new Date().toISOString().slice(0,16); }

function getHeaders(){
  return [
    {key:"id", label:"מספר"},
    {key:"location", label:"מיקום"},
    {key:"status", label:"סטטוס"},
    {key:"version", label:"גרסה"},
    {key:"gps", label:"GPS"},
    {key:"charger", label:"מטען"},
    {key:"issues", label:"תקלות / תיקונים"},
    {key:"notes", label:"הערות"},
  ];
}

function compare(a,b){
  if(a===b) return 0;
  if(a==null && b!=null) return -1;
  if(a!=null && b==null) return 1;
  const na = Number(a), nb = Number(b);
  if(!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), "he");
}
function sortDrones(drones){
  const {key, dir} = sortState;
  const mult = dir === "asc" ? 1 : -1;
  return drones.slice().sort((x,y)=>{
    let ax = x[key], ay = y[key];
    if(key==="gps" || key==="charger"){ ax = x[key]?1:0; ay = y[key]?1:0; }
    return compare(ax, ay) * mult;
  });
}

function renderHeader(){
  const thead = document.querySelector("#theadRow");
  const headers = getHeaders();
  thead.innerHTML = headers.map(h=>{
    const isActive = sortState.key === h.key;
    const arrow = isActive ? (sortState.dir === "asc" ? " ▲" : " ▼") : "";
    return `<th data-sort="${h.key}" class="thSort">${h.label}${arrow}</th>`;
  }).join("");

  thead.querySelectorAll("th[data-sort]").forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.getAttribute("data-sort");
      if(sortState.key === key) sortState.dir = (sortState.dir==="asc") ? "desc" : "asc";
      else { sortState.key = key; sortState.dir = "asc"; }
      renderHeader();
      renderTable();
    });
  });
}

function renderKpis(drones){
  const total = drones.length;
  const by = {};
  for(const d of drones) by[d.status] = (by[d.status]||0)+1;
  const chargerOk = drones.filter(d=>d.status==="תקין" && d.charger).length;

  const items = [
    {n: total, l:"סה״כ"},
    {n: by["תקין"]||0, l:"תקינים"},
    {n: by["תקין – בשלבי בדיקה"]||0, l:"תקין – בדיקה"},
    {n: by["לא תקין"]||0, l:"לא תקין"},
    {n: by["במעקב"]||0, l:"במעקב"},
    {n: by["נמסר"]||0, l:"נמסר"},
    {n: by["חדש"]||0, l:"חדשים"},
    {n: chargerOk, l:"תקין + מטען"},
  ];

  el("kpis").innerHTML = items.map(x=>`
    <div class="kpi">
      <div class="n">${x.n}</div>
      <div class="l">${x.l}</div>
    </div>
  `).join("");
}

function updateLastUpdated(){
  const t = working.last_updated ? new Date(working.last_updated) : null;
  const src = fb.enabled ? `Firestore${fb.user ? " (מחובר)" : " (לא מחובר)"}` : "קובץ מקומי";
  const txt = t && !isNaN(t.getTime())
    ? `עדכון אחרון: ${t.toLocaleString("he-IL")} · מקור: ${src}`
    : `עדכון אחרון: — · מקור: ${src}`;
  el("lastUpdated").textContent = txt;
}

function renderTable(){
  const q = normalize(el("search").value);
  const f = el("statusFilter").value;

  let drones = working.drones.slice();
  if(f) drones = drones.filter(d => d.status === f);
  if(q){
    drones = drones.filter(d => {
      const hay = [d.id,d.location,d.status,d.version,d.issues,d.notes]
        .map(x=>normalize(x)).join(" | ");
      return hay.includes(q);
    });
  }

  drones = sortDrones(drones);
  renderKpis(drones);

  const tbody = el("tbody");
  tbody.innerHTML = "";

  for(const d of drones){
    const tr = document.createElement("tr");
    const cells = [
      {key:"id", val:d.id, editable:false},
      {key:"location", val:d.location||"", editable:true},
      {key:"status", val:d.status||"", editable:true, type:"status"},
      {key:"version", val:d.version||"", editable:true},
      {key:"gps", val:boolToMark(!!d.gps), editable:true, type:"bool"},
      {key:"charger", val:boolToMark(!!d.charger), editable:true, type:"bool"},
      {key:"issues", val:d.issues||"", editable:true},
      {key:"notes", val:d.notes||"", editable:true},
    ];

    for(const c of cells){
      const td = document.createElement("td");

      if(c.key === "status"){
        if(editMode){
          td.innerHTML = `
            <select class="input editable" data-id="${d.id}" data-key="status">
              ${["תקין","תקין – בשלבי בדיקה","לא תקין","במעקב","נמסר","חדש"].map(s=>
                `<option ${s===d.status?"selected":""}>${s}</option>`
              ).join("")}
            </select>
          `;
        } else {
          td.innerHTML = `<span class="badge ${statusClass(d.status)}">${d.status}</span>`;
        }
      } else if(c.type === "bool"){
        const on = (c.key === "gps") ? !!d.gps : !!d.charger;
        if(editMode){
          td.innerHTML = `<input type="checkbox" class="editable" data-id="${d.id}" data-key="${c.key}" ${on?"checked":""} />`;
          td.style.textAlign = "center";
        } else {
          td.innerHTML = `<span class="pill ${on?"on":""}">${on ? "✓" : ""}</span>`;
        }
      } else {
        td.textContent = c.val;
        if(editMode && c.editable){
          td.contentEditable = "true";
          td.classList.add("editable");
          td.dataset.id = d.id;
          td.dataset.key = c.key;
        } else {
          td.contentEditable = "false";
          td.classList.remove("editable");
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  el("toggleEdit").textContent = editMode ? "סיום עריכה" : "עריכה";
  updateLastUpdated();
}

function findDrone(id){
  return working.drones.find(x=>String(x.id)===String(id));
}

function applyEditsFromDom(){
  document.querySelectorAll("[contenteditable='true'][data-id][data-key]").forEach(td=>{
    const d = findDrone(td.dataset.id);
    if(!d) return;
    d[td.dataset.key] = td.textContent.trim();
  });

  document.querySelectorAll("select[data-id][data-key]").forEach(sel=>{
    const d = findDrone(sel.dataset.id);
    if(!d) return;
    d[sel.dataset.key] = sel.value;
  });

  document.querySelectorAll("input[type='checkbox'][data-id][data-key]").forEach(ch=>{
    const d = findDrone(ch.dataset.id);
    if(!d) return;
    d[ch.dataset.key] = !!ch.checked;
  });

  stamp();
}

function promptAddDrone(){
  const id = (prompt("מספר רחפן (למשל 7080):") || "").trim();
  if(!id) return;
  if(working.drones.some(d=>String(d.id)===String(id))){
    alert("רחפן עם מספר כזה כבר קיים.");
    return;
  }

  const location = (prompt("מיקום:", "תעש") || "").trim();
  const status = (prompt("סטטוס (תקין / לא תקין / במעקב / נמסר / חדש / תקין – בשלבי בדיקה):", "תקין") || "תקין").trim();
  const version = (prompt("גרסת תוכנה (אופציונלי):", "") || "").trim();

  working.drones.push({
    id, location, status, version,
    gps:false, charger:false, issues:"", notes:""
  });
  stamp();
  renderTable();
}

async function loadLocalJson(){
  const res = await fetch("./drones.json", {cache:"no-store"});
  if(!res.ok) throw new Error("Failed to load local drones.json");
  return await res.json();
}

/* ---------------- Firebase ---------------- */
function initFirebase(){
  const cfg = window.SUFA_FIREBASE_CONFIG;
  if(!cfg) return false;

  try{
    // ✅ init only once
    fb.app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg);
    fb.db = firebase.firestore();
    fb.auth = firebase.auth();
    fb.enabled = true;

    fb.auth.onAuthStateChanged(async (user)=>{
      fb.user = user || null;
      el("logoutBtn")?.classList.toggle("hidden", !fb.user);
      const loginBtn = el("loginBtn");
      if(loginBtn) loginBtn.textContent = fb.user ? "מחובר" : "התחבר";
      updateLastUpdated();

      if(fb.user){
        try{
          await loadFromFirestore();
          renderTable();
        }catch(e){
          console.error(e);
        }
      }
    });

    return true;
  }catch(e){
    console.error(e);
    alert("Firebase init failed: " + e.message);
    return false;
  }
}

function statusDocRef(){ return fb.db.collection("sufa").doc("status"); }
function dronesColRef(){ return statusDocRef().collection("drones"); }

async function loadFromFirestore(){
  const metaSnap = await statusDocRef().get();
  const meta = metaSnap.exists ? metaSnap.data() : {};
  const last_updated = meta.last_updated || "";

  const snap = await dronesColRef().get();
  const drones = [];
  snap.forEach(doc=>{
    const d = doc.data() || {};
    d.id = d.id || doc.id;
    drones.push(d);
  });

  if(drones.length){
    working = { last_updated, drones };
  }
}

async function saveToFirestore(){
  if(!fb.user) throw new Error("Not logged in");

  stamp();
  const batch = fb.db.batch();

  batch.set(statusDocRef(), { last_updated: working.last_updated }, { merge:true });

  for(const d of working.drones){
    const id = String(d.id);
    const ref = dronesColRef().doc(id);
    batch.set(ref, {
      id,
      location: d.location||"",
      status: d.status||"",
      version: d.version||"",
      gps: !!d.gps,
      charger: !!d.charger,
      issues: d.issues||"",
      notes: d.notes||"",
    }, { merge:true });
  }

  await batch.commit();
}

async function seedFirestoreIfEmpty(){
  const snap = await dronesColRef().limit(1).get();
  if(!snap.empty) return;
  await saveToFirestore();
}

async function doLogin(){
  if(!fb.enabled) return alert("Firebase לא מוגדר. צריך להדביק config ב-index.html");

  const email = (prompt("אימייל Firebase:", "") || "").trim();
  const password = (prompt("סיסמה:", "") || "").trim();
  if(!email || !password) return;

  try{
    await fb.auth.signInWithEmailAndPassword(email, password);
    await seedFirestoreIfEmpty();
    await loadFromFirestore();
    renderTable();
  }catch(e){
    alert("שגיאת התחברות: " + e.message);
  }
}

async function doLogout(){
  try{ await fb.auth.signOut(); }catch(e){}
}

/* ----------- Admin actions: Import / Clear+Import ----------- */
async function importAllFromLocalToFirestore(){
  if(!fb.enabled) throw new Error("Firestore not enabled");
  if(!fb.user) throw new Error("Not logged in");

  const local = await loadLocalJson();
  if(!local || !Array.isArray(local.drones)) throw new Error("Bad drones.json format");

  working = local;
  stamp();
  await saveToFirestore();
}

async function clearFirestoreDrones(){
  if(!fb.enabled) throw new Error("Firestore not enabled");
  if(!fb.user) throw new Error("Not logged in");

  const col = dronesColRef();
  while(true){
    const snap = await col.limit(450).get();
    if(snap.empty) break;

    const batch = fb.db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  await statusDocRef().set({ last_updated: "" }, { merge:true });
}

async function clearAndImport(){
  await clearFirestoreDrones();
  await importAllFromLocalToFirestore();
}


/* ----------- Admin actions: Paste JSON Import / Clear+Import / Export ----------- */
function parsePastedJson(raw){
  let txt = (raw||"");
  // Support pasting from chat/code blocks
  txt = txt.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if(!txt) throw new Error("הטקסט ריק");

  const obj0 = JSON.parse(txt);

  // Accept 3 formats:
  // 1) { last_updated, drones:[...] }  ✅ recommended
  // 2) { drones:[...] }
  // 3) [ {...}, {...} ]  (treated as drones array)
  const obj = Array.isArray(obj0) ? { drones: obj0 } : obj0;

  if(!obj || !Array.isArray(obj.drones)) throw new Error("פורמט לא תקין: צריך drones[] או מערך רשומות");
  if(!obj.last_updated) obj.last_updated = new Date().toISOString().slice(0,16);
  obj.drones = obj.drones
    .map(d=>({ ...d, id: String(d.id||"").trim() }))
    .filter(d=>d.id);
  return obj;
}

async function importFromPasteJson(raw){
  if(!fb.enabled) throw new Error("Firestore not enabled");
  if(!fb.user) throw new Error("Not logged in");
  const obj = parsePastedJson(raw);
  working = obj;
  if(!working.last_updated) stamp();
  await saveToFirestore();
}

async function clearAndImportFromPasteJson(raw){
  await clearFirestoreDrones();
  await importFromPasteJson(raw);
}

async function exportJsonFromFirestore(){
  if(!fb.enabled) throw new Error("Firestore not enabled");
  await loadFromFirestore();
  const payload = {
    last_updated: working.last_updated || new Date().toISOString().slice(0,16),
    drones: (working.drones||[])
  };
  const filename = `sufa_drones_${(payload.last_updated||"").replace(/[:]/g,"-")}.json`;
  downloadTextFile(filename, JSON.stringify(payload, null, 2));
}

/* ---------------- Wire ---------------- */
  el("applyPasteBtn")?.addEventListener("click", async ()=>{
    if(!fb.enabled) return alert("Firebase לא מוגדר (אין Firestore).");
    try{
      const raw = (jsonPaste?.value||"");
      const obj = parsePastedJson(raw);

      // תמיד נטען לטבלה מקומית כדי שתראה מיד שזה עובד
      working = obj;
      renderTable();

      // שמירה ל-DB רק אם מחוברים
      if(!fb.user){
        const msg = "נטען לטבלה (לוקאלי). כדי לשמור ל-DB: התחבר ואז לחץ שוב על ייבוא ל‑DB.";
        if(jsonHint) jsonHint.textContent = msg;
        return alert(msg);
      }

      if(!confirm("לשמור את ה-JSON המודבק ל-DB (Upsert)?")) return;
      await importFromPasteJson(raw);
      await loadFromFirestore();
      renderTable();
      if(jsonHint) jsonHint.textContent = "ייבוא ל‑DB הסתיים בהצלחה ✅";
      alert("ייבוא ל‑DB הסתיים בהצלחה ✅");
    }catch(e){
      if(jsonHint) jsonHint.textContent = "שגיאה: " + e.message;
      alert("ייבוא נכשל: " + e.message);
    }
  });
      await loadFromFirestore();
      renderTable();
      if(jsonHint) jsonHint.textContent = "ייבוא הסתיים בהצלחה ✅";
      alert("ייבוא הסתיים בהצלחה ✅");
    }catch(e){
      if(jsonHint) jsonHint.textContent = "שגיאה: " + e.message;
      alert("ייבוא נכשל: " + e.message);
    }
  });
  el("clearApplyPasteBtn")?.addEventListener("click", async ()=>{
    if(!fb.enabled) return alert("Firebase לא מוגדר (אין Firestore).");
    if(!fb.user) return alert("כדי לנקות/לייבא צריך להתחבר.");
    try{
      const raw = (jsonPaste?.value||"");
      const ok = confirm("אזהרה: זה ימחק את כל נתוני הרחפנים ב-DB ואז ייבא מה-JSON המודבק. להמשיך?");
      if(!ok) return;
      await clearAndImportFromPasteJson(raw);
      await loadFromFirestore();
      renderTable();
      if(jsonHint) jsonHint.textContent = "ניקוי + ייבוא הסתיים בהצלחה ✅";
      alert("ניקוי + ייבוא הסתיים בהצלחה ✅");
    }catch(e){
      if(jsonHint) jsonHint.textContent = "שגיאה: " + e.message;
      alert("ניקוי/ייבוא נכשל: " + e.message);
    }
  });
  el("exportJsonBtn")?.addEventListener("click", async ()=>{
    if(!fb.enabled) return alert("Firebase לא מוגדר (אין Firestore).");
    try{ await exportJsonFromFirestore(); }
    catch(e){ alert("ייצוא נכשל: " + e.message); }
  });

  const importBtn_unused = el("importBtn_unused");
  const clearImportBtn_unused = el("clearImportBtn_unused");

  if(importBtn_unused) importBtn_unused.addEventListener("click", async ()=>{
    if(!fb.enabled) return alert("Firebase לא מוגדר. צריך להדביק config ב-index.html");
    if(!fb.user) return alert("כדי לייבא ל-DB צריך להתחבר.");
    if(!confirm("לייבא את כל הנתונים מקובץ drones.json ל-Firestore? (פעולה תעדכן/תוסיף רשומות)")) return;
    try{
      await importAllFromLocalToFirestore();
      await loadFromFirestore();
      renderTable();
      alert("ייבוא הסתיים בהצלחה ✅");
    }catch(e){
      alert("ייבוא נכשל: " + e.message);
    }
  });

  if(clearImportBtn_unused) clearImportBtn_unused.addEventListener("click", async ()=>{
    if(!fb.enabled) return alert("Firebase לא מוגדר. צריך להדביק config ב-index.html");
    if(!fb.user) return alert("כדי לנקות/לייבא צריך להתחבר.");
    const ok = confirm("אזהרה: זה ימחק את כל נתוני הרחפנים ב-Firestore ואז ייבא מחדש מ-drones.json. להמשיך?");
    if(!ok) return;
    try{
      await clearAndImport();
      await loadFromFirestore();
      renderTable();
      alert("ניקוי + ייבוא הסתיים בהצלחה ✅");
    }catch(e){
      alert("ניקוי/ייבוא נכשל: " + e.message);
    }
  });

  el("search")?.addEventListener("input", ()=>renderTable());
  el("statusFilter")?.addEventListener("change", ()=>renderTable());

  el("addDrone")?.addEventListener("click", async ()=>{
    promptAddDrone();
    if(fb.enabled && fb.user){
      try{ await saveToFirestore(); } catch(e){ alert("שמירה ל-Firestore נכשלה: " + e.message); }
    }
  });

  el("toggleEdit")?.addEventListener("click", async ()=>{
    if(editMode){
      applyEditsFromDom();
      editMode = false;
      renderTable();

      if(fb.enabled){
        if(!fb.user){ alert("כדי לשמור ל-Firestore צריך להתחבר."); return; }
        try{ await saveToFirestore(); } catch(e){ alert("שמירה ל-Firestore נכשלה: " + e.message); }
      }
    }else{
      editMode = true;
      renderTable();
    }
  });

  el("loginBtn")?.addEventListener("click", async ()=>{
    if(fb.user) return;
    await doLogin();
  });

  el("logoutBtn")?.addEventListener("click", doLogout);
}

(async function init(){
  renderHeader();
  initFirebase();

  try{
    working = await loadLocalJson(); // show something immediately
    stamp();
    renderTable();
  }catch(err){
    const lu = el("lastUpdated");
    if(lu) lu.textContent = "שגיאה בטעינת נתונים: " + err.message;
    console.error(err);
  }

  wire();
})();
