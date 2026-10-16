/* SPDX-License-Identifier: AGPL-3.0-only */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { packagedRuntimeAudioArguments } from './helpers/packaged-runtime-audio-fixture.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('removing a normally recorded final take group restores the surviving Close control', async ({ browserName, baseURL }) => {
	test.skip(browserName !== 'chromium', 'Chromium supplies a real fake microphone capture device.');
	test.setTimeout(90_000);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-round4-take-removal-'));
	const microphonePath = join(directory, 'ordinary-microphone-tone.wav');
	await writeFile(microphonePath, createWavFixture({
		name: 'ordinary-microphone-tone.wav', duration: 5, frequency: 440,
		channelCount: 1, channelAmplitudes: [0.1],
	}).buffer);
	const browser = await chromium.launch({
		headless: true, args: [...packagedRuntimeAudioArguments(microphonePath), '--use-fake-ui-for-media-stream'],
	});
	try {
		const context = await browser.newContext({ baseURL, permissions: ['microphone'], serviceWorkers: 'block' });
		const page = await context.newPage();
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Record loop into takes', exact: true }).click();
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(record).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
		// Observe the ordinary recorder's durable PCM, without installing editor state.
		await expect.poll(() => capturedFrameCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(144_000);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
		await chooseTrackMenuAction(page, editor, null, 'Take lanes and comps');
		const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
		await expect(dialog).toBeVisible();
		const takeButtons = dialog.getByRole('button', { name: /^Select /u });
		await expect.poll(() => takeButtons.count()).toBeGreaterThanOrEqual(2);
		const remove = dialog.getByRole('button', { name: 'Remove take group', exact: true });
		await remove.focus();
		await remove.press('Enter');
		await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
		const close = dialog.getByRole('button', { name: 'Close', exact: true }).last();
		await expect(close).toBeFocused();
		await close.press('Enter');
		await expect(dialog).toBeHidden();
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
});

async function capturedFrameCount(page) {
	return page.evaluate(async (databaseName) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const rows = await new Promise((resolve, reject) => {
				const request = database.transaction('analysis', 'readonly').objectStore('analysis').getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return Math.max(0, ...rows.filter((row) => row.key?.startsWith('raw-pcm-spool-registry-v1:'))
				.flatMap((row) => row.value?.records ?? []).map((record) => record.frameCount));
		} finally {
			database.close();
		}
	}, SOUNDSCAPER_DATABASE_NAME);
}
