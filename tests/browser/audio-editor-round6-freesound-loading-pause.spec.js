/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile, test } from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

const SOUND = {
	id: 314159, name: 'Rain in the garden', pageUrl: 'https://freesound.org/s/314159/',
	creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
	description: 'A garden field recording.', tags: ['rain'], category: null, subcategory: null,
	createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
	license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false, commercialUseAllowed: true },
	durationSeconds: 12, originalFile: { format: 'wav', channels: 1, byteLength: 1_152_044,
		sampleRate: 48_000, md5: '0123456789abcdef0123456789abcdef' },
	statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
	preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
};

for (const delayPreview of [false, true]) test(`pausing a ${delayPreview ? 'still-loading' : 'loaded'} Freesound preview retains the same native audio for resume`, async ({ page }) => {
	const frameCount = 48_000 * 12;
	const pcm = new Float32Array(frameCount);
	for (let frame = 0; frame < frameCount; frame += 1) pcm[frame] = 0.2 * Math.sin(2 * Math.PI * 440 * frame / 48_000);
	const preview = await encodeDedicatedAudioPcm({ format: 'ogg-vorbis', input: new Uint8Array(pcm.buffer),
		frameCount, channelCount: 1, sampleRate: 48_000, settings: { quality: 4 }, maximumOutputBytes: 1024 * 1024,
	}, { loadPayload: async (_format, url) => readFile(url) });
	await page.addInitScript(() => {
		globalThis.__round6FreesoundAudios = [];
		const nativePlay = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			if (!globalThis.__round6FreesoundAudios.includes(this)) globalThis.__round6FreesoundAudios.push(this);
			return nativePlay.call(this);
		};
	});
	let releasePreview = () => undefined;
	const previewGate = new Promise(resolve => { releasePreview = resolve; });
	let previewRequested = false;
	await page.route('**/api/freesound/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/freesound/oauth/session') {
			await route.fulfill({ json: { data: { connected: false } } });
			return;
		}
		if (url.pathname === '/api/freesound/search') {
			await route.fulfill({ json: { data: { query: 'rain', page: 1, pageSize: 20,
				totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } } });
			return;
		}
		if (url.pathname.endsWith('/preview')) {
			previewRequested = true;
			await previewGate;
			await route.fulfill({ contentType: 'audio/ogg', body: Buffer.from(preview) });
			return;
		}
		await route.fulfill({ status: 404, json: {} });
	});
	try {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('rain');
		await panel.getByRole('button', { name: 'Search', exact: true }).click();
		const result = panel.getByRole('listitem');
		await result.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true }).click();
		await expect.poll(() => previewRequested).toBe(true);
		if (!delayPreview) {
			releasePreview();
			await expect.poll(() => page.evaluate(() => globalThis.__round6FreesoundAudios[0]?.currentTime)).toBeGreaterThan(0.05);
		}
		await result.getByRole('button', { name: `Pause preview: ${SOUND.name}`, exact: true }).click();
		await expect(result.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(() => page.evaluate(() => globalThis.__round6FreesoundAudios[0]?.getAttribute('src')))
			.toContain('/api/freesound/sounds/314159/preview');
		releasePreview();
		await result.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__round6FreesoundAudios[0]?.currentTime)).toBeGreaterThan(0.05);
		expect(await page.evaluate(() => globalThis.__round6FreesoundAudios.length)).toBe(1);
		await result.getByRole('button', { name: `Pause preview: ${SOUND.name}`, exact: true }).click();
	} finally { releasePreview(); }
});
