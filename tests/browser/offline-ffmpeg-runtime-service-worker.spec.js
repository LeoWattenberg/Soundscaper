import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(90_000);

test('a controlled offline page can read only an explicitly installed runtime release', async ({ browserName, context, page }) => {
	test.skip(browserName === 'webkit', 'Playwright WebKit cannot route an offline cross-origin fetch through the service worker.');
	await page.goto('/en/');
	await expect(page.locator('[data-audio-editor]')).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
	});

	const releaseId = 'c'.repeat(64);
	const installedUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/ffmpeg-core.js`;
	const orphanId = 'd'.repeat(64);
	const orphanUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${orphanId}/ffmpeg-core.js`;
	await page.evaluate(async ({ releaseId: id, orphanId: uncommittedId }) => {
		const hexDigest = async (bytes) => Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(value) => value.toString(16).padStart(2, '0'),
		).join('');
		const baseUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${id}/`;
		const sources = [
			['ffmpeg-core.js', 'verified offline runtime', 'text/javascript; charset=utf-8'],
			['ffmpeg-core.wasm', 'verified offline wasm', 'application/wasm'],
		];
		const files = await Promise.all(sources.map(async ([name, contents, contentType]) => {
			const bytes = new TextEncoder().encode(contents);
			return {
				name,
				url: `${baseUrl}${name}`,
				byteLength: bytes.byteLength,
				sha256: await hexDigest(bytes),
				contentType,
				bytes,
			};
		}));
		const cache = await caches.open(`soundscaper-ffmpeg-runtime-v1-${id}`);
		for (const file of files) {
			await cache.put(file.url, new Response(file.bytes, {
				status: 200,
				headers: {
					'content-length': String(file.byteLength),
					'content-type': file.contentType,
				},
			}));
		}
		const state = {
			schemaVersion: 1,
			active: {
				schemaVersion: 1,
				releaseId: id,
				manifestSha256: id,
				baseUrl,
				files: files.map(({ bytes: _bytes, ...file }) => file),
			},
			previous: null,
		};
		const stateBytes = new TextEncoder().encode(JSON.stringify(state));
		const stateCache = await caches.open('soundscaper-ffmpeg-runtime-v1-state');
		await stateCache.put(
			new URL('/.soundscaper/offline/ffmpeg-runtime-state-v1.json', location.origin),
			new Response(stateBytes, {
				status: 200,
				headers: {
					'content-length': String(stateBytes.byteLength),
					'content-type': 'application/json; charset=utf-8',
				},
			}),
		);
		const orphanBytes = new TextEncoder().encode('uncommitted offline runtime');
		const orphanCache = await caches.open(`soundscaper-ffmpeg-runtime-v1-${uncommittedId}`);
		await orphanCache.put(
			`https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${uncommittedId}/ffmpeg-core.js`,
			new Response(orphanBytes, {
				status: 200,
				headers: {
					'content-length': String(orphanBytes.byteLength),
					'content-type': 'text/javascript; charset=utf-8',
				},
			}),
		);
	}, { releaseId, orphanId });

	await context.setOffline(true);
	const installed = await page.evaluate(async (url) => {
		const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
		return { ok: response.ok, status: response.status, body: await response.text() };
	}, installedUrl);
	expect(installed).toEqual({ ok: true, status: 200, body: 'verified offline runtime' });
	await expect(page.evaluate((url) => fetch(url, { mode: 'cors', credentials: 'omit' }), orphanUrl)).rejects.toThrow();
});
