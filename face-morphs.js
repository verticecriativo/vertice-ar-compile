// vertice-face-morphs — drive a GLB's ARKit morph targets from mind-ar's live face blendshapes.
//
// mind-ar asks MediaPipe for blendshapes (outputFaceBlendshapes: true) and parks them on the
// controller every frame, but its A-Frame layer registers no component for them. This is that
// component. Put it on an <a-gltf-model> inside a mindar-face-target entity.
//
// The 52 categories are the ARKit set, but the SAME shape is spelled differently depending on who
// exported the model, so names are canonicalised on both sides before matching:
//
//   MediaPipe / Apple            mouthSmileLeft
//   most DCC exports             mouthSmile_L   or   mouthSmile.L
//   Maya                         blendShape1.mouthSmile_L
//
// Without that, a perfectly good model simply sits still and nothing says why — hence the report.
(function () {
  const ARKIT = ["_neutral",
    "browDownLeft","browDownRight","browInnerUp","browOuterUpLeft","browOuterUpRight",
    "cheekPuff","cheekSquintLeft","cheekSquintRight","eyeBlinkLeft","eyeBlinkRight",
    "eyeLookDownLeft","eyeLookDownRight","eyeLookInLeft","eyeLookInRight","eyeLookOutLeft",
    "eyeLookOutRight","eyeLookUpLeft","eyeLookUpRight","eyeSquintLeft","eyeSquintRight",
    "eyeWideLeft","eyeWideRight","jawForward","jawLeft","jawOpen","jawRight","mouthClose",
    "mouthDimpleLeft","mouthDimpleRight","mouthFrownLeft","mouthFrownRight","mouthFunnel",
    "mouthLeft","mouthLowerDownLeft","mouthLowerDownRight","mouthPressLeft","mouthPressRight",
    "mouthPucker","mouthRight","mouthRollLower","mouthRollUpper","mouthShrugLower",
    "mouthShrugUpper","mouthSmileLeft","mouthSmileRight","mouthStretchLeft","mouthStretchRight",
    "mouthUpperUpLeft","mouthUpperUpRight","noseSneerLeft","noseSneerRight"];

  // Order matters: strip a Maya-style prefix first, then fold a _L/.L suffix to Left/Right, and
  // only then drop separators. Folding the suffix BEFORE dropping separators is what keeps
  // "mouthFunnel" intact — it ends in an l but has no suffix separator.
  function canon(raw) {
    let n = String(raw).replace(/^blend[sS]hape\d*\./, "");
    n = n.replace(/[._]([LR])$/i, (_m, d) => (d.toLowerCase() === "l" ? "Left" : "Right"));
    return n.replace(/[._\s]/g, "").toLowerCase();
  }

  // Extensions plain A-Frame cannot decode: it installs none of these loaders, so the model loads
  // as nothing and the scene looks empty. Worth catching before anyone builds on it.
  const BLOCKING = {
    KHR_texture_basisu: "KTX2 textures (needs KTX2Loader)",
    EXT_meshopt_compression: "meshopt packing (needs MeshoptDecoder)",
    KHR_draco_mesh_compression: "Draco mesh compression (needs DRACOLoader)",
  };

  // Read a .glb's JSON chunk directly — no three.js, no network, nothing uploaded. Enough to answer
  // "will this model work?" from the file alone, without a camera or a face.
  function inspectGLB(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb");
    let off = 12, json = null;
    while (off + 8 <= dv.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4e4f534a) {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
        break;
      }
      off += 8 + len + ((4 - (len % 4)) % 4);
    }
    if (!json) throw new Error("no JSON chunk");

    let names = [];
    (json.meshes || []).forEach((m) => {
      (m.primitives || []).forEach((p) => {
        const tn = (p.extras && p.extras.targetNames) || (m.extras && m.extras.targetNames);
        if (tn && tn.length > names.length) names = tn;
      });
    });
    // "A-Frame can decode it" and "a phone can run it" are different questions. AI image-to-3D
    // tools (Tripo, Meshy and friends) emit millions of triangles and 4k textures by default, which
    // decodes perfectly and then exhausts a phone's memory. Report the weight too.
    const acc = json.accessors || [], views = json.bufferViews || [];
    let tris = 0;
    (json.meshes || []).forEach((m) => (m.primitives || []).forEach((pr) => {
      if (pr.indices !== undefined && acc[pr.indices]) tris += Math.floor(acc[pr.indices].count / 3);
      else if (pr.attributes && pr.attributes.POSITION !== undefined && acc[pr.attributes.POSITION])
        tris += Math.floor(acc[pr.attributes.POSITION].count / 3);
    }));
    let texBytes = 0;
    (json.images || []).forEach((im) => {
      if (im.bufferView !== undefined && views[im.bufferView]) texBytes += views[im.bufferView].byteLength;
    });

    const have = new Set(names.map(canon));
    const matched = ARKIT.filter((n) => have.has(canon(n)));
    const mouth = ARKIT.filter((n) => /^(jaw|mouth)/.test(n));
    const blocking = [].concat(json.extensionsRequired || [], json.extensionsUsed || [])
      .filter((e, i, a) => BLOCKING[e] && a.indexOf(e) === i);
    return {
      meshes: (json.meshes || []).length,
      triangles: tris,
      textureBytes: texBytes,
      animations: (json.animations || []).length,
      skins: (json.skins || []).length,
      generator: (json.asset || {}).generator || "",
      morphTargets: names.length,
      names: names,
      matched: matched.length,
      // _neutral is never authored into a model, so 51 is the real ceiling.
      matchedDrivable: matched.filter((n) => n !== "_neutral").length,
      mouthOk: mouth.filter((n) => have.has(canon(n))).length,
      mouthTotal: mouth.length,
      dialect: names.some((n) => /[._][LR]$/.test(n)) ? "_L/_R"
             : names.some((n) => /(Left|Right)$/.test(n)) ? "Left/Right" : "—",
      blocking: blocking.map((e) => BLOCKING[e]),
    };
  }

  window.VerticeFaceMorphs = { ARKIT: ARKIT, canon: canon, inspectGLB: inspectGLB };

  if (typeof AFRAME === "undefined") return;

  AFRAME.registerComponent("vertice-face-morphs", {
    schema: {
      smoothing: { type: "number", default: 0.35 },  // 0 = raw and twitchy, →1 = heavier damping
      gain:      { type: "number", default: 1 },     // exaggerate the expression
      enabled:   { type: "boolean", default: true },
    },

    init: function () {
      this.rigs = [];
      this.reported = false;
      this.onModel = this.collect.bind(this);
      this.el.addEventListener("model-loaded", this.onModel);
      this.collect();
    },

    remove: function () { this.el.removeEventListener("model-loaded", this.onModel); },

    collect: function () {
      const rigs = [], raw = [];
      this.el.object3D.traverse((o) => {
        if (!o.isMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const map = {};
        for (const name in o.morphTargetDictionary) {
          map[canon(name)] = o.morphTargetDictionary[name];
          raw.push(name);
        }
        rigs.push({ mesh: o, map: map });
      });
      this.rigs = rigs;
      this.rawNames = raw;
      this.reported = false;
    },

    // Reported once, after the first frame that actually carries blendshapes, so the numbers
    // describe a real match rather than an empty model or a missing face.
    report: function () {
      const seen = new Set();
      this.rigs.forEach((r) => Object.keys(r.map).forEach((k) => seen.add(k)));
      const matched = ARKIT.filter((n) => seen.has(canon(n)));
      const unusedModel = this.rawNames.filter((n) => !ARKIT.some((a) => canon(a) === canon(n)));
      const detail = {
        meshes: this.rigs.length,
        morphTargets: this.rawNames.length,
        matched: matched.length,
        missing: ARKIT.filter((n) => n !== "_neutral" && !seen.has(canon(n))),
        unusedModelTargets: unusedModel,
        sample: this.rawNames.slice(0, 8),
      };
      this.el.sceneEl.emit("vertice-morphs-report", detail);
      return detail;
    },

    tick: function () {
      if (!this.data.enabled) return;
      const sys = this.el.sceneEl.systems["mindar-face-system"];
      const est = sys && sys.controller && sys.controller.lastEstimateResult;
      const cats = est && est.blendshapes && est.blendshapes.categories;
      if (!cats || !cats.length) return;

      // Report BEFORE bailing on an empty rig. A model that loaded with no morph targets at all —
      // or that failed to load, as facecap.glb does without KTX2/meshopt loaders — is exactly the
      // case that most needs to say something, and reporting after the guard said nothing.
      if (!this.reported) { this.reported = true; this.report(); }
      if (!this.rigs.length) return;

      const k = Math.min(1, Math.max(0.01, 1 - this.data.smoothing));
      const gain = this.data.gain;
      for (let r = 0; r < this.rigs.length; r++) {
        const map = this.rigs[r].map, inf = this.rigs[r].mesh.morphTargetInfluences;
        for (let i = 0; i < cats.length; i++) {
          const idx = map[canon(cats[i].categoryName)];
          if (idx === undefined) continue;
          const want = Math.min(1, cats[i].score * gain);
          inf[idx] += (want - inf[idx]) * k;
        }
      }
    },
  });
})();
