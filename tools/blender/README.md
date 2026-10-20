# Procedural ARKit shapes — prototype findings

Question: can the ARKit mouth shapes be generated procedurally, so a character does not need a
€499 rigging service or a day of hand-sculpting?

Tested on `assets/redpanda-head.glb`, which already carries an authored `jawOpen` — so every
result has ground truth to measure against. Blender 5.2.2, headless.

## What was proven

**1. jawOpen really is a rigid rotation.** Least-squares fit of a single rotation about the
left-right axis against the authored shape:

```
hinge y=-0.0817  z=-0.2747   angle 37.56°
residual: mean 0.0114, max 0.0449   against a max displacement of 0.5285
→ the rotation model explains 97.5% of the motion
```

No template, no non-rigid fit, no deformation transfer needed. That is the encouraging half.

**2. Bounding-box heuristics cannot find the jaw.** This is where the idea fails:

| approach | cosine vs authored | what it looks like |
|---|---|---|
| bbox plane, soft falloff | 0.83 | **mouth stays shut** — both lips are on the same side of a horizontal plane, so they move together |
| bbox plane, sharp cutoff | 0.85 | **face mangled** — the plane slices through eyes, cheeks and muzzle |
| painted region + fitted hinge | **0.97** | **indistinguishable from the authored shape** |

⚠ The cosine metric was actively misleading: 0.83 sounded fine while the rendered mouth was
completely shut. It measures the chin mass moving, not the thing that matters — the lips parting.
**Renders decided this, not numbers.**

**3. So the region is the whole problem, and the transform is free.** Paint a `jaw` vertex group
once — a couple of minutes per character — and everything after it is deterministic.

## Using it

```sh
# 1. open the GLB in Blender, paint a "jaw" vertex group (1 on chin and lower lip,
#    feathering to 0 at the jawline and mouth corners), save character.blend
# 2. generate:
blender --background --python jaw_open.py -- character.blend out.glb --group jaw
```

Optional: `--angle 37.5`, `--name jawOpen`, and `--hinge-y` / `--hinge-z` to override the
auto-derived pivot.

⚠ **The painted region cannot travel in a GLB**, two ways over: a vertex group is not exported at
all (glTF carries only skinning weights), and index-keyed weights are useless anyway because the
exporter re-splits vertices at UV and normal seams — this model goes 5386 → 5406 on a round-trip.
The character stays a `.blend` between painting and generating.

The auto hinge is approximate: it reaches ~61% of the authored displacement, against 93% with the
fitted pivot. One number, tunable by eye, or fittable where an authored example exists.

## Where this goes

The same painted region drives the rest of the mouth group with different deformations —
`mouthPucker` and `mouthFunnel` as radial lip displacement, the smiles as corner displacement.
Ten shapes is already enough to talk, and `vertice-face-morphs` drives whatever subset exists.

Finding the region automatically is a vision/judgement problem, not a geometry one — which is
precisely the part worth handing to an agent, while the transform stays a deterministic script.
