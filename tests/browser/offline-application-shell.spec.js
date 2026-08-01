import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(90_000);

test('verified application shell reloads both products while the browser is offline', async ({ context, page }) => {
	await page.goto('/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-soundscaper.webmanifest');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});
	await expect.poll(() => page.evaluate(async () => (
		(await caches.keys()).filter((name) => name.startsWith('soundscaper-application-shell-v1-')).length
	))).toBe(1);

	await context.setOffline(true);
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'soundscaper');

	await page.goto('/framescaper/en/', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await expect(page.locator('html')).toHaveAttribute('data-product', 'framescaper');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-framescaper.webmanifest');
});
