/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOUNDSCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()';
const FRAMESCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';
const EMBEDDED_FRAMESCAPER_POLICY =
	'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()';

test('Pages assigns exactly one product- and route-specific document capture policy', async () => {
	const rules = parseHeaderRules(await readFile('public/_headers', 'utf8'));
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	assert.deepEqual(policyRules.map(({ pattern }) => pattern), [
		'/', '/:locale/', '/embed/:locale/',
		'/framescaper/:locale/', '/framescaper/embed/:locale/',
	]);
	for (const [path, expected] of [
		['/', SOUNDSCAPER_POLICY],
		['/en/', SOUNDSCAPER_POLICY],
		['/embed/en/', SOUNDSCAPER_POLICY],
		['/framescaper/en/', FRAMESCAPER_POLICY],
		['/framescaper/embed/en/', EMBEDDED_FRAMESCAPER_POLICY],
	]) {
		const matched = policyRules.filter(({ pattern }) => matches(pattern, path));
		assert.equal(matched.length, 1, `${path} must not receive comma-joined policies`);
		assert.equal(matched[0].headers.get('permissions-policy'), expected);
	}
	assert.equal(policyRules.some(({ pattern }) => pattern === '/*'), false);
	assert.equal(policyRules.filter(({ pattern }) => matches(pattern, '/assets/editor.js')).length, 0);
	// And nothing in the file detaches a capture policy on the way past: these
	// five rules are the only thing that decides what a document may capture.
	assert.deepEqual(
		rules.filter(({ detached }) => detached.has('permissions-policy')).map(({ pattern }) => pattern),
		[],
	);
});

function parseHeaderRules(value) {
	const rules = [];
	let current = null;
	for (const rawLine of value.split(/\r?\n/u)) {
		const line = rawLine.trimEnd();
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		if (!/^\s/u.test(rawLine)) {
			current = { pattern: line, headers: new Map(), detached: new Set() };
			rules.push(current);
			continue;
		}
		// Cloudflare's detach form, `! Header-Name`, carries no value and no
		// colon. The two transfer documents use it to drop the wildcard opener
		// policy before naming their own; nothing here detaches a permissions
		// policy, so recording the name is enough to keep this parser honest
		// about lines it has seen.
		const detach = /^\s+!\s*([A-Za-z0-9-]+)\s*$/u.exec(rawLine);
		if (detach) {
			assert.ok(current, `invalid _headers line: ${rawLine}`);
			current.detached.add(detach[1].toLowerCase());
			continue;
		}
		const match = /^\s+([^:]+):\s*(.*)$/u.exec(rawLine);
		assert.ok(current && match, `invalid _headers line: ${rawLine}`);
		const name = match[1].trim().toLowerCase();
		assert.equal(current.headers.has(name), false, `${current.pattern} repeats ${name}`);
		current.headers.set(name, match[2]);
	}
	return rules;
}

function matches(pattern, path) {
	const expression = pattern.split('/').map((segment) => (
		segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)
	)).join('/');
	return new RegExp(`^${expression}$`, 'u').test(path);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
