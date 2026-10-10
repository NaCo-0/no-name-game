/**
 * ForestGenerator - Rise of Kingdoms Style
 * ----------------------------------------
 * Pure geometry for scattering trees into abundant, natural groves,
 * modeled directly on Rise of Kingdoms:
 *
 *   1. Plentiful Discrete Groves: Many distinct copses and groves (4 to 14 trees each)
 *      distributed across territories, providing rich woodland atmosphere while
 *      preserving open clearings for cities and armies.
 *   2. Rich Foothill Clustering: Plentiful groves hug mountain ridges and cliff bases,
 *      framing stone walls naturally.
 *   3. 2:1 Isometric Perspective: Canopy cluster offsets are projected in screen-aligned
 *      isometric coordinates for round, pleasing canopy overlap.
 *   4. Obstacle & Passage Clearance: Respects buildings, mountains, and gates.
 *   5. Deterministic: identical seed + params produces identical tree distribution.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} o
 * @param {number} o.gridWidth
 * @param {number} o.gridHeight
 * @param {number} [o.seed=1]
 * @param {number} [o.coverage=0.80]            frequency of groves in open territory (0..1)
 * @param {number} [o.forestScaleTiles=11]      grid cell spacing for grove centers (tiles)
 * @param {number} [o.spacingTiles=0.85]        distance between trees within a grove (tiles)
 * @param {number} [o.minTreesPerGrove=4]       minimum trees in a standard grove
 * @param {number} [o.maxTreesPerGrove=12]      maximum trees in a standard grove
 * @param {number} [o.clusterChance=0.40]       share of inner trees in large groves using cluster sprite
 * @param {number} [o.bushChance=0.30]           share of grove-edge spots that become low bushes (replaces a tree, no extra sprites)
 * @param {(tx:number,ty:number)=>number} [o.bushBiasAt] per-location multiplier for bushChance (e.g. dry regions = more bushes)
 * @param {number} [o.loneTreeChance=0.20]      share of grove centers that are 1-2 tree mini-copses
 * @param {number} [o.foothillCoverage=0.70]    frequency of groves hugging mountain bases
 * @param {number} [o.scaleMin=0.85]
 * @param {number} [o.scaleMax=1.2]
 * @param {number} [o.edgeMarginTiles=4]        keep this far from the map border
 * @param {number} [o.maxTrees=6000]            hard cap
 * @param {Array<{x:number,y:number,r?:number}>} [o.obstacles]   mountains & placed buildings
 * @param {number} [o.obstacleClearance=2.2]    min distance from obstacles
 * @param {Array<{x:number,y:number,r:number}>} [o.corridors]    corridors/entrances kept free
 * @param {(tx:number,ty:number)=>number} [o.densityAt]          0..1 multiplier per location
 * @returns {{trees: Array<{tileX:number,tileY:number,kind:'single'|'cluster'|'bush',pick:number,scale:number,flipX:boolean}>, stats:object}}
 */
export function generateForestPlacements({
  gridWidth,
  gridHeight,
  seed = 1,
  coverage = 0.80,
  forestScaleTiles = 11,
  spacingTiles = 0.85,
  minTreesPerGrove = 4,
  maxTreesPerGrove = 12,
  clusterChance = 0.40,
  loneTreeChance = 0.20,
  bushChance = 0.30,
  bushBiasAt = () => 1,
  foothillCoverage = 0.70,
  scaleMin = 0.85,
  scaleMax = 1.2,
  edgeMarginTiles = 4,
  maxTrees = 6000,
  obstacles = [],
  obstacleClearance = 2.2,
  corridors = [],
  densityAt = () => 1,
}) {
  if (spacingTiles <= 0 || gridWidth <= 0 || gridHeight <= 0) {
    return { trees: [], stats: { candidates: 0, thinned: false, groveCount: 0 } };
  }

  const rand = mulberry32(seed >>> 0);
  // Bush decisions use their own stream so adding bushes never moves a tree.
  const bushRand = mulberry32((seed ^ 0xb05b05) >>> 0);

  // Spatial hash of obstacles for fast proximity checks.
  const HASH = 4;
  const hashed = new Map();
  let maxObstacleRadius = obstacleClearance;

  for (const o of obstacles) {
    const r = o.r ?? obstacleClearance;
    if (r > maxObstacleRadius) maxObstacleRadius = r;
    const key = `${Math.floor(o.x / HASH)},${Math.floor(o.y / HASH)}`;
    let arr = hashed.get(key);
    if (!arr) hashed.set(key, (arr = []));
    arr.push({ x: o.x, y: o.y, origR: r, r2: r * r });
  }

  const reach = Math.ceil(maxObstacleRadius / HASH) + 1;

  const nearObstacle = (x, y, extraMargin = 0) => {
    if (!hashed.size) return false;
    const cx = Math.floor(x / HASH);
    const cy = Math.floor(y / HASH);
    for (let gy = cy - reach; gy <= cy + reach; gy++) {
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        const arr = hashed.get(`${gx},${gy}`);
        if (!arr) continue;
        for (const o of arr) {
          const dx = o.x - x;
          const dy = o.y - y;
          const req = o.origR + extraMargin;
          if (dx * dx + dy * dy < req * req) return true;
        }
      }
    }
    return false;
  };

  const inCorridor = (x, y, extraMargin = 0) => {
    for (const c of corridors) {
      const dx = c.x - x;
      const dy = c.y - y;
      const req = c.r + extraMargin;
      if (dx * dx + dy * dy < req * req) return true;
    }
    return false;
  };

  const groveCenters = [];

  // ---------------------------------------------------------------------------
  // 1. Foothill Groves: Clustered abundantly along mountain ridges and cliffs
  // ---------------------------------------------------------------------------
  if (foothillCoverage > 0 && obstacles.length > 0) {
    // Sample every 2nd or 3rd mountain obstacle
    const stride = Math.max(1, Math.round(2.2 / Math.max(0.1, foothillCoverage)));
    for (let i = 0; i < obstacles.length; i += stride) {
      const o = obstacles[i];
      if (rand() > foothillCoverage) continue;

      const angle = rand() * Math.PI * 2;
      const r = o.r ?? obstacleClearance;
      const dist = r + 0.9 + rand() * 1.5;
      const gx = o.x + Math.cos(angle) * dist;
      const gy = o.y + Math.sin(angle) * dist;

      if (gx < edgeMarginTiles || gy < edgeMarginTiles || gx > gridWidth - edgeMarginTiles || gy > gridHeight - edgeMarginTiles) {
        continue;
      }

      const density = Math.max(0, Math.min(1, densityAt(gx, gy)));
      if (rand() > density) continue;

      if (nearObstacle(gx, gy, 0.3) || inCorridor(gx, gy, 1.2)) continue;

      // Foothill groves have 3 to 8 trees along the mountain skirts
      const count = Math.floor(3 + rand() * 4); // 3 to 6
      groveCenters.push({ x: gx, y: gy, count, isFoothill: true });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Plains Groves: Dispersed in open territory
  // ---------------------------------------------------------------------------
  const groveSpacing = Math.max(8, forestScaleTiles);
  const cols = Math.ceil(gridWidth / groveSpacing);
  const rows = Math.ceil(gridHeight / groveSpacing);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * groveSpacing;
      const cy = (r + 0.5) * groveSpacing;

      // Jitter center within cell
      const gx = cx + (rand() - 0.5) * groveSpacing * 0.8;
      const gy = cy + (rand() - 0.5) * groveSpacing * 0.8;

      if (gx < edgeMarginTiles || gy < edgeMarginTiles || gx > gridWidth - edgeMarginTiles || gy > gridHeight - edgeMarginTiles) {
        continue;
      }

      const density = Math.max(0, Math.min(1, densityAt(gx, gy)));
      if (density <= 0) continue;

      // Coverage check scaled by territory density
      if (rand() >= coverage * density) continue;

      if (nearObstacle(gx, gy, obstacleClearance + 0.4) || inCorridor(gx, gy, 1.8)) continue;

      // Grove size distribution (sprites per grove). Kept small on purpose:
      // every sprite is a game object, and the 4-tree cluster sprite makes
      // a small grove already look like a thicket.
      //   loneTreeChance  mini-copse (1-2)
      //   55%             standard grove (3-5)
      //   rest            lush grove (5-8)
      let count;
      const roll = rand();
      if (roll < loneTreeChance) {
        count = rand() < 0.5 ? 1 : 2;
      } else if (roll < loneTreeChance + 0.55) {
        count = Math.floor(3 + rand() * 3); // 3 to 5
      } else {
        count = Math.floor(5 + rand() * 4); // 5 to 8
      }

      groveCenters.push({ x: gx, y: gy, count, isFoothill: false });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Populate Trees within each Grove
  // ---------------------------------------------------------------------------
  const trees = [];
  const minTreeSep2 = Math.pow(spacingTiles * 0.7, 2);

  for (let gi = 0; gi < groveCenters.length; gi++) {
    const grove = groveCenters[gi];
    if (grove.count <= 0) continue;

    const groveTrees = [];
    const groveRadius = spacingTiles * (0.5 + Math.sqrt(grove.count) * 0.55);

    for (let i = 0; i < grove.count; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        let tx, ty;
        let far = false; // far from the grove center (edge of the grove)

        if (i === 0 && grove.count === 1) {
          tx = grove.x;
          ty = grove.y;
        } else if (i === 0) {
          const jx = (rand() - 0.5) * spacingTiles * 0.5;
          const jy = (rand() - 0.5) * spacingTiles * 0.5;
          tx = grove.x + jx;
          ty = grove.y + jy;
        } else {
          // Circular distribution in 2:1 isometric screen space
          const dist = Math.sqrt(rand()) * groveRadius;
          far = dist > groveRadius * 0.5;
          const theta = rand() * Math.PI * 2;
          const isoX = dist * Math.cos(theta);
          const isoY = dist * Math.sin(theta) * 0.5;

          const dx = (isoX / 0.7071 + isoY / 0.3536) * 0.5;
          const dy = (isoY / 0.3536 - isoX / 0.7071) * 0.5;

          tx = grove.x + dx;
          ty = grove.y + dy;
        }

        if (tx < edgeMarginTiles || ty < edgeMarginTiles || tx > gridWidth - edgeMarginTiles || ty > gridHeight - edgeMarginTiles) {
          continue;
        }

        if (nearObstacle(tx, ty, 0.1) || inCorridor(tx, ty, 0.4)) continue;

        let tooClose = false;
        for (const other of groveTrees) {
          const odx = other.tileX - tx;
          const ody = other.tileY - ty;
          if (odx * odx + ody * ody < minTreeSep2) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        // Cluster roll keeps its original place in the random stream.
        const wantsCluster = grove.count >= 3 && i <= 2 && rand() < clusterChance;
        // Bushes: mini-copses (1-2) are often a lone bush; larger groves get
        // bushes around their edge. Drawn from the separate bushRand stream.
        const bushP = Math.min(0.9, bushChance * Math.max(0, bushBiasAt(grove.x, grove.y)));
        let isBush = false;
        if (i === 0) {
          if (grove.count <= 2 && bushRand() < bushP * 1.5) isBush = true;
        } else if (far && bushRand() < bushP) {
          isBush = true;
        }
        const isClusterSprite = wantsCluster && !isBush;
        const treeObj = {
          tileX: tx,
          tileY: ty,
          kind: isBush ? 'bush' : isClusterSprite ? 'cluster' : 'single',
          pick: rand(),
          scale: scaleMin + (scaleMax - scaleMin) * rand(),
          flipX: rand() < 0.5,
          grove: gi,
          groveX: grove.x,
          groveY: grove.y,
        };

        groveTrees.push(treeObj);
        trees.push(treeObj);
        break;
      }
    }
  }

  // Thin if over the cap: drop WHOLE groves at random (never single trees,
  // which would punch holes in the groves that remain).
  let thinned = false;
  let result = trees;
  if (trees.length > maxTrees) {
    thinned = true;
    const byGrove = new Map();
    for (const t of trees) {
      let arr = byGrove.get(t.grove);
      if (!arr) byGrove.set(t.grove, (arr = []));
      arr.push(t);
    }
    const ids = [...byGrove.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    result = [];
    for (const id of ids) {
      const g = byGrove.get(id);
      if (result.length + g.length > maxTrees) continue;
      for (const t of g) result.push(t);
    }
  }

  return {
    trees: result,
    stats: {
      candidates: trees.length,
      beforeCap: trees.length,
      thinned,
      groveCount: groveCenters.length,
    },
  };
}
