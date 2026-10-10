/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem, openNestedCommandMenu, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Freesound upload restoration belongs to one account', () => {
	registerAudioEditorHooks();
	for (const changeAccount of [false, true]) test(`ordinary delayed restoration ${changeAccount ? 'stays out of a newly connected account' : 'finishes for the original account'}`, async ({ page }) => {
		const service = await ordinaryAccountService(page);
		try {
			const editor = await bootEditor(page, '/embed/en/');
			const menu = await openNestedCommandMenu(page, editor, 'Window', []);
			await getMenuItem(menu, 'Freesound').press('Enter');
			const panel = editor.locator('[data-workspace-panel="freesound"]');
			const credit = panel.locator('.kw-audio-editor__freesound-credit');
			await expect(credit.getByText('Connected as original-account', { exact: true })).toBeVisible();
			await service.firstRequested;
			if (changeAccount) {
				await credit.getByRole('button', { name: 'Disconnect', exact: true }).click();
				const connect = credit.getByRole('button', { name: 'Connect to Freesound', exact: true });
				await expect(connect).toBeVisible();
				const opened = page.waitForEvent('popup');
				await connect.click();
				const authorization = await opened;
				await expect(authorization).toHaveURL(/^https:\/\/freesound\.org\/apiv2\/oauth2\/authorize\/\?/u);
				await authorization.close();
				await expect(credit.getByText('Connected as new-account', { exact: true })).toBeVisible();
				await panel.getByText('Upload to Freesound', { exact: true }).click();
				await expect(panel.getByText('new-account-take.wav', { exact: true })).toBeVisible();
			}
			const received = page.waitForResponse(response => new URL(response.url()).pathname === '/api/freesound/uploads/pending');
			await service.releaseFirst();
			await (await received).finished();
			// The response has finished and the synchronous external-store owner has
			// rendered through a real browser paint before inspecting its account rows.
			await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
			if (!changeAccount) await panel.getByText('Upload to Freesound', { exact: true }).click();
			await expect(panel.locator('li[data-upload-status]')).toHaveCount(1);
			await expect(panel.getByText(changeAccount ? 'new-account-take.wav' : 'original-account-take.wav', { exact: true })).toBeVisible();
			if (changeAccount) await expect(panel.getByText('original-account-take.wav', { exact: true })).toHaveCount(0);
		} finally { await service.releaseFirst(); }
	});
});

for (const changeAccount of [false, true]) test(`ordinary original-download expiry ${changeAccount ? 'preserves a newly connected account' : 'expires its original account'}`, async ({ page }) => {
	const service = await ordinaryAccountService(page, 'original');
	try {
		const editor = await bootEditor(page, '/embed/en/');
		const menu = await openNestedCommandMenu(page, editor, 'Window', []);
		await getMenuItem(menu, 'Freesound').press('Enter');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		const credit = panel.locator('.kw-audio-editor__freesound-credit');
		await expect(credit.getByText('Connected as original-account', { exact: true })).toBeVisible();
		await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('rain');
		await panel.getByRole('button', { name: 'Search', exact: true }).click();
		await panel.getByRole('button', { name: /^Add to project\s*:\s*Rain in the garden$/u }).click();
		await service.firstRequested;
		if (changeAccount) {
			await credit.getByRole('button', { name: 'Disconnect', exact: true }).click();
			const connect = credit.getByRole('button', { name: 'Connect to Freesound', exact: true });
			await expect(connect).toBeVisible();
			const opened = page.waitForEvent('popup');
			await connect.click();
			const authorization = await opened;
			await expect(authorization).toHaveURL(/^https:\/\/freesound\.org\/apiv2\/oauth2\/authorize\/\?/u);
			await authorization.close();
			await expect(credit.getByText('Connected as new-account', { exact: true })).toBeVisible();
		}
		await service.releaseFirst();
		await expect(panel.getByText(/^Old account expired\./u)).toBeVisible();
		if (changeAccount) await expect(credit.getByText('Connected as new-account', { exact: true })).toBeVisible();
		else await expect(credit.getByRole('button', { name: 'Connect to Freesound', exact: true })).toBeVisible();
	} finally { await service.releaseFirst(); }
});

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

async function ordinaryAccountService(page, mode = 'pending') {
	let firstRequested;
	let firstRoute;
	let requests = 0;
	const requested = new Promise(resolve => { firstRequested = resolve; });
	await page.context().route('https://freesound.org/apiv2/oauth2/authorize/**', async route => {
		await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Freesound authorization</title>' });
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/oauth/session')) {
			if (route.request().method() === 'DELETE') await route.fulfill({ status: 204 });
			else await data(route, { connected: true, user: { username: 'original-account' } });
		} else if (path.endsWith('/oauth/start')) await data(route, {
			attemptId: 'new-account', handoffToken: 'new-account-handoff',
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary-client&response_type=code&state=new-account&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback',
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		});
		else if (path.endsWith('/oauth/poll')) await data(route, { connected: true, user: { username: 'new-account' } });
		else if (path.endsWith('/search')) await data(route, { query: 'rain', page: 1, pageSize: 20,
			totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [SOUND] });
		else if (path.endsWith('/sounds/42')) await data(route, SOUND);
		else if ((mode === 'pending' && path.endsWith('/uploads/pending') && ++requests === 1)
			|| (mode === 'original' && path.endsWith('/sounds/42/original'))) { firstRoute = route; firstRequested(); }
		else if (path.endsWith('/uploads/pending')) await data(route, { pendingDescription: ['new-account-take.wav'], pendingProcessing: [], pendingModeration: [] });
		else await route.fulfill({ status: 404, body: '{}' });
	});
	return { firstRequested: requested, releaseFirst: async () => {
		const route = firstRoute; firstRoute = null;
		if (route && mode === 'original') await route.fulfill({ status: 401,
			json: { error: { code: 'not_authenticated', message: 'Old account expired.' } } });
		else if (route) await data(route, { pendingDescription: ['original-account-take.wav'], pendingProcessing: [], pendingModeration: [] });
	} };
}

async function data(route, value) {
	await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: value }) });
}
