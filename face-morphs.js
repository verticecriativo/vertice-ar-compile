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
  if (typeof AFRAME === "undefined") return;

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
