/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	startDesktopNightlyTestsProductSites,
} from '../scripts/lib/desktop-nightly-tests-product-sites.mjs';

async function unusedLoopbackOrigin() {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	return `http://127.0.0.1:${String(address.port)}`;
}

async function stageProductSites(
	payloadRoot: string,
	origins: Readonly<{ soundscaper: string; framescaper: string }>,
	withContent = false,
) {
	for (const productId of ['soundscaper', 'framescaper'] as const) {
		const siteRoot = join(payloadRoot, 'sites', productId);
		await mkdir(siteRoot, { recursive: true });
		await writeFile(join(siteRoot, '.browser-product-build.json'), `${JSON.stringify({
			schemaVersion: 2, productId, origin: origins[productId],
		})}\n`);
		if (!withContent) continue;
		await Promise.all([
			mkdir(join(siteRoot, 'en'), { recursive: true }),
			mkdir(join(siteRoot, 'assets'), { recursive: true }),
			mkdir(join(siteRoot, 'transfer/send'), { recursive: true }),
		]);
		await writeFile(join(siteRoot, 'en/index.html'), `<body data-product="${productId}">`);
		await writeFile(join(siteRoot, 'assets/product.js'), `export default '${productId}';`);
		await writeFile(join(siteRoot, 'transfer/send/index.html'), '<body>transfer sender</body>');
		await writeFile(join(siteRoot, '_headers'), [
			'/transfer/send/',
			'\tCross-Origin-Opener-Policy: same-origin-allow-popups',
			'\tCross-Origin-Embedder-Policy: credentialless',
		].join('\n'));
		await writeFile(join(siteRoot, '_redirects'), productId === 'soundscaper'
			? '/framescaper/en/ https://framescaper.org/en/ 301\n' : '# no retired routes\n');
	}
}

test('the real nightly servers expose each staged document and root asset only on its product origin', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-sites-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	const origins = {
		soundscaper: await unusedLoopbackOrigin(),
		framescaper: await unusedLoopbackOrigin(),
	};
	assert.notEqual(origins.soundscaper, origins.framescaper);
	await stageProductSites(payloadRoot, origins, true);
	const sites = await startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: {},
	});
	context.after(() => sites.close());
	assert.deepEqual(sites.origins, origins);

	for (const [productId, origin] of Object.entries(sites.origins)) {
		assert.match(await (await fetch(`${origin}/en/`)).text(), new RegExp(`data-product="${productId}"`, 'u'));
		assert.equal(await (await fetch(`${origin}/assets/product.js`)).text(), `export default '${productId}';`);
	}
	const transfer = await fetch(`${sites.origins.soundscaper}/transfer/send/`);
	assert.equal(transfer.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
	assert.equal(transfer.headers.get('cross-origin-embedder-policy'), 'credentialless');
	const retired = await fetch(`${sites.origins.soundscaper}/framescaper/en/`, { redirect: 'manual' });
	assert.equal(retired.status, 301);
	assert.equal(retired.headers.get('location'), 'https://framescaper.org/en/');
});

test('the nightly launcher binds each staged root to its authenticated browser origin', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-bind-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	const origins = {
		soundscaper: 'http://127.0.0.1:47777',
		framescaper: 'http://127.0.0.1:47778',
	};
	await stageProductSites(payloadRoot, origins);
	const starts: Array<{ root: string; host: string; port: number }> = [];
	const closed: string[] = [];
	const sites = await startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: { PATH: '/usr/bin', EXISTING: 'preserved' },
		startStaticServer: async ({ root, host, port }) => {
			starts.push({ root, host, port });
			const productId = root.endsWith('/soundscaper') ? 'soundscaper' : 'framescaper';
			return {
				baseURL: `http://${host}:${String(port)}`,
				close: async () => { closed.push(productId); },
			};
		},
	});

	assert.deepEqual(starts, [
		{ root: join(payloadRoot, 'sites/soundscaper'), host: '127.0.0.1', port: 47777 },
		{ root: join(payloadRoot, 'sites/framescaper'), host: '127.0.0.1', port: 47778 },
	]);
	assert.deepEqual(sites.origins, origins);
	assert.deepEqual(JSON.parse(sites.browserEnvironment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? ''), sites.origins);
	assert.deepEqual(JSON.parse(sites.browserEnvironment.SCAPE_BROWSER_COVERAGE_SITES ?? ''), [
		{
			productId: 'soundscaper',
			origin: 'http://127.0.0.1:47777',
			outputDirectory: join(payloadRoot, 'sites/soundscaper'),
		},
		{
			productId: 'framescaper',
			origin: 'http://127.0.0.1:47778',
			outputDirectory: join(payloadRoot, 'sites/framescaper'),
		},
	]);
	assert.equal(sites.browserEnvironment.EXISTING, 'preserved');
	assert.equal(Object.isFrozen(sites), true);
	assert.equal(Object.isFrozen(sites.origins), true);
	assert.equal(Object.isFrozen(sites.browserEnvironment), true);

	await sites.close();
	await sites.close();
	assert.deepEqual([...closed].sort(), ['framescaper', 'soundscaper']);
});

test('the nightly launcher closes an already-started product site when its peer cannot start', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-peer-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	await stageProductSites(payloadRoot, {
		soundscaper: 'http://127.0.0.1:47777', framescaper: 'http://127.0.0.1:47778',
	});
	let starts = 0;
	let closes = 0;
	await assert.rejects(() => startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: {},
		startStaticServer: async () => {
			starts += 1;
			if (starts === 2) throw new Error('Framescaper site unavailable');
			return {
				baseURL: 'http://127.0.0.1:47777',
				close: async () => { closes += 1; },
			};
		},
	}), /Framescaper site unavailable/u);
	assert.equal(closes, 1);
});

test('the nightly launcher rejects aliased build origins before opening a server', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-alias-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	await stageProductSites(payloadRoot, {
		soundscaper: 'http://127.0.0.1:47777', framescaper: 'http://127.0.0.1:47777',
	});
	let starts = 0;
	await assert.rejects(() => startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: {},
		startStaticServer: async () => {
			starts += 1;
			return { baseURL: 'http://127.0.0.1:47777', close: async () => undefined };
		},
	}), /distinct product origins/u);
	assert.equal(starts, 0);
});

test('the nightly launcher rejects a server that misses the authenticated origin', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-misbind-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	await stageProductSites(payloadRoot, {
		soundscaper: 'http://127.0.0.1:47777', framescaper: 'http://127.0.0.1:47778',
	});
	let closes = 0;
	await assert.rejects(() => startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: {},
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:49999',
			close: async () => { closes += 1; },
		}),
	}), /did not bind its authenticated build origin/u);
	assert.equal(closes, 1);
});
