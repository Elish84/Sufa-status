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

const ALL_STATUSES = [
  "תקין",
  "תקין – בשלבי בדיקה",
  "רחפן תקין- חוסר בחומרה",
  "רחפן מוכן למסירה",
  "לא תקין",
  "במעקב",
  "נמסר",
  "חדש",
  "לא ידוע"
];

const ALL_TYPES = [
  "רחפן",
  "רחפן EGV",
  "Osprey-H",
  "תחנה",
  "אחר"
];

function statusClass(status){
  if(status === "תקין" || status === "תקין – בשלבי בדיקה") return "ok";
  if(status === "רחפן תקין- חוסר בחומרה") return "missing-hw";
  if(status === "רחפן מוכן למסירה") return "ready";
  if(status === "לא ידוע") return "unknown";
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
    { key: "type", label: "סוג" },
    {key:"location", label:"מיקום"},
    {key:"status", label:"סטטוס"},
    {key:"version", label:"גרסה"},
    {key:"gps", label:"GPS"},
    {key:"charger", label:"מטען"},
    {key:"issues", label:"תקלות / תיקונים"},
    {key:"notes", label:"הערות"},
    {key:"_actions", label:"פעולות"}, 
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
      renderAllViews();
    });
  });
}

function renderKpis(drones){
  const total = drones.length;
  const by = {};
  for(const d of drones) by[d.status] = (by[d.status]||0)+1;
  const chargerOk = drones.filter(d=>(d.status==="תקין" || d.status==="רחפן מוכן למסירה") && d.charger).length;

  const items = [
    {n: total, l:"סה״כ"},
    {n: by["תקין"]||0, l:"תקינים"},
    {n: by["תקין – בשלבי בדיקה"]||0, l:"בשלבי בדיקה"},
    {n: by["רחפן תקין- חוסר בחומרה"]||0, l:"חוסר בחומרה"},
    {n: by["רחפן מוכן למסירה"]||0, l:"מוכן למסירה"},
    {n: by["לא תקין"]||0, l:"לא תקין"},
    {n: by["במעקב"]||0, l:"במעקב"},
    {n: by["נמסר"]||0, l:"נמסר"},
    {n: by["חדש"]||0, l:"חדשים"},
    {n: by["לא ידוע"]||0, l:"לא ידוע"},
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
  const tf = el("typeFilter") ? el("typeFilter").value : "";
  
  let drones = working.drones.slice();
  if(f) drones = drones.filter(d => d.status === f);
  if(tf) drones = drones.filter(d => (d.type || "רחפן") === tf);
  if(q){
    drones = drones.filter(d => {
      const hay = [d.id,d.type,d.location,d.status,d.version,d.issues,d.notes]
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
      {key:"type", val:d.type || "רחפן", editable:true, type:"type"},
      {key:"location", val:d.location||"", editable:true},
      {key:"status", val:d.status||"", editable:true, type:"status"},
      {key:"version", val:d.version||"", editable:true},
      {key:"gps", val:boolToMark(!!d.gps), editable:true, type:"bool"},
      {key:"charger", val:boolToMark(!!d.charger), editable:true, type:"bool"},
      {key:"issues", val:d.issues||"", editable:true},
      {key:"notes", val:d.notes||"", editable:true},
      {key:"_actions"},
    ];


    for(const c of cells){
      const td = document.createElement("td");
// === פעולות (מחיקה) ===
if(c.key === "_actions"){
  if(editMode){
    const btn = document.createElement("button");
    btn.className = "btn danger";
    btn.textContent = "מחק";

btn.onclick = async () => {
  const displayId = String(d.id);              // מה שמציגים למשתמש
  const docId = String(d.docId || d.id);       // מה שמוחקים בפועל (docId אמיתי)

  if(!confirm(`למחוק את רחפן ${displayId}?`)) return;

  // 1) מחיקה לוקאלית (עדיף לפי docId כדי לא למחוק כפולים בטעות)
  const prev = working.drones.slice();
  working.drones = working.drones.filter(x => String(x.docId || x.id) !== docId);
  stamp();
  renderTable();

  // 2) מחיקה מ-Firestore - חייב אותו נתיב של הטעינה
  if(fb.enabled){
    try{
      if(!fb.user){
        alert("כדי למחוק מה-DB צריך להתחבר.");
        working.drones = prev;
        renderTable();
        return;
      }

      // ✅ אם אתה טוען עם dronesColRef() - חובה למחוק ממנו
      await dronesColRef().doc(docId).delete();

      // ❌ אל תשתמש בזה אם הטעינה אינה מאותה קולקשן:
      // await fb.db.collection("drones").doc(docId).delete();

    } catch(e){
      console.error("delete failed:", e);
      alert("מחיקה מה-DB נכשלה (בדוק הרשאות/נתיב).");
      working.drones = prev;
      renderTable();
    }
  }
};



    td.appendChild(btn);
  } else {
    td.textContent = "—";
  }

  tr.appendChild(td);
  continue; // חשוב: לדלג לשדה הבא
}
if(c.key === "type"){
  if(editMode){
    td.innerHTML = `
      <select class="input editable" data-id="${d.id}" data-key="type">
        ${ALL_TYPES.map(t =>
          `<option ${t === (d.type || "רחפן") ? "selected" : ""}>${t}</option>`
        ).join("")}
      </select>
    `;
  } else {
    td.textContent = d.type || "רחפן";
  }
  tr.appendChild(td);
  continue;
}

      if(c.key === "status"){
        if(editMode){
          td.innerHTML = `
            <select class="input editable" data-id="${d.id}" data-key="status">
              ${ALL_STATUSES.map(s=>
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
  const statusListStr = ALL_STATUSES.join(" / ");
  const status = (prompt(`סטטוס (${statusListStr}):`, "תקין") || "תקין").trim();
  const version = (prompt("גרסת תוכנה (אופציונלי):", "") || "").trim();

  working.drones.push({
    id, location, status, version,
    gps:false, charger:false, issues:"", notes:""
  });
  stamp();
  renderAllViews();
}

/* ---------------- DASHBOARD LOGIC ---------------- */
let activeTab = "table";
let selectedStatuses = new Set();
let selectedTypes = new Set();

function getFilteredDrones(){
  const q = normalize(el("search") ? el("search").value : "");
  
  let drones = (working.drones || []).slice();
  if(selectedStatuses.size > 0){
    drones = drones.filter(d => selectedStatuses.has(d.status));
  }
  if(selectedTypes.size > 0){
    drones = drones.filter(d => selectedTypes.has(d.type || "רחפן"));
  }
  if(q){
    drones = drones.filter(d => {
      const hay = [d.id,d.type,d.location,d.status,d.version,d.issues,d.notes]
        .map(x=>normalize(x)).join(" | ");
      return hay.includes(q);
    });
  }
  return drones;
}

function initMultiSelects(){
  const statusOptionsContainer = el("statusMultiOptions");
  if(statusOptionsContainer){
    statusOptionsContainer.innerHTML = ALL_STATUSES.map((s, idx) => `
      <label class="ms-option-row">
        <input type="checkbox" value="${s}" id="st_opt_${idx}" />
        <span class="badge ${statusClass(s)}" style="font-size:11px;">${s}</span>
      </label>
    `).join("");
  }

  const typeOptionsContainer = el("typeMultiOptions");
  if(typeOptionsContainer){
    typeOptionsContainer.innerHTML = ALL_TYPES.map((t, idx) => `
      <label class="ms-option-row">
        <input type="checkbox" value="${t}" id="tp_opt_${idx}" />
        <span>${t}</span>
      </label>
    `).join("");
  }

  const statusWrap = el("statusMultiWrap");
  const statusBtn = el("statusMultiBtn");
  const statusDropdown = el("statusMultiDropdown");

  const typeWrap = el("typeMultiWrap");
  const typeBtn = el("typeMultiBtn");
  const typeDropdown = el("typeMultiDropdown");

  statusBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    typeDropdown?.classList.add("hidden");
    typeWrap?.classList.remove("open");
    statusDropdown?.classList.toggle("hidden");
    statusWrap?.classList.toggle("open");
  });

  typeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    statusDropdown?.classList.add("hidden");
    statusWrap?.classList.remove("open");
    typeDropdown?.classList.toggle("hidden");
    typeWrap?.classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    if(!statusWrap?.contains(e.target)){
      statusDropdown?.classList.add("hidden");
      statusWrap?.classList.remove("open");
    }
    if(!typeWrap?.contains(e.target)){
      typeDropdown?.classList.add("hidden");
      typeWrap?.classList.remove("open");
    }
  });

  statusDropdown?.addEventListener("click", (e) => e.stopPropagation());
  typeDropdown?.addEventListener("click", (e) => e.stopPropagation());

  statusOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", () => {
      if(cb.checked) selectedStatuses.add(cb.value);
      else selectedStatuses.delete(cb.value);
      updateMultiSelectLabels();
      renderAllViews();
    });
  });

  typeOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", () => {
      if(cb.checked) selectedTypes.add(cb.value);
      else selectedTypes.delete(cb.value);
      updateMultiSelectLabels();
      renderAllViews();
    });
  });

  el("statusSelectAllBtn")?.addEventListener("click", () => {
    selectedStatuses = new Set(ALL_STATUSES);
    statusOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = true);
    updateMultiSelectLabels();
    renderAllViews();
  });
  el("statusClearAllBtn")?.addEventListener("click", () => {
    selectedStatuses.clear();
    statusOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);
    updateMultiSelectLabels();
    renderAllViews();
  });

  el("typeSelectAllBtn")?.addEventListener("click", () => {
    selectedTypes = new Set(ALL_TYPES);
    typeOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = true);
    updateMultiSelectLabels();
    renderAllViews();
  });
  el("typeClearAllBtn")?.addEventListener("click", () => {
    selectedTypes.clear();
    typeOptionsContainer?.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);
    updateMultiSelectLabels();
    renderAllViews();
  });
}

function updateMultiSelectLabels(){
  const statusLabel = el("statusMultiLabel");
  if(statusLabel){
    if(selectedStatuses.size === 0 || selectedStatuses.size === ALL_STATUSES.length){
      statusLabel.textContent = "כל הסטטוסים";
    } else if(selectedStatuses.size === 1){
      statusLabel.textContent = Array.from(selectedStatuses)[0];
    } else {
      statusLabel.textContent = `${selectedStatuses.size} סטטוסים נבחרו`;
    }
  }

  const typeLabel = el("typeMultiLabel");
  if(typeLabel){
    if(selectedTypes.size === 0 || selectedTypes.size === ALL_TYPES.length){
      typeLabel.textContent = "כל הסוגים";
    } else if(selectedTypes.size === 1){
      typeLabel.textContent = Array.from(selectedTypes)[0];
    } else {
      typeLabel.textContent = `${selectedTypes.size} סוגים נבחרו`;
    }
  }
}

function renderAllViews(){
  renderTable();
  renderDashboard();
}

function renderDashboard(){
  const allDrones = working.drones || [];
  const filtered = getFilteredDrones();
  const sorted = sortDrones(filtered);

  // 1. KPI Cards
  const total = allDrones.length;
  const readyCount = allDrones.filter(d => d.status === "רחפן מוכן למסירה").length;
  const missingHwCount = allDrones.filter(d => d.status === "רחפן תקין- חוסר בחומרה").length;
  const okTotal = allDrones.filter(d => d.status === "תקין" || d.status === "תקין – בשלבי בדיקה" || d.status === "רחפן מוכן למסירה").length;
  const badTotal = allDrones.filter(d => d.status === "לא תקין" || d.status === "במעקב").length;

  const kpiGrid = el("dashKpiGrid");
  if(kpiGrid){
    kpiGrid.innerHTML = `
      <div class="dash-kpi-card">
        <span class="kpi-icon">📦</span>
        <div class="kpi-num">${total}</div>
        <div class="kpi-label">סה״כ ציוד במערכת</div>
        <div class="kpi-sub">${filtered.length} מסוננים כעת</div>
      </div>
      <div class="dash-kpi-card" style="border-top: 3px solid #00d2b4;">
        <span class="kpi-icon">🚀</span>
        <div class="kpi-num" style="color: #85ffed;">${readyCount}</div>
        <div class="kpi-label">רחפנים מוכנים למסירה</div>
        <div class="kpi-sub">מוכנים למשלוח מיידי</div>
      </div>
      <div class="dash-kpi-card" style="border-top: 3px solid #ffa000;">
        <span class="kpi-icon">🛠️</span>
        <div class="kpi-num" style="color: #ffd685;">${missingHwCount}</div>
        <div class="kpi-label">תקין - חוסר בחומרה</div>
        <div class="kpi-sub">ממתינים להשלמת ציוד</div>
      </div>
      <div class="dash-kpi-card" style="border-top: 3px solid #2f6bff;">
        <span class="kpi-icon">✅</span>
        <div class="kpi-num" style="color: #a7ffbf;">${okTotal}</div>
        <div class="kpi-label">סה״כ תקינים ומוכנים</div>
        <div class="kpi-sub">${total ? Math.round((okTotal/total)*100) : 0}% מסך הכלים</div>
      </div>
      <div class="dash-kpi-card" style="border-top: 3px solid #b00020;">
        <span class="kpi-icon">⚠️</span>
        <div class="kpi-num" style="color: #ffb2bd;">${badTotal}</div>
        <div class="kpi-label">לא תקין / במעקב</div>
        <div class="kpi-sub">דורשים טיפול/תיקון</div>
      </div>
    `;
  }

  // 2. Status Distribution Chart
  const statusDistContainer = el("statusDistContainer");
  if(statusDistContainer){
    const dashStatusTotalCount = el("dashStatusTotalCount");
    if(dashStatusTotalCount) dashStatusTotalCount.textContent = `${filtered.length} כלים מסוננים`;

    const counts = {};
    for(const s of ALL_STATUSES) counts[s] = 0;
    for(const d of filtered){
      counts[d.status] = (counts[d.status] || 0) + 1;
    }

    const statusColors = {
      "תקין": "#1e7f3a",
      "תקין – בשלבי בדיקה": "#2e9e4f",
      "רחפן תקין- חוסר בחומרה": "#e18200",
      "רחפן מוכן למסירה": "#00b4a0",
      "לא תקין": "#b00020",
      "במעקב": "#b07a00",
      "נמסר": "#2344b8",
      "חדש": "#777777",
      "לא ידוע": "#7e57c2"
    };

    const maxCount = filtered.length || 1;
    statusDistContainer.innerHTML = ALL_STATUSES.map(s => {
      const c = counts[s] || 0;
      const pct = Math.round((c / maxCount) * 100);
      const color = statusColors[s] || "#2f6bff";
      return `
        <div class="dist-item">
          <div class="dist-info">
            <span>${s}</span>
            <span>${c} (${pct}%)</span>
          </div>
          <div class="dist-bar-track">
            <div class="dist-bar-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  // 3. Hardware Readiness Overview
  const hwReadinessContainer = el("hwReadinessContainer");
  if(hwReadinessContainer){
    const totalCount = filtered.length || 1;
    const gpsOk = filtered.filter(d => d.gps).length;
    const chargerOk = filtered.filter(d => d.charger).length;
    const gpsPct = Math.round((gpsOk / totalCount) * 100);
    const chargerPct = Math.round((chargerOk / totalCount) * 100);

    hwReadinessContainer.innerHTML = `
      <div class="hw-item">
        <div class="hw-title">
          <span>📡 מקלט GPS מותקן</span>
          <span style="color: #b9ccff;">${gpsOk} / ${filtered.length} (${gpsPct}%)</span>
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${gpsPct}%; background: #2f6bff;"></div>
        </div>
      </div>
      <div class="hw-item">
        <div class="hw-title">
          <span>🔌 מטען זמין</span>
          <span style="color: #a7ffbf;">${chargerOk} / ${filtered.length} (${chargerPct}%)</span>
        </div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${chargerPct}%; background: #1e7f3a;"></div>
        </div>
      </div>
    `;
  }

  // 4. Location Breakdown
  const locationList = el("locationList");
  if(locationList){
    const locMap = {};
    for(const d of filtered){
      const loc = (d.location || "לא צוין").trim();
      if(!locMap[loc]) locMap[loc] = { total: 0, statuses: {} };
      locMap[loc].total++;
      locMap[loc].statuses[d.status] = (locMap[loc].statuses[d.status] || 0) + 1;
    }

    const locEntries = Object.entries(locMap).sort((a,b) => b[1].total - a[1].total);
    if(locEntries.length === 0){
      locationList.innerHTML = `<div style="color: var(--muted); padding: 12px;">אין נתונים להצגה לפי הפילטר הנבחר.</div>`;
    } else {
      locationList.innerHTML = locEntries.map(([name, data]) => {
        const badgesHtml = Object.entries(data.statuses).map(([st, count]) => `
          <span class="badge ${statusClass(st)}" style="font-size:10px; padding:2px 6px;">${count} ${st}</span>
        `).join("");
        return `
          <div class="loc-item">
            <div>
              <div class="loc-name">${name}</div>
              <div style="font-size: 11px; color: var(--muted); margin-top:2px;">${data.total} כלים בסה״כ</div>
            </div>
            <div class="loc-badges">${badgesHtml}</div>
          </div>
        `;
      }).join("");
    }
  }

  // 5. Insights
  const dashInsights = el("dashInsights");
  if(dashInsights){
    const missingHwDrones = filtered.filter(d => d.status === "רחפן תקין- חוסר בחומרה");
    const readyDrones = filtered.filter(d => d.status === "רחפן מוכן למסירה");
    const noCharger = filtered.filter(d => (d.status === "תקין" || d.status === "רחפן מוכן למסירה") && !d.charger);

    dashInsights.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div style="background:#0f1a31; padding:10px 12px; border-radius:10px; border-right: 4px solid #00b4a0;">
          <strong style="color:#85ffed;">🚀 מוכנים למסירה:</strong> ${readyDrones.length} כלים
          ${readyDrones.length ? `<div style="font-size:12px; opacity:0.8; margin-top:2px;">מספרים: ${readyDrones.map(d=>d.id).join(", ")}</div>` : ''}
        </div>
        <div style="background:#0f1a31; padding:10px 12px; border-radius:10px; border-right: 4px solid #ffa000;">
          <strong style="color:#ffd685;">🛠️ דורשים השלמת חומרה:</strong> ${missingHwDrones.length} כלים
          ${missingHwDrones.length ? `<div style="font-size:12px; opacity:0.8; margin-top:2px;">מספרים: ${missingHwDrones.map(d=>d.id).join(", ")}</div>` : ''}
        </div>
        <div style="background:#0f1a31; padding:10px 12px; border-radius:10px; border-right: 4px solid #2f6bff;">
          <strong style="color:#b9ccff;">⚡ תקינים ללא מטען:</strong> ${noCharger.length} כלים
        </div>
      </div>
    `;
  }

  // 6. Drone Cards Grid
  const droneCardsGrid = el("droneCardsGrid");
  const dashFilteredCount = el("dashFilteredCount");
  if(dashFilteredCount) dashFilteredCount.textContent = sorted.length;

  if(droneCardsGrid){
    if(sorted.length === 0){
      droneCardsGrid.innerHTML = `<div style="grid-column: 1/-1; color: var(--muted); padding: 20px; text-align: center;">לא נמצאו כלים התואמים את החיפוש והפילטרים.</div>`;
    } else {
      droneCardsGrid.innerHTML = sorted.map(d => `
        <div class="drone-card-item">
          <div class="drone-card-header">
            <span class="drone-card-id">#${d.id}</span>
            <span class="badge ${statusClass(d.status)}">${d.status || "ללא סטטוס"}</span>
          </div>
          <div class="drone-card-location">
            <span>📍</span>
            <span>${d.location || "מיקום לא עודכן"}</span>
            <span class="drone-card-type" style="margin-right:auto;">${d.type || "רחפן"}</span>
          </div>
          <div class="drone-card-hw">
            <span class="hw-tag ${d.gps ? 'ok' : ''}">GPS: ${d.gps ? '✓' : '✗'}</span>
            <span class="hw-tag ${d.charger ? 'ok' : ''}">מטען: ${d.charger ? '✓' : '✗'}</span>
            ${d.version ? `<span class="hw-tag">v${d.version}</span>` : ''}
          </div>
          ${(d.issues || d.notes) ? `
            <div class="drone-card-notes">
              ${d.issues ? `<div><strong>תקלות:</strong> ${d.issues}</div>` : ''}
              ${d.notes ? `<div><strong>הערות:</strong> ${d.notes}</div>` : ''}
            </div>
          ` : ''}
        </div>
      `).join("");
    }
  }
}

async function loadLocalJson(){
  try{
    const res = await fetch("./drones.json", {cache:"no-store"});
    if(!res.ok) throw new Error("Failed to load local drones.json");
    return await res.json();
  }catch(e){
    // אם אין drones.json (למשל ב-GitHub Pages) – נמשיך עם רשימה ריקה
    return { last_updated: new Date().toISOString().slice(0,16), drones: [] };
  }
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
          renderAllViews();
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
snap.forEach(docSnap => {
  const d = docSnap.data() || {};
  d.docId = docSnap.id;        // 🔑 זה ה-ID האמיתי למחיקה
  d.id = d.id || docSnap.id;   // זה ה-ID הלוגי להצגה (אם אין)
  d.type = d.type || "רחפן";
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
      type: d.type || "רחפן",
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
    renderAllViews();
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
function stripCodeFences(s){
  return (s||"")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function normalizeImportedJson(raw){
  // תומך ב:
  // 1) {last_updated, drones:[...]}
  // 2) [{...}]  (מערך רחפנים)
  // 3) {rows:[...]} / {data:[...]}
  if(Array.isArray(raw)){
    return { last_updated: new Date().toISOString().slice(0,16), drones: raw };
  }
  if(raw && Array.isArray(raw.drones)){
    return raw;
  }
  if(raw && Array.isArray(raw.rows)){
    return { last_updated: new Date().toISOString().slice(0,16), drones: raw.rows };
  }
  if(raw && Array.isArray(raw.data)){
    return { last_updated: new Date().toISOString().slice(0,16), drones: raw.data };
  }
  return null;
}

function parsePastedJson(raw){
  let txt = stripCodeFences((raw||""));
  if(!txt) throw new Error("הטקסט ריק");
  const parsed = JSON.parse(txt);
  const obj = normalizeImportedJson(parsed);
  if(!obj || !Array.isArray(obj.drones)) throw new Error("פורמט לא תקין: צריך drones[] או מערך רשומות");

  if(!obj.last_updated) obj.last_updated = new Date().toISOString().slice(0,16);

  obj.drones = (obj.drones||[])
    .map(d=>({
      id: String(d.id||"").trim(),
      type: d.type || "רחפן",   // ← חובה
      location: d.location || "",
      status: d.status || "",
      version: d.version || "",
      gps: !!d.gps,
      charger: !!d.charger,
      issues: d.issues || "",
      notes: d.notes || ""
    }))
    .filter(d=>d.id);

  return obj;
}

// טוען לטבלה מקומית (בלי DB)
function applyPasteToLocal(raw){
  const obj = parsePastedJson(raw);
  working = obj;
  stamp();
  renderTable();
  return obj;
}

// שומר ל-DB (רק אם מחובר)
async function importFromPasteJsonToFirestore(raw){
  if(!fb.enabled) throw new Error("Firestore not enabled");
  if(!fb.user) throw new Error("Not logged in");
  const obj = parsePastedJson(raw);
  working = obj;
  if(!working.last_updated) stamp();
  await saveToFirestore();
}

async function clearAndImportFromPasteJson(raw){
  await clearFirestoreDrones();
  await importFromPasteJsonToFirestore(raw);
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
function wire(){
  // Paste JSON panel + export
  const jsonPanel = el("jsonPanel");
  const jsonPaste = el("jsonPaste");
  const jsonHint = el("jsonPanelHint");
  el("pasteJsonBtn")?.addEventListener("click", ()=>{
    if(jsonPanel) jsonPanel.style.display = (jsonPanel.style.display==="none"||!jsonPanel.style.display) ? "block" : "none";
  });
  el("closeJsonPanelBtn")?.addEventListener("click", ()=>{ if(jsonPanel) jsonPanel.style.display="none"; });
    
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

  // Tabs wiring
  el("tabTableBtn")?.addEventListener("click", () => {
    activeTab = "table";
    el("tabTableBtn").classList.add("active");
    el("tabDashBtn").classList.remove("active");
    el("tableView").classList.remove("hidden");
    el("dashboardView").classList.add("hidden");
    renderTable();
  });

  el("tabDashBtn")?.addEventListener("click", () => {
    activeTab = "dashboard";
    el("tabDashBtn").classList.add("active");
    el("tabTableBtn").classList.remove("active");
    el("dashboardView").classList.remove("hidden");
    el("tableView").classList.add("hidden");
    renderDashboard();
  });

  initMultiSelects();
  el("search")?.addEventListener("input", ()=>renderAllViews());
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
      renderAllViews();

      if(fb.enabled){
        if(!fb.user){ alert("כדי לשמור ל-Firestore צריך להתחבר."); return; }
        try{ await saveToFirestore(); } catch(e){ alert("שמירה ל-Firestore נכשלה: " + e.message); }
      }
    }else{
      editMode = true;
      renderAllViews();
    }
  });

  el("loginBtn")?.addEventListener("click", async ()=>{
    if(fb.user) return;
    await doLogin();
  });

  el("logoutBtn")?.addEventListener("click", doLogout);
  // ===== JSON Paste → Confirm & Import =====
el("applyPasteBtn")?.addEventListener("click", async () => {
  const ta   = el("jsonPaste");
  const hint = el("jsonPanelHint");
  const txt  = (ta?.value || "").trim();

  if(!txt){
    hint.textContent = "❌ לא הודבק JSON";
    return;
  }

  let parsed;
  try {
    parsed = parsePastedJson(txt);
  } catch(e){
    hint.textContent = "❌ JSON לא תקין: " + e.message;
    return;
  }

  // תמיכה בכמה פורמטים
  const drones =
    parsed?.drones ||
    parsed?.rows ||
    parsed?.data ||
    (Array.isArray(parsed) ? parsed : null);

  if(!Array.isArray(drones)){
    hint.textContent = "❌ פורמט לא נתמך (צריך מערך או {drones:[]})";
    return;
  }

  // טעינה לוקאלית לטבלה ולדשבורד
  working.drones = drones;
  stamp();
  renderAllViews();
  hint.textContent = `✅ נטענו ${drones.length} רחפנים לטבלה ולדשבורד`;

  // שמירה ל-DB רק אם מחובר
  if(fb.user){
    const ok = confirm("לשמור גם ל-Firestore?");
    if(ok){
      try{
        await saveToFirestore();
        hint.textContent += " + נשמר ל-DB ✅";
      }catch(e){
        hint.textContent += " (שגיאה בשמירה ל-DB: " + e.message + ")";
      }
    }
  } else {
    hint.textContent += " (לוקאלי בלבד – התחבר כדי לשמור ל-DB)";
  }
});

// ניקוי
el("clearPasteBtn")?.addEventListener("click", () => {
  el("jsonPaste").value = "";
  el("jsonPanelHint").textContent = "";
});

}

(async function init(){
  renderHeader();
  initFirebase();

  try{
    working = await loadLocalJson(); // show something immediately
    stamp();
    renderAllViews();
  }catch(err){
    const lu = el("lastUpdated");
    if(lu) lu.textContent = "שגיאה בטעינת נתונים: " + err.message;
    console.error(err);
  }

  wire();
})();
