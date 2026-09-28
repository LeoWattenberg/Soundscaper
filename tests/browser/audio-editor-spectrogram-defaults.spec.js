/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	clipByName, commitInput,
} from './audio-editor-test-helpers.js';

test('a new audio track renders the spectrogram defaults set with no track selected', async ({ page }) => {
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
	const croppedPixels = await spectrogramColoredPixelCount(canvas);

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	settings = preferences.locator('[data-spectrogram-settings]');
	await expect(settings).toHaveAttribute('data-spectrogram-target', trackId);
	await commitInput(settings.getByLabel('Minimum frequency (Hz)', { exact: true }), '0');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(lane).toHaveAttribute('data-spectrogram-minimum-frequency', '0');
	await expect.poll(() => spectrogramColoredPixelCount(canvas))
		.toBeGreaterThan(croppedPixels + 100);
});

async function spectrogramColoredPixelCount(canvas) {
	return canvas.evaluate((element) => {
		const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
		let colored = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset + 3] && Math.max(data[offset], data[offset + 1], data[offset + 2]) >= 32) colored += 1;
		}
		return colored;
	});
}
