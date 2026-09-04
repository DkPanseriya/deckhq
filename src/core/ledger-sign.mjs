/**
 * The Ed25519 key that signs an export, and the two sides of the signature
 * (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: where the key pair lives, how it is
 * generated the first time, its fingerprint, and sign/verify over bytes.
 *
 * The key is generated locally, stored locally, and sent nowhere by anything
 * in this repository — `ledger.mjs`'s rule 4. Signing an export is what lets
 * a team floor merge two machines' summaries without either machine having
 * to trust the other's arithmetic.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { parseRecords } from './ledger-read.mjs';

// ---------------------------------------------------------------------------
// WP-48 — signed export
// ---------------------------------------------------------------------------

/**
 * Where the signing key lives, beside the state it describes.
 * @param {string} stateDir
 */
export function keyPaths(stateDir) {
  return {
    private: path.join(stateDir, 'ledger-key.pem'),
    public: path.join(stateDir, 'ledger-key.pub.pem'),
  };
}

/**
 * The machine's Ed25519 signing key, generated once.
 *
 * Written `0600` where the OS honours a mode — that is POSIX. On Windows the
 * mode argument is effectively ignored by the filesystem, and the file's
 * protection is whatever the user's profile directory already provides; this
 * is stated rather than papered over, and it is why the key signs a ledger
 * rather than authenticating anything.
 *
 * The key never leaves the machine. Only the PUBLIC half is written into a
 * signature sidecar, which is what makes a signed day file verifiable by a
 * team member who has never seen this machine.
 *
 * @param {string} stateDir
 * @returns {{privateKeyPem:string, publicKeyPem:string, created:boolean, mode:number|null}}
 */
export function loadOrCreateKey(stateDir) {
  const paths = keyPaths(stateDir);
  if (fs.existsSync(paths.private)) {
    const privateKeyPem = fs.readFileSync(paths.private, 'utf8');
    const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
      .export({ type: 'spki', format: 'pem' })
      .toString();
    let mode = null;
    try {
      mode = fs.statSync(paths.private).mode & 0o777;
    } catch {
      /* unknowable is fine */
    }
    return { privateKeyPem, publicKeyPem, created: false, mode };
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(paths.private, privateKeyPem, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(paths.public, publicKeyPem, { encoding: 'utf8', mode: 0o644 });
  try {
    fs.chmodSync(paths.private, 0o600);
  } catch {
    /* Windows, and anywhere else that does not do modes */
  }
  let mode = null;
  try {
    mode = fs.statSync(paths.private).mode & 0o777;
  } catch {
    /* unknowable is fine */
  }
  return { privateKeyPem, publicKeyPem, created: true, mode };
}

/** A short, comparable fingerprint of a public key. */
export function keyFingerprint(publicKeyPem) {
  return createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/**
 * The signature document written beside an exported day file.
 *
 * It carries the public key so that verification needs nothing but the two
 * files. That proves **integrity and a single signer**, not identity: anyone
 * can mint a key. A BYOS team floor pins the fingerprint it expects for each
 * machine; `deckhq ledger verify` prints it for exactly that reason.
 *
 * @param {Buffer} bytes the day file, verbatim
 * @param {{privateKeyPem:string, publicKeyPem:string}} key
 * @param {{day:string, machineId:string, now?:number}} meta
 */
export function signBytes(bytes, key, meta) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = cryptoSign(null, bytes, createPrivateKey(key.privateKeyPem)).toString('base64');
  return {
    v: 1,
    alg: 'ed25519',
    day: meta.day,
    machineId: meta.machineId,
    bytes: bytes.length,
    sha256,
    publicKey: key.publicKeyPem,
    fingerprint: keyFingerprint(key.publicKeyPem),
    signature,
    signedAt: meta.now ?? Date.now(),
  };
}

/**
 * Check a day file against its signature document.
 * @param {Buffer} bytes
 * @param {any} sig
 * @returns {{ok:boolean, reason?:string, fingerprint?:string, machineId?:string,
 *            day?:string, records?:number}}
 */
export function verifyBytes(bytes, sig) {
  if (!sig || typeof sig !== 'object')
    return { ok: false, reason: 'the signature file is not a signature' };
  if (sig.alg !== 'ed25519') return { ok: false, reason: `unknown algorithm "${sig.alg}"` };
  if (typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string') {
    return { ok: false, reason: 'the signature file is missing its key or its signature' };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (typeof sig.sha256 === 'string' && sig.sha256 !== sha256) {
    return { ok: false, reason: 'the file does not match the digest it was signed with' };
  }
  let ok = false;
  try {
    ok = cryptoVerify(
      null,
      bytes,
      createPublicKey(sig.publicKey),
      Buffer.from(sig.signature, 'base64'),
    );
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'the signature could not be checked' };
  }
  if (!ok) return { ok: false, reason: 'the signature does not match the file' };
  return {
    ok: true,
    fingerprint: keyFingerprint(sig.publicKey),
    machineId: typeof sig.machineId === 'string' ? sig.machineId : 'unknown',
    day: typeof sig.day === 'string' ? sig.day : 'unknown',
    records: parseRecords(bytes.toString('utf8')).length,
  };
}
