#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startPagesSiteStaticServer } from './lib/pages-site-static-server.mjs';

// Serves one built Cloudflare Pages site directory, honouring its `_headers`
// and `_redirects`, for the browser suites that exercise deployed-origin
// behaviour without a Cloudflare emulator in the loop.

const USAGE = 'Usage: node scripts/serve-pages-site.mjs <site-directory> [--host 127.0.0.1] [--port 0]';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		host: { type: 'string', default: '127.0.0.1' },
		port: { type: 'string', default: '0' },
	},
});
const port = Number(values.port);
if (positionals.length !== 1 || !Number.isInteger(port) || port < 0 || port > 65_535) {
	console.error(USAGE);
	process.exit(2);
}

const server = await startPagesSiteStaticServer({ root: resolve(positionals[0]), host: values.host, port });
console.log(`Serving ${positionals[0]} at ${server.baseURL}`);
const stop = () => {
	server.close().finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
