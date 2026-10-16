/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseNestedCommandAction, closeDialog, closeWorkspacePanel, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('a camera bin audition retains its normally silenced audio companion', async ({ page }, testInfo) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('silenced-camera.webm')]);
	await closeWorkspacePanel(editor, 'video-preview');
	const video = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const audio = editor.getByRole('group', { name: /^silenced-camera Audio clip,/u });
	await audio.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Silence audio']);
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const delivery = await openExportDialog(page, editor);
	await chooseDropdown(page, delivery.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, delivery.locator('[data-export-field="dither"]'), 'None');
	await delivery.getByRole('button', { name: 'Export', exact: true }).click();
	const link = delivery.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, link));
	const data = bytes.indexOf(Buffer.from('data'));
	expect(data).toBeGreaterThan(0);
	const count = bytes.readUInt32LE(data + 4);
	expect(count).toBeGreaterThan(0);
	expect(bytes.subarray(data + 8, data + 8 + count).every(value => value === 0)).toBe(true);
	await closeDialog(delivery);
	await video.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: silenced-camera', exact: true });
	await expect(card).toContainText('With audio');
	await card.getByRole('button', { name: /^Play:/u }).click();
	const media = card.locator('video');
	await expect(media).toBeVisible();
	await expect.poll(() => media.evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
	const original = await media.evaluate(async (element) => {
		const context = new AudioContext();
		const source = context.createMediaElementSource(element);
		const analyser = context.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);
		analyser.connect(context.destination);
		await context.resume();
		const values = new Float32Array(analyser.fftSize);
		let peak = 0;
		const until = performance.now() + 150;
		while (performance.now() < until) {
			await new Promise(resolve => requestAnimationFrame(resolve));
			analyser.getFloatTimeDomainData(values);
			for (const value of values) peak = Math.max(peak, Math.abs(value));
		}
		source.disconnect();
		analyser.disconnect();
		await context.close();
		return { peak, muted: element.muted, volume: element.volume };
	});
	await testInfo.attach('camera-bin-audition.json', { body: JSON.stringify(original), contentType: 'application/json' });
	expect(original.peak).toBeLessThan(0.000_001);
});

test('an unchanged camera companion remains audible through the owned Bin preview transport', async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		window.__binAudioStarts = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) {
				let peak = 0;
				for (const value of this.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
				window.__binAudioStarts.push({ peak, duration: this.buffer.duration });
			}
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('unchanged-camera.webm')]);
	await closeWorkspacePanel(editor, 'video-preview');
	await editor.getByRole('group', { name: /^Video clip:/u }).first().click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.getByRole('listitem', { name: 'Project bin: unchanged-camera', exact: true });
	const before = await page.evaluate(() => window.__binAudioStarts.length);
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect.poll(() => page.evaluate(index => window.__binAudioStarts.slice(index).some(start => start.peak > 0.04), before)).toBe(true);
	const media = card.locator('video');
	await expect.poll(() => media.evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
	await expect.poll(() => media.evaluate(element => element.muted)).toBe(true);
	await card.getByRole('button', { name: /^Pause:/u }).click();
	await expect.poll(() => media.evaluate(element => element.paused)).toBe(true);
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect.poll(() => media.evaluate(element => element.paused)).toBe(false);
	await testInfo.attach('unchanged-camera-bin-audio.json', {
		body: JSON.stringify(await page.evaluate(() => window.__binAudioStarts.slice(-2))), contentType: 'application/json',
	});
});
