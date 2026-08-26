import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(90_000);

test('offline-shell-upgrade replaces a prior shell, isolates products, and keeps both usable offline', async ({ browserName, context, page }) => {
	test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload a service-worker page in offline emulation.');
	const staleCacheName = `soundscaper-application-shell-v1-${'0'.repeat(64)}`;
	await page.goto('/logo/logo-klein-schwarz.svg');
	await page.evaluate(async (cacheName) => {
		const cache = await caches.open(cacheName);
		await cache.put('/', new Response('stale application shell'));
	}, staleCacheName);
	await page.goto('/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-soundscaper.webmanifest');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});
	await expect.poll(() => page.evaluate(async () => (
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-soundscaper-'))
	))).toHaveLength(1);
	expect(await page.evaluate(async (cacheName) => (await caches.keys()).includes(cacheName), staleCacheName)).toBe(false);
	const soundscaperCacheHasFramescaperDocument = await page.evaluate(async () => {
		const cacheName = (await caches.keys())
			.find((name) => name.startsWith('soundscaper-application-shell-v2-soundscaper-'));
		if (!cacheName) throw new Error('Soundscaper application-shell cache is missing.');
		const response = await (await caches.open(cacheName)).match('/framescaper/en/');
		return response !== undefined;
	});
	expect(soundscaperCacheHasFramescaperDocument).toBe(false);
	await context.setOffline(true);
	if (browserName === 'chromium') {
		// Playwright's Firefox offline emulation does not apply to navigations: the request
		// still reaches the preview server, so only Chromium can observe that a product
		// document this shell never cached is unreachable while the network is down.
		await expect(page.goto('/framescaper/en/', { waitUntil: 'domcontentloaded', timeout: 5_000 })).rejects.toThrow();
	}
	await context.setOffline(false);

	await page.goto('/framescaper/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-framescaper.webmanifest');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller?.scriptURL.endsWith('/framescaper/service-worker.js')) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});
	await expect.poll(() => page.evaluate(async () => (
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-framescaper-'))
	))).toHaveLength(1);

	await context.setOffline(true);
	await page.goto('/en/', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'soundscaper');

	await page.goto('/framescaper/en/', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'framescaper');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-framescaper.webmanifest');
});

test('allowlisted optional assets are verified once and reused offline', async ({ browserName, context, page }) => {
	test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload a service-worker page in offline emulation.');
	await bindSoundscaperAndWaitForWorker(page);
	const optional = await page.evaluate(async () => {
		const auditResponse = await fetch('/offline-shell.json', { cache: 'no-store' });
		if (!auditResponse.ok) throw new Error(`Offline audit request failed with ${auditResponse.status}.`);
		const audit = await auditResponse.json();
		const worker = audit.workers.soundscaper;
		const cacheName = (await caches.keys())
			.find((name) => name === `soundscaper-application-shell-v2-soundscaper-${worker.releaseId}`);
		if (!cacheName) throw new Error('Soundscaper application-shell cache is missing.');
		const cache = await caches.open(cacheName);
		for (const asset of audit.assets) {
			if (!asset.url.startsWith('/assets/') || !asset.url.endsWith('.js') || worker.installUrls.includes(asset.url)) continue;
			if (!await cache.match(asset.url)) return { asset, cacheName };
		}
		throw new Error('No uncached optional JavaScript asset is available.');
	});
	const online = await fetchDigest(page, optional.asset.url);
	expect(online).toEqual({ byteLength: optional.asset.byteLength, sha256: optional.asset.sha256 });
	await expect.poll(() => page.evaluate(async ({ cacheName, url }) => (
		(await (await caches.open(cacheName)).match(url)) !== undefined
	), { cacheName: optional.cacheName, url: optional.asset.url })).toBe(true);

	await context.setOffline(true);
	// Firefox does not dispatch a `cache: 'reload'` request to the service worker, so the
	// offline round trip is only observable in Chromium. Reading the stored response there
	// still proves the worker retained the exact verified bytes.
	const offline = browserName === 'chromium'
		? await fetchDigest(page, optional.asset.url)
		: await cachedDigest(page, optional.cacheName, optional.asset.url);
	expect(offline).toEqual(online);
});

test('a failed worker upgrade retains the active shell and its complete cache', async ({ browserName, context, page }) => {
	test.skip(browserName === 'webkit', 'Playwright WebKit cannot reliably reload a service-worker page in offline emulation.');
	test.skip(browserName === 'firefox', 'Playwright Firefox cannot route a service-worker script request, so the failing upgrade candidate never reaches the browser.');
	await bindSoundscaperAndWaitForWorker(page);
	const prior = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration('/');
		return {
			activeScriptUrl: registration?.active?.scriptURL,
			cacheNames: (await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-soundscaper-')),
		};
	});
	expect(prior.activeScriptUrl).toMatch(/\/service-worker\.js$/u);
	expect(prior.cacheNames).toHaveLength(1);

	const source = await page.evaluate(async () => {
		const response = await fetch('/service-worker.js', { cache: 'no-store' });
		if (!response.ok) throw new Error(`Service-worker request failed with ${response.status}.`);
		return response.text();
	});
	const candidate = failingWorkerCandidate(source);
	let candidateRequests = 0;
	await context.route('**/service-worker-failing-test.js', async (route) => {
		candidateRequests += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/javascript; charset=utf-8',
			headers: {
				'Cache-Control': 'no-store',
				'Service-Worker-Allowed': '/',
			},
			body: candidate.source,
		});
	});
	await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.register('/service-worker-failing-test.js', {
			scope: '/',
			updateViaCache: 'none',
		});
		const installing = registration.installing;
		if (!installing || installing.state === 'redundant') return;
		await new Promise((resolve) => {
			installing.addEventListener('statechange', () => {
				if (installing.state === 'redundant') resolve();
			});
		});
	});
	expect(candidateRequests).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(async () => (
		(await navigator.serviceWorker.getRegistration('/'))?.active?.scriptURL
	))).toBe(prior.activeScriptUrl);
	await expect.poll(() => page.evaluate(async (releaseId) => (
		(await caches.keys()).some((name) => name.endsWith(releaseId))
	), candidate.releaseId)).toBe(false);
	expect(await page.evaluate(async () => (
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-soundscaper-'))
	))).toEqual(prior.cacheNames);

	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
});

async function bindSoundscaperAndWaitForWorker(page) {
	await page.goto('/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});
	await expect.poll(() => page.evaluate(async () => (
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v2-soundscaper-'))
	))).toHaveLength(1);
}

async function cachedDigest(page, cacheName, url) {
	return page.evaluate(async ({ name, assetUrl }) => {
		const response = await (await caches.open(name)).match(assetUrl);
		if (!response) throw new Error(`Cached asset ${assetUrl} is missing.`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		return {
			byteLength: bytes.byteLength,
			sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		};
	}, { name: cacheName, assetUrl: url });
}

async function fetchDigest(page, url) {
	return page.evaluate(async (assetUrl) => {
		const response = await fetch(assetUrl, { cache: 'reload' });
		if (!response.ok) throw new Error(`Asset request failed with ${response.status}.`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		return {
			byteLength: bytes.byteLength,
			sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		};
	}, url);
}

function failingWorkerCandidate(source) {
	const prefix = 'const OFFLINE_SHELL = ';
	const start = source.indexOf(prefix);
	const end = source.indexOf(';', start);
	if (start < 0 || end < 0) throw new Error('Generated worker configuration is missing.');
	const configuration = JSON.parse(source.slice(start + prefix.length, end));
	const installUrl = configuration.installUrls[0];
	const asset = configuration.assets.find((entry) => entry.url === installUrl);
	if (!asset) throw new Error('Generated worker install asset is missing.');
	asset.sha256 = '0'.repeat(64);
	const { releaseId: _releaseId, ...identity } = configuration;
	configuration.releaseId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
	return {
		releaseId: configuration.releaseId,
		source: `${source.slice(0, start + prefix.length)}${JSON.stringify(configuration)}${source.slice(end)}`,
	};
}
