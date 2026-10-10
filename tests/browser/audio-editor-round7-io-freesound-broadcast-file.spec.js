/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

const recording = Buffer.from((await readFile(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8')).trim(), 'base64');

test.describe('ordinary Freesound broadcast file upload', () => {
	registerAudioEditorHooks();
	for (const extension of ['wav', 'bwf']) test(`the Choose audio files picker uploads an ordinary .${extension} production recording`, async ({ page }) => {
		const uploads = [];
		await page.route('**/api/freesound/**', async route => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (path === '/api/freesound/oauth/session') {
				await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
			} else if (path === '/api/freesound/uploads/pending') {
				await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
			} else if (path === '/api/freesound/uploads') {
				uploads.push({ name: request.headers()['x-freesound-filename'], type: request.headers()['content-type'], bytes: request.postDataBuffer() });
				await route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-production-take.wav' } } });
			} else await route.fulfill({ status: 404, json: {} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Window', 'Freesound');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
		const area = panel.locator('[data-freesound-uploads="true"]');
		await area.getByText('Upload to Freesound', { exact: true }).click();
		const chosen = page.waitForEvent('filechooser');
		await area.getByRole('button', { name: 'Choose audio files', exact: true }).click();
		await (await chosen).setFiles({ name: `production-take.${extension}`, mimeType: '', buffer: recording });
		await expect(area.getByRole('button', { name: /^Ready to publish\s*:/u })).toHaveCount(1);
		expect(uploads).toHaveLength(1);
		expect(uploads[0].name).toBe('production-take.wav');
		expect(uploads[0].type).toBe('audio/wav');
		expect(uploads[0].bytes.subarray(0, 4).toString()).toBe('RIFF');
		expect(uploads[0].bytes.byteLength).toBeGreaterThan(48_000 * 2);
		const descriptor = await inspectWavBlobPcm(new Blob([uploads[0].bytes]));
		expect(descriptor?.channelCount).toBe(1);
		expect(descriptor?.frameCount / descriptor?.sampleRate).toBeCloseTo(1, 5);
		await expect(area.locator('input[type="file"]')).toHaveAttribute('accept', /\.bwf/u);
		await expect(area.getByRole('alert')).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	});
});
