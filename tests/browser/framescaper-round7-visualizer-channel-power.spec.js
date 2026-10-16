/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeDialog,
	disableNativeSavePicker, importFiles, readDownloadBytes } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

for (const opposite of [false, true]) test(`a menu-authored spectrum retains an audible ${opposite ? 'opposite' : 'matching'}-polarity four-channel recording`, async ({ page }) => {
	// Software compositing and exact PCM rendering run more slowly under CI coverage.
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__wideVisualizerPeak = { calls: 0, row: 1 };
		const nativePut = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(nativePut, this, args);
			const frame = args[0];
			if (frame.width !== 1_280 || frame.height !== 720) return result;
			let row = 1;
			search: for (let y = 0; y < frame.height; y++) {
				for (let x = 0; x < frame.width; x++) {
					const offset = (y * frame.width + x) * 4;
					if (frame.data[offset] === 255 && frame.data[offset + 1] === 0
						&& frame.data[offset + 2] === 0 && frame.data[offset + 3] === 255) {
						row = y / frame.height;
						break search;
					}
				}
			}
			window.__wideVisualizerPeak = { calls: window.__wideVisualizerPeak.calls + 1, row };
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Spectrum pixels require the exact WebGL2 preview.');
	const recording = createWavFixture({ name: 'four-channel recording.wav', duration: 1,
		frequency: 468.75, channelCount: 4, channelAmplitudes: opposite ? [.5, -.5, .5, -.5] : [.5, .5, .5, .5] });
	expect(recording.buffer.readUInt16LE(22)).toBe(4);
	await importFiles(editor, [recording]);
	await chooseFileAction(page, editor, 'Export video');
	const exportDialog = page.getByRole('dialog', { name: 'Export video', exact: true });
	await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = exportDialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute('download', /\.wav$/u);
	const bytes = await readDownloadBytes(page, link);
	const physical = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			const rms = Array.from({ length: audio.numberOfChannels }, (_, channel) => {
				const samples = audio.getChannelData(channel).subarray(12_000, 36_000);
				return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
			});
			return { rate: audio.sampleRate, frames: audio.length, rms };
		} finally { await context.close(); }
	}, Array.from(bytes));
	expect(physical.rate).toBe(48_000);
	expect(physical.frames).toBe(48_000);
	expect(physical.rms).toHaveLength(2);
	for (const rms of physical.rms) expect(rms).toBeGreaterThan(.3);
	await closeDialog(exportDialog);
	await chooseNestedCommandAction(page, editor, 'Generate', [
		'Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addSoundVisualizer'],
	]);
	await editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', [
		'Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector'],
	]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('spectrum');
	await dialog.getByRole('spinbutton', { name: 'View window (seconds)', exact: true }).fill('0.25');
	await dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true }).fill('#ff0000ff');
	await dialog.getByRole('group', { name: 'Audio sources', exact: true }).getByRole('checkbox').first().check();
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await page.mouse.move(1, 1);
	await expect(page.getByRole('tooltip')).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	const preview = editor.locator('[data-video-preview]');
	const priorCalls = await page.evaluate(() => window.__wideVisualizerPeak.calls);
	await seekFramescaperTimecode(page, editor, '00:00:00:12');
	await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '19200');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect.poll(() => page.evaluate(() => window.__wideVisualizerPeak.calls)).toBeGreaterThan(priorCalls);
	const projection = await page.evaluate(() => window.__wideVisualizerPeak);
	expect(projection.row).toBeLessThan(.03);
});
