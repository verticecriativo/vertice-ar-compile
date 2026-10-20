// AR Studio — everything runs in this tab. No file is uploaded anywhere.
//
// Runtime options below are taken from the component schemas in mind-ar's source, not from the
// docs (which do not document face tracking at all):
//   mindar-image : imageTargetSrc maxTrack filterMinCF filterBeta missTolerance
//                  warmupTolerance showStats autoStart uiLoading uiScanning uiError
//   mindar-face  : autoStart faceOccluder uiLoading uiScanning uiError filterMinCF
//                  filterBeta disableFaceMirror showStats
// Library defaults: filterMinCF 0.001, filterBeta 1000, warmupTolerance 5, missTolerance 5.
const $ = (id) => document.getElementById(id);
const say = (el, msg, cls) => { const n = $(el); if (!n) return; n.textContent = msg; n.className = "status " + (cls || ""); };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const CLOSE = "<" + "/script>";
// Stamped into the preview tab. The SCENE comes from here, so this is the build id that
// matters when checking whether a phone is running current bytes. Bump it on every change.
const BUILD = "2026-10-20f";

// The library URLs live here only. The export builders inline them and the preview tab is HANDED
// them, so a version can never be bumped in one place and left stale in another.
// Face is 1.2.5 while image is 1.2.1 on purpose: mind-ar@1.2.1's mindar-face-aframe.prod.js is a
// broken artifact upstream — it fails to parse ("Illegal return statement"), so face tracking
// could never have worked on it. The image bundle at 1.2.1 parses and is deliberately left alone,
// because image tracking is coupled to the .mind the pinned 1.1.5 compiler produces.
const LIB = {
  aframe: "https://aframe.io/releases/1.4.1/aframe.min.js",
  extras: "https://cdn.jsdelivr.net/npm/aframe-extras@6.1.1/dist/aframe-extras.min.js",
  image: "https://cdn.jsdelivr.net/npm/mind-ar@1.2.1/dist/mindar-image-aframe.prod.js",
  face: "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-face-aframe.prod.js",
};
const libsFor = (mode) => [LIB.aframe, LIB.extras, mode === "face" ? LIB.face : LIB.image];

// ---------- persistence (settings only; blob URLs cannot survive a reload) ----------
const SKEY = "vertice-ar-studio-v1";
const saveSettings = () => {
  const o = {};
  document.querySelectorAll("[data-persist]").forEach((el) => {
    o[el.id] = el.type === "checkbox" ? el.checked : el.value;
  });
  try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {}
};
const loadSettings = () => {
  try {
    const o = JSON.parse(localStorage.getItem(SKEY) || "{}");
    for (const [k, v] of Object.entries(o)) {
      const el = $(k); if (!el) continue;
      if (el.type === "checkbox") el.checked = v; else el.value = v;
    }
  } catch (e) {}
};
document.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.persist !== undefined) saveSettings(); });
document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.persist !== undefined) saveSettings(); });

// ---------- shared: content builder ----------
// One content picker serves both modes. A target or a face anchor is just a parent entity.
function contentState(prefix) {
  return {
    kind: $(prefix + "kind").value,
    url: window.__assets[prefix] ? window.__assets[prefix].url : null,
    name: window.__assets[prefix] ? window.__assets[prefix].name : "",
    text: $(prefix + "text").value,
    color: $(prefix + "color").value,
    scale: $(prefix + "sc").value.trim() || "1",
    pos: [$(prefix + "px").value.trim() || "0", $(prefix + "py").value.trim() || "0", $(prefix + "pz").value.trim() || "0"].join(" "),
    rot: [$(prefix + "rx").value.trim() || "0", $(prefix + "ry").value.trim() || "0", $(prefix + "rz").value.trim() || "0"].join(" "),
    w: $(prefix + "w").value.trim() || "1",
    h: $(prefix + "h").value.trim() || "1",
  };
}
window.__assets = {};

function assetTag(c, id) {
  if (c.kind === "glb" && c.url) return `<a-asset-item id="${id}" src="${c.url}"></a-asset-item>`;
  if (c.kind === "video" && c.url) return `<video id="${id}" src="${c.url}" preload="auto" loop muted playsinline crossorigin="anonymous"></video>`;
  if (c.kind === "image" && c.url) return `<img id="${id}" src="${c.url}" crossorigin="anonymous">`;
  return "";
}
function contentTag(c, id) {
  const common = `position="${c.pos}" rotation="${c.rot}" scale="${c.scale} ${c.scale} ${c.scale}"`;
  switch (c.kind) {
    case "glb":   return c.url ? `<a-gltf-model src="#${id}" ${common} animation-mixer></a-gltf-model>` : "";
    case "video": return c.url ? `<a-video src="#${id}" width="${c.w}" height="${c.h}" ${common}></a-video>` : "";
    case "image": return c.url ? `<a-image src="#${id}" width="${c.w}" height="${c.h}" ${common}></a-image>` : "";
    case "plane": return `<a-plane width="${c.w}" height="${c.h}" color="${esc(c.color)}" ${common}></a-plane>`;
    case "box":   return `<a-box width="${c.w}" height="${c.h}" depth="${c.h}" color="${esc(c.color)}" ${common}></a-box>`;
    case "text":  return `<a-text value="${esc(c.text)}" align="center" color="${esc(c.color)}" width="${(parseFloat(c.w) || 1) * 2}" ${common}></a-text>`;
    default: return "";
  }
}
function needsFile(kind) { return kind === "glb" || kind === "video" || kind === "image"; }

// ---------- tracking params ----------
function trackOpts(prefix, isFace) {
  const n = (id, d) => { const v = parseFloat($(prefix + id).value); return Number.isFinite(v) ? v : d; };
  const parts = [];
  if (!isFace) parts.push(`maxTrack: ${Math.max(1, parseInt($(prefix + "maxtrack").value, 10) || 1)}`);
  parts.push(`filterMinCF: ${n("mincf", 0.001)}`, `filterBeta: ${n("beta", 1000)}`);
  if (!isFace) parts.push(`warmupTolerance: ${n("warmup", 5)}`, `missTolerance: ${n("miss", 5)}`);
  if (isFace) {
    parts.push(`faceOccluder: ${$(prefix + "occ").checked}`);
    if ($(prefix + "mirror").checked) parts.push("disableFaceMirror: true");
  }
  parts.push(`uiScanning: ${$(prefix + "uiscan").checked ? "yes" : "no"}`,
             `uiLoading: ${$(prefix + "uiload").checked ? "yes" : "no"}`);
  if ($(prefix + "stats").checked) parts.push("showStats: true");
  return parts.join("; ");
}

// ---------- IMAGE MODE ----------
let targets = [];            // [{file, img, url, name}]
let mindBuffer = null, mindURL = null;

function renderTargets() {
  const box = $("tlist");
  box.innerHTML = targets.length ? "" : '<p class="hint">No targets yet.</p>';
  targets.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "titem";
    row.innerHTML = `<img src="${t.url}" alt=""><div><b>#${i}</b> ${esc(t.name)}<br>
      <span class="mono dim">${t.img.width}×${t.img.height}</span></div>`;
    const rm = document.createElement("button");
    rm.className = "ghost sm"; rm.textContent = "Remove";
    rm.onclick = () => { targets.splice(i, 1); renderTargets(); invalidateMind(); };
    row.appendChild(rm);
    box.appendChild(row);
  });
  $("compile").disabled = targets.length === 0;
  $("imaxtrack").max = Math.max(1, targets.length);
  say("s1", targets.length ? `${targets.length} target${targets.length > 1 ? "s" : ""} ready to compile.` : "");
}
function invalidateMind() {
  mindBuffer = null;
  if (mindURL) { URL.revokeObjectURL(mindURL); mindURL = null; }
  $("dl").disabled = true; $("run").disabled = true; $("bundle").disabled = true;
}

$("img").addEventListener("change", (e) => {
  [...e.target.files].forEach((f) => {
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      targets.push({ file: f, img: im, url, name: f.name });
      renderTargets(); invalidateMind();
      if (Math.max(im.width, im.height) > 2048)
        say("s1", `${f.name} is ${im.width}×${im.height} — large. ~1000 px compiles far faster for the same tracking.`, "err");
    };
    im.onerror = () => say("s1", `Could not read ${f.name}.`, "err");
    im.src = url;
  });
  e.target.value = "";
});

$("compile").addEventListener("click", async () => {
  if (!targets.length) return;
  $("compile").disabled = true; invalidateMind();
  $("bar").style.display = "block"; $("barfill").style.width = "2%";
  say("s1", `Compiling ${targets.length} target${targets.length > 1 ? "s" : ""}… CPU-bound, can take a while.`);
  try {
    const compiler = new window.MINDAR.IMAGE.Compiler();
    await compiler.compileImageTargets(targets.map((t) => t.img), (p) => {
      $("barfill").style.width = Math.max(2, Math.round(p)) + "%";
    });
    mindBuffer = await compiler.exportData();
    mindURL = URL.createObjectURL(new Blob([mindBuffer]));
    $("barfill").style.width = "100%";
    $("dl").disabled = false; $("run").disabled = false; $("bundle").disabled = false;
    say("s1", `Compiled ${targets.length} target(s) — ${(mindBuffer.byteLength / 1024).toFixed(0)} KB.`, "ok");
  } catch (err) {
    say("s1", "Compile failed: " + err.message, "err");
  } finally { $("compile").disabled = targets.length === 0; }
});

const dlBlob = (url, name) => { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); };
$("dl").addEventListener("click", () => mindURL && dlBlob(mindURL, "targets.mind"));

// A new same-origin TAB, not an iframe. iOS Safari restricts getUserMedia inside srcdoc iframes,
// which is why the face preview came up white with no camera at all. A real top-level document
// gets normal camera permission, and preview.html reports why it failed instead of going blank.
// Only the <a-scene> fragment is passed: preview.html loads the runtime itself, while the export
// builders keep producing complete documents.
// The scene references blob: URLs minted in THIS document. A same-origin tab is supposed to be
// able to fetch them, but it is exactly the kind of thing iOS restricts, so the preview tab can
// ask us for the bytes instead. We only ever answer for URLs we minted ourselves.
window.addEventListener("message", async (ev) => {
  if (ev.origin !== location.origin) return;
  const d = ev.data;
  if (!d || d.type !== "vertice_ar_blob_req" || typeof d.url !== "string") return;
  const reply = (body) => ev.source && ev.source.postMessage(
    Object.assign({ type: "vertice_ar_blob_res", url: d.url }, body), location.origin);
  const mine = new Set([mindURL].concat(
    Object.keys(window.__assets || {}).map((k) => window.__assets[k].url)).filter(Boolean));
  if (!mine.has(d.url)) return reply({ error: "not one of ours" });
  try {
    const b = await (await fetch(d.url)).blob();
    reply({ buf: await b.arrayBuffer(), mime: b.type });
  } catch (e) { reply({ error: String((e && e.message) || e) }); }
});

function openPreview(mode, doc) {
  const m = doc.match(/<a-scene[\s\S]*<\/a-scene>/);
  if (!m) return false;
  try { sessionStorage.setItem("vertice_ar_preview", JSON.stringify({ mode, scene: m[0], libs: libsFor(mode), build: BUILD })); }
  catch (e) { return false; }
  // Pages serves preview.html with max-age=600, and a stale preview is indistinguishable from
  // a broken one. The query string guarantees the tab fetches the current build.
  return !!window.open("preview.html?v=" + Date.now(), "_blank");
}

function imageHTML(mindSrc, assetSrcMode) {
  const c = contentState("i");
  const id = "c0";
  const perTarget = targets.length
    ? targets.map((t, i) => `  <a-entity mindar-image-target="targetIndex: ${i}">
    ${i === 0 ? contentTag(c, id) : `<!-- target ${i}: add content here -->`}
  </a-entity>`).join("\n")
    : `  <a-entity mindar-image-target="targetIndex: 0">\n    ${contentTag(c, id)}\n  </a-entity>`;
  const asset = assetTag(c, id);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="${LIB.aframe}">${CLOSE}
<script src="${LIB.extras}">${CLOSE}
<script src="${LIB.image}">${CLOSE}
<style>body{margin:0;overflow:hidden}</style></head><body>
<a-scene mindar-image="imageTargetSrc: ${mindSrc}; ${trackOpts("i", false)}"
  embedded color-space="sRGB" renderer="colorManagement: true, physicallyCorrectLights"
  vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false">
${asset ? `  <a-assets>\n    ${asset}\n  </a-assets>\n` : ""}  <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
${perTarget}
</a-scene></body></html>`;
}

$("run").addEventListener("click", () => {
  if (!mindURL) return;
  const ok = openPreview("image", imageHTML(mindURL));
  say("s4", ok ? "Opened in a new tab — allow the camera there, then point it at a target."
               : "The browser blocked the new tab. Allow pop-ups for this site, then try again.",
      ok ? "ok" : "err");
});
$("stop").addEventListener("click", () => { say("s4", "Close the preview tab to release the camera."); });
$("gen").addEventListener("click", () => {
  const c = contentState("i");
  const assetName = c.kind === "glb" ? "model.glb" : c.kind === "video" ? "video.mp4" : "image.jpg";
  $("out").textContent = imageHTML("./targets.mind").replace(/blob:[^"]+/g, "./" + assetName)
    + `\n\n<!-- Files: index.html, targets.mind${needsFile(c.kind) ? ", " + assetName : ""} — all in one folder. -->`;
  $("out").style.display = "block";
  say("s4", "Generated below.", "ok");
});

// ---------- bundle (zip) ----------
$("bundle").addEventListener("click", async () => {
  if (!mindBuffer) return;
  say("s4", "Building bundle…");
  try {
    const zip = new window.JSZip();
    const c = contentState("i");
    const assetName = c.kind === "glb" ? "model.glb" : c.kind === "video" ? "video.mp4" : "image.jpg";
    zip.file("targets.mind", mindBuffer);
    zip.file("index.html", imageHTML("./targets.mind").replace(/blob:[^"]+/g, "./" + assetName));
    if (needsFile(c.kind) && window.__assets.i) zip.file(assetName, window.__assets.i.file);
    targets.forEach((t, i) => zip.file(`targets/${i}-${t.name}`, t.file));
    const blob = await zip.generateAsync({ type: "blob" });
    const u = URL.createObjectURL(blob);
    dlBlob(u, "vertice-ar-bundle.zip");
    setTimeout(() => URL.revokeObjectURL(u), 10000);
    say("s4", "Bundle downloaded — unzip it into the repo root and it runs as-is.", "ok");
  } catch (err) { say("s4", "Bundle failed: " + err.message, "err"); }
});

// ---------- FACE MODE ----------
// Face runtime is 1.2.5, not 1.2.1 like image: mind-ar@1.2.1's mindar-face-aframe.prod.js is a
// broken artifact upstream — it fails to parse with "Illegal return statement", so face tracking
// could never have worked on it. The image bundle at 1.2.1 parses and is left alone, because image
// tracking is coupled to the .mind the 1.1.5 compiler produces.
function faceHTML() {
  const c = contentState("f");
  const id = "f0";
  const asset = assetTag(c, id);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="${LIB.aframe}">${CLOSE}
<script src="${LIB.extras}">${CLOSE}
<script src="${LIB.face}">${CLOSE}
<style>body{margin:0;overflow:hidden}</style></head><body>
<a-scene mindar-face="${trackOpts("f", true)}"
  embedded color-space="sRGB" renderer="colorManagement: true, physicallyCorrectLights"
  vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false">
${asset ? `  <a-assets>\n    ${asset}\n  </a-assets>\n` : ""}  <a-camera active="false" position="0 0 0" look-controls="enabled: false"></a-camera>
  <a-entity mindar-face-target="anchorIndex: ${parseInt($("fanchor").value, 10) || 0}">
    ${contentTag(c, id)}
  </a-entity>
</a-scene></body></html>`;
}
$("frun").addEventListener("click", () => {
  const ok = openPreview("face", faceHTML());
  say("f3", ok ? "Opened in a new tab — allow the camera there. It attaches as soon as it finds a face."
               : "The browser blocked the new tab. Allow pop-ups for this site, then try again.",
      ok ? "ok" : "err");
});
$("fstop").addEventListener("click", () => { say("f3", "Close the preview tab to release the camera."); });
$("fgen").addEventListener("click", () => {
  const c = contentState("f");
  const assetName = c.kind === "glb" ? "model.glb" : c.kind === "video" ? "video.mp4" : "image.jpg";
  $("fout").textContent = faceHTML().replace(/blob:[^"]+/g, "./" + assetName)
    + `\n\n<!-- Files: index.html${needsFile(c.kind) ? ", " + assetName : ""}. No .mind — face tracking compiles nothing. -->`;
  $("fout").style.display = "block";
  say("f3", "Generated below.", "ok");
});
document.querySelectorAll("button.anchor").forEach((b) =>
  b.addEventListener("click", () => { $("fanchor").value = b.dataset.i; saveSettings(); }));

// ---------- content pickers (shared wiring) ----------
["i", "f"].forEach((pfx) => {
  const kind = $(pfx + "kind"), file = $(pfx + "file");
  const sync = () => {
    const k = kind.value;
    $(pfx + "filerow").style.display = needsFile(k) ? "" : "none";
    $(pfx + "textrow").style.display = k === "text" ? "" : "none";
    $(pfx + "colorrow").style.display = ["plane", "box", "text"].includes(k) ? "" : "none";
    $(pfx + "whrow").style.display = k === "glb" ? "none" : "";
    if (pfx === "f") $("frun").disabled = needsFile(k) && !window.__assets.f;
    if (pfx === "f") $("fgen").disabled = needsFile(k) && !window.__assets.f;
  };
  kind.addEventListener("change", () => { sync(); saveSettings(); });
  file.addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (window.__assets[pfx]) URL.revokeObjectURL(window.__assets[pfx].url);
    window.__assets[pfx] = { url: URL.createObjectURL(f), name: f.name, file: f };
    const big = f.size > 3 * 1024 * 1024;
    say(pfx === "i" ? "s2" : "f1",
      `${f.name} — ${(f.size / 1024 / 1024).toFixed(2)} MB` + (big ? "  ⚠ over 3 MB is slow on venue Wi-Fi" : ""),
      big ? "err" : "ok");
    sync();
  });
  sync();
});

// ---------- sidebar ----------
const PANELS = { image: ["nav-image", "panel-image"], face: ["nav-face", "panel-face"] };
function show(which) {
  for (const [k, [nav, pan]] of Object.entries(PANELS)) {
    $(nav).setAttribute("aria-current", String(k === which));
    $(pan).hidden = (k !== which);
  }
}
$("nav-image").addEventListener("click", () => show("image"));
$("nav-face").addEventListener("click", () => show("face"));

loadSettings();
renderTargets();
["i", "f"].forEach((p) => $(p + "kind").dispatchEvent(new Event("change")));

// ---------- QR MODE ----------
// qrcode-generator exposes isDark(r,c) and getModuleCount(), so the SVG is built here rather than
// taken from createSvgTag() — that gives brand colours, a correct quiet zone, and a knocked-out
// centre for the mark. Square modules on purpose: rounded ones scan worse on cheap readers.
const MARK_POLYS = [
  ["#191b21", "100,99.85 0,99.85 50,49.87"],
  ["#22242b", "99.92,0 100,99.85 50,49.87"],
  ["#3a3e48", "0.13,0 99.92,0 50,49.87"],
  ["#2c2f37", "0.08,99.85 0.13,0 50,49.87"],
  ["#e0a24c", "0.22,0 48.5,48.1 48.2,48.42 0.13,0.17"],
];

// Readers threshold luminance, so a pretty colour with too little contrast simply fails. Pale
// swatches are where consumer QR tools quietly break codes, so this one measures and says so.
function relLum(hex) {
  const h = hex.replace("#", "");
  const v = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) {
  try {
    const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  } catch (e) { return 0; }
}

// Module shape. Square is the only one that cannot cost you a scan; the others shrink the dark
// area a reader samples, which matters most at small sizes and on screens.
function moduleSVG(x, y, shape, fill) {
  switch (shape) {
    case "rounded":  return `<rect x="${x + .05}" y="${y + .05}" width=".9" height=".9" rx=".22" fill="${fill}"/>`;
    case "xrounded": return `<rect x="${x + .05}" y="${y + .05}" width=".9" height=".9" rx=".45" fill="${fill}"/>`;
    case "dots":     return `<circle cx="${x + .5}" cy="${y + .5}" r=".45" fill="${fill}"/>`;
    case "sdots":    return `<circle cx="${x + .5}" cy="${y + .5}" r=".36" fill="${fill}"/>`;
    case "diamond":  return `<polygon points="${x + .5},${y + .02} ${x + .98},${y + .5} ${x + .5},${y + .98} ${x + .02},${y + .5}" fill="${fill}"/>`;
    default:         return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
  }
}

// A rounded finder keeps the 1:1:3:1:1 ratio a reader measures along its scan lines, which is why
// it works in practice — but it is a deviation, so the UI says to test the real output.
function finderSVG(x, y, dark, light, style) {
  const rr = (X, Y, W, H, R, f) => `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="${R}" ry="${R}" fill="${f}"/>`;
  const ci = (cx, cy, rad, f) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${f}"/>`;
  // one corner left square, the rest rounded — the "leaf" shape
  const leaf = (X, Y, S, R, f) =>
    `<path d="M${X},${Y} h${S - R} a${R},${R} 0 0 1 ${R},${R} v${S - R * 2} a${R},${R} 0 0 1 ${-R},${R} `
    + `h${-(S - R * 2)} a${R},${R} 0 0 1 ${-R},${-R} v${-(S - R)} z" fill="${f}"/>`;
  switch (style) {
    case "rounded":  return rr(x, y, 7, 7, 2, dark) + rr(x + 1, y + 1, 5, 5, 1.4, light) + rr(x + 2, y + 2, 3, 3, .9, dark);
    case "xrounded": return rr(x, y, 7, 7, 3.2, dark) + rr(x + 1, y + 1, 5, 5, 2.2, light) + rr(x + 2, y + 2, 3, 3, 1.4, dark);
    case "circle":   return ci(x + 3.5, y + 3.5, 3.5, dark) + ci(x + 3.5, y + 3.5, 2.5, light) + ci(x + 3.5, y + 3.5, 1.5, dark);
    case "ring":     return ci(x + 3.5, y + 3.5, 3.5, dark) + ci(x + 3.5, y + 3.5, 2.5, light) + ci(x + 3.5, y + 3.5, 1.5, dark);
    case "dot":      return rr(x, y, 7, 7, 0, dark) + rr(x + 1, y + 1, 5, 5, 0, light) + ci(x + 3.5, y + 3.5, 1.5, dark);
    case "leaf":     return leaf(x, y, 7, 3, dark) + leaf(x + 1, y + 1, 5, 2, light) + leaf(x + 2, y + 2, 3, 1.1, dark);
    default:         return rr(x, y, 7, 7, 0, dark) + rr(x + 1, y + 1, 5, 5, 0, light) + rr(x + 2, y + 2, 3, 3, 0, dark);
  }
}

function buildQR() {
  const url = $("qurl").value.trim();
  if (!url) { say("q1", "Enter a URL.", "err"); return null; }
  const centre = $("qmark").checked || !!window.__centreImg;
  const ec = centre ? "H" : $("qec").value;          // any centre art needs the 30% recovery level
  if (centre && $("qec").value !== "H") $("qec").value = "H";

  let qr;
  try {
    qr = window.qrcode(0, ec);
    qr.addData(url);
    qr.make();
  } catch (err) { say("q1", "Could not encode: " + err.message, "err"); return null; }

  const n = qr.getModuleCount();
  const quiet = 4;                                   // the spec's minimum quiet zone
  const total = n + quiet * 2;
  const dark = $("qdark").value.trim() || "#17191F";
  const light = $("qlight").value.trim() || "#F6F6F8";

  const fstyle = $("qfinder").value;
  const shape = $("qpattern").value;
  // the three finders occupy 7x7 at the corners; when styling them, their modules are skipped and
  // the shapes drawn instead
  const inFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  let body = `<rect width="${total}" height="${total}" fill="${light}"/>`;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (inFinder(r, c)) continue;      // finders are always shapes — see below
      if (qr.isDark(r, c)) body += moduleSVG(c + quiet, r + quiet, shape, dark);
    }
  }
  // Always drawn as shapes, "square" included. Otherwise the finders inherit the module pattern
  // and "square corners" come out as dots — the corners must be independent of the pattern.
  body += finderSVG(quiet, quiet, dark, light, fstyle)
        + finderSVG(quiet + n - 7, quiet, dark, light, fstyle)
        + finderSVG(quiet, quiet + n - 7, dark, light, fstyle);
  if (window.__centreImg) {
    const side = Math.round(total * 0.22);
    const off = (total - side) / 2;
    const pad = Math.max(1, Math.round(side * 0.12));
    body += `<rect x="${off - pad}" y="${off - pad}" width="${side + pad * 2}" height="${side + pad * 2}" fill="${light}" rx="${pad}"/>`;
    body += `<image href="${window.__centreImg}" x="${off}" y="${off}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid meet"/>`;
  } else if ($("qmark").checked) {
    // knock a hole in the modules, then drop the mark in it. ~22% of the width keeps the payload
    // recoverable at level H.
    const side = Math.round(total * 0.22);
    const off = (total - side) / 2;
    const pad = Math.max(1, Math.round(side * 0.12));
    body += `<rect x="${off - pad}" y="${off - pad}" width="${side + pad * 2}" height="${side + pad * 2}" fill="${light}"/>`;
    body += `<g transform="translate(${off},${off}) scale(${side / 100})">`;
    MARK_POLYS.forEach(([f, p]) => { body += `<polygon points="${p}" fill="${f}"/>`; });
    body += `<circle cx="49.9" cy="49.85" r="2.25" fill="#e0a24c"/></g>`;
  }
  // Frame sits OUTSIDE the quiet zone — eating into it is a classic way to break a code.
  const frame = $("qframe").value;
  let vw = total, vh = total, shiftX = 0, shiftY = 0, outer = "";
  if (frame !== "none") {
    const bw = 1.2, capH = frame === "caption" ? 5 : 0;
    // width and height are INDEPENDENT: a caption adds a band below only. Adding it to a square
    // viewBox padded the right edge too and pushed the code off centre.
    vw = total + bw * 4;
    vh = total + bw * 4 + capH;
    shiftX = shiftY = bw * 2;
    const rx = frame === "rounded" ? 3 : 0;
    outer = `<rect x="${bw / 2}" y="${bw / 2}" width="${vw - bw}" height="${vh - bw}" rx="${rx}" `
          + `fill="${light}" stroke="${dark}" stroke-width="${bw}"/>`;
    if (capH) {
      const cap = ($("qcaption").value || "SCAN ME").toUpperCase();
      outer += `<text x="${vw / 2}" y="${total + bw * 2 + capH * 0.7}" text-anchor="middle" `
             + `font-family="Helvetica, Arial, sans-serif" font-size="${capH * 0.56}" `
             + `font-weight="700" letter-spacing="0.2" fill="${dark}">${esc(cap)}</text>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" `
    + `width="${vw}" height="${vh}" shape-rendering="crispEdges" role="img" `
    + `aria-label="QR code for ${esc(url)}">${outer}`
    + `<g transform="translate(${shiftX},${shiftY})">${body}</g></svg>`;

  const cr = contrast(dark, light);
  const notes = [`${n}×${n} modules`, `level ${ec}`, `${url.length} chars`, `contrast ${cr.toFixed(1)}:1`];
  let bad = n > 57;
  if (cr < 4) { notes.push("⚠ too little contrast — readers threshold luminance and this will fail"); bad = true; }
  else if (cr < 7) notes.push("contrast is workable but not generous");
  if (relLum(dark) > relLum(light)) { notes.push("⚠ inverted (light on dark) — many readers cope, not all"); }
  if (n > 45) notes.push("dense — shorten the URL if it scans badly off a screen");
  if (centre) notes.push("centre art ~22%, recoverable at H");
  if (fstyle !== "square") notes.push(`${fstyle} corners — a deviation from the spec, test it`);
  if (shape !== "square") notes.push(`${shape} modules shrink the sampled area — test at final size`);
  say("q1", notes.join(" · "), bad ? "err" : "ok");
  return { svg, vw, vh, url };
}

function renderQR() {
  const r = buildQR(); if (!r) return;
  $("qprev").innerHTML = r.svg;
  $("qprev").style.display = "block";
  $("qsvg").disabled = false; $("qpng").disabled = false;
  window.__qr = r;
}
["qurl", "qec", "qdark", "qlight"].forEach((id) => $(id).addEventListener("input", renderQR));
["qfinder", "qpattern", "qframe"].forEach((id) => $(id).addEventListener("change", renderQR));
$("qcaption").addEventListener("input", renderQR);
document.querySelectorAll("button.swatch").forEach((b) =>
  b.addEventListener("click", () => { $("qdark").value = b.dataset.c; saveSettings(); renderQR(); }));

// Custom centre art, for codes pointing at anything else we own. Embedded as a data URI so the
// downloaded SVG is self-contained rather than referencing a file that will go missing.
window.__centreImg = null;
$("qimg").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) { window.__centreImg = null; renderQR(); return; }
  if (f.size > 400 * 1024) { say("q1", "Keep the centre image under 400 KB — it is embedded in the SVG.", "err"); return; }
  const rd = new FileReader();
  rd.onload = () => { window.__centreImg = rd.result; $("qmark").checked = false; renderQR(); };
  rd.onerror = () => say("q1", "Could not read that image.", "err");
  rd.readAsDataURL(f);
});
$("qimgclear").addEventListener("click", () => {
  window.__centreImg = null; $("qimg").value = ""; renderQR();
});
$("qmark").addEventListener("change", renderQR);
$("qgen").addEventListener("click", renderQR);

$("qsvg").addEventListener("click", () => {
  if (!window.__qr) return;
  const u = URL.createObjectURL(new Blob([window.__qr.svg], { type: "image/svg+xml" }));
  dlBlob(u, "vertice-ar-qr.svg");
  setTimeout(() => URL.revokeObjectURL(u), 8000);
});

$("qpng").addEventListener("click", () => {
  if (!window.__qr) return;
  const px = Math.max(256, parseInt($("qpx").value, 10) || 1024);
  const { vw, vh } = window.__qr;
  const h = Math.round(px * vh / vw);             // a captioned frame is taller than it is wide
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;            // keep module edges hard
    ctx.drawImage(img, 0, 0, px, h);
    cv.toBlob((b) => {
      const u = URL.createObjectURL(b);
      dlBlob(u, `vertice-ar-qr-${px}.png`);
      setTimeout(() => URL.revokeObjectURL(u), 8000);
    }, "image/png");
  };
  img.onerror = () => say("q1", "PNG export failed — the SVG did not rasterise.", "err");
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(window.__qr.svg);
});

PANELS.qr = ["nav-qr", "panel-qr"];
$("nav-qr").addEventListener("click", () => show("qr"));
renderQR();
