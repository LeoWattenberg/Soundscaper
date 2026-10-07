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

test('a read-only tab can audition takes created by normal loop recording', async ({ browserName, baseURL }) => {
	test.skip(browserName !== 'chromium', 'Chromium supplies a real fake microphone capture device.');
	test.setTimeout(90_000);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-dialog-takes-'));
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
		const audition = dialog.getByRole('button', { name: 'Audition lane', exact: true }).first();
		await expect(audition).toBeEnabled();
		const second = await context.newPage();
		await bootEditor(second, '/embed/en/');
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(audition).toBeEnabled();
		await audition.click();
		await expect(dialog).toContainText('Take comp updated.');
		await expect(dialog.getByRole('button', { name: 'Promote for full group', exact: true })).toBeDisabled();

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
