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
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { PRESET_DEFS } from '../public/render/look-presets.js';
import { DEMO_EPOCH } from './demo-args.mjs';
import { fakeId } from './demo-write.mjs';
import {
  cropImage,
  layout,
  postHook,
  record,
  sleep,
  startDemo,
  withStage,
  writeGif,
  writePng,
} from './lib/capture-kit.mjs';

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

/** How long a recording waits for the floor to come to rest before it starts. */
const SETTLE_MS = Number(opt('--settle', 9000));
/** Override a recording's frame rate, for a quick look before the real take. */
const FPS = Number(opt('--fps', 0));
/** Override a recording's length, for finding out how long something takes. */
const SECONDS = Number(opt('--seconds', 0));

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

/** The rooms of a floor as one string: a recording compares it to see a floor laid out again. */
const planOf = (g) => g.rooms.map((r) => [r.name, r.x, r.y, r.w, r.h].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(':')).join('|');

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

  /**
   * C-001. One working session's turn ends: a real `Stop` hook, six tenths of
   * a second in. The frame is the office, the corridor and the room it leaves.
   */
  'need.office': () =>
    onFloor({ population: 'pair', stepped: true }, (demo) =>
      // 1031 high so the stage under the header is 1600 x 900.
      withStage({ width: 1600, height: 1031, dpr: 2, reduced: false, virtual: true }, async (stage) => {
        // Everybody walks in from the door on first paint; the recording wants
        // exactly one person moving.
        const g = await stage.open(demo.url, SETTLE_MS);
        refuseBanner(g);
        const laid = planOf(g);
        const who = g.agents.find((a) => a.title === 'Rate limiter for the public API');
        const clip = { x: 0, y: Math.ceil(g.canvas.y), w: 1600, h: 900 };
        const frames = await record(stage, demo, {
          fps: FPS || 25,
          seconds: SECONDS || 6,
          clip,
          width: 1600,
          dir: path.join(WORK, 'need.office.frames'),
          events: [
            {
              at: 0.6,
              run: () =>
                postHook(demo.url, {
                  session_id: who.id.replace(/^claude-code:/, ''),
                  cwd: path.join(demo.root, 'code', 'orbital-api'),
                  hook_event_name: 'Stop',
                }),
            },
          ],
          watch: async (i, t) => {
            if (i % 5) return;
            const now = await stage.geometry();
            if (planOf(now) !== laid) say(`  ${t.toFixed(2)}s THE FLOOR WAS LAID OUT AGAIN`);
            const a = now.agents.find((x) => x.id === who.id);
            say(`  ${t.toFixed(2)}s ${a.name} ${a.state} ${a.placement} ${a.clip}${a.moving ? ' moving' : ''} ${Math.round(a.x)},${Math.round(a.y)}`);
          },
        });
        reportGif('need.office', frames, FPS || 25);
      }),
    ),
};

/**
 * The band of the demo floor inside the link preview: the whole width of the
 * building and a third of that in height, from the wait badges over the
 * office's side sofas down to the names under the juniors two rooms below.
 * Those two are 36.7 units apart and the band is 39.7, so it is placed with
 * the same few pixels to spare at either end.
 * @returns {Promise<{width:number, height:number, data:Uint8Array}>} 3000 x 1000
 */
function officeBand() {
  return onFloor({ population: 'demo' }, (demo) =>
    // The window `see.every-session` uses, where the building is 119 units wide.
    withStage({ width: 1760, height: 990, dpr: 3000 / 1760 }, async (stage) => {
      const g = await stage.open(demo.url);
      refuseBanner(g);
      const waiting = g.agents.filter((a) => a.placement === 'office');
      const top = Math.min(...waiting.map((a) => a.y)) - 6.2 * g.unit;
      return even(await stage.still({ x: 0, y: top, w: 1760, h: 1760 / 3 }));
    }),
  );
}

/**
 * A profile header is three to one and the building is never wider than 2.2 to
 * one, so no band of it holds the office and a room below it with room to
 * spare at the top and the foot. This is the other answer: a window that is
 * itself three to one under its header, where the product stands the whole
 * building in the middle of the studio ground. Nothing is cut, and what a
 * profile picture covers bottom left is ground and the corner of the lounge.
 * @returns {Promise<{width:number, height:number, data:Uint8Array}>} 3000 x 1000
 */
function wholeFloorBand() {
  return onFloor({ population: 'demo' }, (demo) =>
    withStage({ width: 2610, height: 1000, dpr: 3000 / 2610 }, async (stage) => {
      const g = await stage.open(demo.url);
      refuseBanner(g);
      if (g.unit < 14) throw new Error(`the floor fits at ${g.unit} px a unit: no wait badges`);
      return even(await stage.still({ x: 0, y: g.canvas.y, w: 2610, h: 870 }));
    }),
  );
}

/** The mark's own file, on its dark ground, for a page that sets it inline. */
const MARK = fs
  .readFileSync(new URL('../public/brand/deckhq-mark.svg', import.meta.url), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace('<svg ', '<svg class="dark" ');

Object.assign(RECIPES, {
  /**
   * BRAND-GUIDE §3's avatar: the mark's robot with no plate and no rim, on the
   * plate's own colour edge to edge, its ink 64% of the width. The shapes are
   * the SVG's, untouched; only the two plate rectangles are left out and the
   * view box is widened about the centre of the ink (44..468 by 48..470).
   */
  'avatar-product-1024': async () => {
    const view = 424 / 0.64;
    const robot = MARK.replace(/<rect width="512"[^>]*\/>/, '')
      .replace(/<rect x="6" y="6"[^>]*\/>/, '')
      .replace(/viewBox="[^"]*" width="512" height="512"/, `viewBox="${256 - view / 2} ${259 - view / 2} ${view} ${view}" width="1024" height="1024"`);
    const page = await layout({
      dir: WORK,
      name: 'avatar-product-1024',
      width: 1024,
      height: 1024,
      html: `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1024px;height:1024px;
        background:#14161B;overflow:hidden">${robot}`,
    });
    const img = writePng(path.join(OUT, 'avatar-product-1024.png'), page, 1024);
    say(`avatar-product-1024.png  ${img.width}x${img.height}`);
  },

  /** A profile header: the whole building on the studio ground, 1500 x 500. */
  'header-1500x500': async () => {
    const img = writePng(path.join(OUT, 'header-1500x500.png'), await wholeFloorBand(), 1500);
    say(`header-1500x500.png  ${img.width}x${img.height}`);
  },

  /**
   * The link preview, laid out as BRAND-GUIDE §9.4 scaled to a 630 px short
   * edge: studio ground, the mark and the name as live text in the app's own
   * font stack (no font is loaded), the line, and the band in a 12 px frame.
   */
  'link-preview-1200x630': async () => {
    const page = await layout({
      dir: WORK,
      name: 'link-preview-1200x630',
      width: 1200,
      height: 630,
      parts: { band: await officeBand() },
      html: `<!doctype html><meta charset="utf-8"><style>
        body{margin:0;width:1200px;height:630px;background:${STUDIO};color:#e9ecf2;
          font-family:'IBM Plex Sans',system-ui,sans-serif;position:relative;overflow:hidden}
        .lock{position:absolute;left:56px;top:48px;display:flex;align-items:center;gap:14px;
          font-weight:600;font-size:30px;letter-spacing:-0.01em}
        .lock svg{width:40px;height:40px}
        .line{position:absolute;left:56px;top:112px;font-weight:600;font-size:46px;letter-spacing:-0.03em}
        img{position:absolute;left:56px;top:212px;width:1088px;height:362px;border-radius:12px;
          box-shadow:0 0 0 1px ${LINE}}
      </style><div class="lock">${MARK}<span>DeckHQ</span></div>
      <div class="line">An office for your AI coding agents.</div><img src="{{band}}">`,
    });
    const img = writePng(path.join(OUT, 'link-preview-1200x630.png'), page, 1200);
    say(`link-preview-1200x630.png  ${img.width}x${img.height}`);
  },
});

/** The box a set of robots stands in, by their feet, in CSS pixels of the page. */
const boxOf = (agents) => ({
  x0: Math.min(...agents.map((a) => a.x)),
  x1: Math.max(...agents.map((a) => a.x)),
  y0: Math.min(...agents.map((a) => a.y)),
  y1: Math.max(...agents.map((a) => a.y)),
});
const centreOf = (box) => ({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });

/**
 * How many CSS pixels a unit of this floor is, fitted to a window. Asked in a
 * browser of its own first, because a real pixel ratio is fixed when a browser
 * starts and a close crop needs to know the fit to choose one.
 */
const fitUnit = (demo, width, height, query = '') =>
  withStage({ width, height, dpr: 1 }, async (stage) => (await stage.open(demo.url + query, 300)).unit);

/**
 * Magnify the floor about a group of robots and bring them to the middle of
 * the stage, as far as the building's edges allow. `who` picks the group out of
 * a geometry; the answer is the geometry afterwards.
 */
async function closeIn(stage, zoom, who) {
  let g = await stage.geometry();
  g = await stage.zoomTo(Math.max(1, Math.min(2.5, zoom)), centreOf(boxOf(who(g))));
  for (let i = 0; i < 2; i++) {
    const c = centreOf(boxOf(who(g)));
    g = await stage.panBy(g.canvas.x + g.canvas.w / 2 - c.x, g.canvas.y + g.canvas.h / 2 - c.y);
  }
  return g;
}

/** A clip of `w` by `h` CSS pixels about a point, on whole pixels, refused if it leaves the stage. */
function clipAbout(g, c, w, h) {
  const clip = { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
  const s = g.canvas;
  if (clip.x < s.x || clip.y < s.y || clip.x + w > s.x + s.w || clip.y + h > s.y + s.h) {
    throw new Error(`the crop ${JSON.stringify(clip)} leaves the stage ${JSON.stringify(s)}`);
  }
  return clip;
}

/** A capture on the studio ground, in a 12 px frame: for a room that is not sixteen to nine. */
async function framed(name, shot) {
  const page = await layout({
    dir: WORK,
    name,
    width: 1600,
    height: 900,
    parts: { shot },
    html: `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1600px;height:900px;
      background:${STUDIO};display:grid;place-items:center"><img src="{{shot}}"
      style="width:{{shot.w}}px;height:{{shot.h}}px;border-radius:12px;box-shadow:0 0 0 1px ${LINE}">`,
  });
  const img = writePng(path.join(OUT, `${name}.png`), page, 1600);
  say(`${name}.png  ${img.width}x${img.height}  capture ${shot.width}x${shot.height} at 2x`);
}

/** The eleven styles, in the order the Look panel lists them. */
const STYLES = PRESET_DEFS.map((preset) => preset.id);

Object.assign(RECIPES, {
  /**
   * C-014. The `crew` floor's one room, close: a lead at its desk and five
   * juniors on the floor in an arc, two of them still writing, so two cables
   * carry pulses for the whole six seconds.
   */
  'crew.formation': () =>
    onFloor({ population: 'crew', stepped: true }, (demo) =>
      withStage({ width: 1280, height: 851, dpr: 4, reduced: false, virtual: true }, async (stage) => {
        refuseBanner(await stage.open(demo.url, SETTLE_MS));
        const crew = (g) => g.agents.filter((a) => a.project === 'orbital-api');
        // Twenty-two units across the 800 CSS pixels that are 3200 at this ratio.
        const g = await closeIn(stage, 800 / 22 / (await stage.geometry()).unit, crew);
        const c = centreOf(boxOf(crew(g)));
        const frames = await record(stage, demo, {
          fps: FPS || 25,
          seconds: SECONDS || 6,
          clip: clipAbout(g, { x: c.x, y: c.y + 0.3 * g.unit }, 800, 450),
          width: 1600,
          dir: path.join(WORK, 'crew.formation.frames'),
        });
        reportGif('crew.formation', frames, FPS || 25);
      }),
    ),

  /**
   * C-002. One lead and its two juniors, close. Twenty units across 1600
   * pixels, from a capture at twice that.
   */
  'crew.juniors-laptops': () =>
    onFloor({ population: 'juniors' }, async (demo) => {
      const dpr = 3200 / (20 * 2.5 * (await fitUnit(demo, 1600, 1000)));
      return withStage({ width: 1600, height: 1000, dpr }, async (stage) => {
        refuseBanner(await stage.open(demo.url));
        const crew = (g) => g.agents.filter((a) => a.project === 'design-system');
        const g = await closeIn(stage, 2.5, crew);
        const c = centreOf(boxOf(crew(g)));
        const shot = await stage.still(clipAbout(g, { x: c.x, y: c.y - 1.3 * g.unit }, 3200 / dpr, 1800 / dpr));
        const img = writePng(path.join(OUT, 'crew.juniors-laptops.png'), even(shot), 1600);
        say(`crew.juniors-laptops.png  ${img.width}x${img.height}  from ${shot.width}x${shot.height}`);
      });
    }),

  /**
   * C-015. The `rare` floor: cast number 183, which the product's own
   * `appearanceFor` gives a crown, at the desk beside cast number 1, which it
   * gives nothing. The pointer rests on the crowned one, so its card is open.
   */
  'see.rare': () =>
    onFloor({ population: 'rare' }, (demo) =>
      withStage({ width: 1600, height: 1000, dpr: 4 }, async (stage) => {
        refuseBanner(await stage.open(demo.url));
        const two = (g) => g.agents.filter((a) => a.placement === 'desk');
        let g = await closeIn(stage, 2, two);
        const crowned = two(g).find((a) => a.id.endsWith(fakeId(183)));
        // The pointer comes to rest on the body. Its right-hand side is tried
        // first, because the card opens below and to the right of the pointer
        // and from there it stands beside the robot and not over it.
        let card = { hidden: true, text: '' };
        for (const [right, up] of [[0.7, 0.5], [0.4, 0.5], [0, 0.3], [0, 0.1]]) {
          const at = { x: crowned.x + right * g.unit, y: crowned.y - up * g.unit };
          await stage.pointer(at.x + 4, at.y - 4);
          await stage.pointer(at.x, at.y);
          await sleep(1500);
          card = await stage.evaluate(`(() => {
            const el = document.getElementById('tooltip');
            const r = el.getBoundingClientRect();
            return { hidden: el.hidden, text: el.innerText, x: r.x, y: r.y, w: r.width, h: r.height };
          })()`);
          if (!card.hidden) break;
        }
        if (card.hidden || !/legendary/.test(card.text)) throw new Error(`no legendary card: ${JSON.stringify(card)}`);
        say(`  hover card: ${card.text.replace(/\s*\n\s*/g, ' | ')}`);
        g = await stage.geometry();
        // 600 CSS pixels square, twenty units: the crowned robot a little below
        // the middle, the plain one above it, the card to its right.
        const c = { x: crowned.x + 2.2 * g.unit, y: crowned.y - 3.2 * g.unit };
        const shot = await stage.still(clipAbout(g, c, 600, 600));
        const img = writePng(path.join(OUT, 'see.rare.png'), shot, 1200);
        say(`see.rare.png  ${img.width}x${img.height}  ${two(g).map((a) => a.name).join(' and ')}`);
      }),
    ),

  /**
   * C-003. The `lead` floor. The lead's turn ends (`Stop`) and it stays at its
   * desk; its three juniors end one by one (`SubagentStop`, naming each); when
   * the last has, the lead goes where its own state sends it. Eight seconds.
   */
  'crew.lead-supervises': () =>
    onFloor({ population: 'lead', stepped: true }, (demo) =>
      withStage({ width: 1600, height: 1031, dpr: 2, reduced: false, virtual: true }, async (stage) => {
        const g = await stage.open(demo.url, SETTLE_MS);
        refuseBanner(g);
        const laid = planOf(g);
        const lead = g.agents.find((a) => a.title === 'Split the deploy pipeline');
        const juniors = g.agents.filter((a) => a.junior);
        const hook = (body) =>
          postHook(demo.url, {
            session_id: lead.id.replace(/^claude-code:/, ''),
            cwd: path.join(demo.root, 'code', 'orbital-api'),
            ...body,
          });
        const frames = await record(stage, demo, {
          fps: FPS || 25,
          seconds: SECONDS || 8,
          clip: { x: 0, y: Math.ceil(g.canvas.y), w: 1600, h: 900 },
          width: 1600,
          dir: path.join(WORK, 'crew.lead-supervises.frames'),
          events: [
            { at: 0.6, run: () => hook({ hook_event_name: 'Stop' }) },
            ...juniors.map((junior, i) => ({
              // All three in one frame. A crew that falls from three to two is no
              // longer a formation, and the room is laid out again around a desk
              // somewhere else: one by one, the lead is seen to change desks.
              at: 3.2,
              run: () =>
                hook({ hook_event_name: 'SubagentStop', agent_id: junior.id.replace(/^claude-code:/, '') }),
            })),
          ],
          watch: async (i, t) => {
            if (i % 5) return;
            const now = await stage.geometry();
            if (planOf(now) !== laid) say(`  ${t.toFixed(2)}s THE FLOOR WAS LAID OUT AGAIN`);
            const a = now.agents.find((x) => x.id === lead.id);
            const crew = now.agents.filter((x) => x.junior).map((x) => x.state).join(',');
            say(`  ${t.toFixed(2)}s ${a.name} ${a.state} ${a.placement} ${a.clip}${a.moving ? ' moving' : ''} ${Math.round(a.x)},${Math.round(a.y)}  juniors: ${crew}`);
          },
        });
        reportGif('crew.lead-supervises', frames, FPS || 25);
      }),
    ),

  /**
   * C-019. The `worktrees` floor's repository room: a desk for the main
   * checkout and a bench for each worktree, named for its branch or directory.
   */
  'wt.benches': () =>
    onFloor({ population: 'worktrees' }, async (demo) => {
      // Asked first: how large the room can be magnified and still stand whole
      // on the stage, and the ratio at which that is 1640 px high or 2880 wide.
      const { room: probe, canvas } = await withStage({ width: 1600, height: 1000, dpr: 1 }, async (stage) => {
        const g = await stage.open(demo.url, 300);
        return { room: g.rooms.find((r) => r.name === 'orbital-api'), canvas: g.canvas };
      });
      const zoom = Math.max(1, Math.min(2.5, (0.96 * canvas.w) / probe.w, (0.96 * canvas.h) / probe.h));
      const dpr = Math.min(1640 / (probe.h * zoom), 2880 / (probe.w * zoom));
      return withStage({ width: 1600, height: 1000, dpr }, async (stage) => {
        let g = await stage.open(demo.url);
        refuseBanner(g);
        const room = () => g.rooms.find((r) => r.name === 'orbital-api');
        g = await stage.zoomTo(zoom, { x: room().x + room().w / 2, y: room().y + room().h / 2 });
        for (let i = 0; i < 2; i++) {
          g = await stage.panBy(
            g.canvas.x + g.canvas.w / 2 - (room().x + room().w / 2),
            g.canvas.y + g.canvas.h / 2 - (room().y + room().h / 2),
          );
        }
        await framed('wt.benches', even(await stage.still(room())));
      });
    }),

  /**
   * C-020. The `colours` floor in the Colour plan style, whose room colours
   * are zoned: five rooms with people at desks and their lights on, one away.
   * The floor alone, in a window whose stage is sixteen to nine.
   */
  'look.room-colours': () =>
    onFloor({ population: 'colours' }, (demo) =>
      withStage({ width: 1760, height: 1120, dpr: 3200 / 1760 }, async (stage) => {
        const g = await stage.open(`${demo.url}?look=colour-plan`);
        refuseBanner(g);
        const shot = await stage.still({ x: 0, y: g.canvas.y, w: 1760, h: 990 });
        const img = writePng(path.join(OUT, 'look.room-colours.png'), even(shot), 1600);
        const lit = g.rooms.filter((r) => r.kind === 'project').length;
        say(`look.room-colours.png  ${img.width}x${img.height}  ${lit} rooms, unit ${g.unit.toFixed(2)}`);
      }),
    ),

  /**
   * C-005. The demo floor in each of the eleven styles, through `?look=`, held
   * for eight tenths of a second each. Reduced motion, so the eleven pictures
   * differ in the style and in nothing else.
   */
  'look.styles': () =>
    onFloor({ population: 'demo' }, (demo) =>
      withStage({ width: 1760, height: 1120, dpr: 3200 / 1760 }, async (stage) => {
        const dir = path.join(WORK, 'look.styles.frames');
        fs.rmSync(dir, { recursive: true, force: true });
        const frames = [];
        for (const [i, style] of STYLES.entries()) {
          const g = await stage.open(`${demo.url}?look=${style}`, 1200);
          refuseBanner(g);
          const shot = await stage.still({ x: 0, y: g.canvas.y, w: 1760, h: 990 });
          const file = path.join(dir, `${String(i).padStart(2, '0')}-${style}.png`);
          writePng(file, even(shot), 1600);
          frames.push(file);
          say(`  ${style}`);
        }
        reportGif('look.styles', frames, 0, { delays: frames.map(() => 80), ownPalettes: true });
      }),
    ),
});

/** Write a recording, and its smaller copy when it is too heavy for a post. */
function reportGif(name, frames, fps, opts = {}) {
  const gif = writeGif(path.join(OUT, `${name}.gif`), frames, fps, opts);
  say(`${name}.gif  ${gif.width}x${gif.height}  ${gif.frames} frames  ${(gif.bytes / 1048576).toFixed(2)} MB`);
  if (gif.bytes > 8 * 1048576) {
    const small = writeGif(path.join(OUT, `${name}.1280.gif`), frames, fps, { ...opts, width: 1280 });
    say(`${name}.1280.gif  ${small.width}x${small.height}  ${(small.bytes / 1048576).toFixed(2)} MB`);
  }
}

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
