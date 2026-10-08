/**
 * The furniture sheet: every kind of prop the floor is furnished with, laid
 * out in small scenes and painted twice — at 16 and at 32 device pixels to the
 * plan unit — by the painters the floor itself uses.
 *
 * A floor shows a desk where a plan happens to put one, at whatever scale the
 * window gives it. This shows all of them, side by side, at the two scales an
 * ordinary display and a HiDPI one bake at, which is the only way to see
 * whether a chair reads as a chair before it is behind somebody.
 *
 * `FURNITURE_SHEET` is plain data and is read by two things: `goldens.mjs`
 * hands it to the page for the `furniture@2x` capture, and
 * `test/unit/furniture.test.mjs` checks that no painted kind is missing from
 * it. Positions are in plan units inside a cell `SHEET_CELL` wide and high.
 */

/** The two scales, in device pixels per plan unit. */
export const SHEET_SCALES = Object.freeze([16, 32]);

/** One scene's cell, in plan units. The top unit is its label. */
export const SHEET_CELL = Object.freeze({ w: 12.5, h: 9 });

const N = Math.PI / 2;

/**
 * A bench desk the way the plan lays one: the top, and for each seat a chair,
 * a monitor on the edge the occupant sits at, and something on the desk.
 * @param {number} x @param {number} y @param {number} perSide
 */
function bench(x, y, perSide) {
  /** @type {any[]} */
  const out = [{ kind: 'desk', id: `bench-${perSide}`, x, y, w: perSide * 2.6, h: 2.6 }];
  const clutter = ['mug', 'notebook', 'sticky', 'desk_tray'];
  for (const side of [-1, 1]) {
    const edge = side < 0 ? 'N' : 'S';
    for (let k = 0; k < perSide; k++) {
      const cx = x + (k + 0.5) * 2.6;
      const cy = side < 0 ? y - 1.15 : y + 3.75;
      const anchor = { type: 'attached', to: `bench-${perSide}`, edge, along: k * 2.6 };
      out.push({ kind: 'chair', x: cx - 1, y: cy - 1, w: 2, h: 2, angle: -side * N, anchor });
      out.push({ kind: 'monitor', x: cx - 0.8, y: side < 0 ? y : y + 2.1, w: 1.6, h: 0.5, anchor });
      const kind = clutter[(k * 2 + (side < 0 ? 0 : 1)) % clutter.length];
      const front = kind === 'notebook' || kind === 'desk_tray';
      const w = { mug: 0.8, sticky: 0.7, notebook: 1.3, desk_tray: 1.6 }[kind];
      const h = { mug: 0.8, sticky: 0.7, notebook: 0.9, desk_tray: 1.0 }[kind];
      const along = front ? 1.3 : 0.48;
      const depth = front ? 1.62 : 0.52;
      out.push({
        kind,
        x: x + k * 2.6 + along - w / 2,
        y: side < 0 ? y + depth - h / 2 : y + 2.6 - depth - h / 2,
        w,
        h,
      });
    }
  }
  return out;
}

/**
 * @type {ReadonlyArray<{label:string, floor:'carpet'|'wood', props:any[]}>}
 */
export const FURNITURE_SHEET = Object.freeze([
  { label: 'Desk, two seats', floor: 'carpet', props: bench(4.95, 3.5, 1) },
  { label: 'Bench desk, four seats', floor: 'carpet', props: bench(3.65, 3.5, 2) },
  {
    label: 'The user’s desk',
    floor: 'wood',
    props: [
      { kind: 'user_desk', id: 'user-desk', x: 1.85, y: 2.2, w: 8.8, h: 3 },
      { kind: 'monitor', x: 4.5, y: 2.7, w: 1.6, h: 0.5, anchor: { type: 'zone' } },
      { kind: 'desk_tray', x: 7.75, y: 3.1, w: 2.2, h: 1.2 },
      { kind: 'tub_chair', x: 5.05, y: 6, w: 2.4, h: 2.4, angle: -N },
    ],
  },
  {
    label: 'Task chairs',
    floor: 'carpet',
    props: [
      { kind: 'chair', x: 1.2, y: 3.6, w: 2, h: 2, angle: -N },
      { kind: 'chair', x: 4, y: 3.6, w: 2, h: 2, angle: N },
      { kind: 'chair', x: 6.8, y: 3.6, w: 2, h: 2, angle: 0 },
      { kind: 'chair', x: 9.6, y: 3.6, w: 2, h: 2, angle: Math.PI },
    ],
  },
  {
    label: 'Meeting table, four',
    floor: 'carpet',
    props: [{ kind: 'meeting_table', x: 3.15, y: 1.4, w: 6.2, h: 7.3, seats: 4, turned: false }],
  },
  {
    label: 'Meeting table, eight',
    floor: 'carpet',
    props: [{ kind: 'meeting_table', x: 0.55, y: 1.4, w: 11.4, h: 7.3, seats: 8, turned: false }],
  },
  {
    label: 'Sofa and low table',
    floor: 'wood',
    props: [
      { kind: 'sofa', id: 'sofa-3', x: 2.35, y: 1.8, w: 7.8, h: 2.6, angle: N },
      { kind: 'coffee_table', x: 4.05, y: 5.6, w: 4.4, h: 2.2 },
    ],
  },
  {
    label: 'Armchairs',
    floor: 'wood',
    props: [
      { kind: 'armchair', x: 1.4, y: 3.2, w: 3, h: 3, angle: 0 },
      { kind: 'side_table', x: 5.35, y: 3.8, w: 1.8, h: 1.8 },
      { kind: 'armchair', x: 8.1, y: 3.2, w: 3, h: 3, angle: Math.PI },
    ],
  },
  {
    label: 'Tub chairs',
    floor: 'carpet',
    props: [
      { kind: 'rug_round', x: 3.05, y: 1.8, w: 6.4, h: 6.4, tone: 'task' },
      { kind: 'tub_chair', x: 3.35, y: 3.8, w: 2.4, h: 2.4, angle: 0 },
      { kind: 'side_table', x: 5.55, y: 4.3, w: 1.4, h: 1.4 },
      { kind: 'tub_chair', x: 6.75, y: 3.8, w: 2.4, h: 2.4, angle: Math.PI },
    ],
  },
  {
    label: 'Reception run',
    floor: 'wood',
    props: [
      { kind: 'sofa', id: 'run', x: 0.45, y: 1.6, w: 9, h: 2.6, angle: N, cushions: 3 },
      { kind: 'sofa_corner', x: 9.45, y: 1.6, w: 2.6, h: 2.6 },
      { kind: 'sofa', id: 'side', x: 9.45, y: 4.2, w: 2.6, h: 4.4, angle: Math.PI, cushions: 2 },
      { kind: 'magazine_table', x: 1.6, y: 5.2, w: 6.4, h: 3 },
    ],
  },
  {
    label: 'Credenza and board',
    floor: 'carpet',
    props: [
      { kind: 'credenza', x: 1.05, y: 1.8, w: 10.4, h: 1.4 },
      { kind: 'credenza', x: 1.05, y: 4, w: 1.4, h: 4.6 },
      { kind: 'board_stand', x: 5, y: 6, w: 4.4, h: 0.6, tall: true },
    ],
  },
  {
    label: 'Shelving',
    floor: 'carpet',
    props: [
      { kind: 'bookshelf', id: 'shelf-a', x: 2.65, y: 1.8, w: 7.2, h: 1.2 },
      { kind: 'shelf', id: 'shelf-b', x: 1.05, y: 3.6, w: 1.2, h: 5 },
      { kind: 'bookshelf', id: 'shelf-c', x: 4, y: 6.6, w: 4.4, h: 1.2 },
      { kind: 'pinboard', id: 'pin', x: 10.2, y: 4, w: 1.2, h: 2.8 },
    ],
  },
  {
    label: 'On the wall',
    floor: 'carpet',
    props: [
      { kind: 'whiteboard', x: 0.9, y: 1.8, w: 2.4, h: 6.5 },
      { kind: 'screen', x: 5, y: 2.2, w: 2.6, h: 0.7 },
      { kind: 'tv', x: 4.6, y: 4.4, w: 6, h: 0.6 },
      { kind: 'art', x: 4.6, y: 6.6, w: 6, h: 0.4 },
    ],
  },
  {
    label: 'Planting',
    floor: 'wood',
    props: [
      { kind: 'planter', x: 0.9, y: 1.8, w: 5.2, h: 0.9 },
      { kind: 'planter', x: 0.9, y: 3.4, w: 0.9, h: 5.2 },
      { kind: 'plant_broad', x: 3, y: 4.6, w: 2, h: 2 },
      { kind: 'plant_blade', x: 5.6, y: 4.4, w: 2.4, h: 2.4 },
      { kind: 'plant_tree', x: 8.4, y: 3.4, w: 3.2, h: 3.2 },
    ],
  },
  {
    label: 'Rugs',
    floor: 'wood',
    props: [
      { kind: 'rug', x: 0.6, y: 1.8, w: 5.4, h: 6.6, tone: 'wool' },
      { kind: 'rug', x: 6.5, y: 1.8, w: 5.4, h: 6.6 },
    ],
  },
  {
    label: 'Kitchen',
    floor: 'wood',
    props: [
      { kind: 'counter', x: 0.75, y: 1.8, w: 8, h: 2 },
      { kind: 'fridge', x: 9.2, y: 1.6, w: 2.6, h: 2.4 },
      { kind: 'coffee_machine', x: 1.2, y: 5.4, w: 1.6, h: 1.2 },
      { kind: 'fruit_bowl', x: 4, y: 5.2, w: 1.6, h: 1.6 },
      { kind: 'water_cooler', x: 7, y: 5.2, w: 1.6, h: 1.6 },
      { kind: 'lamp', x: 9.8, y: 5.2, w: 1.6, h: 1.6 },
    ],
  },
  {
    label: 'Bar',
    floor: 'wood',
    props: [
      { kind: 'bar_counter', x: 0.75, y: 2.6, w: 11, h: 1.6 },
      { kind: 'bar_stool', x: 2, y: 4.9, w: 1.4, h: 1.4 },
      { kind: 'bar_stool', x: 4.4, y: 4.9, w: 1.4, h: 1.4 },
      { kind: 'bar_stool', x: 6.8, y: 4.9, w: 1.4, h: 1.4 },
      { kind: 'bar_stool', x: 9.2, y: 4.9, w: 1.4, h: 1.4 },
    ],
  },
  {
    label: 'Round tables',
    floor: 'wood',
    props: [
      { kind: 'dining_table', x: 0.9, y: 2, w: 6, h: 6 },
      { kind: 'board_game_table', x: 7.6, y: 3, w: 4, h: 4 },
    ],
  },
  {
    label: 'Pool',
    floor: 'wood',
    props: [{ kind: 'pool_table', x: 1.75, y: 2.4, w: 9, h: 5 }],
  },
  {
    label: 'Games',
    floor: 'wood',
    props: [
      { kind: 'table_tennis', x: 0.7, y: 2, w: 6.4, h: 3.6 },
      { kind: 'foosball', x: 7.8, y: 2.2, w: 4, h: 2.4 },
      { kind: 'arcade_cabinet', x: 8.8, y: 5.8, w: 2, h: 2 },
    ],
  },
  {
    label: 'Small things',
    floor: 'carpet',
    props: [
      { kind: 'doormat', x: 0.8, y: 2, w: 4.6, h: 1.8 },
      { kind: 'box', x: 6.6, y: 2.1, w: 1.5, h: 1.5 },
      { kind: 'exit_sign', x: 9.2, y: 2.6, w: 2, h: 0.6 },
      { kind: 'mug', x: 1.4, y: 5.6, w: 0.8, h: 0.8 },
      { kind: 'notebook', x: 3.4, y: 5.5, w: 1.3, h: 0.9 },
      { kind: 'sticky', x: 6, y: 5.6, w: 0.7, h: 0.7 },
      { kind: 'desk_tray', x: 8, y: 5.4, w: 1.6, h: 1 },
    ],
  },
  {
    label: 'Booth',
    floor: 'wood',
    props: [{ kind: 'booth', x: 4.15, y: 3, w: 4.2, h: 3.2, angle: N }],
  },
  {
    label: 'Reception desk',
    floor: 'wood',
    props: [{ kind: 'reception_desk', x: 1.75, y: 2.6, w: 9, h: 4 }],
  },
]);

/**
 * PAINT THE SHEET, in the page. Source text rather than a function, because it
 * runs in the floor's own tab and not here: the painters it imports are the
 * ones the floor just used and the palette is the one it is painted in.
 *
 * The sheet is one canvas over the whole window, one device pixel to one
 * canvas pixel. It reports what it painted, so a capture of an empty canvas
 * cannot pass for a sheet.
 */
const PAINT_SHEET = `async (spec) => {
  const [bd, dp, pal] = await Promise.all([
    import('/render/backdrop.js'),
    import('/render/device-px.js'),
    import('/render/palette.js'),
  ]);
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.id = 'furniture-sheet';
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483647;width:' +
    window.innerWidth + 'px;height:' + window.innerHeight + 'px';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const P = pal.PALETTE;
  ctx.fillStyle = P.floorGround;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grid = 14;
  let painted = 0;
  let top = 0;
  for (const ppu of spec.scales) {
    const cw = Math.round(spec.cell.w * ppu);
    const ch = Math.round(spec.cell.h * ppu);
    const cols = Math.max(1, Math.floor(canvas.width / cw));
    const left = Math.floor((canvas.width - cols * cw) / 2);
    spec.cells.forEach((cell, i) => {
      const x = left + (i % cols) * cw;
      const y = top + Math.floor(i / cols) * ch;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cw, ch);
      ctx.clip();
      ctx.fillStyle = cell.floor === 'wood' ? P.woodHerringboneA : P.carpetBase;
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = P.partitionEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = P.plateInkSecondary;
      ctx.font = Math.round(ppu * 0.62) + 'px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(cell.label + ' · ' + ppu, x + ppu * 0.4, y + ppu * 0.3);
      ctx.translate(x, y);
      ctx.scale(ppu / grid, ppu / grid);
      dp.setDeviceScale(ctx, ppu / grid);
      for (const prop of cell.props) {
        bd.paintProp(ctx, { angle: 0, ...prop }, grid);
        painted++;
      }
      ctx.restore();
    });
    top += Math.ceil(spec.cells.length / cols) * ch;
  }
  dp.setDeviceScale(ctx, 1);
  return { painted, width: canvas.width, height: canvas.height, used: top, dpr };
}`;

/** The expression `Runtime.evaluate` is handed: the painter, applied to the sheet. */
export function sheetExpression() {
  const spec = { cells: FURNITURE_SHEET, scales: SHEET_SCALES, cell: SHEET_CELL };
  return `(${PAINT_SHEET})(${JSON.stringify(spec)})`;
}
