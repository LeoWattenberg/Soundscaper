/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadDesktopNightlyTestsProductSitePlans } from '../scripts/lib/desktop-nightly-tests-product-sites.mjs';
import { preserveDesktopNightlyTestsCoverageEvidence } from '../scripts/lib/desktop-nightly-tests-packaged-coverage.mjs';
import { resolvePackagedProductExecutable } from '../scripts/lib/desktop-packaged-product-executable.mjs';

test('desktop test artifacts include a third authenticated Motionscaper site and distinct origin', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-sites-'));
	try {
		const products = ['soundscaper', 'framescaper', 'motionscaper'];
		for (const [index, productId] of products.entries()) {
			await mkdir(join(root, 'sites', productId), { recursive: true });
			await writeFile(join(root, 'sites', productId, '.browser-product-build.json'), JSON.stringify({
				schemaVersion: 2, productId, origin: `http://127.0.0.1:${4322 + index}`,
			}));
		}
		assert.deepEqual((await loadDesktopNightlyTestsProductSitePlans(root)).map((entry) => entry.productId), products);
		await writeFile(join(root, 'sites/motionscaper/.browser-product-build.json'), JSON.stringify({
			schemaVersion: 2, productId: 'motionscaper', origin: 'http://127.0.0.1:4322',
		}));
		await assert.rejects(loadDesktopNightlyTestsProductSitePlans(root), /distinct/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('packaged Motionscaper executable selection never falls back to another product', () => {
	assert.equal(resolvePackagedProductExecutable({ productRoot: '/products', productId: 'motionscaper', platform: 'linux', arch: 'x64' }), '/products/motionscaper/linux-unpacked/motionscaper');
	assert.equal(resolvePackagedProductExecutable({ productRoot: '/products', productId: 'motionscaper', platform: 'win32', arch: 'arm64' }), '/products/motionscaper/win-arm64-unpacked/Motionscaper.exe');
});

test('nightly evidence preserves the exact Motionscaper browser and packaged denominator', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-evidence-'));
	try {
		for (const product of ['soundscaper', 'framescaper', 'motionscaper']) {
			for (const relative of [`sites/${product}/editor.js`, `sites/${product}-source-maps/editor.js.map`, `products/${product}/e2e-coverage/manifest.json`]) {
				await mkdir(dirname(join(root, 'payload', relative)), { recursive: true });
				await writeFile(join(root, 'payload', relative), product);
			}
		}
		const evidence = await preserveDesktopNightlyTestsCoverageEvidence({ payloadRoot: join(root, 'payload'), runRoot: join(root, 'run') });
		assert.equal(await readFile(join(evidence, 'browser/motionscaper/site/editor.js'), 'utf8'), 'motionscaper');
		assert.equal(await readFile(join(evidence, 'electron/motionscaper/manifest.json'), 'utf8'), 'motionscaper');
	} finally { await rm(root, { recursive: true, force: true }); }
});
