# vertice-ar-compile

Groundwork for a **recomputable AR target compiler**: a fork-path for [MindAR](https://github.com/hiukim/mind-ar-js) (MIT)
that emits, alongside the `.mind`, a manifest binding it to the inputs and the toolchain that made it.

This repo currently holds the **determinism harness** — the measurement the whole idea rests on.

## The studio

**[verticecriativo.github.io/vertice-ar-compile](https://verticecriativo.github.io/vertice-ar-compile/)**
— compile an image target and preview a model, entirely in the browser. Nothing is uploaded: the
image, the compiled `.mind` and the `.glb` never leave the tab.

- pick an image → compile → download `target.mind`
- pick a `.glb` → set scale, position and rotation → preview with the real tracker
- generate a ready-to-use `index.html` with those settings baked in

Versions are pinned deliberately: **compiler `mind-ar@1.1.5`** (the build upstream's own tool uses,
so targets behave identically) and **runtime `mind-ar@1.2.1` + A-Frame 1.4.1** (what our working
experience runs). The preview is a same-origin `srcdoc` iframe precisely so the two versions cannot
collide on one page.

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
