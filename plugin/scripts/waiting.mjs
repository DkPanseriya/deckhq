#!/usr/bin/env node
/**
 * What `/deckhq:waiting` runs. Prints the needs-you list as plain text.
 *
 * The output goes into a model's context, not onto a terminal, so it carries
 * no ANSI and no box drawing — `deckhq waiting` is the surface for a person at
 * a prompt (WP-42), and this is the same queue said in words.
 *
 * Exits 0 whichever way it goes: a slash command whose injected command fails
 * aborts the whole invocation, and "DeckHQ is not running" is information, not
 * an error.
 */
import process from 'node:process';

import { NO_DAEMON, findDaemon, renderWaiting } from '../lib/deckhq.mjs';

const found = await findDaemon({ timeoutMs: 1500 });
process.stdout.write((found ? renderWaiting(found.snapshot) : NO_DAEMON) + '\n');
process.exitCode = 0;
