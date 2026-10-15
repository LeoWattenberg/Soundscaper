/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

const AUDIO = {
	id: '123', title: 'Rain in the garden', authorName: 'Field recorder', username: 'field-recorder',
	url: 'https://audio.com/field-recorder/audio/rain', description: 'Garden rain.',
	license: 'cc-by', isDownloadable: false, durationSeconds: 12,
	previewUrl: '/api/audiocom/preview?url=https%3A%2F%2Faudio.com%2Fpreview.mp3',
};

test.describe('audio.com panel', () => {
	registerAudioEditorHooks();

	test('opens from Window, connects, searches and pages, releases previews, and publishes audio with consent', async ({ page }) => {
		test.setTimeout(90_000);
		const requests = await mockAudiocom(page);
		await installPreviewProbe(page);
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator('[data-workspace-panel="audiocom"]');
		await expect(panel).toHaveCount(0);
		expect(requests.sessions).toBe(0);
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		await expect(panel).toBeVisible();
		await expect(panel.locator('[data-audiocom-uploads]')).toHaveCount(0);
		const popupPromise = page.waitForEvent('popup');
		await panel.getByRole('button', { name: 'Connect to audio.com', exact: true }).click();
		const authorization = await popupPromise;
		await expect(authorization).toHaveURL(/^https:\/\/api\.audio\.com\/auth\/authorize\?/u);
		await expect(panel.getByText('Connected to audio.com', { exact: true })).toBeVisible();
		expect(await authorization.evaluate(() => window.opener)).toBeNull();
		await authorization.close();
		expect(requests.starts).toEqual([{ client: 'web' }]);

		const uploads = panel.locator('[data-audiocom-uploads]');
		await expect(uploads).not.toHaveAttribute('open');
		const search = panel.getByRole('searchbox', { name: 'Search audio.com', exact: true });
		await search.fill('rain');
		await panel.getByRole('button', { name: 'Search', exact: true }).click();
		await expect(panel.getByRole('link', { name: AUDIO.title, exact: true })).toBeVisible();
		await panel.getByRole('button', { name: 'Next', exact: true }).click();
		await expect.poll(() => requests.searches.at(-1)).toEqual({ query: 'rain', page: '2' });
		await panel.getByRole('button', { name: 'Previous', exact: true }).click();
		await expect.poll(() => requests.searches.at(-1)).toEqual({ query: 'rain', page: '1' });
		await panel.getByRole('button', { name: `Play preview: ${AUDIO.title}`, exact: true }).click();
		await expect(panel.getByRole('button', { name: `Stop preview: ${AUDIO.title}`, exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__audiocomPreviewProbe.plays)).toBe(1);
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		await expect(panel).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => globalThis.__audiocomPreviewProbe.pauses)).toBeGreaterThan(0);
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		await expect(panel.getByRole('link', { name: AUDIO.title, exact: true })).toBeVisible();

		await uploads.locator('summary').click();
		await uploads.locator('input[type="file"]').setInputFiles({
			name: 'field take.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF-field-take'),
		});
		await expect(uploads.locator('[data-upload-status="draft"]')).toBeVisible();
		expect(requests.uploads).toEqual([]);
		await uploads.getByRole('button', { name: /^Publish\s*: field take\.wav$/u }).click();
		const dialog = page.locator('[data-audiocom-publish-dialog]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
		await expect(dialog.locator('[name="visibility"]')).toHaveValue('unlisted');
		await expect(dialog.locator('[name="downloadable"]')).not.toBeChecked();
		await dialog.locator('[name="title"]').fill('Garden rain');
		await dialog.locator('[name="description"]').fill('A field recording from my garden.');
		await dialog.locator('[name="category"]').selectOption('recording');
		await dialog.locator('[name="license"]').selectOption('cc-by');
		await dialog.locator('[name="rightsConfirmed"]').check();
		await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(uploads.locator('[data-upload-status="processing"]')).toBeVisible();
		expect(requests.uploads).toEqual([{
			filename: 'field%20take.wav', contentType: 'audio/wav', byteLength: '15',
			metadata: { title: 'Garden rain', description: 'A field recording from my garden.', category: 'recording', license: 'cc-by', listed: '0', downloadable: '0' },
		}]);
		await expect(uploads.getByRole('link', { name: 'Open on audio.com', exact: true })).toHaveAttribute('href', AUDIO.url);
		await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Connect to audio.com', exact: true })).toBeVisible();
		await expect(uploads).toHaveCount(0);
		expect(requests.disconnects).toBe(1);
	});

	test('retains queued files through hiding the panel and retries failed publication with the same settings', async ({ page }) => {
		const requests = await mockAudiocom(page, { connected: true });
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		const panel = editor.locator('[data-workspace-panel="audiocom"]');
		const uploads = panel.locator('[data-audiocom-uploads]');
		await uploads.locator('summary').click();
		await uploads.locator('input[type="file"]').setInputFiles([
			{ name: 'first.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF-first') },
			{ name: 'second.flac', mimeType: 'audio/flac', buffer: Buffer.from('fLaC-second') },
		]);
		await expect(uploads.locator('[data-upload-status="draft"]')).toHaveCount(2);
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		await uploads.locator('summary').click();
		await expect(uploads.locator('[data-upload-status="draft"]')).toHaveCount(2);
		requests.failNextUpload = true;
		await uploads.getByRole('button', { name: /^Publish\s*: first\.wav$/u }).click();
		const dialog = page.locator('[data-audiocom-publish-dialog]');
		await dialog.locator('[name="rightsConfirmed"]').check();
		await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
		const first = uploads.locator('li').filter({ hasText: 'first.wav' });
		await expect(first).toHaveAttribute('data-upload-status', 'error');
		await first.getByRole('button', { name: /^Retry\s*: first\.wav$/u }).click();
		await expect(first).toHaveAttribute('data-upload-status', 'processing');
		expect(requests.uploads).toHaveLength(2);
		expect(requests.uploads[0]).toEqual(requests.uploads[1]);
		await expect(uploads.locator('[data-upload-status="draft"]')).toHaveCount(1);
	});

	test('reports rejected search sessions and rejects project files before uploading', async ({ page }) => {
		const requests = await mockAudiocom(page, { connected: true });
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['audio.com']);
		const panel = editor.locator('[data-workspace-panel="audiocom"]');
		const uploads = panel.locator('[data-audiocom-uploads]');
		await uploads.locator('summary').click();
		await uploads.locator('input[type="file"]').setInputFiles({
			name: 'session.aup3', mimeType: 'application/octet-stream', buffer: Buffer.from('SQLite format 3'),
		});
		await expect(uploads.getByRole('alert')).toBeVisible();
		expect(requests.uploads).toEqual([]);
		requests.expireSearch = true;
		await panel.getByRole('searchbox').fill('rain');
		await panel.getByRole('button', { name: 'Search', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Connect to audio.com', exact: true })).toBeVisible();
		await expect(panel.getByRole('alert')).toContainText('The audio.com session expired.');
		await expect(uploads).toHaveCount(0);
	});
});

async function installPreviewProbe(page) {
	await page.addInitScript(() => {
		globalThis.__audiocomPreviewProbe = { plays: 0, pauses: 0 };
		const originalPlay = HTMLMediaElement.prototype.play;
		const originalPause = HTMLMediaElement.prototype.pause;
		const originalLoad = HTMLMediaElement.prototype.load;
		HTMLMediaElement.prototype.play = function () {
			if (!this.src.includes('/api/audiocom/preview?')) return originalPlay.call(this);
			globalThis.__audiocomPreviewProbe.plays += 1;
			return Promise.resolve();
		};
		HTMLMediaElement.prototype.pause = function () {
			if (!this.src.includes('/api/audiocom/preview?')) return originalPause.call(this);
			globalThis.__audiocomPreviewProbe.pauses += 1;
		};
		HTMLMediaElement.prototype.load = function () {
			if (this.src.includes('/api/audiocom/preview?') || !this.getAttribute('src')) return;
			return originalLoad.call(this);
		};
		HTMLMediaElement.prototype.setSinkId = function () { return Promise.resolve(); };
	});
}

async function mockAudiocom(page, options = {}) {
	let connected = options.connected ?? false;
	const preview = createWavFixture({ name: 'preview.wav', frequency: 440, duration: 0.25, channelCount: 1 });
	const requests = { sessions: 0, starts: [], searches: [], uploads: [], disconnects: 0, expireSearch: false, failNextUpload: false };
	await page.context().route('https://api.audio.com/auth/authorize**', route => route.fulfill({
		contentType: 'text/html', body: '<!doctype html><title>audio.com authorization</title>',
	}));
	await page.route('**/api/audiocom/**', async route => {
		const request = route.request();
		const url = new URL(request.url());
		const data = value => route.fulfill({ json: { data: value } });
		if (url.pathname === '/api/audiocom/usage') return data({ maximumUploadBytes: 100_000_000, projectStorageSupported: false });
		if (url.pathname === '/api/audiocom/oauth/session') {
			requests.sessions += 1;
			if (request.method() === 'DELETE') { connected = false; requests.disconnects += 1; }
			return data({ connected });
		}
		if (url.pathname === '/api/audiocom/oauth/start') {
			requests.starts.push(request.postDataJSON());
			const params = new URLSearchParams({ client_id: 'browser-test', redirect_uri: 'https://soundscaper.org/api/audiocom/oauth/callback',
				response_type: 'code', state: 'attempt', scope: 'public', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
			return data({ attemptId: 'attempt', handoffToken: 'handoff', authorizeUrl: `https://api.audio.com/auth/authorize?${params}`, expiresAt: new Date(Date.now() + 60_000).toISOString() });
		}
		if (url.pathname === '/api/audiocom/oauth/poll') { connected = true; return data({ status: 'connected' }); }
		if (url.pathname === '/api/audiocom/search') {
			if (requests.expireSearch) return route.fulfill({ status: 401, json: { error: { message: 'The audio.com session expired.' } } });
			const query = url.searchParams.get('q');
			const pageNumber = Number(url.searchParams.get('page') || '1');
			requests.searches.push({ query, page: String(pageNumber) });
			return data({ results: [AUDIO], page: pageNumber, hasNext: pageNumber === 1 });
		}
		if (url.pathname === '/api/audiocom/uploads') {
			requests.uploads.push({ filename: request.headers()['x-audiocom-filename'], contentType: request.headers()['content-type'],
				byteLength: request.headers()['x-audiocom-content-length'], metadata: Object.fromEntries(url.searchParams) });
			if (requests.failNextUpload) {
				requests.failNextUpload = false;
				return route.fulfill({ status: 503, json: { error: { message: 'audio.com is temporarily unavailable.' } } });
			}
			return data({ audio: AUDIO, processing: true });
		}
		if (url.pathname === '/api/audiocom/preview') return route.fulfill({ contentType: 'audio/wav', body: preview.buffer });
		return route.fulfill({ status: 404, json: { error: { message: 'Unexpected mocked audio.com request.' } } });
	});
	return requests;
}
