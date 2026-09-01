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

/**
 * The opener policy each cross-origin transfer document receives, and no other
 * document may. Both builds emit these two paths: a project crosses between
 * soundscaper.org and framescaper.org, so each origin serves its own pair.
 */
const TRANSFER_OPENER_POLICIES = Object.freeze({
	'/transfer/send/': 'same-origin-allow-popups',
	'/transfer/receive/': 'unsafe-none',
});

test('the Soundscaper build assigns exactly one product- and route-specific document capture policy', async () => {
	const rules = parseHeaderRules(await productHeaders('soundscaper'));
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	assert.deepEqual(policyRules.map(({ pattern }) => pattern), [
		'/', '/:locale/', '/embed/:locale/', '/privacy/:locale/', '/docs/*',
	]);
	assertExactPolicies(rules, [
		['/', SOUNDSCAPER_POLICY],
		['/en/', SOUNDSCAPER_POLICY],
		['/embed/en/', SOUNDSCAPER_POLICY],
		['/privacy/en/', EMBEDDED_FRAMESCAPER_POLICY],
	], ['/docs/*']);
	assert.deepEqual(workerRules(rules), [['/service-worker.js', '/']]);
	assert.equal(rules.some(({ pattern }) => pattern.startsWith('/framescaper/')), false);
});

/**
 * The handbook index is one path segment deep, so the product's own
 * `/:locale/` rule matches it. Cloudflare joins same-name headers from every
 * matching rule, and a document that receives two `Permissions-Policy` values
 * or two `Cache-Control` values has an unusable one of each.
 */
test('the handbook receives exactly one capture and cache policy on the origin that hosts it', async () => {
	const rules = parseHeaderRules(await productHeaders('soundscaper'));
	// The index is the collision: `/:locale/` matches `/docs/` and nothing
	// deeper, so a handbook rule that set without detaching would leave the
	// index alone carrying two of each header.
	for (const path of ['/docs/', '/docs/soundscaper/first-project/']) {
		assert.deepEqual(effectiveHeader(rules, path, 'permissions-policy'), [EMBEDDED_FRAMESCAPER_POLICY], path);
		assert.deepEqual(effectiveHeader(rules, path, 'cache-control'), ['no-cache'], path);
	}
	const asset = '/docs/_astro/page.BQqJ0Ynq.js';
	assert.deepEqual(effectiveHeader(rules, asset, 'permissions-policy'), [EMBEDDED_FRAMESCAPER_POLICY]);
	assert.deepEqual(effectiveHeader(rules, asset, 'cache-control'), ['public, max-age=31536000, immutable']);
	// The handbook never weakens the isolation every response on the origin shares.
	assert.deepEqual(effectiveHeader(rules, '/docs/', 'cross-origin-opener-policy'), [ISOLATION[
		'cross-origin-opener-policy'
	]]);
	assert.deepEqual(effectiveHeader(rules, '/docs/', 'cross-origin-embedder-policy'), [ISOLATION[
		'cross-origin-embedder-policy'
	]]);
});

test('the Framescaper build hosts no handbook and emits no rule for one', async () => {
	const rules = parseHeaderRules(await productHeaders('framescaper'));
	assert.equal(rules.some(({ pattern }) => pattern.startsWith('/docs/')), false);
	assert.deepEqual(webBuildRouting({ SCAPE_PRODUCT: 'framescaper' }).handbook, null);
});

test('the Framescaper build moves the same capture policies to its own origin root', async () => {
	const rules = parseHeaderRules(await productHeaders('framescaper'));
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	assert.deepEqual(policyRules.map(({ pattern }) => pattern), [
		'/', '/:locale/', '/embed/:locale/', '/privacy/:locale/',
	]);
	assertExactPolicies(rules, [
		['/', FRAMESCAPER_POLICY],
		['/en/', FRAMESCAPER_POLICY],
		['/de/', FRAMESCAPER_POLICY],
		['/embed/en/', EMBEDDED_FRAMESCAPER_POLICY],
		['/privacy/en/', EMBEDDED_FRAMESCAPER_POLICY],
	]);
	assert.deepEqual(workerRules(rules), [['/service-worker.js', '/']]);
	assert.equal(rules.some(({ pattern }) => pattern.startsWith('/framescaper/')), false);
});

test('a Windows CRLF checkout composes the same deterministic product headers as LF', async () => {
	const checkedIn = await readFile('public/_headers', 'utf8');
	const lf = checkedIn.replace(/\r?\n/gu, '\n');
	const crlf = lf.replace(/\n/gu, '\r\n');
	for (const productId of ['soundscaper', 'framescaper']) {
		const routing = webBuildRouting({ SCAPE_PRODUCT: productId });
		assert.equal(composeProductHeaders(crlf, routing), composeProductHeaders(lf, routing), productId);
	}
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
		assertTransferDocuments(rules, productId);
	}
});

/**
 * The transfer documents are per-origin, not per-product: both composed files
 * carry them, each with exactly one relaxed opener policy reached by detaching
 * the shared one first, and each still credentialless.
 */
function assertTransferDocuments(rules, productId) {
	for (const [path, expected] of Object.entries(TRANSFER_OPENER_POLICIES)) {
		const own = rules.filter(({ pattern }) => pattern === path);
		assert.equal(own.length, 1, `${productId} must carry ${path} exactly once`);
		assert.deepEqual([...own[0].detached], ['cross-origin-opener-policy'], `${productId} ${path} detach`);
		assert.deepEqual(joinedHeader(rules, path, 'cross-origin-opener-policy'), [expected], `${productId} ${path}`);
		assert.deepEqual(
			joinedHeader(rules, path, 'cross-origin-embedder-policy'),
			['credentialless'],
			`${productId} ${path} Cross-Origin-Embedder-Policy`,
		);
		assert.equal(own[0].headers.has('permissions-policy'), false, `${productId} ${path} capture policy`);
	}
	// Only those two documents name an opener policy of their own; every other
	// rule inherits the wildcard's same-origin by saying nothing.
	assert.deepEqual(
		rules
			.filter(({ headers, pattern }) => pattern !== '/*' && headers.has('cross-origin-opener-policy'))
			.map(({ pattern }) => pattern)
			.sort(),
		Object.keys(TRANSFER_OPENER_POLICIES).sort(),
		`${productId} opener-policy owners`,
	);
}

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

function assertExactPolicies(rules, expectations, detaching = []) {
	const policyRules = rules.filter(({ headers }) => headers.has('permissions-policy'));
	for (const [path, expected] of expectations) {
		const matched = policyRules.filter(({ pattern }) => matches(pattern, path));
		assert.equal(matched.length, 1, `${path} must not receive comma-joined policies`);
		assert.equal(matched[0].headers.get('permissions-policy'), expected, path);
	}
	assert.equal(policyRules.some(({ pattern }) => pattern === '/*'), false);
	assert.equal(policyRules.filter(({ pattern }) => matches(pattern, '/assets/editor.js')).length, 0);
	// The substituted document rules are the only thing that decides what a
	// document may capture, and only the handbook - whose index a locale rule
	// also matches - is allowed to replace what one of them set. Every other
	// path must reach its policy by matching a single rule.
	assert.deepEqual(
		rules.filter(({ detached }) => detached.has('permissions-policy')).map(({ pattern }) => pattern),
		detaching,
	);
}

/**
 * Applies Cloudflare's matching to one path, independently of the composer.
 *
 * Every matching rule contributes in file order, a repeated name joins rather
 * than replaces, and `! Name` drops whatever earlier rules set. Returning the
 * list rather than a value is what lets a test say "exactly one".
 */
function effectiveHeader(rules, path, name) {
	let values = [];
	for (const rule of rules) {
		if (!matches(rule.pattern, path)) continue;
		if (rule.detached.has(name)) values = [];
		if (rule.headers.has(name)) values = [...values, rule.headers.get(name)];
	}
	return values;
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
		// Cloudflare's detach form, `! Header-Name`, carries no value and no
		// colon. The two transfer documents use it to drop the wildcard opener
		// policy before naming their own; nothing else in either composed file
		// detaches anything, so recording the name is enough to keep this parser
		// honest about lines it has seen.
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
		segment.startsWith(':') ? '[^/]+' : segment.split('*').map(escapeRegExp).join('.*')
	)).join('/');
	return new RegExp(`^${expression}$`, 'u').test(path);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
