/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

test('a menu-authored spectrum preserves equal-level low and high recorded tones', async ({ page }) => {
	// CI coverage reached the final seek at the former 30-second workflow limit.
	test.setTimeout(120_000);
	await page.addInitScript(() => {
		window.__visualizerPeak = { calls: 0, row: 1 };
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
			window.__visualizerPeak = { calls: window.__visualizerPeak.calls + 1, row };
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Spectrum pixels require the exact WebGL2 preview.');
	const recording = createWavFixture({ name: 'equal-level-recorded-tones.wav', duration: 2,
		frequency: 468.75, channelCount: 1, channelAmplitudes: [0.5] });
	for (let frame = 48_000; frame < 96_000; frame++) {
		recording.buffer.writeInt16LE(Math.round(0.5 * 32767
			* Math.sin(2 * Math.PI * 14_062.5 * frame / 48_000)), 44 + frame * 2);
	}
	const rms = start => {
		let power = 0;
		for (let frame = start; frame < start + 48_000; frame++) {
			power += (recording.buffer.readInt16LE(44 + frame * 2) / 32767) ** 2;
		}
		return Math.sqrt(power / 48_000);
	};
	expect(Math.abs(rms(0) - rms(48_000))).toBeLessThan(0.00001);
	await importFiles(editor, [recording]);
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
	await seekFramescaperTimecode(page, editor, '00:00:00:12');
	await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '19200');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
	await expect.poll(() => page.evaluate(() => window.__visualizerPeak.row)).toBeLessThan(0.03);
	const healthyCalls = await page.evaluate(() => window.__visualizerPeak.calls);
	await seekFramescaperTimecode(page, editor, '00:00:01:15');
	await expect(preview).toHaveAttribute('data-video-preview-evaluated-timeline-sample', '72000');
	await expect.poll(() => page.evaluate(() => window.__visualizerPeak.calls)).toBeGreaterThan(healthyCalls);
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect.poll(() => page.evaluate(() => window.__visualizerPeak.row)).toBeLessThan(0.03);
});
