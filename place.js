// Placement viewport for image tracking — see where the content sits on the target before the
// camera is involved at all.
//
// It mirrors mind-ar's convention exactly: the target is ONE UNIT WIDE and its height follows the
// image aspect, content at position 0 0 0 sits at the target's centre, and +Z comes towards the
// viewer. So the plane you see here is the printed target at the same scale the tracker uses, and
// the numbers in Scale / Pos / Rot mean the same thing in both places. Whatever looks right here
// is what the preview and the exported bundle will produce.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
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
const num = (id, d) => { const v = parseFloat(($(id) || {}).value); return Number.isFinite(v) ? v : d; };

let renderer, scene, camera, controls, targetPlane, content, grid;
let started = false, modelURL = null, targetURL = null;
const loader = new GLTFLoader();

function start() {
  const host = $("iview");
  if (started || !host) return;
  started = true;

  // preserveDrawingBuffer so the canvas can be read back — screenshots, and tests like this one.
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x13161c, 1);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, host.clientWidth / host.clientHeight, 0.01, 60);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  renderer.domElement.style.touchAction = "none";

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1.4, 2.2); scene.add(key);

  // A metre grid in the target's plane, so offsets are readable against something.
  grid = new THREE.GridHelper(4, 40, 0x2e323d, 0x21242b);
  grid.rotation.x = Math.PI / 2;            // the target lies in XY, not XZ
  scene.add(grid);

  targetPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x666b76, side: THREE.DoubleSide })
  );
  scene.add(targetPlane);

  content = new THREE.Group();
  scene.add(content);

  fitDecoders(loader, renderer);

  front();
  addEventListener("resize", resize);
  (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  refresh();
}

function resize() {
  const host = $("iview");
  if (!renderer || !host || !host.clientWidth) return;
  renderer.setSize(host.clientWidth, host.clientHeight);
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
}

// Straight on, framed to the target — what the phone sees when it is square to the print.
function front() {
  if (!camera) return;
  camera.position.set(0, 0, 1.9);
  controls.target.set(0, 0, 0);
  controls.update();
}

function clearContent() {
  content.clear();
  content.position.set(0, 0, 0);
  content.rotation.set(0, 0, 0);
  content.scale.set(1, 1, 1);
}

// ---- the target itself -------------------------------------------------------------------
function updateTarget() {
  const list = window.__targets || [];
  const t = list[0];
  const url = t ? t.url : null;
  const aspect = t && t.img && t.img.width ? t.img.height / t.img.width : 0.75;
  targetPlane.geometry.dispose();
  targetPlane.geometry = new THREE.PlaneGeometry(1, aspect);   // 1 unit wide, exactly as mind-ar
  if (url !== targetURL) {
    targetURL = url;
    if (url) {
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        targetPlane.material.map = tex;
        targetPlane.material.color.set(0xffffff);
        targetPlane.material.needsUpdate = true;
      });
    } else {
      targetPlane.material.map = null;
      targetPlane.material.color.set(0x666b76);
      targetPlane.material.needsUpdate = true;
    }
  }
  return aspect;
}

// ---- the content -------------------------------------------------------------------------
function placeholder(kind, w, h, colour) {
  const col = new THREE.Color(colour || "#E0A24C");
  if (kind === "box") return new THREE.Mesh(new THREE.BoxGeometry(w, h, h),
    new THREE.MeshStandardMaterial({ color: col, roughness: .6 }));
  if (kind === "plane" || kind === "image" || kind === "video")
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: col, roughness: .8, side: THREE.DoubleSide }));
  if (kind === "text") {
    const g = new THREE.PlaneGeometry(w * 2, h * 0.5);
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: .8, transparent: true,
      opacity: .55, side: THREE.DoubleSide });
    return new THREE.Mesh(g, m);
  }
  return null;
}

function applyTransform() {
  const s = num("isc", 1);
  content.scale.set(s, s, s);
  content.position.set(num("ipx", 0), num("ipy", 0), num("ipz", 0));
  content.rotation.set(
    THREE.MathUtils.degToRad(num("irx", 0)),
    THREE.MathUtils.degToRad(num("iry", 0)),
    THREE.MathUtils.degToRad(num("irz", 0)));
}

function report(extra) {
  const s = num("isc", 1);
  const box = new THREE.Box3().setFromObject(content);
  const size = box.isEmpty() ? null : box.getSize(new THREE.Vector3());
  const aspect = targetPlane.geometry.parameters.height;
  let msg = size
    ? `content ${size.x.toFixed(2)} × ${size.y.toFixed(2)} units — `
      + `${(size.x * 100).toFixed(0)}% of the target's width, ${(size.y / aspect * 100).toFixed(0)}% of its height`
    : "nothing to place yet";
  if (size && size.x > 4) msg += "  ⚠ far wider than the target";
  say(msg + (extra ? " · " + extra : ""));
}

const say = (m, cls) => { const n = $("i5"); if (n) { n.textContent = m; n.className = "status " + (cls || ""); } };

function refresh() {
  if (!started) return;
  updateTarget();
  const kind = ($("ikind") || {}).value;
  const asset = (window.__assets || {}).i;
  const w = num("iw", 1), h = num("ih", 1);

  if (kind === "glb") {
    if (!asset) { clearContent(); applyTransform(); say("Choose a .glb above to place it on the target."); return; }
    if (asset.url !== modelURL) {
      modelURL = asset.url;
      clearContent();
      say("Loading the model…");
      loader.load(asset.url, (g) => {
        clearContent();
        content.add(g.scene);
        applyTransform();
        report("drag to orbit");
      }, undefined, (e) => {
        clearContent(); applyTransform();
        say("Could not load that .glb — " + ((e && e.message) || "decode failed"), "err");
      });
      return;
    }
  } else {
    modelURL = null;
    clearContent();
    const ph = placeholder(kind, w, h, ($("icolor") || {}).value);
    if (ph) content.add(ph);
  }
  applyTransform();
  report();
}

// ---- wiring ------------------------------------------------------------------------------
["isc", "ipx", "ipy", "ipz", "irx", "iry", "irz", "iw", "ih", "icolor"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", () => { if (started) { refresh(); } });
});
if ($("ikind")) $("ikind").addEventListener("change", () => { if (started) refresh(); });
document.addEventListener("vertice:placement", () => { if (started) refresh(); });
if ($("ifront")) $("ifront").addEventListener("click", front);
if ($("igridtoggle")) $("igridtoggle").addEventListener("change", (e) => { if (grid) grid.visible = e.target.checked; });

window.__placeStart = start;

// Module scripts are DEFERRED, so this file runs after studio.js — its boot-time call to
// __placeStart found nothing. Image tracking is the panel shown on load, so start here instead.
// The nav handler still covers coming back to the tab later.
const panel = document.getElementById("panel-image");
if (panel && !panel.hidden) start();
