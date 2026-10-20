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
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// A bare GLTFLoader decodes none of the compressed containers, which is how a perfectly good
// Draco model fails here with "No DRACOLoader instance provided" — the same gap A-Frame leaves for
// KTX2 and meshopt. Wire all three up once, against the renderer, so any real model opens.
function fitDecoders(loader, renderer) {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.5/");
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    const ktx2 = new KTX2Loader()
      .setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/basis/")
      .detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }
}

const $ = (id) => document.getElementById(id);
const say = (el, msg, cls) => { const n = $(el); if (!n) return; n.textContent = msg; n.className = "status " + (cls || ""); };

let renderer, scene, camera, controls, root, mesh;
let base = null;            // Float32Array, the neutral positions
let W = { jaw: null, lips: null };   // one weight map per paintable region
let weights = null;                  // alias for the channel being painted
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
    const gl = new GLTFLoader();
    fitDecoders(gl, renderer);
    const gltf = await gl.loadAsync(url);
    root.clear(); root.add(gltf.scene);

    // The head is the densest mesh. Everything else (ears, hair) stays visible but unpainted.
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    if (!meshes.length) throw new Error("no mesh in this file");
    mesh = meshes.reduce((a, b) =>
      b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a);

    // A model can arrive with non-zero default weights baked in — glTF stores them per mesh/node,
    // and anything exported mid-expression carries them. Start every load neutral so the viewport
    // shows the actual rest pose.
    let baked = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.morphTargetInfluences) {
        for (let i = 0; i < o.morphTargetInfluences.length; i++) {
          if (o.morphTargetInfluences[i] > 0.001) baked++;
          o.morphTargetInfluences[i] = 0;
        }
      }
    });

    const pos = mesh.geometry.attributes.position;
    base = new Float32Array(pos.array);
    W = { jaw: new Float32Array(pos.count), lips: new Float32Array(pos.count) };
    weights = W[$("rigchannel").value] || W.jaw;

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
    // Generating onto a model that already has a full ARKit set replaces ten of its shapes with
    // cruder ones while the other forty-one stay as the artist made them. The mouth then gets
    // deformed by two systems that were never designed together.
    if (existing >= 20) say("rig3", `This model already carries ${existing} morph targets. `
      + `Generating will REPLACE the ten mouth shapes with generated ones and leave the rest — `
      + `fine for trying the tool, but for real work rig a model that has none.`, "err");
    say("rig1", `${file.name} — ${(file.size / 1048576).toFixed(2)} MB · mesh "${mesh.name || "?"}" · `
      + `${pos.count.toLocaleString()} vertices` + (existing ? ` · ${existing} existing morph targets` : "")
      + (baked ? `  ⚠ it had ${baked} non-zero default weight(s) baked in — reset to neutral here` : ""), "ok");
    $("rigclear").disabled = false; $("rigseed").disabled = false;
    $("riggen").disabled = false; $("rigpaint").disabled = false;
    $("rigall").disabled = false;
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
  for (let i = 0; i < col.count; i++) {
    const j = W.jaw[i], l = W.lips[i];
    // jaw tints red, lips tint amber; where they overlap the two simply multiply
    col.setXYZ(i, 1, (1 - 0.85 * j) * (1 - 0.25 * l), (1 - 0.9 * j) * (1 - 0.85 * l));
  }
  col.needsUpdate = true;
  const nj = W.jaw.reduce((a, w) => a + (w > 0.01 ? 1 : 0), 0);
  const nl = W.lips.reduce((a, w) => a + (w > 0.01 ? 1 : 0), 0);
  say("rig2", `jaw ${nj.toLocaleString()} · lips ${nl.toLocaleString()} vertices painted`
    + (nj && !nl ? "  — paint the lip ring too for the other nine shapes" : ""));
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
  // Channel first. Seeding the lip ring from a jawOpen displacement would hand it the whole jaw,
  // which is the one thing the lip shapes must not have.
  if ($("rigchannel").value === "lips") { seedLipsFromJaw(); return; }
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

// The lip ring is where the jaw paint stops: you paint the lower lip and not the upper, so the
// transition band of the jaw map runs along the mouth. Take that band and thicken it slightly.
function seedLipsFromJaw() {
  const j = W.jaw;
  if (!j.some((w) => w > 0.01)) {
    say("rig2", "Paint the jaw first — the lip ring is seeded from where the jaw paint stops.", "err");
    return;
  }
  for (let i = 0; i < j.length; i++) {
    const d = Math.abs(j[i] - 0.5) * 2;        // 1 at w=0 or w=1, 0 at the halfway transition
    W.lips[i] = j[i] > 0.02 && j[i] < 0.98 ? 1 - d * d : 0;
  }
  refreshColors();
  say("rig2", "Lips seeded from the jaw's transition band — check it follows the mouth, and erase "
    + "any of it that ran along the jawline instead.", "ok");
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
  const weights = W.jaw;
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
  const dict = addTarget(name, delta);

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
  refreshPicker();
  $("rigpick").value = name;
  $("rigtest").value = 0;
  applyTest();
}

// Add or replace a morph target. glTF semantics: targets are DELTAS, hence morphTargetsRelative.
function addTarget(name, delta) {
  const g = mesh.geometry;
  if (!g.morphAttributes.position) g.morphAttributes.position = [];
  g.morphTargetsRelative = true;
  const dict = mesh.morphTargetDictionary || {};
  if (name in dict) g.morphAttributes.position[dict[name]] = new THREE.BufferAttribute(delta, 3);
  else {
    g.morphAttributes.position.push(new THREE.BufferAttribute(delta, 3));
    dict[name] = g.morphAttributes.position.length - 1;
  }
  mesh.updateMorphTargets();                 // rebuilds the dictionary from scratch
  mesh.morphTargetDictionary = dict;         // so put ours back
  mesh.morphTargetInfluences = new Array(g.morphAttributes.position.length).fill(0);
  return dict;
}

function refreshPicker() {
  const sel = $("rigpick");
  const dict = mesh.morphTargetDictionary || {};
  const names = Object.keys(dict).sort();
  const keep = sel.value;
  sel.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");
  if (names.includes(keep)) sel.value = keep;
  sel.disabled = !names.length;
  $("rigtest").disabled = !names.length;
  $("rigdl").disabled = !names.length;
}

// The nine lip shapes. All of them are a displacement of the LIP ring expressed in a frame built
// from that ring — centre, half-width, half-height, and which way the face points — so the numbers
// are proportions of the mouth and carry across characters of any size or style.
function generateAll() {
  const g = mesh.geometry, pos = g.attributes.position, n = pos.count;
  if (!W.lips.some((w) => w > 0.01)) {
    say("rig3", "Paint the lip ring first — switch the region selector to Lips. "
      + "jawOpen only needs the jaw, the other nine need the lips.", "err");
    return;
  }
  generate();                                    // jawOpen, from the jaw channel

  const L = W.lips;
  let cx = 0, cy = 0, cz = 0, tot = 0;
  for (let i = 0; i < n; i++) if (L[i] > 0.01) { cx += pos.getX(i) * L[i]; cy += pos.getY(i) * L[i]; cz += pos.getZ(i) * L[i]; tot += L[i]; }
  cx /= tot; cy /= tot; cz /= tot;
  let hw = 0, hh = 0;
  for (let i = 0; i < n; i++) if (L[i] > 0.05) {
    hw = Math.max(hw, Math.abs(pos.getX(i) - cx));
    hh = Math.max(hh, Math.abs(pos.getY(i) - cy));
  }
  hw = hw || 1; hh = hh || 1;
  g.computeBoundingBox();
  const midZ = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;
  const fwd = cz > midZ ? 1 : -1;                // the mouth is on the face, so this is "outwards"
  // Facing +Z with +Y up, the subject's left is +X (cross(up, forward)). Facing -Z it flips.
  const leftSign = fwd;
  const amt = (parseFloat($("riglip").value) || 100) / 100;

  // Each entry returns a displacement for one vertex, given its offset within the lip frame.
  const SHAPES = {
    mouthClose:       (dx, dy, u) => [0, -dy * 0.45 - Math.sign(dy) * hw * 0.05, 0],
    mouthFunnel:      (dx, dy, u) => [-dx * 0.55, dy * 0.12, fwd * hw * 0.30],
    mouthPucker:      (dx, dy, u) => [-dx * 0.65, -dy * 0.25, fwd * hw * 0.42],
    // Vertical amounts are scaled by mouth WIDTH, not by the thickness of the painted band. A thin
    // band still has the right width, so the shapes stay sensible however carefully it was painted.
    mouthShrugUpper:  (dx, dy, u) => (u > 0 ? [0, hw * 0.20, fwd * hw * 0.15] : [0, 0, 0]),
    mouthRollLower:   (dx, dy, u) => (u < 0 ? [0, hw * 0.14, -fwd * hw * 0.28] : [0, 0, 0]),
  };
  // Sided shapes: a smile lifts one corner up and back, a stretch pulls it outwards and down.
  for (const side of ["Left", "Right"]) {
    const sgn = side === "Left" ? leftSign : -leftSign;
    const sideW = (dx) => Math.max(0, Math.min(1, (dx * sgn) / hw));   // 0 at centre, 1 at corner
    SHAPES["mouthSmile" + side]   = (dx, dy) => { const k = sideW(dx);
      return [dx * 0.10 * k, hw * 0.34 * k, -fwd * hw * 0.10 * k]; };
    SHAPES["mouthStretch" + side] = (dx, dy) => { const k = sideW(dx);
      return [sgn * hw * 0.32 * k, -hw * 0.10 * k, -fwd * hw * 0.05 * k]; };
  }

  const built = [];
  for (const [name, fn] of Object.entries(SHAPES)) {
    const d = new Float32Array(n * 3);
    let mx = 0;
    for (let i = 0; i < n; i++) {
      const w = L[i]; if (w <= 0.005) continue;
      const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy;
      const v = fn(dx, dy, dy);
      d[i * 3]     = v[0] * w * amt;
      d[i * 3 + 1] = v[1] * w * amt;
      d[i * 3 + 2] = v[2] * w * amt;
      mx = Math.max(mx, Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]));
    }
    if (mx > 1e-6) { addTarget(name, d); built.push(name); }
  }
  refreshPicker();
  const dict = mesh.morphTargetDictionary || {};
  say("rig3", `Built ${built.length + 1} shapes: jawOpen + ${built.join(", ")} · `
    + `lip frame ${(2 * hw).toFixed(3)} wide · ${Object.keys(dict).length} morph target(s) total`, "ok");
}

function applyTest() {
  if (!mesh || !mesh.morphTargetInfluences) return;
  const dict = mesh.morphTargetDictionary || {};
  mesh.morphTargetInfluences.fill(0);               // play one at a time, so each is legible
  const name = $("rigpick").value || ($("rigname").value || "jawOpen").trim();
  const idx = dict[name];
  if (idx === undefined) return;
  mesh.morphTargetInfluences[idx] = (parseFloat($("rigtest").value) || 0) / 100;
}

async function download() {
  say("rig4", "Exporting…");
  // The exporter writes whatever the influences currently are as the model's DEFAULT weights, so
  // exporting with the test slider up ships a model that is permanently mid-expression — it loads
  // with its jaw already open. Zero every mesh for the duration of the export, then put it back.
  const saved = [];
  root.traverse((o) => {
    if (o.isMesh && o.morphTargetInfluences) {
      saved.push([o, [...o.morphTargetInfluences]]);
      o.morphTargetInfluences.fill(0);
    }
  });
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
  // morphTargetInfluences is a plain Array, not a typed array — it has no .set().
  finally {
    for (const [o, v] of saved)
      for (let k = 0; k < v.length; k++) o.morphTargetInfluences[k] = v[k];
  }
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
$("rigall").addEventListener("click", generateAll);
$("rigpick").addEventListener("change", () => { $("rigtest").value = 0; applyTest(); });
$("rigchannel").addEventListener("change", () => {
  weights = W[$("rigchannel").value] || W.jaw;
  say("rig2", `Painting the ${$("rigchannel").value === "lips" ? "lip ring" : "jaw"} now.`);
});
$("rigtest").addEventListener("input", applyTest);
$("rigdl").addEventListener("click", download);

window.__rigInit = init;
// Exposed for inspection: lets a test (or the console) read back what was actually generated.
Object.defineProperty(window, "__rigMesh", { get: () => mesh });
