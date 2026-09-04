/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	authoredWildcardResponseHeaders,
	parseWildcardResponseHeaders,
} from '../scripts/lib/static-response-headers.mjs';
import { securityHeaders } from '../desktop/protocol.js';

const directives = (policy) => new Map(policy
	.split(';')
	.map((directive) => directive.trim().split(/\s+/u))
	.filter(([name]) => name)
	.map(([name, ...sources]) => [name, sources]));

test('the wildcard rule is read, and the per-path rules that follow it are not', () => {
	const headers = parseWildcardResponseHeaders([
		'# a comment',
		'/*',
		'\tContent-Security-Policy: default-src \'self\'',
		'\tCross-Origin-Opener-Policy: same-origin',
		'',
		'/transfer/send/',
		'\t! Cross-Origin-Opener-Policy',
		'\tCross-Origin-Opener-Policy: same-origin-allow-popups',
		'\tCache-Control: no-cache',
	].join('\n'));

	assert.deepEqual(headers, {
		'Content-Security-Policy': "default-src 'self'",
		'Cross-Origin-Opener-Policy': 'same-origin',
	});
	assert.throws(() => parseWildcardResponseHeaders('/*\n\tX-Content-Type-Options: nosniff\n'),
		/no Content-Security-Policy/u);
});

test('both shipped policies keep the shape a sandboxed macro worker depends on', () => {
	// A macro runs as a worker built from a blob: URL, because there is no way to
	// evaluate a string of source without 'unsafe-eval'. Both halves of that are
	// load-bearing, and neither is visible from the sandbox's own code — so they
	// are pinned here. A future policy edit that grants 'unsafe-eval' or drops
	// blob: workers has to come past this test and say why.
	for (const [shell, policy] of [
		['web', authoredWildcardResponseHeaders()['Content-Security-Policy']],
		['desktop', securityHeaders({ html: '' })['Content-Security-Policy']],
	]) {
		const parsed = directives(policy);
		assert.ok(parsed.get('worker-src')?.includes('blob:'),
			`${shell} must allow a blob: worker`);
		for (const [name, sources] of parsed) {
			assert.ok(!sources.includes("'unsafe-eval'"),
				`${shell} must not grant 'unsafe-eval' (found in ${name})`);
		}
		assert.deepEqual(parsed.get('object-src'), ["'none'"], `${shell} must forbid plugins`);
	}
});

test('the desktop shell reaches no network beyond its own origin', () => {
	// The web worker inherits connect-src from the document and keeps the two
	// first-party CDNs; the desktop one has nowhere to go at all. That asymmetry
	// is recorded in the threat model, so it is pinned rather than assumed.
	assert.deepEqual(
		directives(securityHeaders({ html: '' })['Content-Security-Policy']).get('connect-src'),
		["'self'", 'blob:'],
	);
	const web = directives(authoredWildcardResponseHeaders()['Content-Security-Policy']).get('connect-src');
	assert.ok(web.includes("'self'"));
	assert.ok(web.every((source) => source === "'self'" || source.startsWith('https://')),
		'the web policy must not widen connect-src beyond first-party https origins');
});
