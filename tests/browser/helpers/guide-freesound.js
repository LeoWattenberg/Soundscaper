/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, readFile } from '../audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../../src/common/editor/browser-dedicated-audio-codec.ts';

const SOUND = Object.freeze({
	id: 314159,
	name: 'Harbor ambience',
	pageUrl: 'https://freesound.org/s/314159/',
	creator: Object.freeze({ username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' }),
	description: 'Waves and distant rigging recorded beside a harbor.',
	tags: Object.freeze(['harbor', 'waves']),
	category: null,
	subcategory: null,
	createdAt: '2026-01-02T03:04:05Z',
	license: Object.freeze({
		code: 'cc-by', name: 'Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true, commercialUseAllowed: true,
	}),
	generativeAiPreference: null,
	explicit: false,
	durationSeconds: 0.8,
	originalFile: Object.freeze({
		format: 'wav', channels: 2, byteLength: 153_644, sampleRate: 48_000,
		md5: '0123456789abcdef0123456789abcdef',
	}),
	statistics: Object.freeze({ downloads: 42, averageRating: 4.75, ratingCount: 8 }),
	preview: Object.freeze({ available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 }),
});

let previewPromise;

function previewFixture() {
	previewPromise ??= (async () => {
		const frameCount = 38_400;
		const pcm = new Float32Array(frameCount * 2);
		for (let frame = 0; frame < frameCount; frame += 1) {
			pcm[frame * 2] = Math.sin(2 * Math.PI * 330 * frame / 48_000) * 0.25;
			pcm[frame * 2 + 1] = Math.sin(2 * Math.PI * 330 * frame / 48_000 + Math.PI / 3) * 0.15;
		}
		return encodeDedicatedAudioPcm({
			format: 'ogg-vorbis', input: new Uint8Array(pcm.buffer), frameCount,
			channelCount: 2, sampleRate: 48_000, settings: { quality: 4 },
			maximumOutputBytes: 1024 * 1024,
		}, { loadPayload: async (_format, url) => readFile(url) });
	})();
	return previewPromise;
}

async function mockFreesoundApi(page) {
	const requests = [];
	const preview = await previewFixture();
	await page.route('**/api/freesound/**', async (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		if (url.pathname === '/api/freesound/search') {
			await route.fulfill({
				status: 200, contentType: 'application/json',
				body: JSON.stringify({ data: {
					query: url.searchParams.get('q'), page: 1, pageSize: 20,
					totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false,
					results: [SOUND],
				} }),
			});
			return;
		}
		if (url.pathname === `/api/freesound/sounds/${String(SOUND.id)}`) {
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: SOUND }) });
			return;
		}
		if (url.pathname === `/api/freesound/sounds/${String(SOUND.id)}/preview`) {
			await route.fulfill({
				status: 200, contentType: 'audio/ogg',
				headers: { 'Content-Length': String(preview.byteLength) }, body: Buffer.from(preview),
			});
			return;
		}
		await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	return requests;
}

export async function runFreesoundSearch(page, state, entry) {
	const requests = await mockFreesoundApi(page);
	const panel = state.editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel).toBeVisible();
	await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill(entry.query);
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const result = panel.getByRole('list', { name: 'Freesound results', exact: true }).getByRole('listitem');
	await expect(result.getByRole('link', { name: SOUND.name, exact: true })).toBeVisible();
	expect(requests.find((url) => url.pathname === '/api/freesound/search')?.searchParams.get('q')).toBe(entry.query);
	state.freesound = { result, requests };
}

export async function runFreesoundInsert(state, entry) {
	if (!state.freesound) throw new Error('Search Freesound before inserting a result.');
	expect(entry.name).toBe(SOUND.name);
	await state.freesound.result.getByRole('button', { name: /^Insert at playhead\s*:\s*Harbor ambience$/u }).click();
	await expect(state.editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	await expect(state.editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	for (const suffix of ['', '/preview']) {
		expect(state.freesound.requests.some((url) => url.pathname === `/api/freesound/sounds/${String(SOUND.id)}${suffix}`)).toBe(true);
	}
}
