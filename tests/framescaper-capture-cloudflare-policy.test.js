/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { composeProductHeaders, webBuildRouting } from '../scripts/lib/product-web-routing.mjs';

const SOUNDSCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()';
const FRAMESCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';
const EMBEDDED_FRAMESCAPER_POLICY =
	'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()';
const ISOLATION = Object.freeze({
	'cross-origin-opener-policy': 'same-origin',
	'cross-origin-embedder-policy': 'credentialless',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'x-content-type-options': 'nosniff',
});

test('the Soundscaper build assigns exactly one product- and route-specific document capture policy', async () => {
	const rules = parseHeaderRules(await productHeaders('soundscaper'));
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	assert.deepEqual(policyRules.map(({ pattern }) => pattern), [
		'/', '/:locale/', '/embed/:locale/',
		'/framescaper/:locale/', '/framescaper/embed/:locale/',
	]);
	assertExactPolicies(rules, [
		['/', SOUNDSCAPER_POLICY],
		['/en/', SOUNDSCAPER_POLICY],
		['/embed/en/', SOUNDSCAPER_POLICY],
		['/framescaper/en/', FRAMESCAPER_POLICY],
		['/framescaper/embed/en/', EMBEDDED_FRAMESCAPER_POLICY],
	]);
	assert.deepEqual(workerRules(rules), [
		['/service-worker.js', '/'],
		['/framescaper/service-worker.js', '/framescaper/'],
	]);
});

test('the Framescaper build moves the same capture policies to its own origin root', async () => {
	const rules = parseHeaderRules(await productHeaders('framescaper'));
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	assert.deepEqual(policyRules.map(({ pattern }) => pattern), ['/', '/:locale/', '/embed/:locale/']);
	assertExactPolicies(rules, [
		['/', FRAMESCAPER_POLICY],
		['/en/', FRAMESCAPER_POLICY],
		['/de/', FRAMESCAPER_POLICY],
		['/embed/en/', EMBEDDED_FRAMESCAPER_POLICY],
	]);
	assert.deepEqual(workerRules(rules), [['/service-worker.js', '/']]);
	assert.equal(rules.some(({ pattern }) => pattern.startsWith('/framescaper/')), false);
});

test('both builds share one unmoved cross-origin isolation rule that no document loses', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const composed = await productHeaders(productId);
		const rules = parseHeaderRules(composed);
		const isolation = rules.filter(({ pattern }) => pattern === '/*');
		assert.equal(isolation.length, 1, `${productId} must carry the isolation rule exactly once`);
		assert.equal(rules[0], isolation[0], `${productId} must open with the isolation rule`);
		for (const [name, value] of Object.entries(ISOLATION)) {
			assert.equal(isolation[0].headers.get(name), value, `${productId} ${name}`);
		}
		assert.ok(isolation[0].headers.get('content-security-policy')?.includes("frame-ancestors 'self'"));
		assert.equal(rules.some(({ pattern }) => /:\/\//u.test(pattern)), false, `${productId} host-scoped rule`);
		for (const path of ['/', '/en/', '/embed/en/', '/assets/editor.js', '/service-worker.js']) {
			const opener = joinedHeader(rules, path, 'cross-origin-opener-policy');
			assert.deepEqual(opener, ['same-origin'], `${productId} ${path} Cross-Origin-Opener-Policy`);
			assert.deepEqual(
				joinedHeader(rules, path, 'cross-origin-embedder-policy'),
				['credentialless'],
				`${productId} ${path} Cross-Origin-Embedder-Policy`,
			);
		}
	}
});

test('a relaxed Cross-Origin-Opener-Policy is refused unless the shared rule is detached first', async () => {
	const shared = await readFile('public/_headers', 'utf8');
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const detached = shared.replace(
		'/offline-shell.json\n',
		'/transfer/\n\t! Cross-Origin-Opener-Policy\n\tCross-Origin-Opener-Policy: same-origin-allow-popups\n\n/offline-shell.json\n',
	);
	const rules = parseHeaderRules(composeProductHeaders(detached, routing));
	assert.deepEqual(joinedHeader(rules, '/transfer/', 'cross-origin-opener-policy'), ['same-origin-allow-popups']);
	assert.deepEqual(joinedHeader(rules, '/en/', 'cross-origin-opener-policy'), ['same-origin']);

	const joined = shared.replace(
		'/offline-shell.json\n',
		'/transfer/\n\tCross-Origin-Opener-Policy: same-origin-allow-popups\n\n/offline-shell.json\n',
	);
	assert.throws(
		() => composeProductHeaders(joined, routing),
		/relaxes Cross-Origin-Opener-Policy without detaching it/u,
	);
});

test('a header template that fixes a per-product rule is refused', async () => {
	const shared = await readFile('public/_headers', 'utf8');
	assert.throws(
		() => composeProductHeaders(
			shared.replace('/offline-shell.json\n', `/en/\n\tPermissions-Policy: ${SOUNDSCAPER_POLICY}\n\n/offline-shell.json\n`),
			webBuildRouting({ SCAPE_PRODUCT: 'framescaper' }),
		),
		/must not fix the per-product permissions-policy/u,
	);
	assert.throws(
		() => composeProductHeaders(shared.replace('# @product-worker-rules@\n', ''), webBuildRouting({})),
		/must carry # @product-worker-rules@ exactly once/u,
	);
});

async function productHeaders(productId) {
	return composeProductHeaders(
		await readFile('public/_headers', 'utf8'),
		webBuildRouting({ SCAPE_PRODUCT: productId }),
	);
}

function assertExactPolicies(rules, expectations) {
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	for (const [path, expected] of expectations) {
		const matched = policyRules.filter(({ pattern }) => matches(pattern, path));
		assert.equal(matched.length, 1, `${path} must not receive comma-joined policies`);
		assert.equal(matched[0].headers.get('permissions-policy'), expected, path);
	}
	assert.equal(policyRules.some(({ pattern }) => pattern === '/*'), false);
	assert.equal(policyRules.filter(({ pattern }) => matches(pattern, '/assets/editor.js')).length, 0);
}

function workerRules(rules) {
	return rules
		.filter(({ headers }) => headers.has('service-worker-allowed'))
		.map(({ pattern, headers }) => {
			assert.equal(headers.get('cache-control'), 'no-store', pattern);
			return [pattern, headers.get('service-worker-allowed')];
		});
}

function joinedHeader(rules, path, name) {
	const values = [];
	for (const rule of rules) {
		if (!matches(rule.pattern, path)) continue;
		if (rule.detached.has(name)) values.length = 0;
		if (rule.headers.has(name)) values.push(rule.headers.get(name));
	}
	return values;
}

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
		const removal = /^\s+!\s*([^:\s]+)\s*$/u.exec(rawLine);
		if (removal) {
			assert.ok(current, `invalid _headers line: ${rawLine}`);
			current.detached.add(removal[1].trim().toLowerCase());
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
		segment.startsWith(':') ? '[^/]+' : segment.split('*').map(escapeRegExp).join('.*')
	)).join('/');
	return new RegExp(`^${expression}$`, 'u').test(path);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
