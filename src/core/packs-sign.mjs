/**
 * A pack's canonical bytes, and the signature over them (WP-22 follow-up).
 *
 * Split out of `packs.mjs` unchanged: the deterministic JSON serialisation a
 * signature is taken over, the publisher key's fingerprint, signing, and
 * verification.
 *
 * The canonical form is the whole point. Two files that differ only in key
 * order or whitespace are the same pack, and must produce the same bytes, or
 * a signature would be a statement about formatting rather than about
 * content.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
} from 'node:crypto';

import { CURRENT_PUBLISHER_KEY_ID, PUBLISHER_KEYS } from './publisher-key.mjs';
import { errorText, isPlainObject } from './packs-format.mjs';

// ---------------------------------------------------------------------------
// Canonical JSON — what a signature is actually over
// ---------------------------------------------------------------------------

/**
 * A value as ONE string, whatever order its keys arrived in.
 *
 * A signature over `JSON.stringify(doc)` would be a signature over whichever
 * key order the producer's parser happened to emit, so a pack that survived a
 * round trip through any tool that re-orders keys — a formatter, a CDN that
 * re-serialises JSON, a human editing it — would stop verifying while being
 * byte-for-byte the same document. So: object keys sorted, arrays in order,
 * no whitespace, and nothing else.
 *
 * Refuses what JSON cannot round-trip rather than silently dropping it:
 * `undefined`, a function, a non-finite number and a cycle are all errors, not
 * omissions, because an omission would mean signing a document that is not the
 * one on disk.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  /** @param {unknown} v @param {Set<any>} seen @param {string} where */
  const walk = (v, seen, where) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'number') {
      if (!Number.isFinite(v)) throw new Error(`${where} is not a finite number`);
      return JSON.stringify(v);
    }
    if (t === 'string' || t === 'boolean') return JSON.stringify(v);
    if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
      throw new Error(`${where} is a ${t}, which cannot be signed`);
    }
    if (seen.has(v)) throw new Error(`${where} is a cycle`);
    seen.add(v);
    let out;
    if (Array.isArray(v)) {
      out = `[${v.map((x, i) => walk(x, seen, `${where}[${i}]`)).join(',')}]`;
    } else {
      const keys = Object.keys(/** @type {any} */ (v)).sort();
      out = `{${keys
        .map(
          (k) => `${JSON.stringify(k)}:${walk(/** @type {any} */ (v)[k], seen, `${where}.${k}`)}`,
        )
        .join(',')}}`;
    }
    seen.delete(v);
    return out;
  };
  return walk(value, new Set(), 'the document');
}

/**
 * The bytes a pack's signature covers: the whole document except its own
 * `signature` block, canonicalised.
 * @param {any} doc
 * @returns {Buffer}
 */
export function signedBytes(doc) {
  const { signature: _ignored, ...rest } = isPlainObject(doc) ? doc : {};
  return Buffer.from(canonicalJson(rest), 'utf8');
}

// ---------------------------------------------------------------------------
// Signing and verifying
// ---------------------------------------------------------------------------

/** A short, comparable fingerprint of a public key. Same shape as WP-48's. */
export function keyFingerprint(publicKeyPem) {
  return createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Sign an unsigned pack document.
 *
 * The signature block carries a key ID and a fingerprint so a refusal can say
 * WHICH key a pack wanted, which is the difference between "this is not ours"
 * and "your DeckHQ is too old to know this key".
 *
 * @param {any} doc a pack document, with or without a stale `signature`
 * @param {string} privateKeyPem  PKCS#8 PEM of an Ed25519 private key
 * @param {{keyId?:string, now?:number}} [meta]
 * @returns {any} the same document with a fresh `signature`
 */
export function signPack(doc, privateKeyPem, meta = {}) {
  const { signature: _drop, ...rest } = isPlainObject(doc) ? doc : {};
  const bytes = Buffer.from(canonicalJson(rest), 'utf8');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(
      `the signing key is ${key.asymmetricKeyType}, and a pack is signed with ed25519`,
    );
  }
  const publicKeyPem = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
  return {
    ...rest,
    signature: {
      alg: 'ed25519',
      keyId: meta.keyId || CURRENT_PUBLISHER_KEY_ID,
      fingerprint: keyFingerprint(publicKeyPem),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sig: cryptoSign(null, bytes, key).toString('base64'),
      signedAt: meta.now ?? Date.now(),
    },
  };
}

/**
 * Is this document signed by a key this build trusts?
 *
 * Returns a result rather than throwing, because every caller has something
 * better to do with the reason: the CLI prints one line, the loader skips the
 * pack and logs it, and the test suite asserts on it.
 *
 * @param {any} doc
 * @param {{keys?:ReadonlyArray<{id:string,pem:string,retired?:boolean}>}} [opts]
 * @returns {{ok:true, keyId:string, retired:boolean} | {ok:false, error:string}}
 */
export function verifyPackSignature(doc, opts = {}) {
  const keys = opts.keys || PUBLISHER_KEYS;
  if (!isPlainObject(doc)) return { ok: false, error: 'that is not a pack document' };
  const sig = doc.signature;
  if (!isPlainObject(sig)) {
    return {
      ok: false,
      error: 'this pack is not signed. DeckHQ only loads packs signed by its publisher key.',
    };
  }
  if (sig.alg !== 'ed25519') {
    return { ok: false, error: `unknown signature algorithm ${JSON.stringify(sig.alg)}` };
  }
  if (typeof sig.sig !== 'string' || !sig.sig) {
    return { ok: false, error: 'the signature block carries no signature' };
  }

  let bytes;
  try {
    bytes = signedBytes(doc);
  } catch (err) {
    return { ok: false, error: `this pack cannot be canonicalised: ${errorText(err)}` };
  }

  // The digest is a courtesy, not the check: it turns "the signature does not
  // match" into "the file was edited after it was signed" for the common case.
  if (typeof sig.sha256 === 'string') {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== sig.sha256) {
      return { ok: false, error: 'this pack has been edited since it was signed' };
    }
  }

  let raw;
  try {
    raw = Buffer.from(sig.sig, 'base64');
  } catch {
    return { ok: false, error: 'the signature is not base64' };
  }

  for (const key of keys) {
    let ok = false;
    try {
      ok = cryptoVerify(null, bytes, createPublicKey(key.pem), raw);
    } catch {
      ok = false;
    }
    if (ok) return { ok: true, keyId: key.id, retired: key.retired === true };
  }

  const wanted = typeof sig.keyId === 'string' ? sig.keyId : '(unnamed)';
  const known = keys.map((k) => k.id).join(', ');
  return {
    ok: false,
    error:
      `this pack's signature does not match any DeckHQ publisher key. ` +
      `It names key "${wanted}"; this build knows ${known}.`,
  };
}
