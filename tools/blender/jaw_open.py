"""Generate a jawOpen shape key on a head mesh by rotating a painted jaw region about a hinge.

    blender --background --python jaw_open.py -- in.glb out.glb [--group jaw] [--angle 37.5]

WHY THIS SHAPE: measured against an authored ARKit head, jawOpen is ~97.5% explained by a rigid
rotation of the lower face about a left-right axis. No template and no non-rigid fit are needed.

WHY A PAINTED GROUP: the transform is the easy half. Choosing WHICH vertices move is the whole
problem, and bounding-box heuristics do not solve it — a horizontal plane at "mouth height" slices
through eyes, cheeks and muzzle, and because both lips sit on the same side of it the mouth never
actually opens. Measured on the bundled test head:

    bbox heuristic, soft falloff     cosine 0.83   mouth stays shut
    bbox heuristic, sharp cutoff     cosine 0.85   face mangled, mouth still shut
    painted region + fitted hinge    cosine 0.97   indistinguishable from the authored shape

So: paint a vertex group once (weight 1 on the chin and lower lip, feathering to 0 at the jawline
and the mouth corners), and everything after that is deterministic.

Paint it in Blender: select the head, Object Data Properties → Vertex Groups → New, name it "jaw",
then Weight Paint mode. A couple of minutes per character.

NOTE — the painted region cannot travel in a GLB, two ways over:
  * a vertex group is not exported at all (glTF carries only skinning weights), and
  * per-vertex weights keyed by index are useless anyway, because the exporter re-splits vertices
    at UV and normal seams — this very model goes 5386 -> 5406 verts on a round-trip.
So the character stays a .blend between painting and generating. That is the normal art workflow
and it is the only reliable one:

    1. open the GLB in Blender once, paint a "jaw" vertex group, save character.blend
    2. blender --background --python jaw_open.py -- character.blend out.glb

Input may be .blend or .glb; a .glb only works if it somehow already carries the group.
"""
import bpy, sys, math, json
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 2:
    print("usage: ... -- in.glb out.glb [--group NAME] [--angle DEG] [--name KEY]"); sys.exit(1)
src, dst = argv[0], argv[1]
def opt(flag, default):
    return argv[argv.index(flag) + 1] if flag in argv else default
GROUP = opt("--group", "jaw")
WEIGHTS = opt("--weights", None)
DUMP = opt("--dump-weights", None)
ANGLE = math.radians(float(opt("--angle", "37.5")))
KEY   = opt("--name", "jawOpen")

if src.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes: print("ERROR no mesh"); sys.exit(1)
head = max(meshes, key=lambda o: len(o.data.vertices))
me = head.data
n = len(me.vertices)
print(f"MESH {head.name} {n} verts")

w = np.zeros(n)
if WEIGHTS:
    arr = json.load(open(WEIGHTS))
    if len(arr) != n:
        print(f"ERROR weights file has {len(arr)} entries, mesh has {n} verts"); sys.exit(2)
    w = np.asarray(arr, dtype=float)
else:
    vg = head.vertex_groups.get(GROUP)
    if vg is None:
        print(f"ERROR no vertex group '{GROUP}' and no --weights. Paint one first — see the "
              f"docstring. Groups present: {[g.name for g in head.vertex_groups] or 'none'}")
        sys.exit(2)
    for i, v in enumerate(me.vertices):
        for g in v.groups:
            if g.group == vg.index: w[i] = g.weight

if DUMP:
    json.dump([round(float(x), 5) for x in w], open(DUMP, "w"))
    print("DUMPED", DUMP)
print(f"REGION {int((w > 0.01).sum())}/{n} verts weighted, mean {w[w>0.01].mean():.3f}")

V = np.array([list(v.co) for v in me.vertices])
lo, hi = V.min(axis=0), V.max(axis=0)
# glTF is Y-up/-Z-forward; Blender's importer gives Z up with the face looking down -Y.
UP, FWD, SIDE = 2, 1, 0

# Hinge: the jaw pivots at the TOP-BACK of the painted region, so take a high percentile on both
# the up and the backward axis. A plain percentile over all weighted verts pulls the hinge into the
# muzzle, because that is where most of them are — so weight the percentile by (1 - w): the verts
# at the edge of the region, which barely move, are the ones nearest the hinge.
sel = w > 0.05
edge = V[sel][(1.0 - w[sel]) > 0.5] if ((1.0 - w[sel]) > 0.5).sum() > 20 else V[sel]
pz = float(np.percentile(edge[:, UP], 90))
py = float(np.percentile(edge[:, FWD], 90))
if "--hinge-y" in argv: py = float(opt("--hinge-y", py))
if "--hinge-z" in argv: pz = float(opt("--hinge-z", pz))
print(f"HINGE y={py:.4f} z={pz:.4f} angle={math.degrees(ANGLE):.1f}deg")

th = w * ANGLE
c, s = np.cos(th), np.sin(th)
dy, dz = V[:, FWD] - py, V[:, UP] - pz
G = V.copy()
G[:, FWD] = dy * c - dz * s + py
G[:, UP]  = dy * s + dz * c + pz

bpy.context.view_layer.objects.active = head
if not me.shape_keys: head.shape_key_add(name="Basis", from_mix=False)
key = head.shape_key_add(name=KEY, from_mix=False)
for i in range(n): key.data[i].co = G[i]
key.value = 0.0

d = np.linalg.norm(G - V, axis=1)
print(f"RESULT {KEY}: moved {int((d > 1e-5).sum())}, max |d| {d.max():.4f} "
      f"({100 * d.max() / (hi[UP] - lo[UP]):.1f}% of height)")

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_morph=True)
print("WROTE", dst)
