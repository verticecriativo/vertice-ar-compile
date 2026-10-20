# Talking faces — how to get a model working

A face-tracked model that mouths what you mouth. Everything below runs in the browser: no account,
no upload, no third-party service in the loop. The only external dependencies are the A-Frame and
MindAR files on public CDNs, and those can be vendored into this repo if that ever matters.

---

## Fastest path (30 seconds)

1. Open the studio → **Face tracking**.
2. Press **Use test head**. That loads a model bundled in this repo with all 51 drivable ARKit
   shapes, and sets type, scale, anchor and the morph checkbox for you.
3. Press **Start preview**, allow the camera, look at it.

The corner of the preview shows `morphs 51/51 matched`. If that reads 51/51 and the head still does
nothing, the problem is the setup, not the model — which is exactly why the test head is bundled.

---

## What a model needs

Four separate requirements. A model can satisfy three and still do nothing.

| # | Requirement | How to check |
|---|---|---|
| 1 | **Morph targets** (blend shapes / shape keys) | studio reports the count when you pick the file |
| 2 | **Named with the ARKit set** | studio reports `N/51 ARKit matched` |
| 3 | **A container A-Frame can open** — Draco is fine; KTX2 and meshopt need decoder paths, which the generated pages now set | studio says so explicitly |
| 4 | **Light enough for a phone** | studio reports triangles and texture MB |

**A skeleton rig is not a blendshape rig.** Mixamo characters and most "rigged" downloads animate a
*body* via joints and have zero facial morph targets. Image-to-3D output (Meshy, Tripo) is worse
still: one dense static mesh, no skin, no animation, no morphs. Neither will ever talk.

Pick a `.glb` in the face panel and the studio answers all four questions from the file alone — no
camera, no face, nothing uploaded.

---

## Where to get one

**Verified working, bundled here**

- `assets/redpanda-head.glb` — 51/51 ARKit, 11,944 triangles, ~1 MB. MIT licensed, see
  `assets/CREDITS.md`. Head only, which is what you want for a mask.

**Verified working, fetch yourself**

- A Ready Player Me avatar: `https://models.readyplayer.me/<avatarId>.glb?morphTargets=ARKit`.
  Accepted values are `Default`, `ARKit`, `Oculus Visemes`, or individual names. Tested a sample at
  51/51 ARKit, 19k triangles, 2.5 MB, plain glTF — loads as-is.
  ⚠ Do **not** add `?lod=2`; it keeps 25% of the triangles and the morph targets come back empty.
  ⚠ RPM avatars are **full-body**, with the origin at the feet. On a face anchor you see the shoes.
  Use a head-only model for a mask, or offset the position heavily.
- [`mrchipset/aniface-demo`](https://github.com/mrchipset/aniface-demo) — `redpanda_head.glb` and
  `raccoon_head_small.glb`, both 51/51. Meshopt-packed upstream, so convert first (below).

**Leads, not checked**

- Sketchfab, searching for "52 ARKit blendshapes"
- A free *MetaHuman Head – 52 blendshapes, ARKit ready* on Gumroad
- [`face-to-blendshape-3d`](https://github.com/arturwyroslak/face-to-blendshape-3d) — photo →
  ARKit-rigged GLB. Its bundled `head.glb` measured **0/51**, so generate rather than use that file.

**Paid, for reference:** Polywink will add blendshapes to any head you supply — €299 for the 52
ARKit set, €499 for their general service — but delivers **FBX, not GLB**, so a conversion step is
still needed.

---

## Making a model work

### It says "A-Frame cannot decode this file"

**Correction to an earlier version of this note: Draco is fine.** A-Frame's `gltf-model` system
defaults `dracoDecoderPath` to a Google-hosted decoder, so Draco-compressed meshes load with no
setup. Only two containers are genuinely off by default, because their paths default to empty
strings:

| extension | A-Frame setting |
|---|---|
| `KHR_texture_basisu` (KTX2) | `basisTranscoderPath` |
| `EXT_meshopt_compression` | `meshoptDecoderPath` |

**The pages this studio generates now set all three**, so those models load too. If you are writing
a page by hand, put this on the `<a-scene>`:

```html
gltf-model="dracoDecoderPath: https://www.gstatic.com/draco/versioned/decoders/1.5.5/;
            basisTranscoderPath: https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/libs/basis/;
            meshoptDecoderPath: https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/libs/meshopt_decoder.js"
```

Or, to avoid the dependency entirely, re-save as plain glTF:

```sh
npm install @gltf-transform/cli
npx gltf-transform cp packed.glb plain.glb
```

That decodes the container and leaves geometry, morph targets and textures untouched. It is how
`assets/redpanda-head.glb` was produced.

### It says "none match the ARKit names"

The same shape is spelled differently depending on who exported it. The studio already matches all
of these automatically:

| source | spelling |
|---|---|
| MediaPipe / Apple | `mouthSmileLeft` |
| most DCC exports | `mouthSmile_L` or `mouthSmile.L` |
| Maya | `blendShape1.mouthSmile_L` |

If it still reports 0, the names are genuinely something else (`Key1`, `Shape.007`) and must be
renamed to the ARKit set — in Blender, rename the shape keys and re-export.

### It is too heavy

Over ~300k triangles or ~8 MB of textures will not survive a phone:

```sh
npx gltf-transform optimize big.glb small.glb --texture-size 1024 --simplify-error 0.001
```

### Nothing moves, but the count says it matched

- Is **Talk with the face** ticked? It only appears for `.glb`.
- Does the model have a **baked facial animation**? An animation clip writes the same influences
  every frame and wins. The studio drops `animation-mixer` automatically when morph driving is on,
  so this only bites in hand-written pages.

---

## Scale and position

**mind-ar's face space is roughly centimetres, not metres.** The anchor sits about 100 units from
the camera and carries its own scale derived from the detected face, so the numbers are nothing like
A-Frame's usual metres. Measured with the bundled test head (1.7 units tall natively):

| scale | share of frame height |
|---|---|
| `1` | ~21% — small, floats on the face |
| `3` | ~62% — covers the head; **this is the default the test-head button sets** |
| `8` | ~160% — far off screen |

So: **start at 3 for a head-sized model and adjust.** The studio's default of `0.1` suits the small
primitives (box, plane, text), not a head.

Useful anchor indices: **168** between the eyes (best for a mask), **10** forehead, **1** nose tip.

### Chin showing below the mask

Anchor 168 is **between the eyes**, so a head centred on it rides high and the real jaw stays
visible underneath. Nudge **Pos Y** negative — `-0.3` is usually enough, and is what the test-head
button sets. Measured on the bundled head: `-0.3` drops the mask ~37 px and closes the gap, while
the same coverage via **Scale** alone needs about `3.6` and looks oversized.

Position is in anchor units and therefore sensitive: `-4` moves the mask roughly 480 px, straight
off the bottom. Adjust in tenths.

---

## You do not need all 52

The component drives whatever subset exists and reports what is missing, so a partial rig works
fine. A convincing mouth needs about ten shapes:

```
jawOpen  mouthClose  mouthFunnel  mouthPucker  mouthSmileLeft  mouthSmileRight
mouthStretchLeft  mouthStretchRight  mouthShrugUpper  mouthRollLower
```

Ten hand-sculpted shape keys in Blender, on a character you already have, is free and about a day's
work. Eyes and brows can come later — they start working the moment the names exist, with no code
change.

---

## Does this need a microphone?

**No.** A virtual mask does not block the camera: MediaPipe still sees the real mouth in the video,
so the mouth movement comes from face tracking. Audio is a separate axis, needed only for a
different voice (pitch shift or conversion), lip-syncing to speech the wearer is not performing
(TTS or a recording → visemes), or amplitude-reactive effects.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Preview tab is blank or white | Opened the preview from a cached page. The corner stamp shows the build; reload the studio. |
| Camera opens, everything black | Covered by a background. The container must have **no** background over the video, which mind-ar inserts at `z-index:-2`. |
| Camera fills but content is displaced upward on a phone | `look-controls` left enabled on the camera. Device orientation then rotates it; the generated pages disable it. |
| Scene empty, no error | A model A-Frame could not decode. The preview now reports `model-error` with the reason. |
| Chin visible below the mask | Anchor 168 is between the eyes. Nudge **Pos Y** to `-0.3`. |
| Tracks, but as a rigid lump | No morph targets, or none matched. Check the line under the file picker. |
| Nothing at all on iOS | The preview must be a top-level tab — iOS Safari blocks `getUserMedia` inside `srcdoc` iframes. |

---

## Why this does not depend on anyone else

The compiler, the studio, the morph component and a known-good test model all live in this repo and
are served from our own domain. No account, no API key, no quota, and no vendor whose shutdown
removes the tool. The only outside pieces are A-Frame and MindAR on public CDNs; both are MIT and
can be vendored here if that ever becomes a concern.
