# Isometric Terrain Demo — Quick Start

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Controls
- Click + drag to pan the camera
- Scroll wheel to zoom
- Right-side panel: upload object images, tune their size/anchor/tint/
  shadow live, place/drag/select/delete them on the map, and export the
  final placement as JSON

## Object editor
Upload any PNG (transparent background recommended) in the "Objects"
section of the side panel. Each uploaded image becomes a reusable "type"
with live sliders:
- **Height (px)** — final on-screen size (source image is scaled to this)
- **Anchor X/Y** — which point of the image sits on the ground (0.5, 1.0
  = bottom-center, typical for a tree/building sprite)
- **Tint** — subtle color multiply, for matching the terrain's lighting
- **Contact shadow** — width/height/opacity of a soft shadow ellipse
  placed under the object (multiply-blended, so it darkens the grass
  rather than sitting on top as a flat shape)

Click **"Place on map"** to arm a type, then click the map to place
copies (stays armed for rapid placement — click the button again to
stop). Click an existing object to select it (shows a Delete button in
the panel); click-drag it to move it. The **"Snap to tile center"**
checkbox controls whether placement/dragging snaps to the nearest tile's
center or stays exactly where you clicked.

**Export placement JSON** dumps every type's tuned parameters and every
placed instance's tile coordinates — nothing is saved automatically
(refreshing the page clears everything), so export before you reload if
you want to keep a layout.

## Mountain rings + civilization territories
Two mountain images are bundled (`assets/objects/mountain_a.png`,
`mountain_b.png`) and auto-registered as normal editor types on load — so
they show up in the "Objects" list with the exact same sliders as an
uploaded image, and can also be placed manually.

**"Mountain Rings"** generates two gapped rings around the map center
(radius 50 / 3 entrances / mountain A, and radius 150 / 5 entrances /
mountain B by default) — every parameter (radius, spacing, entrance
count/width, jitter, which type) is live-editable.

**"Outer Divisions"** generates 5 CONTINUOUS mountain walls (mountain A)
running from just past ring 1 out toward the map edge, fully enclosing 5
wedge-shaped territories. Each wall has exactly one small entrance gap
connecting it to its neighbor, so the 5 territories are genuinely
separate — the only way from one to another is through that entrance, not
some indirect path through the middle. See
`src/world/MountainRingGenerator.js` (`generateRadialDividers`).

Each of the 5 territories also gets its own terrain color palette — Egypt
(desert), Mongol steppe, Japan, Persia, and Rome — via
`src/world/TerritoryMap.js` (pure angle/radius geometry, matched to the
exact same section boundaries the mountain walls use) feeding into
`BiomeMap` and the existing `BiomeRegistry` palette system. The shared
neutral zone at the very center (inside ring 1) stays plain grass. See
`WorldConfig.territories` for the single shared config both systems read
from, and `BiomeRegistry.js` for each territory's color bands.

## What you're looking at
A 600x600 logical grid, streamed as small "render tiles" (16x16 logical
tiles each) that get procedurally painted the first time they enter the
camera view, then cached until they leave view + buffer. See
`ARCHITECTURE.md` for the full design rationale.

## Build for production
```bash
npm run build
npm run preview
```

## Where to make changes
- `src/config/WorldConfig.js` — every tunable number (grid size, chunk
  size, render tile size, tile pixel dimensions, seed)
- `src/world/BiomeRegistry.js` — add new biomes here (colors, patch types)
- `src/world/SeededNoiseField.js` — noise frequencies/layers
- `src/rendering/TerrainRenderTilePainter.js` — the actual paint passes
