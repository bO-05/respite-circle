# Vendored typefaces

Four variable faces, unmodified, copied from the Hall Light design bundle:

| File | Face | Axis range |
| --- | --- | --- |
| `Fraunces.ttf` | Fraunces roman | `wght` 100-900, `opsz`, `SOFT`, `WONK` |
| `Fraunces-Italic.ttf` | Fraunces italic | `wght` 100-900, `opsz`, `SOFT`, `WONK` |
| `SourceSans3.ttf` | Source Sans 3 roman | `wght` 200-900 |
| `SourceSans3-Italic.ttf` | Source Sans 3 italic | `wght` 200-900 |

`layout.tsx` loads these four with `next/font/local`, declaring the full weight
ranges. `OFL.txt` is the SIL Open Font License 1.1 that travels with them.

## Static instances for the share image

The renderer behind `ImageResponse` (the copy of `@vercel/og` bundled with
Next.js 16.4.6) cannot read a variable font: its OpenType parser never loads
the `name` table, and the `fvar` parser then throws. The share card therefore
uses three static instances cut from the same files with fontTools 4.61.1:

```sh
py -m fontTools.varLib.instancer src/app/fonts/SourceSans3.ttf wght=400 \
  --no-recalc-timestamp -o src/app/fonts/SourceSans3-Regular.ttf
py -m fontTools.varLib.instancer src/app/fonts/Fraunces.ttf wght=600 \
  --static --no-recalc-timestamp -o src/app/fonts/Fraunces-SemiBold.ttf
py -m fontTools.varLib.instancer src/app/fonts/Fraunces-Italic.ttf wght=500 \
  --static --no-recalc-timestamp -o src/app/fonts/Fraunces-Italic-Medium.ttf
```

Only `src/app/opengraph-image.tsx` reads the three instances. The app itself is
set in the four variable originals, which stay byte-for-byte as they arrived.
The instances inherit the same SIL OFL 1.1 terms and are covered by `OFL.txt`.
