/**
 * Bringing the floor up: the renderer modules, the Scene, and what a click on
 * a piece of furniture does.
 *
 * Split out of `app.js` by WP-22. The Scene reports a hit as `{kind, id}` and
 * this is the one place that decides what each kind means — a room plate
 * filters, the in-room "+" opens the new-agent dialog, the shelf opens the
 * project's folder, the screen runs its dashboard. Those actions belong to the
 * composition root, so they arrive as a parameter rather than as an import:
 * the dependency runs one way and the closures below are untouched by the
 * move.
 *
 * Both renderer imports stay dynamic and defensive, for the reason `app.js`'s
 * own header gives: a missing or broken `render/` module must degrade the
 * shell, never break it.
 */

import {
  applyThemeSetting,
  el,
  latestSnapshot,
  scene,
  sceneModule,
  setPalette,
  setScene,
  setSceneModule,
  setThemes,
} from './app-state.js';
import { showRendererError } from './app-header.js';

/**
 * @param {{normaliseHit:(hit:unknown) => any, selectAgent:(id:string|null) => void,
 *   filterToProject:(id:string|null) => void, openNewAgentDialog:(id:string) => void,
 *   showWhiteboard:(id:string) => void, revealProjectFolder:(id:string) => Promise<void>,
 *   runProjectDashboard:(id:string) => Promise<void>,
 *   showTooltip:(id:string|null) => void}} actions
 */
export async function loadRenderModules({
  normaliseHit,
  selectAgent,
  filterToProject,
  openNewAgentDialog,
  showWhiteboard,
  revealProjectFolder,
  runProjectDashboard,
  showTooltip,
}) {
  try {
    setPalette(await import('./render/palette.js'));
  } catch (err) {
    console.debug('[deckhq] render/palette.js not available yet, using fallback colours', err);
  }
  try {
    // WP-30. Loaded before the Scene, because the first bake has to happen in
    // the theme the user chose: applying a theme after the backdrop is baked
    // would show the default floor for one frame on every reload.
    setThemes(await import('./render/themes.js'));
    applyThemeSetting((latestSnapshot?.settings || {}).theme);
  } catch (err) {
    console.debug('[deckhq] render/themes.js not available yet, using the default theme', err);
  }
  try {
    setSceneModule(await import('./render/scene.js'));
    const { Scene } = sceneModule;
    setScene(
      new Scene(el.canvas, {
        // Scene reports hits as { kind, id }. A project hit is a room plate:
        // filter the panel to that project (VISUAL-SPEC §8). 'new-agent' is
        // the in-room "+" (CONTRACTS-WP15.md §5); 'whiteboard' is the wall
        // prop (§4) and responds to both select and hover.
        onSelect: (hit) => {
          const sel = normaliseHit(hit);
          if (!sel) return selectAgent(null);
          if (sel.kind === 'project') return filterToProject(sel.id);
          if (sel.kind === 'new-agent') return openNewAgentDialog(sel.id);
          if (sel.kind === 'whiteboard') return showWhiteboard(sel.id);
          if (sel.kind === 'shelf') return revealProjectFolder(sel.id);
          if (sel.kind === 'screen') return runProjectDashboard(sel.id);
          selectAgent(sel.id);
        },
        onHover: (hit) => {
          const sel = normaliseHit(hit);
          // The board is a modal now, not a hover card: it opens on a CLICK
          // (see onSelect) and stays until it is dismissed. Opening it on hover
          // meant a modal appearing under the cursor as it crossed the floor.
          showTooltip(sel && sel.kind === 'agent' ? sel.id : null);
        },
      }),
    );
    if (latestSnapshot) scene.setState(latestSnapshot);
    scene.start();
  } catch (err) {
    // The floor is the product. A failure here is loud, not a debug line.
    console.error('[deckhq] the floor renderer failed to load', err);
    showRendererError(err);
  }
}
