/**
 * Local Vault — fully offline encrypted notebook + stylus drawing.
 * Nothing is ever sent to a server.
 */

import * as db from "./db.js";
import * as crypto from "./crypto.js";

const META_KEY = "meta";
const NOTES_KEY = "notes";

let passphrase = null;
let notes = [];          // decrypted in memory only while unlocked
let currentId = null;
let mode = "text";       // "text" | "draw"
let drawing = false;
let lastX = 0;
let lastY = 0;

const app = document.getElementById("app");

// ---------- Boot ----------

async function boot() {
  const meta = await db.get(META_KEY);

  if (!meta) {
    showSetup();
  } else {
    showUnlock();
  }
}

// ---------- Screens ----------

function showSetup() {
  app.innerHTML = `
    <div class="screen">
      <h1>Local Vault</h1>
      <div class="privacy-box">
        <p><strong>Fully offline. Fully encrypted.</strong></p>
        <p>Your notes and drawings are encrypted with a passphrase you choose. They never leave this device. There is no account, no cloud, and no telemetry.</p>
        <p>If you forget the passphrase, the data cannot be recovered. That is by design.</p>
      </div>
      <div class="form">
        <label class="small">Choose a strong passphrase</label>
        <input type="password" id="pass1" placeholder="Passphrase" autocomplete="new-password" />
        <input type="password" id="pass2" placeholder="Confirm passphrase" autocomplete="new-password" />
        <p class="error" id="err" hidden></p>
        <button class="btn btn-primary" id="create">Create Vault</button>
      </div>
    </div>
  `;

  document.getElementById("create").onclick = async () => {
    const p1 = document.getElementById("pass1").value;
    const p2 = document.getElementById("pass2").value;
    const err = document.getElementById("err");

    if (p1.length < 8) {
      err.textContent = "Use at least 8 characters.";
      err.hidden = false;
      return;
    }
    if (p1 !== p2) {
      err.textContent = "Passphrases do not match.";
      err.hidden = false;
      return;
    }

    passphrase = p1;
    notes = [];
    await saveAll();
    await db.set(META_KEY, { created: Date.now(), version: 1 });
    showList();
  };
}

function showUnlock() {
  app.innerHTML = `
    <div class="screen">
      <h1>Local Vault</h1>
      <div class="privacy-box">
        <p>Everything stays on this device. Enter your passphrase to unlock.</p>
      </div>
      <div class="form">
        <input type="password" id="pass" placeholder="Passphrase" autocomplete="current-password" />
        <p class="error" id="err" hidden></p>
        <button class="btn btn-primary" id="unlock">Unlock</button>
      </div>
    </div>
  `;

  const passEl = document.getElementById("pass");
  passEl.focus();

  document.getElementById("unlock").onclick = tryUnlock;
  passEl.onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };

  async function tryUnlock() {
    const p = passEl.value;
    const err = document.getElementById("err");
    try {
      const raw = await db.get(NOTES_KEY);
      if (raw) {
        const decrypted = await crypto.decrypt(raw, p);
        notes = JSON.parse(decrypted);
      } else {
        notes = [];
      }
      passphrase = p;
      showList();
    } catch {
      err.textContent = "Wrong passphrase.";
      err.hidden = false;
    }
  }
}

function showList() {
  const items = notes
    .slice()
    .sort((a, b) => b.updated - a.updated)
    .map(n => `
      <li class="note-item" data-id="${n.id}">
        <span class="note-title">${escape(n.title || "Untitled")}</span>
        <span class="note-meta">${n.hasDrawing ? "✎ " : ""}${formatDate(n.updated)}</span>
      </li>
    `).join("");

  app.innerHTML = `
    <div class="screen">
      <h1>Local Vault</h1>
      <p class="small">All data encrypted on this device only.</p>
      <ul class="note-list">${items || '<li class="small">No notes yet.</li>'}</ul>
      <div class="footer-actions">
        <button class="btn btn-primary" id="new">New note</button>
        <button class="btn btn-ghost" id="lock">Lock</button>
        <button class="btn btn-ghost" id="export">Export backup</button>
        <button class="btn btn-danger" id="wipe">Wipe everything</button>
      </div>
    </div>
  `;

  document.getElementById("new").onclick = () => openEditor(null);
  document.getElementById("lock").onclick = lock;
  document.getElementById("export").onclick = exportBackup;
  document.getElementById("wipe").onclick = wipeAll;

  app.querySelectorAll(".note-item").forEach(el => {
    el.onclick = () => openEditor(el.dataset.id);
  });
}

function openEditor(id) {
  currentId = id;
  const note = id ? notes.find(n => n.id === id) : {
    id: crypto.randomId(),
    title: "",
    text: "",
    drawing: null,   // base64 PNG data URL
    hasDrawing: false,
    updated: Date.now()
  };

  mode = "text";

  app.innerHTML = `
    <div class="screen">
      <div class="editor-header">
        <input type="text" id="title" placeholder="Title" value="${escape(note.title)}" />
        <button class="btn btn-ghost" id="back">Back</button>
      </div>

      <div class="mode-toggle">
        <button id="mode-text" class="active">Text</button>
        <button id="mode-draw">Draw</button>
      </div>

      <textarea id="text" placeholder="Write privately…" style="display:block">${escape(note.text)}</textarea>

      <div class="canvas-wrap" id="canvas-wrap" style="display:none">
        <canvas id="canvas"></canvas>
      </div>

      <div class="toolbar" id="draw-tools" style="display:none">
        <button class="btn btn-ghost" id="clear-canvas">Clear drawing</button>
        <span class="small">Stylus / finger supported</span>
      </div>

      <div class="footer-actions">
        <button class="btn btn-primary" id="save">Save</button>
        ${id ? '<button class="btn btn-danger" id="delete">Delete</button>' : ''}
      </div>
    </div>
  `;

  const textEl = document.getElementById("text");
  const canvasWrap = document.getElementById("canvas-wrap");
  const canvas = document.getElementById("canvas");
  const drawTools = document.getElementById("draw-tools");

  // Mode switching
  document.getElementById("mode-text").onclick = () => setMode("text");
  document.getElementById("mode-draw").onclick = () => setMode("draw");

  function setMode(m) {
    mode = m;
    document.getElementById("mode-text").classList.toggle("active", m === "text");
    document.getElementById("mode-draw").classList.toggle("active", m === "draw");
    textEl.style.display = m === "text" ? "block" : "none";
    canvasWrap.style.display = m === "draw" ? "block" : "none";
    drawTools.style.display = m === "draw" ? "flex" : "none";
    if (m === "draw") resizeCanvas();
  }

  // Canvas setup
  const ctx = canvas.getContext("2d");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#e8e8f0";
  ctx.lineWidth = 2.5;

  function resizeCanvas() {
    const rect = canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#e8e8f0";
    ctx.lineWidth = 2.5;

    // Restore previous drawing if any
    if (note.drawing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = note.drawing;
    }
  }

  // Pointer events (stylus + touch + mouse)
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure > 0 ? e.pressure : 0.5
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineWidth = 1.5 + pos.pressure * 3;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
  }

  function end(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
  }

  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", end);

  document.getElementById("clear-canvas").onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    note.drawing = null;
    note.hasDrawing = false;
  };

  document.getElementById("back").onclick = () => showList();
  document.getElementById("save").onclick = async () => {
    note.title = document.getElementById("title").value.trim();
    note.text = textEl.value;
    note.updated = Date.now();

    // Capture canvas if anything was drawn
    if (mode === "draw" || note.hasDrawing) {
      // Check if canvas is non-empty by sampling a few pixels is expensive;
      // we simply always save the current canvas state when in draw mode or previously had drawing.
      note.drawing = canvas.toDataURL("image/png");
      note.hasDrawing = true;
    }

    const idx = notes.findIndex(n => n.id === note.id);
    if (idx >= 0) notes[idx] = note;
    else notes.push(note);

    await saveAll();
    showList();
  };

  if (id) {
    document.getElementById("delete").onclick = async () => {
      if (!confirm("Delete this note permanently?")) return;
      notes = notes.filter(n => n.id !== id);
      await saveAll();
      showList();
    };
  }

  // Start in text mode; user can switch to draw
  setMode("text");
}

// ---------- Helpers ----------

async function saveAll() {
  if (!passphrase) return;
  const json = JSON.stringify(notes);
  const encrypted = await crypto.encrypt(json, passphrase);
  await db.set(NOTES_KEY, encrypted);
}

function lock() {
  passphrase = null;
  notes = [];
  currentId = null;
  showUnlock();
}

async function exportBackup() {
  if (!passphrase) return;
  const payload = {
    format: "local-vault-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: await db.get(NOTES_KEY)   // already encrypted
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `local-vault-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function wipeAll() {
  if (!confirm("This will permanently erase the vault and all notes on this device. Continue?")) return;
  if (!confirm("Really sure? This cannot be undone.")) return;

  passphrase = null;
  notes = [];
  await db.clearAll();

  // Also try to clear service worker caches if any exist later
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.includes("local-vault")).map(k => caches.delete(k)));
  }

  showSetup();
}

function escape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- Start ----------
boot();
