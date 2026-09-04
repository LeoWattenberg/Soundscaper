/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const authoredHeadersFile = resolve(repositoryRoot, 'public', '_headers');

/**
 * The response headers the deployed site sends for every path.
 *
 * `public/_headers` is a Cloudflare Pages artifact, so nothing serves it during
 * development or in the Playwright suite: `vite preview` treats it as a static
 * file. That left the browser suite running a production build under no content
 * security policy and no cross-origin isolation at all, which is exactly the
 * configuration in which a policy regression cannot be caught. Reading the
 * authored file rather than restating it is what keeps the preview server and
 * the deployment from drifting apart.
 *
 * Only the wildcard rule is returned. The per-path rules that follow it exist to
 * detach the opener policy from two cross-origin transfer documents, and those
 * are exercised against a real Pages server instead.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseWildcardResponseHeaders(text) {
	if (typeof text !== 'string') throw new TypeError('Response headers must be text.');
	const headers = {};
	let inWildcardRule = false;
	for (const line of text.split(/\r\n?|\n/)) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		if (!/^\s/u.test(line)) {
			inWildcardRule = line.trim() === '/*';
			continue;
		}
		if (!inWildcardRule) continue;
		const separator = line.indexOf(':');
		if (separator < 0) continue;
		const name = line.slice(0, separator).trim();
		// A leading "!" detaches an inherited header rather than setting one.
		if (!name || name.startsWith('!')) continue;
		headers[name] = line.slice(separator + 1).trim();
	}
	if (!headers['Content-Security-Policy']) {
		throw new Error('The wildcard response rule carries no Content-Security-Policy.');
	}
	return headers;
}

/** The wildcard rule as authored in `public/_headers`. */
export function authoredWildcardResponseHeaders() {
	return parseWildcardResponseHeaders(readFileSync(authoredHeadersFile, 'utf8'));
}
