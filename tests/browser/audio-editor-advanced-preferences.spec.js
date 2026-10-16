/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('Advanced saves a compatible server, validates its URL, and restores audio.com', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByLabel('Server URL', { exact: true })).toHaveCount(0);
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	const server = preferences.getByRole('textbox', { name: 'Server URL', exact: true });
	await expect(server).toHaveValue('https://api.audio.com');
	const initialSavedServer = await savedServer(page);
	await expect(preferences.getByRole('button', { name: 'Save server', exact: true })).toBeDisabled();
	await server.fill('http://audiocity.example');
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect(server).toHaveAttribute('aria-invalid', 'true');
	await expect(preferences.getByRole('alert')).toContainText('HTTPS server URL');
	await expect.poll(() => savedServer(page)).toBe(initialSavedServer);
	await server.fill('https://audiocity.example/');
	await server.press('Enter');
	await expect(server).toHaveValue('https://audiocity.example');
	await expect(preferences.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => savedServer(page)).toBe('https://audiocity.example');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	const reopenedEditor = await waitForEditor(page);
	await chooseCommandAction(page, reopenedEditor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	await expect(server).toHaveValue('https://audiocity.example');
	await preferences.getByRole('button', { name: 'Use audio.com', exact: true }).click();
	await expect(server).toHaveValue('https://api.audio.com');
	await expect.poll(() => savedServer(page)).toBe('https://api.audio.com');
});

test('changing the server sends its origin and clears the previous account search and uploads', async ({ page }) => {
	const selectedOrigins = [];
	const customOrigin = 'https://audiocity.example';
	await page.route('**/api/audiocom/**', async route => {
		const request = route.request();
		const url = new URL(request.url());
		const origin = request.headers()['x-audiocom-api-origin'];
		selectedOrigins.push({ path: url.pathname, origin });
		const provider = origin === customOrigin
			? { kind: 'audiocity', apiOrigin: customOrigin, webOrigin: customOrigin, scope: 'public' }
			: { kind: 'audiocom', apiOrigin: 'https://api.audio.com', webOrigin: 'https://audio.com', scope: 'public' };
		const data = value => route.fulfill({ json: { data: value } });
		if (url.pathname === '/api/audiocom/usage') return data({ maximumUploadBytes: 100_000_000, projectStorageSupported: false, provider });
		if (url.pathname === '/api/audiocom/oauth/session') return data({ connected: origin !== customOrigin && request.method() !== 'DELETE' });
		if (url.pathname === '/api/audiocom/search') return data({ results: [{
			id: '123', title: 'Previous server recording', authorName: 'Recorder', username: 'recorder',
			url: 'https://audio.com/recorder/audio/previous', description: '', license: 'cc-by', isDownloadable: false, durationSeconds: 2,
		}], page: 1, hasNext: false });
		return route.fulfill({ status: 404, json: { error: { message: 'Unexpected server selection request.' } } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
	const panel = editor.locator('[data-workspace-panel="audiocom"]');
	await expect(panel.getByText('Connected to audio.com', { exact: true })).toBeVisible();
	await panel.getByRole('searchbox', { name: 'Search audio.com', exact: true }).fill('previous');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(panel.getByRole('link', { name: 'Previous server recording', exact: true })).toBeVisible();
	const uploads = panel.locator('[data-audiocom-uploads]');
	await uploads.locator('summary').click();
	await uploads.locator('input[type="file"]').setInputFiles({ name: 'previous-server.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF-draft') });
	await expect(uploads.locator('[data-upload-status="draft"]')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Advanced$/u }).click();
	await preferences.getByRole('textbox', { name: 'Server URL', exact: true }).fill(customOrigin);
	await preferences.getByRole('button', { name: 'Save server', exact: true }).click();
	await expect.poll(() => savedServer(page)).toBe(customOrigin);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(panel.getByRole('button', { name: 'Connect to Audiocity', exact: true })).toBeVisible();
	await expect(panel.getByRole('link', { name: 'Previous server recording', exact: true })).toHaveCount(0);
	await expect(panel.locator('[data-upload-status]')).toHaveCount(0);
	await expect(panel.getByRole('searchbox', { name: 'Search Audiocity', exact: true })).toHaveValue('');
	await expect.poll(() => selectedOrigins.some(request => request.path === '/api/audiocom/oauth/session' && request.origin === customOrigin)).toBe(true);
	expect(selectedOrigins.filter(request => request.origin !== customOrigin).every(request => request.origin === 'https://api.audio.com')).toBe(true);
});

async function savedServer(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const opened = globalThis.indexedDB.open('kw-media-soundscaper-editor-v1');
		opened.onerror = () => reject(opened.error);
		opened.onsuccess = () => {
			const database = opened.result;
			const stored = database.transaction('settings', 'readonly').objectStore('settings')
				.get('soundscaper:audio-editor-preferences-v1');
			stored.onerror = () => { database.close(); reject(stored.error); };
			stored.onsuccess = () => {
				const server = stored.result?.value?.advanced?.audioComServerUrl ?? null;
				database.close(); resolve(server);
			};
		};
	}));
}
