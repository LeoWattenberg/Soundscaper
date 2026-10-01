/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	clipByName, commitInput,
} from './audio-editor-test-helpers.js';

test('a new audio track renders the spectrogram defaults set with no track selected', async ({ page }) => {
	await page.addInitScript(() => {
		const counts = new WeakMap();
		const fill = CanvasRenderingContext2D.prototype.fillRect;
		const copy = CanvasRenderingContext2D.prototype.drawImage;
		globalThis.__spectrogramPaintProbe = { copies: 0, paints: 0 };
		CanvasRenderingContext2D.prototype.fillRect = function (...args) {
			counts.set(this.canvas, (counts.get(this.canvas) || 0) + 1);
			return fill.apply(this, args);
		};
		CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
			if (this.canvas.matches('canvas.clip-body__waveform') && source instanceof HTMLCanvasElement) {
				globalThis.__spectrogramPaintProbe = {
					copies: globalThis.__spectrogramPaintProbe.copies + 1,
					paints: counts.get(source) || 0,
				};
			}
			return copy.call(this, source, ...args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	let preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	let settings = preferences.locator('[data-spectrogram-settings]');
	await expect(settings).toHaveAttribute('data-spectrogram-target', 'defaults');
	await chooseDropdown(page, preferences.getByRole('group', { name: 'Default view', exact: true }), 'Spectrogram');
	await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
	await commitInput(settings.getByLabel('Minimum frequency (Hz)', { exact: true }), '5000');
	await commitInput(settings.getByLabel('Maximum frequency (Hz)', { exact: true }), '8000');
	await settings.getByLabel('Window size', { exact: true }).selectOption('8192');
	await settings.getByLabel('Window type', { exact: true }).selectOption('blackman');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	const track = editor.locator('[data-track-row]').last();
	const trackId = await track.getAttribute('data-track-id');
	await expect(track).toHaveAttribute('data-display-mode', 'spectrogram');
	const lane = track.locator('[data-track-lane]');
	await expect(lane).toHaveAttribute('data-selected', 'true');
	await expect(lane).toHaveAttribute('data-spectrogram-scale', 'linear');
	await expect(lane).toHaveAttribute('data-spectrogram-minimum-frequency', '5000');
	await expect(lane).toHaveAttribute('data-spectrogram-maximum-frequency', '8000');
	await expect(lane).toHaveAttribute('data-spectrogram-window-size', '8192');
	await expect(lane).toHaveAttribute('data-spectrogram-window-type', 'blackman');

	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const toneDialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await commitInput(toneDialog.locator('[data-generator-field="frequency"] input'), '440');
	await commitInput(toneDialog.locator('[data-generator-field="durationSeconds"] input'), '2');
	await toneDialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(toneDialog).toBeHidden();
	const clip = clipByName(editor, 'Tone');
	await expect(clip.locator('xpath=ancestor::div[@data-track-row]')).toHaveAttribute('data-track-id', trackId);
	const canvas = clip.locator('canvas.clip-body__waveform').first();
	await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
	const cropped = await spectrogramRaster(canvas);
	const beforeSelection = await page.evaluate(() => globalThis.__spectrogramPaintProbe);
	expect(beforeSelection.paints).toBeGreaterThan(0);
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.25, { steps: 4 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => globalThis.__spectrogramPaintProbe.copies))
		.toBeGreaterThan(beforeSelection.copies);
	expect(await page.evaluate(() => globalThis.__spectrogramPaintProbe.paints)).toBe(beforeSelection.paints);

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	settings = preferences.locator('[data-spectrogram-settings]');
	await expect(settings).toHaveAttribute('data-spectrogram-target', trackId);
	await commitInput(settings.getByLabel('Minimum frequency (Hz)', { exact: true }), '0');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(lane).toHaveAttribute('data-spectrogram-minimum-frequency', '0');
	await expect.poll(async () => (await spectrogramRaster(canvas)).colored)
		.toBeGreaterThan(cropped.colored + 100);
	const expanded = await spectrogramRaster(canvas);
	for (const [channel, peakRow] of expanded.peakRows.entries()) {
		expect(Math.abs(peakRow / expanded.height - (channel + 1 - 440 / 8_000) / 2))
			.toBeLessThan(0.02);
	}
});

async function spectrogramRaster(canvas) {
	return canvas.evaluate((element) => {
		const { data, width, height } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
		const rowCounts = new Array(height).fill(0);
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset + 3] && Math.max(data[offset], data[offset + 1], data[offset + 2]) >= 32) {
				rowCounts[Math.floor(offset / 4 / width)] += 1;
			}
		}
		const first = rowCounts.slice(0, Math.floor(height / 2));
		const second = rowCounts.slice(first.length);
		return { colored: rowCounts.reduce((sum, count) => sum + count, 0),
			peakRows: [first.indexOf(Math.max(...first)), first.length + second.indexOf(Math.max(...second))],
			height };
	});
}
