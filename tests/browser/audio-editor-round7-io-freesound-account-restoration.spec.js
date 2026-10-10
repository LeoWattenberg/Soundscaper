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

async function ordinaryAccountService(page) {
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
		else if (path.endsWith('/uploads/pending') && ++requests === 1) { firstRoute = route; firstRequested(); }
		else if (path.endsWith('/uploads/pending')) await data(route, { pendingDescription: ['new-account-take.wav'], pendingProcessing: [], pendingModeration: [] });
		else await route.fulfill({ status: 404, body: '{}' });
	});
	return { firstRequested: requested, releaseFirst: async () => {
		const route = firstRoute; firstRoute = null;
		if (route) await data(route, { pendingDescription: ['original-account-take.wav'], pendingProcessing: [], pendingModeration: [] });
	} };
}

async function data(route, value) {
	await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: value }) });
}
