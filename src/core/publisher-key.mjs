/**
 * The DeckHQ publisher's signing key — the PUBLIC half, and only ever that.
 *
 * WP-45. A Supporter pack is a JSON file. There is no licence server, no
 * account, no activation call and no phone-home: the only question this
 * product ever asks about a pack is "was this signed by the key below", and
 * it answers it locally with `node:crypto`. That is the whole enforcement
 * model, it is stated in one file, and it can be read by anyone.
 *
 * ## What this key proves, and what it does not
 *
 * It proves that a pack file is the one DeckHQ published, unmodified. It
 * proves nothing about who is running it: anybody who has a pack file can
 * install it, on any machine, for ever, offline. That is deliberate.
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 2 — paid features are services you
 * opt into, never gates — and §5's promise that the pack gates nothing that
 * captures, queues or acts. A signature here is an integrity check on an
 * asset bundle, not a lock on a feature. Copy protection would need egress,
 * and this product does not have any.
 *
 * ## Why the private half is not in this repository
 *
 * Because it never can be. It lives in the owner's password manager. A
 * private key in a public MIT repository is not a key. `deckhq pack build`
 * takes it as `--key <file>`, reads it, signs, and never writes it anywhere.
 *
 * ## Rotation
 *
 * `PUBLISHER_KEYS` is a list rather than one key so a compromised or retired
 * key can be replaced without every pack in the wild becoming unverifiable on
 * the day of the upgrade: a new key is prepended, the old one stays until the
 * packs signed with it have been re-issued, and then it is deleted in a
 * release with a changelog line. Verification accepts a signature from any
 * key in the list and reports which one matched, so a pack that only verifies
 * against a retired key can be found.
 */

/**
 * One publisher key.
 *
 * @typedef {object} PublisherKey
 * @property {string} id      short, stable, human-quotable — it appears in
 *                            `deckhq pack verify` output and in a pack's
 *                            signature block
 * @property {string} pem     the SPKI PEM of an Ed25519 public key
 * @property {boolean} retired  a retired key still verifies existing packs and
 *                            is never used to describe a new one
 */

/**
 * Every key a pack may be signed with, newest first.
 *
 * @type {ReadonlyArray<PublisherKey>}
 */
export const PUBLISHER_KEYS = Object.freeze(
  [
    {
      id: 'deckhq-2026',
      pem:
        '-----BEGIN PUBLIC KEY-----\n' +
        'MCowBQYDK2VwAyEAL34A4Fgg/CJ4gPBLRO5Yt168YhHtm1DQg3+oBApX/G4=\n' +
        '-----END PUBLIC KEY-----\n',
      retired: false,
    },
  ].map((k) => Object.freeze(k)),
);

/** The key a freshly built pack is described as being signed with. */
export const CURRENT_PUBLISHER_KEY_ID = 'deckhq-2026';
