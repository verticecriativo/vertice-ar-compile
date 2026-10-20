# vertice-ar-compile

Groundwork for a **recomputable AR target compiler**: a fork-path for [MindAR](https://github.com/hiukim/mind-ar-js) (MIT)
that emits, alongside the `.mind`, a manifest binding it to the inputs and the toolchain that made it.

This repo currently holds the **determinism harness** — the measurement the whole idea rests on.

## The studio

**[verticecriativo.github.io/vertice-ar-compile](https://verticecriativo.github.io/vertice-ar-compile/)**
— compile an image target and preview a model, entirely in the browser. Nothing is uploaded: the
image, the compiled `.mind` and the `.glb` never leave the tab.

**Image tracking** — add one or more images, compile them into a single `.mind` (each addressed by
its index), choose content, preview against the real tracker, then export either a generated
`index.html` or a **.zip bundle** that runs as-is.

**Face tracking** — no compile step. A pretrained mesh runs at capture time, so content rides on an
**anchor index** (MediaPipe FaceMesh landmark, `0–467`; presets for 168 between-eyes, 10 forehead,
1 nose tip, 152 chin). `faceOccluder` is on by default — a head-shaped mask hiding geometry behind
the face, without which glasses arms and hats render through the head.

**QR code** — generate the code that points at the experience, client-side. Six module patterns
(square, rounded, extra-rounded, dots, small dots, diamond), six corner styles (square, rounded,
extra-rounded, circle, square+dot, leaf), eight brand-safe colour swatches plus free hex, four
frame options with a caption, custom centre art, and **vector SVG** out.

It differs from the consumer tools in one way that matters: it **measures contrast and says so**.
Readers threshold luminance, so a pale colour simply fails — every swatch here clears 4:1 on white,
and anything below is flagged rather than quietly shipped. Decorative module shapes and styled
corners are flagged too: they shrink the sampled area or deviate from the 1:1:3:1:1 finder ratio,
which usually works and sometimes does not. Brand colours, four
error-correction levels, an optional Vértice mark knocked into the centre (forces level H, covers
~22%), and **vector SVG** output plus PNG. Shows the module count as you type, because density is
what makes a code fail when scanned off a screen: the bare URL is 33×33 at level H, the same URL
with campaign parameters is 49×49.

**Content types** — `.glb`, video, image, plane, box or text, each with scale, position and rotation.

**Tracking options**, taken from the component schemas rather than the docs:

| | |
|---|---|
| `maxTrack` | how many targets track at once (default 1) |
| `filterMinCF` | One Euro filter cutoff — lower is smoother but laggier (default 0.001) |
| `filterBeta` | filter beta — higher is more responsive (default 1000) |
| `warmupTolerance` | frames before a target counts as found (default 5) |
| `missTolerance` | frames before it counts as lost (default 5) |
| `uiScanning` / `uiLoading` | the built-in overlays |
| `showStats` | the debug overlay |
| `disableFaceMirror` | face mode only |

Settings persist in the browser; files do not, since blob URLs cannot survive a reload.

It also removes a dependency: until now the only way to compile a target was upstream's GitHub
Pages, which has had no commit since June 2024.

## The finding (2026-10-20)

Compiling the same 1000×1000 target with `OfflineCompiler`, in pinned containers:

| test | result |
|---|---|
| same process, compiled twice | **identical** — `f7b80a7a…`, 531 693 B |
| fresh process, same container image | **identical** — same hash |
| the same image compiled by the **browser** tool | **different** — `bedf9309…`, **367 466 B** |
| node:22 | would not run — the canvas native binary is ABI-locked to the Node major it was built for |

**Determinism holds inside a pinned toolchain. It does not hold across implementations.**

The two outputs differ by 164 KB, so this is a different *feature set*, not floating-point noise.

### Why

`mind-ar@1.2.5` pulls **TFJS 4.22.0**, and in Node only the **`cpu`** backend registers —
`@tensorflow/tfjs-backend-webgl` is present in the tree but cannot initialise without WebGL. The
browser compiles on GPU kernels, Node on CPU kernels. Different kernels, different features.

Nothing in the compile path is random: no `Math.random` in `compiler.js`, `detector.js`,
`matching.js` or `ransacHomography.js`. RANSAC runs at **tracking** time against live frames, not
when building a target.

### What this does to the claim

Not *"recompile anywhere, get the same hash"* — that is false, and this harness shows it false.

Instead: ***"recompile with this declared toolchain, get the same hash."*** A manifest must pin

```
mind-ar version · node major · canvas version · tfjs version AND backend · source image sha256
```

which is why this repo carries a `Dockerfile` and a lockfile rather than prose. The toolchain is
the claim.

## Reproducing it

```bash
docker build -t vertice-ar-compile .
docker run --rm -v "$PWD:/data" vertice-ar-compile \
  node det.mjs /data/target.jpg /data/reference.mind
```

Exit `0` = byte-identical across two compiles in one process, `1` = not. Nothing here asserts
cross-implementation equality, because it does not hold.

## Gotcha that costs an hour

Load the image with **mind-ar's own nested canvas**, not a top-level one:

```js
import { loadImage } from "mind-ar/node_modules/canvas/index.js";  // 2.11.2, mind-ar's
```

`mind-ar` pins canvas 2.11.2 under itself. A top-level `canvas` (3.x) is a different native
instance and the compiler throws `Image or Canvas expected` — native modules do not cross
instances. Which canvas decodes the JPEG also changes the pixels, so it is part of the toolchain.

## Where this is going

1. **Self-host the browser compiler** — MIT, runs client-side, images never leave the device.
2. **Fork to expose the compiler's hard-coded constants** as real parameters. They are currently
   module-level constants and `compileImageTargets(images, progressCallback)` accepts no options:

   | constant | controls |
   |---|---|
   | `LAPLACIAN_THRESHOLD = 3.0` | feature sensitivity — lower finds more on low-contrast targets |
   | `EDGE_THRESHOLD = 4.0` | rejection of edge-like features |
   | `NUM_BUCKETS_PER_DIMENSION = 10` × `MAX_FEATURES_PER_BUCKET = 5` | caps features at 500 per scale level, and their spatial spread |
   | `PYRAMID_MAX_OCTAVE = 5`, `PYRAMID_MIN_SIZE = 8` | scale-pyramid depth — governs tracking *distance range* |

   Every exposed knob becomes a manifest field: tweak freely, and the output still proves what made it.
3. **Manifest emission**, then a UI only if 2 proves useful in practice.

**Face tracking compiles nothing.** `src/face-target/` has a controller and a face-mesh helper and
no compiler — it uses a pretrained mesh at runtime and anchors to landmark indices. A *compiler*
suite does not apply to faces; the useful face tool is a landmark picker, which is a different job.

## Caveats worth carrying forward

- ⚠ A node-compiled target is a **different feature set**, not just a different hash. It may track
  better or worse than a browser-compiled one. Test on a real phone against the real printed target
  before swapping a working browser workflow for a CLI one.
- ⚠ Upstream `mind-ar` has had **no commit since 2024-06-11**. Not archived, 2.7k stars, but
  dormant. That is what makes forking realistic, and also why this repo pins everything explicitly
  rather than inheriting whatever npm resolves.

## Licence

MIT, inherited from `mind-ar`. Reuse it for anything, including unrelated AR projects — that is the
point. If the **manifest format** becomes a shared primitive it belongs in the CC0 commons
alongside `recompute-kit`, owned by nobody.
