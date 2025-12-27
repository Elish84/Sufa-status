const el = (id)=>document.getElementById(id);

const STORAGE_KEY = "sufa_status_local_v1";

let baseData = null;      
let workingData = null;   
let editMode = false;

function normalize(s){ return (s||"").toString().trim().toLowerCase(); }

function statusClass(status){
  if(status === "תקין" || status === "תקין – בשלבי בדיקה") return "ok";
  if(status === "במעקב") return "warn";
  if(status === "לא תקין") return "bad";
  if(status === "נמסר") return "delivered";
  if(status === "חדש") return "new";
  return "warn";
}

function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}

function saveLocal(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearLocal(){
  localStorage.removeItem(STORAGE_KEY);
}

function mergeData(repo, local){
  if(!local) return repo;
  return local; // local overrides whole dataset
}

function renderKpis(drones){
  const total = drones.length;
  const by = {};
  for(const d of drones){
    by[d.status] = (by[d.status]||0)+1;
  }
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

function renderTable(){
  const q = normalize(el("search").value);
  const f = el("statusFilter").value;

  let drones = workingData.drones.slice();

  if(f){
    drones = drones.filter(d => d.status === f);
  }
  if(q){
    drones = drones.filter(d => {
      const hay = [
        d.id, d.location, d.status, d.version,
        d.issues, d.notes
      ].map(x=>normalize(x)).join(" | ");
      return hay.includes(q);
    });
  }

  renderKpis(drones);

  const tbody = el("tbody");
  tbody.innerHTML = "";

  for(const d of drones){
    const tr = document.createElement("tr");

    const cells = [
      {key:"id", val:d.id, editable:false},
      {key:"location", val:d.location, editable:true},
      {key:"status", val:d.status, editable:true, type:"status"},
      {key:"version", val:d.version||"", editable:true},
      {key:"gps", val:d.gps ? "✓" : "", editable:true, type:"bool"},
      {key:"charger", val:d.charger ? "✓" : "", editable:true, type:"bool"},
      {key:"video_gps", val:d.video_gps||"", editable:true},
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
        const on = (c.key === "gps") ? d.gps : d.charger;
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
}

function findDrone(id){
  return workingData.drones.find(x=>String(x.id)===String(id));
}

function applyEditsFromDom(){
  const editedCells = document.querySelectorAll("[contenteditable='true'][data-id][data-key]");
  editedCells.forEach(td=>{
    const d = findDrone(td.dataset.id);
    if(!d) return;
    const key = td.dataset.key;
    d[key] = td.textContent.trim();
  });

  const selects = document.querySelectorAll("select[data-id][data-key]");
  selects.forEach(sel=>{
    const d = findDrone(sel.dataset.id);
    if(!d) return;
    d[sel.dataset.key] = sel.value;
  });

  const checks = document.querySelectorAll("input[type='checkbox'][data-id][data-key]");
  checks.forEach(ch=>{
    const d = findDrone(ch.dataset.id);
    if(!d) return;
    d[ch.dataset.key] = !!ch.checked;
  });

  workingData.last_updated = new Date().toISOString().slice(0,16);
  saveLocal(workingData);
}

async function loadRepoData(){
  const res = await fetch("./data/drones.json", {cache:"no-store"});
  if(!res.ok) throw new Error("Failed to load drones.json");
  return await res.json();
}

function updateLastUpdated(){
  const t = workingData?.last_updated ? new Date(workingData.last_updated) : null;
  const txt = t && !isNaN(t.getTime())
    ? `עדכון אחרון: ${t.toLocaleString("he-IL")}${loadLocal() ? " (כולל שינויים מקומיים)" : ""}`
    : `עדכון אחרון: —`;
  el("lastUpdated").textContent = txt;
}

function downloadJson(){
  applyEditsFromDom();
  const blob = new Blob([JSON.stringify(workingData, null, 2)], {type:"application/json;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "drones.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function handleImport(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      if(!obj || !Array.isArray(obj.drones)) throw new Error("Bad JSON format");
      workingData = obj;
      saveLocal(workingData);
      updateLastUpdated();
      renderTable();
    }catch(e){
      alert("קובץ JSON לא תקין: " + e.message);
    }
  };
  reader.readAsText(file, "utf-8");
}

function wire(){
  el("search").addEventListener("input", ()=>renderTable());
  el("statusFilter").addEventListener("change", ()=>renderTable());

  el("toggleEdit").addEventListener("click", ()=>{
    if(editMode){
      applyEditsFromDom();
      editMode = false;
      updateLastUpdated();
      renderTable();
    }else{
      editMode = true;
      renderTable();
    }
  });

  el("exportJson").addEventListener("click", downloadJson);

  el("importJson").addEventListener("change", (e)=>{
    const file = e.target.files && e.target.files[0];
    if(file) handleImport(file);
    e.target.value = "";
  });

  el("resetLocal").addEventListener("click", ()=>{
    if(!confirm("למחוק שינויים מקומיים ולחזור לנתוני הריפו?")) return;
    clearLocal();
    workingData = JSON.parse(JSON.stringify(baseData));
    editMode = false;
    updateLastUpdated();
    renderTable();
  });

  window.addEventListener("beforeunload", ()=>{
    if(editMode) applyEditsFromDom();
  });
}

(async function init(){
  try{
    baseData = await loadRepoData();
    const local = loadLocal();
    workingData = mergeData(baseData, local);
    updateLastUpdated();
    wire();
    renderTable();
    renderKpis(workingData.drones);
  }catch(err){
    el("lastUpdated").textContent = "שגיאה בטעינת נתונים: " + err.message;
    console.error(err);
  }
})(); 
