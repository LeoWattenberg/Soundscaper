/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { parseRedirectRules, startPagesSiteStaticServer } from '../scripts/lib/pages-site-static-server.mjs';
import { rawHttpRequest } from './helpers/raw-http-request.ts';

const HEADERS = [
	'/*',
	'\tCross-Origin-Opener-Policy: same-origin',
	'\tCross-Origin-Embedder-Policy: credentialless',
	'\tX-Content-Type-Options: nosniff',
	'',
	'# The sender opts out of the strict opener policy.',
	'/transfer/send/',
	'\t! Cross-Origin-Opener-Policy',
	'\tCross-Origin-Opener-Policy: same-origin-allow-popups',
	'',
	'/:locale/',
	'\tPermissions-Policy: microphone=(self)',
	'\tLink: <a.js>; rel=preload',
	'\tLink: <b.js>; rel=preload',
	'',
	'/assets/*',
	'\tCache-Control: public, max-age=31536000, immutable',
	'',
].join('\n');
const REDIRECTS = '# retired routes\n/framescaper/en/ https://framescaper.org/en/ 301\n';
const CHUNK = 'export const runtime = 1;\n';
const FILES: Record<string, string> = {
	'index.html': '<h1>home</h1>',
	'en/index.html': '<h1>en</h1>',
	'embed/en/index.html': '<h1>embed en</h1>',
	'transfer/send/index.html': '<h1>send</h1>',
	'transfer/receive/index.html': '<h1>receive</h1>',
	'assets/rolldown-runtime.js': CHUNK,
	'assets/codec.wasm': '\0asm',
	'404.html': '<h1>missing</h1>',
	_headers: HEADERS,
	_redirects: REDIRECTS,
};

async function withSite(run: (baseURL: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), 'pages-site-'));
	try {
		for (const [path, body] of Object.entries(FILES)) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), body);
		}
		const server = await startPagesSiteStaticServer({ root });
		try {
			await run(server.baseURL);
		} finally {
			await server.close();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('documents receive the wildcard isolation headers and route rules join as Cloudflare joins them', async () => {
	await withSite(async (baseURL) => {
		const home = await fetch(`${baseURL}/en/`);
		assert.equal(home.status, 200);
		assert.equal(await home.text(), '<h1>en</h1>');
		assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
		assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
		assert.equal(home.headers.get('cross-origin-embedder-policy'), 'credentialless');
		assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(home.headers.get('permissions-policy'), 'microphone=(self)');
		assert.equal(home.headers.get('link'), '<a.js>; rel=preload, <b.js>; rel=preload');

		const sender = await fetch(`${baseURL}/transfer/send/`);
		assert.equal(sender.status, 200);
		assert.equal(sender.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
		assert.equal(sender.headers.get('cross-origin-embedder-policy'), 'credentialless');
		assert.equal(sender.headers.get('permissions-policy'), null);

		const receiver = await fetch(`${baseURL}/transfer/receive/`);
		assert.equal(receiver.headers.get('cross-origin-opener-policy'), 'same-origin');
	});
});

test('assets carry their content type, the wildcard headers and the asset cache rule', async () => {
	await withSite(async (baseURL) => {
		const wasm = await fetch(`${baseURL}/assets/codec.wasm`);
		assert.equal(wasm.status, 200);
		assert.equal(wasm.headers.get('content-type'), 'application/wasm');
		assert.equal(wasm.headers.get('cross-origin-embedder-policy'), 'credentialless');
		assert.equal(wasm.headers.get('cache-control'), 'public, max-age=31536000, immutable');

		const head = await fetch(`${baseURL}/assets/rolldown-runtime.js`, { method: 'HEAD' });
		assert.equal(head.status, 200);
		assert.equal(head.headers.get('content-type'), 'text/javascript; charset=utf-8');
		assert.equal(head.headers.get('content-length'), String(CHUNK.length));
		assert.equal(await head.text(), '');
	});
});

// The wrangler dev server this replaced answered exactly this shape of request,
// a module chunk it had already served, with a 500 in the middle of a page load.
test('a burst of concurrent requests for one module chunk all succeed with the same bytes', async () => {
	await withSite(async (baseURL) => {
		const responses = await Promise.all(Array.from({ length: 200 }, () => (
			fetch(`${baseURL}/assets/rolldown-runtime.js`)
		)));
		assert.deepEqual([...new Set(responses.map((response) => response.status))], [200]);
		const bodies = await Promise.all(responses.map((response) => response.text()));
		assert.deepEqual([...new Set(bodies)], [CHUNK]);
	});
});

test('exact redirects answer with their configured status and location', async () => {
	await withSite(async (baseURL) => {
		const retired = await fetch(`${baseURL}/framescaper/en/`, { redirect: 'manual' });
		assert.equal(retired.status, 301);
		assert.equal(retired.headers.get('location'), 'https://framescaper.org/en/');
	});
});

test('directory documents canonicalise to a trailing slash and index.html folds onto its directory', async () => {
	await withSite(async (baseURL) => {
		const bare = await fetch(`${baseURL}/en?project=p1`, { redirect: 'manual' });
		assert.equal(bare.status, 308);
		assert.equal(bare.headers.get('location'), '/en/?project=p1');

		const explicit = await fetch(`${baseURL}/embed/en/index.html`, { redirect: 'manual' });
		assert.equal(explicit.status, 308);
		assert.equal(explicit.headers.get('location'), '/embed/en/');

		const rootIndex = await fetch(`${baseURL}/index.html`, { redirect: 'manual' });
		assert.equal(rootIndex.status, 308);
		assert.equal(rootIndex.headers.get('location'), '/');
	});
});

test('unknown paths serve the 404 document with a 404 status, and bad requests are refused', async () => {
	await withSite(async (baseURL) => {
		const missing = await fetch(`${baseURL}/nowhere/`);
		assert.equal(missing.status, 404);
		assert.equal(await missing.text(), '<h1>missing</h1>');
		assert.equal(missing.headers.get('content-type'), 'text/html; charset=utf-8');
		assert.equal(missing.headers.get('cross-origin-opener-policy'), 'same-origin');

		assert.equal((await rawHttpRequest(baseURL, '/%2e%2e/etc/passwd')).statusCode, 400);

		const posted = await fetch(`${baseURL}/en/`, { method: 'POST' });
		assert.equal(posted.status, 405);
		assert.equal(posted.headers.get('allow'), 'GET, HEAD');
	});
});

test('redirect rules accept the generator grammar and refuse what the server does not serve', () => {
	const rules = parseRedirectRules('# note\n/a /b\n/c https://example.org/ 301\n');
	assert.deepEqual(rules.get('/a'), { destination: '/b', statusCode: 302 });
	assert.deepEqual(rules.get('/c'), { destination: 'https://example.org/', statusCode: 301 });
	assert.equal(parseRedirectRules('').size, 0);
	assert.throws(() => parseRedirectRules('/a'), /malformed/u);
	assert.throws(() => parseRedirectRules('/a/* /b 301'), /splats/u);
	assert.throws(() => parseRedirectRules('/a /b 200'), /unsupported/u);
});
