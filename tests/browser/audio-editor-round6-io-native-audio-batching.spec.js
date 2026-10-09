/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';
import { installRound6NativeCapture } from './helpers/framescaper-round6-native-audio-capture.js';

for (const monitoring of [true, false]) {
	test(`native microphone and shared-screen capture remains durable with monitoring=${String(monitoring)}`, async ({ page, browserName }) => {
		await installRound6NativeCapture(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		const projectId = await editor.getAttribute('data-project-id');
		const panel = await openRecordingSetup(page, editor);
		if (!await page.evaluate(() => typeof globalThis.MediaRecorder === 'function')) {
			await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
			await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
			return;
		}
		await selectSourceRoles(panel, ['microphone', 'display']);
		await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
		await expectCapturePhase(panel, 'previewing');
		await expect(panel.getByRole('checkbox', { name: 'System or tab audio', exact: true })).toBeChecked();
		await panel.getByRole('combobox', { name: 'Countdown', exact: true }).selectOption('0');
		await panel.getByRole('checkbox', { name: 'Monitor microphone', exact: true }).setChecked(monitoring);
		await panel.getByRole('button', { name: 'Arm capture', exact: true }).click();
		await expectCapturePhase(panel, 'armed');
		await panel.getByRole('button', { name: 'Start capture', exact: true }).click();
		try { await expectCapturePhase(panel, 'recording'); }
		catch (error) {
			const frames = await page.evaluate(() => window.__round6CaptureNativeFrameSizes());
			throw new Error(`Native AudioData: ${JSON.stringify({ count: frames.length, frameSizes: [...new Set(frames)] })}\n${await panel.innerText()}`, { cause: error });
		}
		await page.waitForTimeout(1000);
		await expect.poll(() => page.evaluate(() => window.__round6CaptureNativePcm().frames)).toBeGreaterThan(16_384);
		if (!monitoring && browserName === 'chromium') {
			await expect.poll(() => page.evaluate(() => window.__round6CaptureNativeFrameSizes().length)).toBeGreaterThan(32);
		}
		const frames = await page.evaluate(() => window.__round6CaptureNativeFrameSizes());
		if (!monitoring && browserName === 'chromium') {
			expect(frames.length).toBeGreaterThan(32);
			expect(frames.every(frame => frame === 480)).toBe(true);
		}
		await expectCapturePhase(panel, 'recording');
		await panel.getByRole('button', { name: 'Stop and import', exact: true }).click();
		await expect(panel).toHaveAttribute('data-capture-phase', /^(?:inactive|recovery)$/u, { timeout: 30_000 });
		const nativeFailures = await page.evaluate(() => window.__round6CaptureNativeFailures());
		expect(await panel.getAttribute('data-capture-phase'), `${await panel.innerText()}\n${JSON.stringify(nativeFailures)}`).toBe('inactive');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await page.evaluate(async ({ databaseName, id }) => {
			const read = request => new Promise((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const database = await read(indexedDB.open(databaseName));
			try { return await read(database.transaction('projects', 'readonly').objectStore('projects').get(id)); }
			finally { database.close(); }
		}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
		const sources = saved.sources.filter(({ kind }) => kind === 'audio');
		expect(sources).toHaveLength(2);
		for (const source of sources) expect(source.frameCount).toBeGreaterThan(4096);
		const pcm = await page.evaluate(() => window.__round6CaptureNativePcm());
		expect(pcm.peak).toBeGreaterThan(0.1);
		expect(sources.reduce((total, source) => total + source.frameCount, 0)).toBe(pcm.frames);
	});
}
