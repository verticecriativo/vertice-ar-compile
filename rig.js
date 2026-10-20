// Face rig — paint a jaw region on a .glb and generate ARKit morph targets from it, in the browser.
//
// WHY THIS EXISTS: jawOpen is ~97.5% explained by a rigid rotation of the lower face about a
// left-right axis (measured by least-squares fit against an authored ARKit head). So the maths is
// trivial. What cannot be automated is WHICH vertices move: a bounding-box plane puts both lips on
// the same side, so they travel together and the mouth never parts — measured cosine 0.83 against
// an authored shape while the rendered mouth stayed completely shut. Paint the region and the same
// rotation scores 0.97 and is visually indistinguishable.
//
// WHY IN THE BROWSER rather than Blender: the painted region cannot survive a GLB round-trip. A
// vertex group is not exported at all, and index-keyed weights are useless because the exporter
// re-splits vertices at UV and normal seams. Painting and generating in one page never serialises
// the weights, so the problem disappears.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);
const say = (el, msg, cls) => { const n = $(el); if (!n) return; n.textContent = msg; n.className = "status " + (cls || ""); };

let renderer, scene, camera, controls, root, mesh;
let base = null;            // Float32Array, the neutral positions
let weights = null;         // Float32Array, 0..1 per vertex
let painting = false, erasing = false;
let origMaterial = null, weightMaterial = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function init() {
  const host = $("rigview");
  if (renderer || !host) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x13161c, 1);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, host.clientWidth / host.clientHeight, 0.01, 100);
  camera.position.set(0, 0, 3);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(1, 1.5, 2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-2, 0, 1); scene.add(fill);

  root = new THREE.Group(); scene.add(root);

  addEventListener("resize", () => {
    if (!host.clientWidth) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
  });

  const cv = renderer.domElement;
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (e) => {
    if (!$("rigpaint").checked || !mesh) return;
    painting = true; erasing = e.shiftKey || e.button === 2;
    cv.setPointerCapture(e.pointerId); paintAt(e); e.preventDefault();
  });
  cv.addEventListener("pointermove", (e) => { if (painting) paintAt(e); });
  cv.addEventListener("pointerup", (e) => { painting = false; try { cv.releasePointerCapture(e.pointerId); } catch {} });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  (function loop() {
    requestAnimationFrame(loop);
    controls.enabled = !$("rigpaint").checked;
    controls.update();
    renderer.render(scene, camera);
  })();
}

// ---------- loading ----------
async function loadFromFile(file) {
  init();
  const url = URL.createObjectURL(file);
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    root.clear(); root.add(gltf.scene);

    // The head is the densest mesh. Everything else (ears, hair) stays visible but unpainted.
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    if (!meshes.length) throw new Error("no mesh in this file");
    mesh = meshes.reduce((a, b) =>
      b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a);

    const pos = mesh.geometry.attributes.position;
    base = new Float32Array(pos.array);
    weights = new Float32Array(pos.count);

    // Frame the model.
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z);
    controls.target.copy(c);
    camera.position.set(c.x, c.y, c.z + d * 2.0);
    camera.near = d / 100; camera.far = d * 40; camera.updateProjectionMatrix();
    controls.update();

    origMaterial = mesh.material;
    const col = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    mesh.geometry.setAttribute("color", col);
    weightMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.75, metalness: 0.0,
      map: origMaterial && origMaterial.map ? origMaterial.map : null,
    });
    setView();
    refreshColors();

    const existing = mesh.morphTargetDictionary ? Object.keys(mesh.morphTargetDictionary).length : 0;
    say("rig1", `${file.name} — ${(file.size / 1048576).toFixed(2)} MB · mesh "${mesh.name || "?"}" · `
      + `${pos.count.toLocaleString()} vertices` + (existing ? ` · ${existing} existing morph targets` : ""), "ok");
    $("rigclear").disabled = false; $("rigseed").disabled = false;
    $("riggen").disabled = false; $("rigpaint").disabled = false;
    say("rig2", "Tick Paint, then drag on the model. Shift-drag erases. Untick Paint to orbit.");
  } catch (e) {
    say("rig1", "Could not load this model — " + e.message, "err");
  } finally { setTimeout(() => URL.revokeObjectURL(url), 20000); }
}

function setView() {
  if (!mesh) return;
  mesh.material = $("rigshow").checked ? weightMaterial : origMaterial;
}

function refreshColors() {
  if (!mesh) return;
  const col = mesh.geometry.attributes.color;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    col.setXYZ(i, 1, 1 - 0.85 * w, 1 - 0.9 * w);   // white → red as the weight rises
  }
  col.needsUpdate = true;
  const n = weights.reduce((a, w) => a + (w > 0.01 ? 1 : 0), 0);
  say("rig2", n ? `${n.toLocaleString()} vertices painted` : "Nothing painted yet.");
}

// ---------- painting ----------
function paintAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit) return;

  const local = mesh.worldToLocal(hit.point.clone());
  const g = mesh.geometry;
  g.computeBoundingBox();
  const span = g.boundingBox.getSize(new THREE.Vector3()).length();
  const radius = span * (parseFloat($("rigbrush").value) || 8) / 100;
  const strength = (parseFloat($("rigstrength").value) || 60) / 100;
  const r2 = radius * radius;
  const pos = g.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - local.x, dy = pos.getY(i) - local.y, dz = pos.getZ(i) - local.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const t = 1 - Math.sqrt(d2) / radius;
    const fall = t * t * (3 - 2 * t);                 // smoothstep, so the edge feathers
    weights[i] = erasing
      ? Math.max(0, weights[i] - fall * strength)
      : Math.min(1, weights[i] + fall * strength);
  }
  refreshColors();
}

// Seeding. If the model already carries a morph target of this name, its own displacement IS the
// region — exact, and useful for retargeting or repairing an existing rig. Otherwise fall back to
// a crude bounding-box guess, which is a head start and NOT a solution: it still needs correcting
// around the mouth, which is the part a bounding box cannot get right.
function seed() {
  const g0 = mesh.geometry;
  const want = ($("rigname").value || "jawOpen").trim();
  const dict = mesh.morphTargetDictionary || {};
  if (want in dict && g0.morphAttributes.position && g0.morphAttributes.position[dict[want]]) {
    const t = g0.morphAttributes.position[dict[want]];
    let mx = 0;
    for (let i = 0; i < t.count; i++) mx = Math.max(mx, Math.hypot(t.getX(i), t.getY(i), t.getZ(i)));
    if (mx > 0) {
      for (let i = 0; i < t.count; i++)
        weights[i] = Math.min(1, Math.hypot(t.getX(i), t.getY(i), t.getZ(i)) / mx);
      refreshColors();
      say("rig2", `Seeded from the model's existing "${want}" — ${
        weights.reduce((a, w) => a + (w > 0.01 ? 1 : 0), 0).toLocaleString()} vertices. `
        + `Regenerating will replace that shape.`, "ok");
      return;
    }
  }
  seedFromBounds();
}

function seedFromBounds() {
  const g = mesh.geometry; g.computeBoundingBox();
  const bb = g.boundingBox, size = bb.getSize(new THREE.Vector3());
  const pos = g.attributes.position;
  const cut = bb.min.y + 0.42 * size.y, band = 0.18 * size.y;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (cut - pos.getY(i)) / band));
    weights[i] = t * t * (3 - 2 * t);
  }
  refreshColors();
  say("rig2", "Seeded from the bounding box — now correct it around the mouth, or the lips will "
    + "move together and it will not open.", "err");
}

// ---------- generation ----------
function generate() {
  const g = mesh.geometry, pos = g.attributes.position;
  const n = pos.count;
  if (!weights.some((w) => w > 0.01)) { say("rig3", "Paint a jaw region first.", "err"); return; }

  g.computeBoundingBox();
  const bb = g.boundingBox, size = bb.getSize(new THREE.Vector3());
  // Hinge placement. A jaw pivots near the ear: at the TOP of the painted region, and well BEHIND
  // the face. Percentiles taken inside the region put the pivot among the vertices it is meant to
  // swing, which collapses the lever arm — an earlier version produced 1% of the displacement it
  // should have. So: height from the region, depth from the head.
  const painted = [];
  for (let i = 0; i < n; i++) if (weights[i] > 0.05) painted.push(i);
  const ys = painted.map((i) => pos.getY(i)).sort((a, b) => a - b);
  let hy = ys[Math.min(ys.length - 1, Math.floor(0.97 * ys.length))];   // top of the painted region

  // Which side is the face? Wherever the painted chin sits. The hinge goes towards the other side.
  const cz = painted.reduce((a, i) => a + pos.getZ(i), 0) / painted.length;
  const midZ = (bb.min.z + bb.max.z) / 2;
  const backZ = cz > midZ ? bb.min.z : bb.max.z;
  let hz = midZ + 0.60 * (backZ - midZ);
  if ($("righy").value.trim()) hy = parseFloat($("righy").value);
  if ($("righz").value.trim()) hz = parseFloat($("righz").value);

  const deg = parseFloat($("rigangle").value) || 37.5;
  // Sign convention differs per model, so choose the direction that actually lowers the painted
  // region rather than assuming one.
  const build = (sign) => {
    const out = new Float32Array(n * 3);
    const a = sign * deg * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const th = weights[i] * a, c = Math.cos(th), s = Math.sin(th);
      const y = pos.getY(i) - hy, z = pos.getZ(i) - hz;
      out[i * 3]     = 0;
      out[i * 3 + 1] = (y * c - z * s + hy) - pos.getY(i);
      out[i * 3 + 2] = (y * s + z * c + hz) - pos.getZ(i);
    }
    return out;
  };
  const score = (d) => { let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) if (weights[i] > 0.5) { sum += d[i * 3 + 1]; cnt++; }
    return cnt ? sum / cnt : 0; };
  let delta = build(1);
  if (score(delta) > 0) delta = build(-1);          // keep the one that moves the chin DOWN

  const name = ($("rigname").value || "jawOpen").trim();
  if (!g.morphAttributes.position) g.morphAttributes.position = [];
  g.morphTargetsRelative = true;                     // glTF semantics: targets are deltas
  const dict = mesh.morphTargetDictionary || {};
  if (name in dict) g.morphAttributes.position[dict[name]] = new THREE.BufferAttribute(delta, 3);
  else {
    g.morphAttributes.position.push(new THREE.BufferAttribute(delta, 3));
    dict[name] = g.morphAttributes.position.length - 1;
  }
  mesh.morphTargetDictionary = dict;
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = dict;                 // updateMorphTargets rebuilds it; keep ours
  mesh.morphTargetInfluences = new Array(g.morphAttributes.position.length).fill(0);

  let maxd = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(delta[i * 3 + 1], delta[i * 3 + 2]);
    if (m > maxd) maxd = m;
  }
  const pct = 100 * maxd / size.y;
  say("rig3", `${name} built · hinge y ${hy.toFixed(3)} z ${hz.toFixed(3)} · `
    + `max displacement ${maxd.toFixed(3)} = ${pct.toFixed(0)}% of head height · `
    + `${Object.keys(dict).length} morph target(s)`
    + (pct < 12 ? "  ⚠ that is a small movement — an open jaw is nearer 30%; raise Angle or move the hinge back"
                : ""), pct < 12 ? "err" : "ok");
  $("rigtest").disabled = false; $("rigdl").disabled = false;
  $("rigtest").value = 0;
  applyTest();
}

function applyTest() {
  if (!mesh || !mesh.morphTargetInfluences) return;
  const name = ($("rigname").value || "jawOpen").trim();
  const idx = mesh.morphTargetDictionary ? mesh.morphTargetDictionary[name] : undefined;
  if (idx === undefined) return;
  mesh.morphTargetInfluences[idx] = (parseFloat($("rigtest").value) || 0) / 100;
}

async function download() {
  say("rig4", "Exporting…");
  try {
    const glb = await new Promise((res, rej) =>
      new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: false }));
    const blob = new Blob([glb], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ($("rigfile") || {}).value || "rigged.glb";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    say("rig4", `Exported ${(blob.size / 1048576).toFixed(2)} MB. Load it in Face tracking and the `
      + `checker will confirm the morph target.`, "ok");
  } catch (e) { say("rig4", "Export failed — " + e.message, "err"); }
}

// ---------- wiring ----------
$("rigfileinput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) loadFromFile(f); });
$("rigtesthead").addEventListener("click", async () => {
  say("rig1", "Loading the bundled test head…");
  try {
    const r = await fetch("assets/redpanda-head.glb");
    if (!r.ok) throw new Error("HTTP " + r.status);
    await loadFromFile(new File([await r.blob()], "redpanda-head.glb", { type: "model/gltf-binary" }));
  } catch (e) { say("rig1", "Could not load it — " + e.message, "err"); }
});
$("rigclear").addEventListener("click", () => { weights.fill(0); refreshColors(); });
$("rigseed").addEventListener("click", seed);
$("rigshow").addEventListener("change", setView);
$("riggen").addEventListener("click", generate);
$("rigtest").addEventListener("input", applyTest);
$("rigdl").addEventListener("click", download);

window.__rigInit = init;
