/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two transfer documents as they are actually served: which paths resolve
 * to them, what markup they carry, and what response policy Cloudflare will put
 * on them.
 *
 * The header assertions are the load-bearing half. Cloudflare joins same-name
 * headers from every matching rule, and a joined Cross-Origin-Opener-Policy is
 * not a weaker policy - it is an unparseable one, which silently drops the
 * editor out of cross-origin isolation and takes SharedArrayBuffer with it. So
 * the test walks the whole file, folds the rules the way Cloudflare does -
 * including the `! Header-Name` detach the transfer routes use - and proves that
 * every path receives exactly one COOP value, that the editor's is still
 * `same-origin`, and that the embedder policy still reaches the assets that
 * inherit it.
 *
 * "Every path" means every path, not every emitted document. A policy that is
 * only attached to the five document routes the generator happens to emit today
 * leaves everything else - a route added tomorrow, a path served by a rewrite,
 * anything the generator does not write an `index.html` for - with no opener
 * policy at all, which is `unsafe-none`. The strict value has to be the default
 * that has to be opted out of, and the two transfer documents are the only
 * things in the file entitled to opt out.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { after } from 'node:test';
import { promisify } from 'node:util';

import {
	renderTransferDocument,
	TRANSFER_PAGE_DEV_MODULE_URL,
	TRANSFER_PAGE_ENTRY_MODULE,
	TRANSFER_ROUTES,
	transferRouteForPath,
	transferRouteForRole,
} from '../src/common/transfer/transfer-routes.js';

const execFileAsync = promisify(execFile);

/**
 * Document shapes that must be among the routes the generator emits.
 *
 * A floor, not the set under test: the paths the policy assertions run over are
 * derived from the generator's own output, because a hardcoded list is exactly
 * how a product route added later would slip past the opener-policy check. These
 * five are named so that a derivation which quietly returned nothing - a fixture
 * that failed to generate, a walk that found no documents - cannot read as a
 * clean pass.
 */
const WELL_KNOWN_EDITOR_DOCUMENTS = [
	'/',
	'/en/',
	'/embed/en/',
];

/** The opener policy each transfer document must receive, and no other document may. */
const TRANSFER_OPENER_POLICIES = new Map([
	['/transfer/send/', 'same-origin-allow-popups'],
	['/transfer/receive/', 'unsafe-none'],
]);

let emittedDocuments: Promise<readonly string[]> | null = null;
let emittedRoot: string | null = null;

after(async () => {
	if (emittedRoot) await rm(emittedRoot, { recursive: true, force: true });
});

/**
 * Every document the route generator emits, as the path it is served from.
 *
 * The generator is the authority on which documents exist, and it needs no
 * bundle to say so: over a bare `index.html` fixture it still writes every
 * product, locale, embed and transfer route from the same tables the real build
 * uses. Walking that output is what keeps the header assertions honest when a
 * new product route appears - the route arrives here on its own, and the COOP
 * rule it has no match in `public/_headers` for fails the test that matters.
 */
function emittedDocumentPaths(): Promise<readonly string[]> {
	emittedDocuments ??= (async () => {
		const outputRoot = await mkdtemp(join(tmpdir(), 'scape-transfer-documents-'));
		emittedRoot = outputRoot;
		await writeIndexFixture(outputRoot);
		await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
			cwd: process.cwd(),
		});
		const paths = await collectDocumentPaths(outputRoot, outputRoot);
		for (const path of WELL_KNOWN_EDITOR_DOCUMENTS) {
			assert.ok(paths.includes(path), `the route generator no longer emits ${path}`);
		}
		return paths;
	})();
	return emittedDocuments;
}

/** Served paths of every `index.html` under `directory`, depth first. */
async function collectDocumentPaths(root: string, directory: string): Promise<string[]> {
	const paths: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			paths.push(...await collectDocumentPaths(root, join(directory, entry.name)));
			continue;
		}
		if (entry.name !== 'index.html') continue;
		const served = relative(root, directory).replaceAll('\\', '/');
		paths.push(served ? `/${served}/` : '/');
	}
	return paths.sort();
}

interface HeaderRule {
	readonly pattern: string;
	readonly headers: ReadonlyMap<string, string>;
	/** Header names this rule detaches (`! Header-Name`) before setting its own. */
	readonly detached: ReadonlySet<string>;
}

test('the transfer routes resolve from their own paths and nothing else', () => {
	assert.deepEqual(TRANSFER_ROUTES.map(({ path }) => path), ['/transfer/send/', '/transfer/receive/']);
	assert.equal(transferRouteForPath('/transfer/send/')?.role, 'send');
	assert.equal(transferRouteForPath('/transfer/receive')?.role, 'receive');
	for (const refused of [
		'/transfer/',
		'/transfer/send/extra/',
		'/transfer/send/../receive/',
		'//transfer/send/',
		'/TRANSFER/send/',
		'transfer/send/',
		'/en/',
		'',
		null,
		undefined,
		42,
	]) {
		assert.equal(transferRouteForPath(refused as string), null, `${String(refused)} must not resolve`);
	}
});

test('a transfer document is a standalone page, not a product route', () => {
	const html = renderTransferDocument({
		role: 'send',
		moduleUrl: '/assets/transfer-page-entry-abc123.js',
		modulePreloads: ['/assets/shared-def456.js'],
		canonical: 'https://soundscaper.org/transfer/send/',
	});
	assert.match(html, /<script type="module" src="\/assets\/transfer-page-entry-abc123\.js"><\/script>/u);
	assert.match(html, /<link rel="modulepreload" href="\/assets\/shared-def456\.js" \/>/u);
	assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/u);
	assert.match(html, /<link rel="canonical" href="https:\/\/soundscaper\.org\/transfer\/send\/" \/>/u);
	// Not a product: no install metadata, no product icon, no application entry.
	assert.doesNotMatch(html, /rel="manifest"/u);
	assert.doesNotMatch(html, /data-product-install-icon|data-product-icon|apple-touch-icon/u);
	assert.doesNotMatch(html, /\/src\/main\.jsx|logo\//u);
});

test('a transfer document refuses an unknown role or an off-root module URL', () => {
	assert.throws(
		() => renderTransferDocument({ role: 'archive', moduleUrl: '/a.js' }),
		/Unknown project transfer role: archive/u,
	);
	for (const moduleUrl of ['https://cdn.example/a.js', 'a.js', '']) {
		assert.throws(
			() => renderTransferDocument({ role: 'send', moduleUrl }),
			/root-relative page module URL/u,
			`${moduleUrl} must be refused`,
		);
	}
});

test('rendered text is escaped rather than injected', () => {
	const html = renderTransferDocument({
		role: 'receive',
		moduleUrl: '/a.js',
		canonical: 'https://example.org/"><script>x()</script>',
	});
	assert.doesNotMatch(html, /<script>x\(\)/u);
	assert.match(html, /&quot;&gt;&lt;script&gt;/u);
});

test('the route generator writes both transfer pages against the built chunk', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'scape-transfer-routes-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await writeIndexFixture(outputRoot);
	await writeFile(join(outputRoot, '.offline-build-manifest.json'), JSON.stringify({
		'src/main.jsx': { file: 'assets/main-1.js', isEntry: true },
		[TRANSFER_PAGE_ENTRY_MODULE]: {
			file: 'assets/transfer-page-entry-2.js',
			isDynamicEntry: true,
			imports: ['_shared.js'],
			css: ['assets/transfer-3.css'],
		},
		'_shared.js': { file: 'assets/shared-4.js', imports: [] },
	}));
	await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
	});

	const send = await readFile(join(outputRoot, 'transfer/send/index.html'), 'utf8');
	const receive = await readFile(join(outputRoot, 'transfer/receive/index.html'), 'utf8');
	assert.match(send, /src="\/assets\/transfer-page-entry-2\.js"/u);
	assert.match(send, /<link rel="modulepreload" href="\/assets\/shared-4\.js" \/>/u);
	assert.match(send, /<link rel="stylesheet" href="\/assets\/transfer-3\.css" \/>/u);
	assert.match(send, /<title>Send projects to the other product<\/title>/u);
	assert.match(receive, /<title>Receive projects from the other product<\/title>/u);
	// The chunk must not be preloaded twice - it is already the module script.
	assert.doesNotMatch(send, /modulepreload" href="\/assets\/transfer-page-entry-2\.js"/u);
	// Generating the transfer pages must not disturb the product routes.
	const product = await readFile(join(outputRoot, 'en/index.html'), 'utf8');
	assert.match(product, /rel="manifest" href="\/manifest-soundscaper\.webmanifest"/u);
});

test('the route generator falls back to the dev module URL with no build manifest', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'scape-transfer-routes-dev-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await writeIndexFixture(outputRoot);
	await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
		cwd: process.cwd(),
	});
	const send = await readFile(join(outputRoot, 'transfer/send/index.html'), 'utf8');
	assert.match(send, new RegExp(`src="${TRANSFER_PAGE_DEV_MODULE_URL}"`, 'u'));
});

test('the route generator refuses a build whose transfer chunk went missing', async (context) => {
	const outputRoot = await mkdtemp(join(tmpdir(), 'scape-transfer-routes-missing-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	await writeIndexFixture(outputRoot);
	await writeFile(join(outputRoot, '.offline-build-manifest.json'), JSON.stringify({
		'src/main.jsx': { file: 'assets/main-1.js', isEntry: true },
	}));
	await assert.rejects(
		execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
			cwd: process.cwd(),
		}),
		(error: unknown) => {
			assert.match(String((error as { stderr?: string }).stderr), /has no chunk for/u);
			return true;
		},
	);
});

test('every document receives exactly one opener policy, and the editor keeps same-origin', async () => {
	const rules = parseHeaderRules(await composedHeaders());
	const documents = await emittedDocumentPaths();
	assert.deepEqual(
		documents.filter((path) => TRANSFER_OPENER_POLICIES.has(path)),
		[...TRANSFER_OPENER_POLICIES.keys()].sort(),
		'both transfer documents must be among the emitted routes',
	);
	for (const path of documents) {
		assert.equal(
			openerPolicyFor(rules, path),
			TRANSFER_OPENER_POLICIES.get(path) ?? 'same-origin',
			path,
		);
	}
	// And nothing in the file relaxes the policy for a path that is not one of
	// the two transfer documents.
	const relaxing = rules.filter(({ headers, pattern }) => (
		headers.get('cross-origin-opener-policy') !== undefined && pattern !== '/*'
	));
	assert.deepEqual(
		relaxing.map(({ pattern }) => pattern).sort(),
		[...TRANSFER_OPENER_POLICIES.keys()].sort(),
		'only the two transfer documents may name an opener policy of their own',
	);
});

test('a path nobody has emitted still gets the strict opener policy', async () => {
	// The regression this replaces: the wildcard COOP was moved onto the five
	// exact document rules, so every path outside that emitted set - a route
	// added later, a rewrite, an asset, `/transfer/` itself - kept
	// Cross-Origin-Embedder-Policy from `/*` and lost its opener policy
	// entirely, which is `unsafe-none`. The strict value has to be what a path
	// gets by saying nothing.
	const rules = parseHeaderRules(await composedHeaders());
	const emitted = new Set(await emittedDocumentPaths());
	for (const path of [
		'/transfer/',
		'/transfer/send/extra/',
		'/lightscaper/en/',
		'/en/manual/',
		'/assets/editor-1.js',
		'/service-worker.js',
		'/some-route-nobody-has-written-yet/',
	]) {
		assert.equal(emitted.has(path), false, `${path} must not be an emitted document`);
		assert.equal(
			openerPolicyFor(rules, path),
			'same-origin',
			`${path} inherits the strict opener policy by default, or it inherits none at all`,
		);
	}
});

test('the embedder policy that gives the editor SharedArrayBuffer is untouched', async () => {
	const rules = parseHeaderRules(await composedHeaders());
	const embedderRules = rules.filter(({ headers }) => headers.has('cross-origin-embedder-policy'));
	assert.deepEqual(embedderRules.map(({ pattern }) => pattern), ['/*']);
	assert.equal(embedderRules[0].headers.get('cross-origin-embedder-policy'), 'credentialless');
	for (const path of [...await emittedDocumentPaths(), '/assets/editor-1.js', '/service-worker.js']) {
		const matched = embedderRules.filter(({ pattern }) => matches(pattern, path));
		assert.equal(matched.length, 1, `${path} must still be credentialless`);
	}
	// The content policy that every response shares is still exactly one rule.
	const contentRules = rules.filter(({ headers }) => headers.has('content-security-policy'));
	assert.deepEqual(contentRules.map(({ pattern }) => pattern), ['/*']);
});

test('the transfer routes detach the shared policy rather than joining a second one', async () => {
	const rules = parseHeaderRules(await composedHeaders());
	for (const route of TRANSFER_ROUTES) {
		const matched = rules.filter(({ pattern }) => matches(pattern, route.path));
		assert.deepEqual(
			matched.map(({ pattern }) => pattern).sort(),
			['/*', route.path],
			`${route.path} must match only the shared rule and its own`,
		);
		const own = matched.find(({ pattern }) => pattern === route.path);
		assert.deepEqual([...own!.headers.keys()].sort(), ['cache-control', 'cross-origin-opener-policy']);
		// The detach is what makes one relaxed value possible at all: without it
		// the wildcard's `same-origin` and this route's value are joined into
		// one unparseable header, which is no policy rather than either.
		assert.deepEqual([...own!.detached], ['cross-origin-opener-policy'], route.path);
		// And it detaches only the opener policy - the embedder policy every
		// asset inherits must survive on these responses too.
		assert.deepEqual(
			effectiveHeader(rules, route.path, 'cross-origin-embedder-policy'),
			['credentialless'],
			route.path,
		);
	}
	assert.equal(transferRouteForRole('send').path, '/transfer/send/');
});

/**
 * A build output the generator can work over: the index template Vite emits and
 * the checked-in `_headers` Vite copies out of `public/`, which the generator
 * composes this build's document and worker rules into.
 */
async function writeIndexFixture(outputRoot: string): Promise<void> {
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en" dir="ltr" data-product="soundscaper">
	<head><!-- route-head --><title>Soundscaper</title></head>
	<body><div id="app"></div></body>
</html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
}

/**
 * The `_headers` this build actually deploys.
 *
 * The checked-in file is a template: `scripts/lib/product-web-routing.mjs`
 * substitutes the document and worker rules of the one product a build serves
 * into it. Only the composed result is what Cloudflare reads, so the policy
 * assertions below run over that, from the same generated root the emitted
 * document paths come from.
 */
async function composedHeaders(): Promise<string> {
	await emittedDocumentPaths();
	assert.ok(emittedRoot, 'the route generator produced no output root');
	return readFile(join(emittedRoot, '_headers'), 'utf8');
}

function parseHeaderRules(value: string): readonly HeaderRule[] {
	interface MutableRule { pattern: string; headers: Map<string, string>; detached: Set<string> }
	const rules: MutableRule[] = [];
	let current: MutableRule | null = null;
	for (const rawLine of value.split(/\r?\n/u)) {
		if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
		if (!/^\s/u.test(rawLine)) {
			current = { pattern: rawLine.trimEnd(), headers: new Map(), detached: new Set() };
			rules.push(current);
			continue;
		}
		// Cloudflare's detach form: `! Header-Name` drops whatever an earlier
		// matching rule attached, which is the only way one route can hold a
		// value that differs from a wildcard rule without joining onto it.
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

/**
 * The values one path actually receives for one header, in the order Cloudflare
 * would join them: every matching rule contributes, and a rule that detaches the
 * name first drops everything attached before it.
 *
 * More than one value is the failure this file exists to catch: for COOP the
 * joined string is not a weaker policy, it is an unparseable one.
 */
function effectiveHeader(
	rules: readonly HeaderRule[],
	path: string,
	name: string,
): readonly string[] {
	let values: string[] = [];
	for (const rule of rules) {
		if (!matches(rule.pattern, path)) continue;
		if (rule.detached.has(name)) values = [];
		const value = rule.headers.get(name);
		if (value !== undefined) values.push(value);
	}
	return values;
}

/** The one opener policy a path receives, asserting that it receives exactly one. */
function openerPolicyFor(rules: readonly HeaderRule[], path: string): string {
	const values = effectiveHeader(rules, path, 'cross-origin-opener-policy');
	assert.equal(
		values.length,
		1,
		`${path} must receive exactly one opener policy, not ${JSON.stringify(values)}`,
	);
	return values[0];
}

/** Cloudflare placeholders match one path segment; splats match the rest. */
function matches(pattern: string, path: string): boolean {
	const expression = pattern.split('*').map((part) => part.split('/').map((segment) => (
		segment.startsWith(':') ? '[^/]+' : escapeRegExp(segment)
	)).join('/')).join('.*');
	return new RegExp(`^${expression}$`, 'u').test(path);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
