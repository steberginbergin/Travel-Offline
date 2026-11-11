// Offline Travel Translator — core app logic
const LS_KEYS = { downloaded: "tt_downloaded_langs", history: "tt_history" };

function normalize(s) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function getDownloaded() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.downloaded) || "[]"); }
  catch { return []; }
}
function setDownloaded(list) {
  localStorage.setItem(LS_KEYS.downloaded, JSON.stringify(Array.from(new Set(list))));
}
function isDownloaded(code) { return getDownloaded().includes(code); }

function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.history) || "[]"); }
  catch { return []; }
}
function pushHistory(entry) {
  const h = getHistory();
  h.unshift({ ...entry, ts: Date.now() });
  localStorage.setItem(LS_KEYS.history, JSON.stringify(h.slice(0, 100)));
  renderHistory();
}

// Build reverse index (foreign normalized text -> entry) per language, for OCR word/phrase spotting.
const REVERSE_INDEX = {};
function buildReverseIndex(code) {
  if (REVERSE_INDEX[code]) return REVERSE_INDEX[code];
  const lang = PHRASEBOOK[code];
  const idx = new Map();
  for (const e of lang.entries) {
    idx.set(normalize(e.text), e);
    for (const w of normalize(e.text).split(/\s+/)) {
      if (w.length > 1 && !idx.has(w)) idx.set(w, e);
    }
  }
  REVERSE_INDEX[code] = idx;
  return idx;
}
function buildForwardIndex(code) {
  const key = "fwd_" + code;
  if (REVERSE_INDEX[key]) return REVERSE_INDEX[key];
  const lang = PHRASEBOOK[code];
  const idx = new Map();
  for (const e of lang.entries) {
    idx.set(normalize(e.en), e);
  }
  REVERSE_INDEX[key] = idx;
  return idx;
}

let state = { lang: "es", direction: "en-fx" }; // en-fx = English -> foreign, fx-en = foreign -> English

function populateLangSelects() {
  const selects = document.querySelectorAll(".lang-select");
  selects.forEach(sel => {
    sel.innerHTML = "";
    Object.entries(PHRASEBOOK).forEach(([code, lang]) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = lang.name + (isDownloaded(code) ? " ✓" : "");
      sel.appendChild(opt);
    });
    sel.value = state.lang;
  });
}

function translateText(query, direction, langCode) {
  const q = normalize(query);
  if (!q) return null;
  if (direction === "en-fx") {
    const fwd = buildForwardIndex(langCode);
    if (fwd.has(q)) return fwd.get(q);
    // fallback: substring/word match
    for (const [key, entry] of fwd) {
      if (key.includes(q) || q.includes(key)) return entry;
    }
  } else {
    const rev = buildReverseIndex(langCode);
    if (rev.has(q)) return rev.get(q);
    for (const [key, entry] of rev) {
      if (key.includes(q) || q.includes(key)) return entry;
    }
  }
  return null;
}

function renderHistory() {
  const list = document.getElementById("historyList");
  if (!list) return;
  const h = getHistory();
  list.innerHTML = h.length ? "" : "<p class='muted'>No translations yet.</p>";
  h.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `<div class="hi-top"><span>${item.from}</span><span class="hi-arrow">→</span><span>${item.to}</span></div><div class="hi-meta">${item.lang}${item.cat ? " · " + item.cat : ""}</div>`;
    list.appendChild(div);
  });
}

// ---------- Text tab ----------
function initTextTab() {
  const input = document.getElementById("textInput");
  const result = document.getElementById("textResult");
  const dirBtn = document.getElementById("dirToggle");
  const langSelect = document.getElementById("textLangSelect");

  function doTranslate() {
    const q = input.value;
    if (!q.trim()) { result.innerHTML = ""; return; }
    const entry = translateText(q, state.direction, state.lang);
    if (entry) {
      const translated = state.direction === "en-fx" ? entry.text : entry.en;
      result.innerHTML = `<div class="result-card"><div class="result-main">${translated}</div><div class="result-sub">${state.direction === "en-fx" ? entry.en : entry.text}</div><div class="result-cat">${entry.cat}</div></div>`;
      pushHistory({ from: q, to: translated, lang: PHRASEBOOK[state.lang].name, cat: entry.cat });
    } else {
      result.innerHTML = `<div class="result-card no-match"><div class="result-main">No offline match found</div><div class="result-sub">Try a simpler word or phrase from the phrasebook — browse by category below.</div></div>`;
    }
  }

  input.addEventListener("input", doTranslate);
  langSelect.addEventListener("change", () => { state.lang = langSelect.value; doTranslate(); renderPhrasebookBrowser(); });
  dirBtn.addEventListener("click", () => {
    state.direction = state.direction === "en-fx" ? "fx-en" : "en-fx";
    dirBtn.textContent = state.direction === "en-fx" ? "EN → " + PHRASEBOOK[state.lang].name : PHRASEBOOK[state.lang].name + " → EN";
    input.placeholder = state.direction === "en-fx" ? "Type English…" : "Type " + PHRASEBOOK[state.lang].name + "…";
    doTranslate();
  });
}

function renderPhrasebookBrowser() {
  const container = document.getElementById("phrasebookBrowser");
  if (!container) return;
  const lang = PHRASEBOOK[state.lang];
  const cats = [...new Set(lang.entries.map(e => e.cat))];
  container.innerHTML = "";
  cats.forEach(cat => {
    const section = document.createElement("div");
    section.className = "pb-section";
    const header = document.createElement("div");
    header.className = "pb-header";
    header.textContent = cat[0].toUpperCase() + cat.slice(1);
    section.appendChild(header);
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    lang.entries.filter(e => e.cat === cat).forEach(e => {
      const item = document.createElement("div");
      item.className = "pb-item";
      item.innerHTML = `<div class="pb-en">${e.en}</div><div class="pb-fx">${e.text}</div>`;
      grid.appendChild(item);
    });
    section.appendChild(grid);
    container.appendChild(section);
  });
}

// ---------- Language manager ----------
function renderLanguageManager() {
  const container = document.getElementById("langManager");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(PHRASEBOOK).forEach(([code, lang]) => {
    const row = document.createElement("div");
    row.className = "lang-row";
    const downloaded = isDownloaded(code);
    row.innerHTML = `
      <div class="lang-row-info">
        <div class="lang-row-name">${lang.name}</div>
        <div class="lang-row-meta">Phrasebook: bundled offline · Camera OCR: ${downloaded ? "downloaded" : "not downloaded"}</div>
      </div>
      <button class="lang-btn ${downloaded ? "downloaded" : ""}" data-code="${code}">${downloaded ? "Remove" : "Download"}</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.code;
      if (isDownloaded(code)) {
        setDownloaded(getDownloaded().filter(c => c !== code));
        renderLanguageManager();
        populateLangSelects();
        return;
      }
      btn.textContent = "Downloading…";
      btn.disabled = true;
      try {
        await window.ensureOcrLanguage(PHRASEBOOK[code].tess);
        setDownloaded([...getDownloaded(), code]);
      } catch (err) {
        console.error(err);
        alert("Could not download OCR data for " + lang.name + ". Check your connection and try again (needed once, then works offline).");
      }
      renderLanguageManager();
      populateLangSelects();
    });
  });
}

function renderBundles() {
  const container = document.getElementById("bundleManager");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(REGION_BUNDLES).forEach(([key, bundle]) => {
    const row = document.createElement("div");
    row.className = "lang-row";
    row.innerHTML = `
      <div class="lang-row-info">
        <div class="lang-row-name">${bundle.name}</div>
        <div class="lang-row-meta">${bundle.langs.map(c => PHRASEBOOK[c].name).join(", ")}</div>
      </div>
      <button class="lang-btn" data-key="${key}">Download bundle</button>
    `;
    container.appendChild(row);
  });
  container.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      btn.textContent = "Downloading…";
      btn.disabled = true;
      const bundle = REGION_BUNDLES[key];
      for (const code of bundle.langs) {
        await window.ensureOcrLanguage(PHRASEBOOK[code].tess);
      }
      setDownloaded([...getDownloaded(), ...bundle.langs]);
      renderLanguageManager();
      populateLangSelects();
      btn.textContent = "Downloaded ✓";
    });
  });
}

// ---------- Storage usage ----------
async function renderStorageUsage() {
  const el = document.getElementById("storageUsage");
  if (!el) return;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const mb = (usage / (1024 * 1024)).toFixed(1);
      const qmb = (quota / (1024 * 1024)).toFixed(0);
      el.textContent = `Using ${mb} MB of ${qmb} MB available on this device.`;
    } catch { el.textContent = ""; }
  }
}

// ---------- Tabs ----------
function initTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    });
  });
}

// ---------- Online/offline indicator ----------
function initNetStatus() {
  const el = document.getElementById("netStatus");
  function update() {
    el.textContent = navigator.onLine ? "Online" : "Offline mode";
    el.className = "net-status " + (navigator.onLine ? "online" : "offline");
  }
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  populateLangSelects();
  initTextTab();
  initTabs();
  initNetStatus();
  renderPhrasebookBrowser();
  renderLanguageManager();
  renderBundles();
  renderHistory();
  renderStorageUsage();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
});
