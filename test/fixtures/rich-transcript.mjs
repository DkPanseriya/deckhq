/**
 * A Claude Code session that says everything a real one says (WP-100).
 *
 * The panel's transcript was audited against what a reply actually contains,
 * and this is the transcript it was audited WITH: one case per thing, named,
 * so a test can render one of them and a person can open the whole session in
 * a panel and look. `test/unit/markdown.test.mjs` and
 * `test/unit/panel-transcript.test.mjs` assert on the cases;
 * `richTranscript()` is the same content as the JSONL records Claude Code
 * writes, in the shapes read off real transcripts — `thinking`, `tool_use`,
 * `tool_result` (string and block-array forms), an image block, and a
 * sub-agent's hand-back.
 *
 * Nothing in here is a real project, path or person.
 */

/** One markdown case per construct. The key is the audit's row name. */
export const CASES = {
  headings: [
    '# What I found',
    '',
    'The renderer is two passes.',
    '',
    '## The parser',
    '',
    'It never touches the DOM.',
    '',
    '### Inline rules',
    '',
    'Code spans win.',
    '',
    '#### A fourth level',
    '',
    'Rare, but it happens.',
  ].join('\n'),

  nestedLists: [
    'Three things to fix:',
    '',
    '1. The table case',
    '   - header row',
    '   - alignment row',
    '     - `:---`, `:---:` and `---:`',
    '   - body rows',
    '2. Task lists',
    '',
    '   A paragraph that belongs to item two.',
    '',
    '3. Links',
    '',
    '- loose item one',
    '',
    '- loose item two',
  ].join('\n'),

  table: [
    '| File | Lines | Status |',
    '| :--- | ---: | :---: |',
    '| `public/markdown.js` | 341 | **changed** |',
    '| `public/panel-said.js` | 156 | changed |',
    '| a \\| piped cell | 0 | — |',
  ].join('\n'),

  codeFence: [
    'Here is the fix:',
    '',
    '```js',
    'export function renderMarkdown(text, doc = document) {',
    "  const root = doc.createElement('div'); // a very long line that has to scroll sideways rather than wrap, because wrapped code is not code",
    '  return root;',
    '}',
    '```',
    '',
    '```diff',
    '- const a = 1;',
    '+ const a = 2;',
    '```',
    '',
    '```',
    'no language on this one',
    '```',
  ].join('\n'),

  inline:
    'Use `renderMarkdown()` with **care**, *never* `innerHTML`, and ~~not~~ this. A snake_case_name stays literal.',

  links: [
    'See [the manual](https://example.com/docs/guide#panel) and https://example.com/bare?x=1.',
    'The floor is at [the daemon](http://127.0.0.1:4317/) and mail is [here](mailto:someone@example.com).',
    'A relative one: [the guide](docs/GUIDE.md), and a hostile one: [click me](javascript:alert(1)).',
  ].join('\n'),

  quote: [
    '> The owner said:',
    '> one click and you are back.',
    '>',
    '> - with a list',
    '> - inside',
  ].join('\n'),

  tasks: ['- [x] headings', '- [x] nested lists', '- [ ] tables', '- [ ] voice input (later)'].join(
    '\n',
  ),

  fileRefs: [
    'The bug is in `public/markdown.js:199` and the caller is public/panel-said.js:107.',
    'A range: src/core/editor.mjs:10-20. An absolute one: C:\\Dk\\app\\src\\index.ts:7.',
    'Not a reference: 12:30 on the clock, and version 2.1:3.',
  ].join('\n'),

  image:
    'The rendered floor:\n\n![the floor at 1600 px](https://example.com/floor.png)\n\nand a local one ![crop](./shots/crop.png).',

  html: [
    'Raw HTML must stay text:',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror="alert(1)">',
    '',
    '<details><summary>open</summary>hidden</details>',
    '',
    '<a href="javascript:alert(1)" onclick="alert(2)">a link</a>',
  ].join('\n'),

  artifact:
    'I published the report as an artifact: https://claude.ai/code/artifact/0b5c1c1e-0000-4000-8000-000000000000 — open it in the session.',
};

/** The last thing the agent said: every case, in the order a reply has them. */
export const REPLY = [
  CASES.headings,
  CASES.nestedLists,
  CASES.table,
  CASES.codeFence,
  CASES.inline,
  CASES.links,
  CASES.quote,
  '---',
  CASES.tasks,
  CASES.fileRefs,
  CASES.image,
  CASES.html,
  CASES.artifact,
].join('\n\n');

/** A long tool result: what `npm test` prints. */
export const LONG_OUTPUT = Array.from(
  { length: 240 },
  (_, i) => `ok ${i + 1} - test/unit/case-${String(i + 1).padStart(3, '0')}.test.mjs`,
).join('\n');

/** What a sub-agent hands back to its lead. */
export const HANDBACK = [
  '## Audit of the markdown renderer',
  '',
  '- tables render as a paragraph of pipes',
  '- task lists render as `[x]` literally',
  '',
  'Agent ID: a1b2c3d4 — 14 tool calls, 38 s.',
].join('\n');

/** 1×1 transparent PNG. An image block is bytes; these are the fewest there are. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * The session, as the records Claude Code writes.
 * @param {{sessionId?:string, cwd?:string, now?:number, title?:string}} [opts]
 * @returns {object[]}
 */
export function richTranscript(opts = {}) {
  const sessionId = opts.sessionId || '55555555-5555-5555-5555-555555555555';
  const cwd = opts.cwd || '/home/dev/code/panel';
  const now = opts.now ?? Date.now();
  let n = 0;
  const at = () => new Date(now - 120_000 + n * 1000).toISOString();
  const base = () => ({
    isSidechain: false,
    cwd,
    gitBranch: 'main',
    sessionId,
    version: '2.1.293',
  });
  const user = (content) => ({
    ...base(),
    type: 'user',
    parentUuid: n ? `r${n}` : null,
    uuid: `r${++n}`,
    timestamp: at(),
    message: { role: 'user', content },
  });
  const assistant = (content, stop = 'tool_use') => ({
    ...base(),
    type: 'assistant',
    parentUuid: `r${n}`,
    uuid: `r${++n}`,
    timestamp: at(),
    message: {
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      stop_reason: stop,
      content,
      usage: { input_tokens: 900, output_tokens: 240 },
    },
  });
  const result = (id, content, isError = false) =>
    user([
      { type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) },
    ]);

  return [
    { type: 'custom-title', customTitle: opts.title || 'Audit the transcript', sessionId },
    user([
      { type: 'text', text: 'Audit how the panel renders a reply, then fix the worst of it.' },
    ]),
    assistant([
      {
        type: 'thinking',
        thinking: 'The renderer is in public/markdown.js. Read it before judging it.',
      },
      { type: 'text', text: 'I’ll read the renderer first.' },
      {
        type: 'tool_use',
        id: 'toolu_read',
        name: 'Read',
        input: { file_path: `${cwd}/public/markdown.js` },
      },
    ]),
    result(
      'toolu_read',
      '1\t/**\n2\t * A small block-level markdown renderer.\n3\t */\n4\texport function parseMarkdown(text) {}',
    ),
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_bash',
        name: 'Bash',
        input: { command: 'npm test', description: 'Run the unit tests' },
      },
    ]),
    result('toolu_bash', LONG_OUTPUT),
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_edit',
        name: 'Edit',
        input: {
          file_path: `${cwd}/public/markdown.js`,
          old_string: 'const HR = /^-{3,}$/;',
          new_string: 'const HR = /^ {0,3}([-*_])(?:\\s*\\1){2,}\\s*$/;',
        },
      },
    ]),
    result('toolu_edit', [
      { type: 'text', text: `The file ${cwd}/public/markdown.js has been updated.` },
    ]),
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_grep',
        name: 'Grep',
        input: { pattern: '<script>alert(1)</script>', path: 'public' },
      },
    ]),
    result('toolu_grep', 'No matches found', true),
    assistant([
      {
        type: 'tool_use',
        id: 'toolu_task',
        name: 'Agent',
        input: {
          description: 'Audit the markdown renderer',
          subagent_type: 'Explore',
          prompt:
            'Read public/markdown.js and list what a Claude Code reply contains that it does not render.',
        },
      },
    ]),
    result('toolu_task', [{ type: 'text', text: HANDBACK }]),
    assistant(
      [{ type: 'text', text: 'Two findings so far. Do you have a picture of the panel as it is?' }],
      'end_turn',
    ),
    user([
      { type: 'text', text: 'Here is how it looks now.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PIXEL } },
    ]),
    assistant(
      [
        { type: 'thinking', thinking: 'Everything is in. Write it up with the table and the fix.' },
        { type: 'text', text: REPLY },
      ],
      'end_turn',
    ),
  ];
}

/** The same session as the text of a `.jsonl` file. */
export function richTranscriptJsonl(opts = {}) {
  return (
    richTranscript(opts)
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  );
}
