/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const folder of [false, true]) test(`Freesound renders a normal ${folder ? 'folder-owned' : 'ungrouped'} clip before upload`, async ({ page }) => {
	const uploaded = [];
	await page.route('**/api/freesound/**', async route => {
		const request = route.request();
		const pathname = new URL(request.url()).pathname;
		if (pathname === '/api/freesound/oauth/session') {
			await route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'browser-tester' } } } });
		} else if (pathname === '/api/freesound/uploads/pending') {
			await route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
		} else if (pathname === '/api/freesound/uploads') {
			uploaded.push(request.postDataBuffer());
			await route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-voice.wav' } } });
		} else {
			await route.fulfill({ status: 404, json: {} });
		}
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await expect(clip).toHaveAttribute('aria-label', 'browser-mono-tone.wav clip, starts at 0 seconds, 0.8 seconds long');
	if (folder) {
		await clip.locator('.clip-header').click();
		const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
		await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
		await expect(editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true })).toBeVisible();
	}
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as browser-tester', { exact: true })).toBeVisible();
	await clip.focus();
	await page.keyboard.press('Shift+F10');
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
	const uploads = panel.locator('[data-freesound-uploads="true"]');
	await expect(uploads).toHaveJSProperty('open', true);
	await expect(uploads.getByRole('button', { name: /^Ready to publish\s*:/u })).toHaveCount(1);
	expect(uploaded).toHaveLength(1);
	expect(uploaded[0].subarray(0, 4).toString()).toBe('RIFF');
	expect(uploaded[0].byteLength).toBeGreaterThan(38_400 * 3);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	if (folder) await expect(editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true })).toBeVisible();
});
