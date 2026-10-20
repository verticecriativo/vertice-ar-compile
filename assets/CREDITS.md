# Bundled assets

## `redpanda-head.glb`

A known-good test head: **51/51 ARKit morph targets**, 11,944 triangles, ~1 MB. It exists so the
studio always has a model that is certain to work — if the face preview does nothing with this
file, the problem is the setup, not the model.

- **Source:** [`mrchipset/aniface-demo`](https://github.com/mrchipset/aniface-demo),
  `work/assets/redpanda_head.glb`
- **Licence:** MIT — Copyright (c) 2026 Zouyu (full text below)
- **Base mesh:** derived from [ICT-FaceKit](https://github.com/ICT-VGL/ICT-FaceKit) (MIT)
- **Modified here:** the original is `EXT_meshopt_compression`-packed, which plain A-Frame cannot
  decode. Re-saved as plain glTF with `gltf-transform cp in.glb out.glb` — geometry, morph targets
  and textures are unchanged; only the container encoding differs.

Redistributed under the MIT licence with the notice below, as that licence permits.

```
MIT License

Copyright (c) 2026 Zouyu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Not bundled, deliberately: Ready Player Me avatars carry their own terms, so they are linked in the
FAQ rather than copied here.
