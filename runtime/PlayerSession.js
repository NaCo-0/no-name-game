/**
 * PlayerSession
 * -------------
 * One call that runs the whole "player enters the game" flow:
 *
 *   1. shows the join screen (pick 1 of 6 civilizations + type a name),
 *   2. picks a random spot for the player's castle,
 *   3. scatters computer castles with random names around the map,
 *   4. draws everything (castle sprites + name plates) and centres the camera
 *      on the player's castle.
 *
 * Usage, in the scene that already created the map:
 *
 *   import { BakedMap } from './runtime/BakedMapLoader.js';
 *   import { startPlayerSession } from './runtime/PlayerSession.js';
 *
 *   async create() {
 *     this.map = await BakedMap.create(this, 'maps/world1/');
 *     this.session = await startPlayerSession(this, this.map);
 *     // this.session.player  -> { name, civId, tileX, tileY }
 *   }
 *   update() { this.map.update(); }
 */
import { CIVILIZATIONS, civById, randomName } from './civilizations.js';
import { SpawnPlanner, planCastles, plannerDataFromBakedMap } from './SpawnPlanner.js';
import { CastleLayer } from './CastleLayer.js';
import { showJoinScreen, sanitizeName, isValidName, forgetChoice } from './JoinScreen.js';
import { showLoading } from './ui/LoadingScreen.js';
import { createGameUI } from './ui/GameUI.js';
import { t } from './ui/i18n.js';
import { hex } from './ui/dom.js';

/**
 * @param {Phaser.Scene} scene
 * @param {import('./BakedMapLoader.js').BakedMap} map
 * @param {object} [opts]
 * @param {string} [opts.assetBase='assets/objects/castles/'] folder with the castle images
 * @param {number} [opts.npcPerCiv=3] computer castles per civilization territory
 * @param {'own'|'any'} [opts.spawnIn='own'] 'own' = player spawns in their civilization's territory;
 *   'any' = in a random territory
 * @param {{civId:string, name:string}} [opts.choice] skip the join screen (e.g. restore a login)
 * @param {() => number} [opts.rand=Math.random] random source (pass makeRng(seed) for reproducible layouts)
 * @param {boolean} [opts.centerCamera=true]
 * @param {number} [opts.initialZoom] camera zoom at the start (default: smaller on phones, 1 on desktop)
 * @param {boolean} [opts.ui=true] build the in-game interface (HUD, minimap, panels); false = castles only
 * @param {() => void} [opts.onChangeCiv] what "Change civilization" does (default: forget the choice and reload the page)
 * @returns {Promise<{player:object, npcs:object[], layer:CastleLayer, civ:object, ui:object|null}>}
 */
export async function startPlayerSession(scene, map, opts = {}) {
  const assetBase = opts.assetBase ?? 'assets/objects/castles/';
  const rand = opts.rand ?? Math.random;

  // 1. who is playing
  let choice = opts.choice ?? (await showJoinScreen({ assetBase }));
  const civ = civById(choice.civId);
  if (!civ) throw new Error(`Unknown civilization "${choice.civId}"`);
  let name = sanitizeName(choice.name);
  if (!isValidName(name)) name = randomName(civ.id, rand);

  // 2. where everything goes
  const planner = new SpawnPlanner(plannerDataFromBakedMap(map));
  const plan = planCastles({
    planner,
    playerCiv: civ,
    playerName: name,
    civs: CIVILIZATIONS,
    nameFor: randomName,
    rand,
    npcPerCiv: opts.npcPerCiv ?? 3,
    spawnIn: opts.spawnIn ?? 'own',
  });
  if (!plan.player) throw new Error('No free spot found for the player castle (is the map baked and loaded?)');

  // 3. draw (a short loading screen covers the castle images loading)
  const loading = showLoading({ title: t('loading.castle'), accent: hex(civ.color) });
  const layer = new CastleLayer(scene, map, { assetBase });
  await layer.loadTextures();
  for (const npc of plan.npcs) layer.addCastle(npc);
  layer.addCastle(plan.player);
  loading.setProgress(1);

  // 4. look at the player's castle
  if (opts.centerCamera !== false) {
    const cam = scene.cameras.main;
    cam.setZoom(opts.initialZoom ?? Math.min(1, Math.max(0.55, window.innerWidth / 1000)));
    const w = map.tileToWorld(plan.player.tileX, plan.player.tileY);
    scene.cameras.main.centerOn(w.x, w.y - 120);
  }

  // 5. the interface
  let ui = null;
  if (opts.ui !== false) {
    ui = createGameUI({
      scene,
      map,
      layer,
      player: plan.player,
      onChangeCiv:
        opts.onChangeCiv ??
        (() => {
          forgetChoice();
          location.reload();
        }),
    });
  }
  await loading.hide();

  return { player: plan.player, npcs: plan.npcs, layer, civ, ui };
}
