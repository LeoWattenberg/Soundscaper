/* SPDX-License-Identifier: AGPL-3.0-only */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { packagedRuntimeAudioArguments } from './helpers/packaged-runtime-audio-fixture.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('a stopped partial loop take offers only its available promotion range', async ({ browserName, baseURL }) => {
	test.skip(browserName !== 'chromium', 'Chromium supplies a real fake microphone capture device.');
	test.setTimeout(90_000);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-round5-partial-take-'));
	const microphonePath = join(directory, 'ordinary-microphone-tone.wav');
	const loop = createWavFixture({ name: 'five-second-loop.wav', duration: 5, frequency: 440,
		channelCount: 1, channelAmplitudes: [0.1] });
	await writeFile(microphonePath, loop.buffer);
	const browser = await chromium.launch({ headless: true,
		args: [...packagedRuntimeAudioArguments(microphonePath), '--use-fake-ui-for-media-stream'] });
	try {
		const context = await browser.newContext({ baseURL, permissions: ['microphone'], serviceWorkers: 'block' });
		const page = await context.newPage();
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [loop]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Record loop into takes', exact: true }).click();
		const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
		await expect(record).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
		await expect.poll(() => capturedFrameCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(48_000);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
		await chooseTrackMenuAction(page, editor, null, 'Take lanes and comps');
		const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
		const take = dialog.locator('.audio-editor-take-comp__lane li').last();
		await take.getByRole('button', { name: /^Select /u }).click();
		const extent = (await take.locator('span').textContent()).match(/Samples (\d+)–(\d+)/u);
		expect(extent).not.toBeNull();
		const endSample = Number(extent[2]);
		expect(endSample).toBeLessThan(240_000);
		await dialog.getByRole('button', { name: 'Promote range', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Take comp updated.');
		const end = dialog.getByRole('group', { name: 'Range end sample', exact: true });
		await end.getByRole('button', { name: 'Range end sample: format', exact: true }).click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await expect.poll(async () => Number((await end.locator('.timecode-digit').allTextContents()).join('')))
			.toBe(endSample);
		await expect(dialog.getByRole('button', { name: 'Promote for full group', exact: true })).toBeDisabled();
		await expect(dialog.locator('.audio-editor-take-comp__regions tbody tr')).toHaveCount(1);
		await expect.poll(() => dialog.locator('.audio-editor-take-comp__regions tbody tr').last()
			.locator('[data-timecode-direct-entry]').last().inputValue()).toBe(String(endSample));
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
		} finally { database.close(); }
	}, SOUNDSCAPER_DATABASE_NAME);
}
