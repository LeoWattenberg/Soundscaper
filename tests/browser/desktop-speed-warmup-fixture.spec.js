/* SPDX-License-Identifier: AGPL-3.0-only */

import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';
import { createServer } from 'node:http';

// The override scenario serves a synthetic feature module outside the built site.
const syntheticRouteTest = test.extend({ browserCoverage: false });

syntheticRouteTest('ordinary web pages retain HTTP caching without desktop manifest interception', async ({ page, browser }) => {
	const requests = new Map();
	const server = createServer((request, response) => {
		if (request.url.startsWith('/cached-resource')) {
			requests.set(request.url, (requests.get(request.url) ?? 0) + 1);
			response.writeHead(200, { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain' });
			response.end('cached resource');
			return;
		}
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end('<!doctype html><title>HTTP cache fixture</title>');
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const control = await browser.newContext({ serviceWorkers: 'block' });
	try {
		const address = server.address();
		expect(address).not.toBeNull();
		const origin = `http://127.0.0.1:${address.port}/`;
		const fetchTwice = async (subject, resource) => {
			await subject.goto(origin);
			const bodies = await subject.evaluate(async path => {
				const first = await (await fetch(path)).text();
				const second = await (await fetch(path)).text();
				return [first, second];
			}, resource);
			expect(bodies).toEqual(['cached resource', 'cached resource']);
		};
		await fetchTwice(await control.newPage(), '/cached-resource-control');
		await fetchTwice(page, '/cached-resource-fixture');
		// Match the engine's fresh-context cache policy: WebKit's ephemeral
		// contexts do not cache these fetches even without request interception.
		expect(requests.get('/cached-resource-fixture')).toBe(requests.get('/cached-resource-control'));
	} finally {
		await control.close();
		await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
});

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} desktop stubs finish Speed preparation without a web build manifest`, async ({ page }) => {
		await installDesktopBridge(page, `${productId}Desktop`);
		const errors = collectClientErrors(page);
		const path = productId === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/';
		const editor = await bootEditor(page, path);
		await expect(editor).toHaveAttribute('data-product', productId);
		const warmup = page.locator('[data-desktop-speed-warmup="ready"]');
		await expect(warmup).toHaveCount(1);
		await expect(warmup).toHaveAttribute('data-desktop-speed-warmup-failed', '0');
		expect(errors).toEqual([]);
	});
}

syntheticRouteTest('a desktop Speed scenario can replace the shared manifest with its feature modules', async ({ page }) => {
	await installDesktopBridge(page, 'scapeDesktop');
	const errors = collectClientErrors(page);
	let featureRequests = 0;
	await page.route('**/assets/desktop-fixture-override.js', async (route) => {
		featureRequests += 1;
		await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const ready = true;' });
	});
	await page.route('**/.offline-build-manifest.json', async (route) => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
				file: 'assets/desktop-fixture-bootstrap.js', isDynamicEntry: true,
			},
			'src/common/editor/ui/dialogs/FixtureDialog.tsx': {
				file: 'assets/desktop-fixture-override.js', isDynamicEntry: true,
			},
		}) });
	});
	await installDesktopSpeedWarmupManifest(page);
	await bootEditor(page, '/embed/en/');
	await expect(page.locator('[data-desktop-speed-warmup="ready"]'))
		.toHaveAttribute('data-desktop-speed-warmup-failed', '0');
	expect(featureRequests).toBe(1);
	expect(errors).toEqual([]);
});

async function installDesktopBridge(page, name) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript((bridgeName) => {
		Object.defineProperty(globalThis, bridgeName, {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				getEnvironment: () => Promise.resolve({ platform: 'win32' }),
			}) }),
		});
	}, name);
}
