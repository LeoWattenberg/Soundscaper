/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
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

test('Freesound pages the current results after typing a different search draft', async ({ page }) => {
	const searches = [];
	await page.route('**/api/freesound/**', async route => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/freesound/oauth/session') {
			await route.fulfill({ json: { data: { connected: false } } });
			return;
		}
		if (url.pathname === '/api/freesound/search') {
			searches.push({ query: url.searchParams.get('q'), page: url.searchParams.get('page') });
			const pageNumber = Number(url.searchParams.get('page') || '1');
			await route.fulfill({ json: { data: {
				query: url.searchParams.get('q'), page: pageNumber, pageSize: 20,
				totalCount: 60, totalPages: 3, hasNextPage: pageNumber < 3, hasPreviousPage: pageNumber > 1,
				results: [SOUND],
			} } });
			return;
		}
		await route.fulfill({ status: 404, json: {} });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Freesound']);
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	const query = panel.getByRole('searchbox', { name: 'Search Freesound', exact: true });
	await query.fill('rain');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(panel.getByRole('link', { name: SOUND.name, exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
	await query.fill('wind');
	await panel.getByRole('button', { name: 'Next', exact: true }).click();
	await expect.poll(() => searches.at(-1)).toEqual({ query: 'rain', page: '2' });
	await expect(query).toHaveValue('wind');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await expect.poll(() => searches.at(-1)).toEqual({ query: 'wind', page: '1' });
});
