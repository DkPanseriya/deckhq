/**
 * The site's moving pictures: the frames of one loop, taken off the floor.
 *
 * A loop on the site is a video at sixty frames a second, twice the size the
 * page shows it at (`video.mjs` writes the file and measures it). This takes
 * the frames, and takes them the same way whatever the rate, because neither
 * way depends on how fast this machine is:
 *
 *   `phase`  steps the scene's pinned phase (`?phase=`, WP-87) from 0 to 1
 *            across the run. Every animation on the floor is pinned to that
 *            phase, so the clip is walked through its cycle exactly once and
 *            the last frame joins the first: a loop.
 *   `live`   is for what no clip phase can produce — a session standing up
 *            and walking to your office. The floor runs on a held clock
 *            (`capture-kit.mjs`'s `VIRTUAL_CLOCK`, and a daemon whose own
 *            clock is stepped with it), one frame of time per frame taken.
 *            It used to be a timer in the page at 25 frames a second; a
 *            timer cannot be asked for 60 and trusted.
 *
 * A frame comes off the floor canvas, cropped and scaled in the page, and
 * crosses the protocol as the PNG it will be encoded from. It is never decoded
 * here except for the few a contact sheet shows.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `evaluate`, for a client this module is handed. */
async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  }
  return result.value;
}

/**
 * Install the in-page frame grabber.
 *
 * One coordinate system for the whole manifest: the rectangle is in CSS pixels
 * from the top left of the PAGE, and this puts it into the canvas's own
 * backing pixels — its offset on the page, then its device pixel ratio. A loop
 * can therefore only show what is on the canvas; a rectangle over the chrome
 * comes back empty.
 */
async function installGrabber(client) {
  await evaluate(
    client,
    `(() => {
      window.__deckhqGrab = (px, py, w, h, outW, outH) => {
        const c = document.getElementById('floor-canvas');
        const b = c.getBoundingClientRect();
        const k = c.width / b.width;
        const o = document.createElement('canvas');
        o.width = outW;
        o.height = outH;
        const ctx = o.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(c, (px - b.left) * k, (py - b.top) * k, w * k, h * k, 0, 0, outW, outH);
        return o.toDataURL('image/png').split(',')[1];
      };
      window.__deckhqPhase = (p) => {
        const s = document.getElementById('floor-canvas').__deckhqScene;
        s._phase = p;
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      };
      return true;
    })()`,
  );
}

/**
 * The size a loop's frames are written at: the manifest's width, never more
 * than was drawn, and both sides even, which H.264 requires.
 *
 * @param {{width:number, crop?:{x:number,y:number,w:number,h:number}}} asset
 * @param {number} scale the device pixel ratio the floor was drawn at
 */
export function loopSize(asset, scale) {
  const rect = asset.crop ?? { x: 0, y: 0, w: 1600, h: 1000 };
  const even = (n) => n - (n % 2);
  const width = even(Math.min(asset.width, Math.round(rect.w * scale)));
  return { rect, width, height: even(Math.round((rect.h * width) / rect.w)) };
}

/**
 * The frames of one loop, as base64 PNGs in order.
 *
 * @param {any} client a CDP client on a settled floor
 * @param {{mode?:'phase'|'live', fps?:number, seconds?:number, width:number,
 *          crop?:{x:number,y:number,w:number,h:number}}} asset
 * @param {object} opts
 * @param {number} opts.scale
 * @param {(ms:number) => Promise<void>} [opts.setNow]  the stepped daemon's clock; `live` only
 * @param {{at:number, run:() => Promise<any>}[]} [opts.events]  what happens, in seconds; `live` only
 * @param {(line:string) => void} [opts.say]
 * @returns {Promise<{frames:{base64:string}[], width:number, height:number, fps:number}>}
 */
export async function loopFrames(client, asset, opts) {
  const fps = asset.fps ?? 60;
  const count = Math.round(fps * (asset.seconds ?? 4));
  const { rect, width, height } = loopSize(asset, opts.scale);
  const grab = async () => ({
    base64: await evaluate(
      client,
      `window.__deckhqGrab(${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}, ${width}, ${height})`,
    ),
  });
  await installGrabber(client);
  const frames = [];
  if ((asset.mode ?? 'phase') === 'phase') {
    for (let i = 0; i < count; i++) {
      await evaluate(client, `window.__deckhqPhase(${(i / count).toFixed(6)})`);
      frames.push(await grab());
    }
    return { frames, width, height, fps };
  }
  if (!opts.setNow) throw new Error('a live loop needs a stepped demo floor');
  const base = await evaluate(client, 'window.__captureClock.freeze()');
  const step = 1000 / fps;
  const pending = [...(opts.events ?? [])].sort((a, b) => a.at - b.at);
  for (let i = 0; i < count; i++) {
    while (pending.length && pending[0].at <= i / fps + 1e-9) {
      const said = await pending.shift().run();
      if (said && opts.say) opts.say(`       ${(i / fps).toFixed(2)} s: ${said}`);
      // The floor hears of it over its event stream, in real time.
      await sleep(400);
    }
    await opts.setNow(base + Math.round((i + 1) * step));
    // One frame of time; the waiting animation frames run inside this call,
    // so the canvas is the new frame by the time it answers.
    await evaluate(client, `window.__captureClock.tick(${step})`);
    frames.push(await grab());
  }
  return { frames, width, height, fps };
}
