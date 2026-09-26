/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Freesound account connection', () => {
	registerAudioEditorHooks();

	test('connects from a signed-out panel, restores uploads, and handles sign-out and session expiry', async ({ page }) => {
		test.setTimeout(90_000);
		const requests = await mockFreesoundSession(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panelsMenu = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		await getMenuItem(panelsMenu, 'Freesound').press('Enter');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		const credit = panel.locator('.kw-audio-editor__freesound-credit');
		const connect = credit.getByRole('button', { name: 'Connect to Freesound', exact: true });
		await expect(connect).toBeVisible();
		await expect(panel.locator('[data-freesound-uploads="true"]')).toHaveCount(0);

		const firstPopup = page.waitForEvent('popup');
		await connect.click();
		const authorization = await firstPopup;
		await expect(authorization).toHaveURL(/^https:\/\/freesound\.org\/apiv2\/oauth2\/authorize\/\?/u);
		await expect(credit.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
		expect(await authorization.evaluate(() => window.opener)).toBeNull();
		await authorization.close();
		expect(requests.starts).toEqual([{ client: 'web' }]);
		expect(requests.polls).toEqual([
			{ attemptId: 'attempt-1', handoffToken: 'handoff-1' },
			{ attemptId: 'attempt-1', handoffToken: 'handoff-1' },
		]);

		const uploads = panel.locator('[data-freesound-uploads="true"]');
		await uploads.getByText('Upload to Freesound', { exact: true }).click();
		await expect(uploads.locator('li[data-upload-status="ready-to-publish"]')
			.filter({ hasText: 'remote-before-connect.wav' })).toBeVisible();
		expect(requests.pending).toBe(1);
		await uploads.locator('input[type="file"]').setInputFiles({
			name: 'new field take.wav',
			mimeType: 'audio/wav',
			buffer: Buffer.from('RIFF-new-field-take'),
		});
		await expect(uploads.getByRole('button', { name: /^Ready to publish\s*: new field take\.wav$/u }))
			.toBeVisible();
		expect(requests.uploadedNames).toEqual(['new%20field%20take.wav']);

		await credit.getByRole('button', { name: 'Disconnect', exact: true }).click();
		await expect(connect).toBeVisible();
		await expect(panel.locator('[data-freesound-uploads="true"]')).toHaveCount(0);
		expect(requests.disconnects).toBe(1);

		const secondPopup = page.waitForEvent('popup');
		await connect.click();
		const renewedAuthorization = await secondPopup;
		await expect(renewedAuthorization).toHaveURL(/^https:\/\/freesound\.org\/apiv2\/oauth2\/authorize\/\?/u);
		await expect(credit.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
		await renewedAuthorization.close();
		expect(requests.starts).toEqual([{ client: 'web' }, { client: 'web' }]);
		await expect.poll(() => requests.pending).toBe(2);

		await panel.locator('[data-freesound-uploads="true"]')
			.getByText('Upload to Freesound', { exact: true }).click();
		requests.expireNextUpload();
		await panel.locator('[data-freesound-uploads="true"] input[type="file"]').setInputFiles({
			name: 'expired field take.wav',
			mimeType: 'audio/wav',
			buffer: Buffer.from('RIFF-expired-field-take'),
		});
		await expect(connect).toBeVisible();
		await expect(panel.getByText('Freesound session expired.', { exact: true })).toBeVisible();
		await expect(panel.locator('[data-freesound-uploads="true"]')).toHaveCount(0);
		expect(requests.uploadedNames).toEqual([
			'new%20field%20take.wav', 'expired%20field%20take.wav',
		]);
	});
});

async function mockFreesoundSession(page) {
	const requests = {
		starts: [], polls: [], uploadedNames: [], pending: 0, disconnects: 0,
		expireNextUpload: () => { expiring = true; },
	};
	let connected = false;
	let expiring = false;
	let attempt = 0;
	const pollCounts = new Map();
	await page.context().route('https://freesound.org/apiv2/oauth2/authorize/**', async (route) => {
		await route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><title>Freesound authorization</title>',
		});
	});
	await page.route('**/api/freesound/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path === '/api/freesound/oauth/session') {
			if (request.method() === 'DELETE') {
				connected = false;
				requests.disconnects += 1;
				await route.fulfill({ status: 204 });
			} else if (connected) {
				await data(route, { connected: true, user: { id: 7, username: 'browser-tester' } });
			} else {
				await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({
					error: { code: 'not_authenticated', message: 'No Freesound session.' },
				}) });
			}
			return;
		}
		if (path === '/api/freesound/oauth/start') {
			attempt += 1;
			requests.starts.push(request.postDataJSON());
			const query = new URLSearchParams({
				client_id: 'browser-test',
				redirect_uri: 'https://soundscaper.org/api/freesound/oauth/callback',
				response_type: 'code',
				state: `browser-attempt-${attempt}`,
			});
			await data(route, {
				attemptId: `attempt-${attempt}`,
				handoffToken: `handoff-${attempt}`,
				authorizeUrl: `https://freesound.org/apiv2/oauth2/authorize/?${query}`,
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			});
			return;
		}
		if (path === '/api/freesound/oauth/poll') {
			const body = request.postDataJSON();
			requests.polls.push(body);
			const count = (pollCounts.get(body.attemptId) ?? 0) + 1;
			pollCounts.set(body.attemptId, count);
			if (count === 1) await route.fulfill({ status: 202, body: '' });
			else {
				connected = true;
				await data(route, { connected: true, user: { id: 7, username: 'browser-tester' } });
			}
			return;
		}
		if (path === '/api/freesound/uploads/pending') {
			requests.pending += 1;
			await data(route, {
				pendingDescription: ['remote-before-connect.wav'],
				pendingProcessing: [], pendingModeration: [],
			});
			return;
		}
		if (path === '/api/freesound/uploads') {
			requests.uploadedNames.push(request.headers()['x-freesound-filename']);
			if (expiring) {
				expiring = false;
				connected = false;
				await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({
					error: { code: 'not_authenticated', message: 'Freesound session expired.' },
				}) });
			} else await data(route, { uploadFilename: 'remote-new-field-take.wav' }, 201);
			return;
		}
		await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	return requests;
}

async function data(route, value, status = 200) {
	await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data: value }) });
}
