/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile, test } from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

const SOUND = {
	id: 42, name: 'Rain in the garden', pageUrl: 'https://freesound.org/s/42/',
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

test('ordinary Freesound previews follow current, live and paused Playback volume', async ({ page }) => {
	const frameCount = 48_000 * 12;
	const pcm = Float32Array.from({ length: frameCount }, (_, frame) => 0.2 * Math.sin(2 * Math.PI * 440 * frame / 48_000));
	const preview = await encodeDedicatedAudioPcm({ format: 'ogg-vorbis', input: new Uint8Array(pcm.buffer),
		frameCount, channelCount: 1, sampleRate: 48_000, settings: { quality: 4 }, maximumOutputBytes: 1024 * 1024,
	}, { loadPayload: async (_format, url) => readFile(url) });
	await page.addInitScript(() => {
		globalThis.__round7FreesoundMedia = [];
		const nativePlay = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			if (this.src.endsWith('/api/freesound/sounds/42/preview')) globalThis.__round7FreesoundMedia.push(this);
			return nativePlay.call(this);
		};
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/freesound/oauth/session') return route.fulfill({ json: { data: { connected: false } } });
		if (path === '/api/freesound/search') return route.fulfill({ json: { data: { query: 'rain', page: 1, pageSize: 20,
			totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] } } });
		if (path.endsWith('/preview')) return route.fulfill({ contentType: 'audio/ogg', body: Buffer.from(preview) });
		return route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.focus();
	await volume.press('End');
	await expect(volume).toHaveValue('1');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('rain');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const result = panel.getByRole('listitem');
	await result.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__round7FreesoundMedia[0]?.currentTime)).toBeGreaterThan(0.05);
	expect(await page.evaluate(() => globalThis.__round7FreesoundMedia[0]?.volume)).toBe(1);
	await volume.focus();
	await volume.press('Home');
	await expect(volume).toHaveValue('0');
	await expect.poll(() => page.evaluate(() => globalThis.__round7FreesoundMedia[0]?.volume)).toBe(0);
	expect(await page.evaluate(() => globalThis.__round7FreesoundMedia.length)).toBe(1);
	await result.getByRole('button', { name: `Pause preview: ${SOUND.name}`, exact: true }).click();
	await volume.focus();
	await volume.press('End');
	await expect(volume).toHaveValue('1');
	await expect.poll(() => page.evaluate(() => globalThis.__round7FreesoundMedia[0]?.volume)).toBe(1);
	await result.getByRole('button', { name: `Play preview: ${SOUND.name}`, exact: true }).click();
	expect(await page.evaluate(() => globalThis.__round7FreesoundMedia[0] === globalThis.__round7FreesoundMedia[1])).toBe(true);
	await result.getByRole('button', { name: `Pause preview: ${SOUND.name}`, exact: true }).click();
});
