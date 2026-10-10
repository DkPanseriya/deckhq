/**
 * The parts of a page the build fills in: the ways to follow the project, the
 * release feed, and what users have said.
 *
 * A page marks the place with `<!-- slot: name -->` and `fill()` puts the
 * block there. Each block is a plain function of its data, so the test can ask
 * for it in both states: with the thing it depends on, and without.
 *
 * Nothing here makes a request. The feed is a file written at build time from
 * `CHANGELOG.md`; the e-mail button is a link to a form hosted somewhere else,
 * which a reader opens by choosing to, and which this site never loads.
 */
import { esc } from './markdown.mjs';

/**
 * The hosted sign-up form: "one e-mail when it lands". While it is empty no
 * button is rendered anywhere. Setting it is the whole change: the home page
 * grows the button, the footer grows a link to it, and
 * `test/unit/site.test.mjs` takes this address's host into its allow-list.
 * It must be an `https://` address.
 */
export const WAITLIST_URL = 'https://deckhq.kit.com/deckhq-3d';

/** The release feed, beside the pages. */
export const FEED = 'feed.xml';

/** The maker's own site: one link, in the footer. */
export const MAKER_URL = 'https://darshakpanseriya.com';

/**
 * The host a sign-up address sends a reader to, or null when there is none.
 *
 * @param {string} [url]
 * @returns {string | null}
 */
export function waitlistHost(url = WAITLIST_URL) {
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`WAITLIST_URL is not https: ${url}`);
  return parsed.hostname.toLowerCase();
}

/**
 * The ways to follow, as list items: the feed, GitHub's own notification and,
 * only when there is a form to send a reader to, the e-mail button.
 *
 * @param {{repo: string, url?: string}} opts
 */
export function followWays({ repo, url = WAITLIST_URL }) {
  const ways = [
    `<li><a href="${FEED}">The release feed</a><span>Atom. One entry a release, with its paragraph.</span></li>`,
    `<li><a href="${esc(repo)}/releases">Watch releases on GitHub</a><span>Watch, Custom, Releases.</span></li>`,
  ];
  if (waitlistHost(url)) {
    ways.push(
      `<li class="follow-mail"><span>One e-mail when it lands. Nothing else.</span>` +
        `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Tell me when 3D is ready</a></li>`,
    );
  }
  return ways;
}

/**
 * The home page's Follow band.
 *
 * @param {{repo: string, url?: string}} opts
 */
export function followBlock(opts) {
  const items = followWays(opts)
    .map((li) => `      ${li}`)
    .join('\n');
  return `<section class="band band--tight" id="follow">
  <div class="wrap follow">
    <div class="follow-copy">
      <h2>Hear about the next release.</h2>
      <p>DeckHQ has no account and sends nothing, so it cannot tell you itself.</p>
    </div>
    <ul class="follow-ways">
${items}
    </ul>
  </div>
</section>
`;
}

/**
 * The footer's Follow column, on every page. The e-mail button says what it is
 * for, and that is only said on the home page; here it is a link to it.
 *
 * @param {{repo: string, url?: string}} opts
 */
export function followLinks({ repo, url = WAITLIST_URL }) {
  const links = [
    `<li><a href="${FEED}">Release feed</a></li>`,
    `<li><a href="${esc(repo)}/releases">Watch releases on GitHub</a></li>`,
  ];
  if (waitlistHost(url)) links.push('<li><a href="index.html#follow">One e-mail</a></li>');
  return links;
}

/** `1.7.0` -> `v1-7-0`: the anchor a release has on the changelog page. */
export const releaseAnchor = (version) => `v${version.replace(/\./g, '-')}`;

/**
 * The releases as an Atom feed: one entry a release, carrying the paragraph
 * the changelog page shows for it. A release with no date is left out, because
 * an entry has to say when it was published and this file does not guess.
 *
 * @param {{origin: string, releases: {version: string, date: string, highlights: string}[],
 *   render: (md: string) => string}} opts `render` turns a paragraph of
 *   markdown into HTML; the feed carries it escaped, as Atom's `type="html"`.
 */
export function atomFeed({ origin, releases, render }) {
  const dated = releases.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const stamp = (date) => `${date}T00:00:00Z`;
  const newest =
    dated
      .map((r) => r.date)
      .sort()
      .pop() ?? '1970-01-01';
  const entries = dated.map((r) => {
    const url = `${origin}/changelog.html#${releaseAnchor(r.version)}`;
    return `  <entry>
    <title>DeckHQ ${esc(r.version)}</title>
    <id>${esc(url)}</id>
    <link rel="alternate" type="text/html" href="${esc(url)}"/>
    <updated>${stamp(r.date)}</updated>
    <content type="html">${esc(render(r.highlights))}</content>
  </entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>DeckHQ releases</title>
  <subtitle>An office for your AI coding agents. What each release brought, in a paragraph.</subtitle>
  <id>${esc(origin)}/</id>
  <link rel="self" type="application/atom+xml" href="${esc(origin)}/${FEED}"/>
  <link rel="alternate" type="text/html" href="${esc(origin)}/changelog.html"/>
  <updated>${stamp(newest)}</updated>
  <author><name>Darshak Panseriya</name></author>
${entries.join('\n')}
</feed>
`;
}

/**
 * What users have said, when somebody has. `site/quotes.json` is a list of
 * `{ "quote", "name", "where" }` and is empty until a real person has said
 * something in public; while it is empty this renders nothing at all. Nothing
 * is ever written into that file that was not said, by that person, there.
 *
 * @param {{quote: string, name: string, where?: string}[]} quotes
 */
export function quotesBlock(quotes) {
  const said = quotes.filter((q) => q && q.quote && q.name).slice(0, 3);
  if (said.length === 0) return '';
  const items = said
    .map(
      (q) => `      <figure class="quote">
        <blockquote><p>${esc(q.quote)}</p></blockquote>
        <figcaption>${esc(q.name)}${q.where ? `, ${esc(q.where)}` : ''}</figcaption>
      </figure>`,
    )
    .join('\n');
  return `<section class="band band--tight" id="said">
  <div class="wrap">
    <h2>What people said.</h2>
    <div class="quotes">
${items}
    </div>
  </div>
</section>
`;
}

/**
 * Put each block where its page asked for it. A slot nobody fills is an
 * error: a marker left in a page is a hole a reader would never see.
 *
 * @param {string} body @param {Record<string, string>} slots
 */
export function fill(body, slots) {
  // A marker may carry a note for whoever edits the page: `<!-- slot: name`,
  // then anything, then `-->`. The note goes with the marker.
  return body.replace(/[ \t]*<!-- slot: ([\w-]+)(?:\s[\s\S]*?)?\s*-->\n?/g, (_m, name) => {
    if (!(name in slots)) throw new Error(`no block is written for the slot "${name}"`);
    return slots[name];
  });
}
