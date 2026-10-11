/**
 * A zip's central directory, read with nothing but `node:zlib`.
 *
 * The Windows app's build opens two archives: the pinned WebView2 NuGet
 * package (a `.nupkg` is a zip) and, in CI, the official Node zip. Both are
 * verified against a hash BEFORE this file sees them, so nothing here is a
 * security boundary; it only has to find a named entry and inflate it, and to
 * refuse loudly when the archive is not the simple kind it reads.
 *
 * Entries are inflated on demand (`read()`), because the Node zip holds a few
 * thousand files and the build wants two of them.
 */
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * @typedef {{name:string, size:number, read:() => Buffer}} ZipEntry
 */

/**
 * @param {Buffer} zip
 * @param {string} [label] what to call the archive in an error
 * @returns {ZipEntry[]} every file entry (directories are skipped)
 */
export function readZip(zip, label = 'archive') {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${label} is not a zip archive (no end-of-central-directory)`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error(`${label}: zip64 is not read`);

  /** @type {ZipEntry[]} */
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error(`${label}: bad central directory`);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    entries.push({
      name,
      size,
      read() {
        if (flags & 1) throw new Error(`${label}: ${name} is encrypted`);
        if (packed === 0xffffffff || size === 0xffffffff)
          throw new Error(`${label}: ${name} needs zip64, which is not read`);
        if (zip.readUInt32LE(local) !== LOCAL) throw new Error(`${label}: bad entry ${name}`);
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
        const raw = zip.subarray(start, start + packed);
        let bytes;
        if (method === 0) bytes = Buffer.from(raw);
        else if (method === 8) bytes = inflateRawSync(raw);
        else throw new Error(`${label}: ${name} uses compression method ${method}`);
        if (bytes.length !== size)
          throw new Error(`${label}: ${name} is ${bytes.length} bytes, not ${size}`);
        return bytes;
      },
    });
  }
  return entries;
}

/**
 * The one entry with this exact name, or a thrown error naming it.
 * @param {ZipEntry[]} entries
 * @param {string} name
 * @param {string} [label]
 * @returns {ZipEntry}
 */
export function entryNamed(entries, name, label = 'archive') {
  const found = entries.find((e) => e.name === name);
  if (!found) throw new Error(`${label} has no entry named ${name}`);
  return found;
}
