/**
 * The pictures and recordings for posts, each one a named recipe.
 *
 *   node scripts/capture-posts.mjs --list
 *   node scripts/capture-posts.mjs --out <dir> --only see.every-session[,need.one-rule]
 *                                  [--tmp <dir>]
 *
 * A recipe starts its own demo floor (`scripts/demo-floor.mjs`, the same fake
 * machine the goldens photograph), opens it in headless Chrome at a real device
 * pixel ratio of two or more, and writes its file into `--out`. Nothing is
 * drawn by this script: a still is a screenshot of the product, cropped and
 * halved; a recording is the product's own frames, one per step of the clock
 * (`lib/capture-kit.mjs`).
 *
 * `--tmp` is where the demo builds its fixture. Without it that is the system
 * temp directory, exactly as `npm run demo` does.
 *
 * The demo floor only, never a real one: these files are published.
 *
 * Dev script only: `scripts/` is not in the published package.
 */
import path from 'node:path';
import process from 'node:process';

import { DEMO_EPOCH } from './demo-args.mjs';
import { cropImage, layout, startDemo, withStage, writePng } from './lib/capture-kit.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const OUT = path.resolve(opt('--out', 'posts-out'));
const TMP = opt('--tmp', '');
/** Where the parts of a laid-out picture are kept: beside the output, never in it. */
const WORK = path.resolve(opt('--work', `${OUT}-work`));
const ONLY = String(opt('--only', ''))
  .split(',')
  .filter(Boolean);

const say = (line) => process.stdout.write(`${line}\n`);

/**
 * Run `fn` against one demo floor and stop the floor afterwards, whatever
 * happened. `pinned` is the goldens' instant unless the recipe is a recording.
 */
async function onFloor(opts, fn) {
  const demo = await startDemo({ pinned: DEMO_EPOCH, tmp: TMP, ...opts });
  try {
    return await fn(demo);
  } finally {
    await demo.stop();
  }
}

/** The studio ground and the line a capture in a layout is held by (`public/style.css`). */
const STUDIO = '#131419';
const LINE = '#333846';

/** A rectangle grown (negative) or shrunk by `by` CSS pixels on every side. */
const inset = (r, by) => ({ x: r.x + by, y: r.y + by, w: r.w - 2 * by, h: r.h - 2 * by });

/** Trim an image to even sides, so half of it is a whole number of pixels. */
const even = (img) =>
  cropImage(img, { x: 0, y: 0, w: img.width - (img.width % 2), h: img.height - (img.height % 2) });

/** A capture that shows the "Install hooks" chip is not a picture of the demo floor. */
function refuseBanner(g) {
  if (g.banner) throw new Error('the "Install hooks for exact state" chip is showing');
}

/** @type {Record<string, () => Promise<void>>} */
const RECIPES = {
  /**
   * C-011. The whole window: header, queue strip, floor. 1600 x 900 at a ratio
   * of two, halved.
   */
  'see.every-session': () =>
    onFloor({ population: 'demo' }, (demo) =>
      // A 1760 x 990 window, not 1600 x 900: below 14 px to the unit the floor
      // folds every wait badge into the office plate, and at 1600 x 900 this
      // floor fits at 13.2. The ratio is the one that makes 1760 into 3200.
      withStage({ width: 1760, height: 990, dpr: 3200 / 1760 }, async (stage) => {
        const g = await stage.open(demo.url);
        refuseBanner(g);
        if (g.unit < 14) throw new Error(`the floor fits at ${g.unit} px a unit: no wait badges`);
        const img = writePng(path.join(OUT, 'see.every-session.png'), await stage.still(), 1600);
        say(`see.every-session.png  ${img.width}x${img.height}`);
      }),
    ),

  /**
   * C-012. Your Office and nothing else. The room is three wide to two high at
   * its widest and a post is sixteen to nine, so it stands on the studio ground
   * as a capture in a layout: 12 px corners and a one-pixel line.
   */
  'need.one-rule': () =>
    onFloor({ population: 'demo' }, (demo) =>
      withStage({ width: 1600, height: 900, dpr: 2.3 }, async (stage) => {
        let g = await stage.open(demo.url);
        refuseBanner(g);
        // Twice the fit, about the stage's own corner, so the office stays put.
        g = await stage.zoomTo(2, { x: g.canvas.x + 1, y: g.canvas.y + 1 });
        const office = g.rooms.find((room) => room.kind === 'office');
        const shot = even(await stage.still(inset(office, -2)));
        const page = await layout({
          dir: WORK,
          name: 'need.one-rule',
          width: 1600,
          height: 900,
          parts: { office: shot },
          html: `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1600px;height:900px;
            background:${STUDIO};display:grid;place-items:center"><img src="{{office}}"
            style="width:{{office.w}}px;height:{{office.h}}px;border-radius:12px;
            box-shadow:0 0 0 1px ${LINE}">`,
        });
        const img = writePng(path.join(OUT, 'need.one-rule.png'), page, 1600);
        say(`need.one-rule.png  ${img.width}x${img.height}  office ${shot.width}x${shot.height} at 2x`);
      }),
    ),

  /**
   * C-013. The header's own counts, large, over the row of the office where a
   * raised hand sits beside a wait badge. Two captures: the header at seven
   * times, and the sofa row at the floor's full magnification.
   */
  'need.two-signals': () =>
    onFloor({ population: 'demo' }, async (demo) => {
      const counts = await withStage({ width: 1600, height: 400, dpr: 7 }, async (stage) => {
        refuseBanner(await stage.open(demo.url));
        const r = await stage.rect('#needs-you');
        const bar = await stage.rect('#topbar');
        const clip = { x: Math.floor(r.x) - 8, y: 4, w: Math.ceil(r.w) + 16, h: 76 };
        return { img: even(await stage.still(clip)), ground: bar.ground };
      });
      const row = await withStage({ width: 1600, height: 1000, dpr: 3.75 }, async (stage) => {
        let g = await stage.open(demo.url);
        refuseBanner(g);
        const office = g.rooms.find((room) => room.kind === 'office');
        g = await stage.zoomTo(2.5, { x: g.canvas.x + 1, y: office.y + office.h });
        const waiting = g.agents.filter((a) => a.placement === 'office');
        const feet = Math.max(...waiting.map((a) => a.y));
        const sofa = waiting.filter((a) => Math.abs(a.y - feet) < 1);
        const mid = (Math.min(...sofa.map((a) => a.x)) + Math.max(...sofa.map((a) => a.x))) / 2;
        const clip = { x: Math.round(mid - 384), y: Math.round(feet - 4.88 * g.unit), w: 768, h: 256 };
        say(`  sofa row: ${sofa.map((a) => `${a.name} ${a.state}`).join(', ')}`);
        return even(await stage.still(clip));
      });
      const page = await layout({
        dir: WORK,
        name: 'need.two-signals',
        width: 1600,
        height: 900,
        parts: { counts: counts.img, row },
        html: `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1600px;height:900px;
          background:${STUDIO};position:relative">
          <div style="position:absolute;left:0;top:0;width:1600px;height:330px;background:${counts.ground};
            border-bottom:1px solid ${LINE}"></div>
          <img src="{{counts}}" style="position:absolute;left:80px;top:32px;width:{{counts.w}}px;height:{{counts.h}}px">
          <img src="{{row}}" style="position:absolute;left:80px;top:372px;width:{{row.w}}px;height:{{row.h}}px;
            border-radius:12px;box-shadow:0 0 0 1px ${LINE}">`,
      });
      const img = writePng(path.join(OUT, 'need.two-signals.png'), page, 1600);
      say(`need.two-signals.png  ${img.width}x${img.height}`);
    }),
};

if (argv.includes('--list')) {
  say(Object.keys(RECIPES).join('\n'));
} else {
  const names = ONLY.length ? ONLY : Object.keys(RECIPES);
  for (const name of names) {
    if (!RECIPES[name]) throw new Error(`no recipe "${name}"; one of: ${Object.keys(RECIPES).join(', ')}`);
    const t0 = Date.now();
    await RECIPES[name]();
    say(`  ${name} took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
