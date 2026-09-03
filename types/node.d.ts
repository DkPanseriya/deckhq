/**
 * The Node and VS Code platform surface, written by hand for `tsc --checkJs`.
 *
 * DeckHQ ships zero runtime dependencies, and WP-22 was allowed exactly one
 * dev dependency: `typescript`. `@types/node` and `@types/vscode` are not in
 * that budget, so the two host platforms are DECLARED here rather than
 * installed. Everything below is `any` on purpose. The point of the gate is to
 * check DeckHQ's own JSDoc against DeckHQ's own code; re-checking a standard
 * library nobody here wrote is not what `01-AUDIT.md` F21 asked for.
 *
 * The cost, stated so nobody discovers it later: a wrong argument to
 * `fs.readFileSync`, a misspelt `process.env` key, or a `vscode` API that does
 * not exist is NOT caught. Only what this repository declares about itself is.
 *
 * Only the specifiers and members the repository actually imports are listed —
 * deliberately, so this stays a list of what is used rather than a second-hand
 * copy of two SDKs. A new Node import needs a line here. If the dependency
 * budget ever opens, deleting this file and putting `"node"` back in `types`
 * in `tsconfig.json` is the whole migration.
 *
 * This file is loaded by the ROOT `tsconfig.json` only. `public/tsconfig.json`
 * loads `browser.d.ts` instead, so a Node global reached for from `public/` is
 * an error rather than a silent pass — which is the point of the split.
 */

declare module 'node:fs' {
  export type FSWatcher = any;
  export const constants: any;
  export const promises: any;
  export const accessSync: any;
  export const statSync: any;
  export const existsSync: any;
  export const createReadStream: any;
  export const mkdirSync: any;
  export const readFileSync: any;
  export const writeFileSync: any;
  export const readdirSync: any;
  const fs: any;
  export default fs;
}

declare module 'node:fs/promises' {
  export type FileHandle = any;
  export const mkdir: any;
  export const stat: any;
  export const open: any;
  export const readFile: any;
  const fsp: any;
  export default fsp;
}

declare module 'node:http' {
  export type Server = any;
  export type ServerResponse = any;
  export type IncomingMessage = any;
  export type ClientRequest = any;
  export const createServer: any;
  export const request: any;
  export const get: any;
  const http: any;
  export default http;
}

declare module 'node:net' {
  export type AddressInfo = any;
  export type Socket = any;
  export const connect: any;
  export const createServer: any;
  const net: any;
  export default net;
}

declare module 'node:child_process' {
  export type ChildProcess = any;
  export const execFile: any;
  export const execFileSync: any;
  export const spawn: any;
  const cp: any;
  export default cp;
}

declare module 'node:url' {
  export const fileURLToPath: any;
  export const pathToFileURL: any;
  const url: any;
  export default url;
}

declare module 'node:crypto' {
  export const randomBytes: any;
  export const createHash: any;
  export const createPrivateKey: any;
  export const createPublicKey: any;
  export const generateKeyPairSync: any;
  export const sign: any;
  export const verify: any;
  const crypto: any;
  export default crypto;
}

// Imported for their default export only.
declare module 'node:path';
declare module 'node:os';
declare module 'node:process';
declare module 'node:zlib';
declare module 'node:assert';
declare module 'node:assert/strict';
declare module 'node:test';
declare module 'node:events';
declare module 'node:readline';
declare module 'node:stream';
declare module 'node:util';
declare module 'node:worker_threads';
declare module 'node:buffer';
declare module 'node:timers';
declare module 'node:timers/promises';

/**
 * The VS Code extension host API. `vscode/` is plain CommonJS loaded by the
 * editor; it is never built and never installs its own types.
 */
declare module 'vscode' {
  export type ExtensionContext = any;
  export type WebviewPanel = any;
  export type StatusBarItem = any;
  export type OutputChannel = any;
  export type Disposable = any;
  export type Uri = any;
  export const window: any;
  export const workspace: any;
  export const commands: any;
  export const extensions: any;
  export const env: any;
  export const Uri: any;
  export const ViewColumn: any;
  export const MarkdownString: any;
  export const ProgressLocation: any;
  export const StatusBarAlignment: any;
  export const EventEmitter: any;
  const vscode: any;
  export default vscode;
}

declare var process: any;
declare var Buffer: any;
/** `Buffer` is used as a type in JSDoc as well as a value. */
type Buffer = any;
declare const __dirname: string;
declare const __filename: string;
declare const module: any;
declare const exports: any;
declare function require(id: string): any;
declare function setImmediate(fn: (...args: any[]) => void, ...args: any[]): any;
declare function clearImmediate(handle: any): void;

/**
 * Node's timers return a `Timeout` object with `.unref()`, not the browser's
 * numeric handle. Declared here because `lib.dom` is deliberately absent from
 * this project, and without it `setTimeout` would come from `lib.es*` (which
 * has no timers at all) rather than resolve to the wrong platform's shape.
 */
declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearTimeout(handle: any): void;
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): any;
declare function clearInterval(handle: any): void;

/**
 * `URL`, `TextEncoder`, `fetch` and friends are globals in Node 18+ as well.
 * Declared with `var` rather than `const` so `globalThis.WebSocket` — how
 * `src/cli/chrome.mjs` feature-detects the Node 22 built-in — resolves too.
 */
declare var console: any;
declare var URL: any;
declare var URLSearchParams: any;
declare var TextEncoder: any;
declare var TextDecoder: any;
declare var fetch: any;
declare var WebSocket: any;
declare var AbortController: any;
declare var AbortSignal: any;
type AbortController = any;
type AbortSignal = any;
declare var performance: any;
declare var structuredClone: any;

/** `import.meta.url`, which every entry point in this repository reads. */
interface ImportMeta {
  url: string;
  dirname?: string;
  filename?: string;
  resolve?(specifier: string, parent?: string): string;
}

/**
 * The DOM names that leak into this project, and only those.
 *
 * Three `public/` modules are reachable from the Node side — `identity.mjs`
 * imports `public/names.js` for the name pool, and `scripts/demo-floor.mjs`
 * imports `public/postcard.js`, which in turn imports `public/snapshot.js`.
 * TypeScript checks whatever an import reaches, so those files are in this
 * program whether or not they are in `include`.
 *
 * They are checked FOR REAL by `public/tsconfig.json`, which has the DOM libs.
 * Here they only need to resolve. The cost is that a Node file reaching for
 * `document` types as `any` instead of failing; the boundary is still enforced
 * in the direction that matters, since `public/` has no Node globals at all.
 */
declare var document: any;
declare var getComputedStyle: any;
declare var atob: any;
type Document = any;
type HTMLCanvasElement = any;
type CanvasRenderingContext2D = any;

declare namespace NodeJS {
  type Timeout = any;
  type Immediate = any;
  type Platform = string;
  type ErrnoException = any;
  type ProcessEnv = Record<string, string | undefined>;
  type Process = any;
  type ReadableStream = any;
  type WritableStream = any;
}
