import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(90_000);

test('a controlled offline page can read only an explicitly installed runtime release', async ({ context, page }) => {
	await page.goto('/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});

	const releaseId = 'c'.repeat(64);
	const installedUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/ffmpeg-core.js`;
	const absentUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${'d'.repeat(64)}/ffmpeg-core.js`;
	await page.evaluate(async ({ cacheName, installedUrl: url }) => {
		const bytes = new TextEncoder().encode('verified offline runtime');
		const cache = await caches.open(cacheName);
		await cache.put(url, new Response(bytes, {
			status: 200,
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': 'text/javascript; charset=utf-8',
			},
		}));
	}, {
		cacheName: `soundscaper-ffmpeg-runtime-v1-${releaseId}`,
		installedUrl,
	});

	await context.setOffline(true);
	const installed = await page.evaluate(async (url) => {
		const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
		return { ok: response.ok, status: response.status, body: await response.text() };
	}, installedUrl);
	expect(installed).toEqual({ ok: true, status: 200, body: 'verified offline runtime' });
	await expect(page.evaluate((url) => fetch(url, { mode: 'cors', credentials: 'omit' }), absentUrl)).rejects.toThrow();
});
