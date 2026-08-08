import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(90_000);

test('offline-shell-upgrade replaces a prior shell and keeps both products usable offline', async ({ browserName, context, page }) => {
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
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v1-'))
	))).toHaveLength(1);
	expect(await page.evaluate(async (cacheName) => (await caches.keys()).includes(cacheName), staleCacheName)).toBe(false);

	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'soundscaper');

	await page.goto('/framescaper/en/', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'framescaper');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-framescaper.webmanifest');
});
