// Camera + photo OCR translation using Tesseract.js (runs fully client-side / offline once cached).
let tesseractWorker = null;
let currentStream = null;
let lastCapturedBlob = null;

async function getWorker() {
  if (tesseractWorker) return tesseractWorker;
  tesseractWorker = await Tesseract.createWorker({
    logger: () => {},
  });
  return tesseractWorker;
}

window.ensureOcrLanguage = async function ensureOcrLanguage(tessCode) {
  const worker = await getWorker();
  await worker.loadLanguage(tessCode);
  await worker.initialize(tessCode);
  return true;
};

function statusMsg(text) {
  const el = document.getElementById("cameraStatus");
  if (el) el.textContent = text;
}

async function startCamera() {
  const video = document.getElementById("cameraVideo");
  if (currentStream) return;
  try {
    currentStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    video.srcObject = currentStream;
    await video.play();
    document.getElementById("cameraPlaceholder").hidden = true;
    video.hidden = false;
    statusMsg("Camera ready — tap Capture to translate what's in frame.");
  } catch (err) {
    statusMsg("Camera unavailable (" + err.message + "). You can still import a photo below.");
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

async function runOcrOnImage(imageSource, langCode) {
  const lang = PHRASEBOOK[langCode];
  if (!isDownloaded(langCode)) {
    statusMsg(`Downloading ${lang.name} OCR data (one-time, size varies by script)… this will work offline afterwards.`);
    try {
      await window.ensureOcrLanguage(lang.tess);
      setDownloaded([...getDownloaded(), langCode]);
      renderLanguageManager();
      populateLangSelects();
    } catch (err) {
      statusMsg("Could not download OCR language data. Connect to the internet once to download this language pack, then it works fully offline.");
      return null;
    }
  } else {
    await window.ensureOcrLanguage(lang.tess);
  }
  statusMsg("Reading text…");
  const worker = await getWorker();
  const { data } = await worker.recognize(imageSource);
  return data;
}

function overlayTranslations(canvas, ocrData, langCode, direction) {
  const overlay = document.getElementById("cameraOverlay");
  overlay.innerHTML = "";
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const lines = ocrData.lines || [];
  let matchCount = 0;
  lines.forEach(line => {
    const text = line.text.trim();
    if (!text) return;
    const entry = translateText(text, direction, langCode);
    const { x0, y0, x1, y1 } = line.bbox;
    const w = x1 - x0, h = y1 - y0;
    if (entry) {
      matchCount++;
      const label = direction === "fx-en" ? entry.en : entry.text;
      // cover the original text area
      ctx.fillStyle = "rgba(11,18,32,0.92)";
      ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 - 2, y0 - 2, w + 4, h + 4);
      ctx.fillStyle = "#e2f3ff";
      const fontSize = Math.max(11, Math.min(h * 0.8, 22));
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(label, x0, y0 + h / 2, w + 20);
    } else {
      ctx.strokeStyle = "rgba(148,163,184,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
    }
  });
  return matchCount;
}

async function translateFromImage(imageEl, sourceCanvasForOverlay, langCode, direction) {
  const data = await runOcrOnImage(imageEl, langCode);
  if (!data) return;
  const matchCount = overlayTranslations(sourceCanvasForOverlay, data, langCode, direction);
  const total = (data.lines || []).filter(l => l.text.trim()).length;
  statusMsg(total === 0
    ? "No readable text found in the image."
    : `Found ${total} line(s) of text, translated ${matchCount} using the offline phrasebook.`);
  if (matchCount > 0) {
    pushHistory({ from: `[image: ${total} lines]`, to: `${matchCount} phrase(s) translated`, lang: PHRASEBOOK[langCode].name, cat: "camera" });
  }
}

function initCameraTab() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");
  const overlay = document.getElementById("cameraOverlay");
  const fileInput = document.getElementById("photoImport");
  const captureBtn = document.getElementById("captureBtn");
  const startBtn = document.getElementById("startCameraBtn");
  const saveBtn = document.getElementById("saveImageBtn");
  const camLangSelect = document.getElementById("cameraLangSelect");
  const camDirBtn = document.getElementById("cameraDirToggle");
  let camDirection = "fx-en";

  camDirBtn.addEventListener("click", () => {
    camDirection = camDirection === "fx-en" ? "en-fx" : "fx-en";
    camDirBtn.textContent = camDirection === "fx-en"
      ? PHRASEBOOK[camLangSelect.value].name + " → EN"
      : "EN → " + PHRASEBOOK[camLangSelect.value].name;
  });

  startBtn.addEventListener("click", startCamera);

  captureBtn.addEventListener("click", async () => {
    if (!currentStream) { statusMsg("Start the camera first."); return; }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
    video.hidden = true;
    canvas.toBlob(b => (lastCapturedBlob = b), "image/jpeg", 0.92);
    await translateFromImage(canvas, canvas, camLangSelect.value, camDirection);
    saveBtn.hidden = false;
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    stopCamera();
    const img = new Image();
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.hidden = false;
      video.hidden = true;
      document.getElementById("cameraPlaceholder").hidden = true;
      canvas.toBlob(b => (lastCapturedBlob = b), "image/jpeg", 0.92);
      await translateFromImage(img, canvas, camLangSelect.value, camDirection);
      saveBtn.hidden = false;
    };
    img.src = URL.createObjectURL(file);
  });

  saveBtn.addEventListener("click", () => {
    // Merge canvas + overlay into one image and trigger a save via share/download.
    const merged = document.createElement("canvas");
    merged.width = canvas.width;
    merged.height = canvas.height;
    const mctx = merged.getContext("2d");
    mctx.drawImage(canvas, 0, 0);
    mctx.drawImage(overlay, 0, 0);
    merged.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "translated-" + Date.now() + ".jpg";
      a.click();
    }, "image/jpeg", 0.95);
  });
}

document.addEventListener("DOMContentLoaded", initCameraTab);
window.addEventListener("beforeunload", stopCamera);
