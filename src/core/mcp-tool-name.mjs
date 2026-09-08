/**
 * MCP tool ids as the Node side sees them — WP-64.
 *
 * The implementation is `public/mcp-tool-name.js`, and this file re-exports
 * it. Same direction and same reason as `src/core/themes.mjs`, which imports
 * `public/render/themes.js`: the label is drawn on the floor, `public/` may
 * never import from `src/` (`docs/DEVIATIONS.md` §122), and one copy of a
 * parsing rule is the only number of copies worth having.
 *
 * Everything here is pure. Nothing in this module reads a file, spawns
 * anything or knows which runtime produced the id it was handed.
 */

import {
  LABEL_JOIN,
  MCP_PREFIX,
  MCP_SEP,
  displayServer,
  humaniseToolSummary,
  isMcpToolName,
  mcpToolLabel,
  parseMcpToolName,
} from '../../public/mcp-tool-name.js';

export {
  LABEL_JOIN,
  MCP_PREFIX,
  MCP_SEP,
  displayServer,
  humaniseToolSummary,
  isMcpToolName,
  mcpToolLabel,
  parseMcpToolName,
};
