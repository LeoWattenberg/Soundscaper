/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	startDesktopNightlyTestsProductSites,
} from '../scripts/lib/desktop-nightly-tests-product-sites.mjs';
import { startDesktopNightlyTestsStaticServer } from '../scripts/lib/desktop-nightly-tests-runtime.mjs';

test('the real nightly servers expose each staged document and root asset only on its product origin', async (context) => {
	const payloadRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-product-sites-'));
	context.after(() => rm(payloadRoot, { recursive: true, force: true }));
	for (const productId of ['soundscaper', 'framescaper']) {
		const siteRoot = join(payloadRoot, 'sites', productId);
		await Promise.all([
			mkdir(join(siteRoot, 'en'), { recursive: true }),
			mkdir(join(siteRoot, 'assets'), { recursive: true }),
		]);
		await writeFile(join(siteRoot, 'en/index.html'), `<body data-product="${productId}">`);
		await writeFile(join(siteRoot, 'assets/product.js'), `export default '${productId}';`);
	}
	const sites = await startDesktopNightlyTestsProductSites({
		payloadRoot,
		environment: {},
		startStaticServer: startDesktopNightlyTestsStaticServer,
	});
	context.after(() => sites.close());

	for (const [productId, origin] of Object.entries(sites.origins)) {
		assert.match(await (await fetch(`${origin}/en/`)).text(), new RegExp(`data-product="${productId}"`, 'u'));
		assert.equal(await (await fetch(`${origin}/assets/product.js`)).text(), `export default '${productId}';`);
	}
});

test('the nightly launcher serves each product from its own staged root and browser origin', async () => {
	const roots: string[] = [];
	const closed: string[] = [];
	const sites = await startDesktopNightlyTestsProductSites({
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		environment: { PATH: '/usr/bin', EXISTING: 'preserved' },
		startStaticServer: async ({ root }: { readonly root: string }) => {
			roots.push(root);
			const productId = root.endsWith('/soundscaper') ? 'soundscaper' : 'framescaper';
			return {
				baseURL: productId === 'soundscaper'
					? 'http://127.0.0.1:47777' : 'http://127.0.0.1:47778',
				close: async () => { closed.push(productId); },
			};
		},
	});

	assert.deepEqual(roots, [
		'/opt/Soundscaper Tests/resources/nightly-tests/sites/soundscaper',
		'/opt/Soundscaper Tests/resources/nightly-tests/sites/framescaper',
	]);
	assert.deepEqual(sites.origins, {
		soundscaper: 'http://127.0.0.1:47777',
		framescaper: 'http://127.0.0.1:47778',
	});
	assert.deepEqual(JSON.parse(sites.browserEnvironment.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? ''), sites.origins);
	assert.equal(sites.browserEnvironment.EXISTING, 'preserved');
	assert.equal(Object.isFrozen(sites), true);
	assert.equal(Object.isFrozen(sites.origins), true);
	assert.equal(Object.isFrozen(sites.browserEnvironment), true);

	await sites.close();
	await sites.close();
	assert.deepEqual([...closed].sort(), ['framescaper', 'soundscaper']);
});

test('the nightly launcher closes an already-started product site when its peer cannot start', async () => {
	let starts = 0;
	let closes = 0;
	await assert.rejects(() => startDesktopNightlyTestsProductSites({
		payloadRoot: '/opt/nightly-tests',
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

test('the nightly launcher rejects aliased product origins and closes both servers', async () => {
	let closes = 0;
	await assert.rejects(() => startDesktopNightlyTestsProductSites({
		payloadRoot: '/opt/nightly-tests',
		environment: {},
		startStaticServer: async () => ({
			baseURL: 'http://127.0.0.1:47777',
			close: async () => { closes += 1; },
		}),
	}), /distinct product origins/u);
	assert.equal(closes, 2);
});
