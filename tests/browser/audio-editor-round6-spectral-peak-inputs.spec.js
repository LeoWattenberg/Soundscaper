/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, clipField, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

for (const mode of ['independent tempo']) {
	test(`spectral center snapping includes the sounding ${mode}`, async ({ page }) => {
		await page.setViewportSize({ width: 1920, height: 1000 });
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: `spectral-${mode}.wav`, frequency: 512,
			sampleRate: 8192, duration: 4, channelCount: mode === 'surround channel' ? 6 : 1,
			channelAmplitudes: mode === 'surround channel' ? [0, 0, .5, 0, 0, 0] : [.5] });
		await importFiles(editor, [recording]);
		const clip = clipByName(editor, recording.name);
		if (mode === 'independent tempo') {
			const properties = await openClipProperties(page, editor, clip);
			await properties.getByText('Pitch and tempo', { exact: true }).click();
			await expect(properties.getByRole('checkbox', { name: 'Link pitch and tempo', exact: true })).not.toBeChecked();
			const speed = clipField(properties, 'speedRatio');
			await speed.fill('2'); await speed.press('Enter');
			await expect(speed).toHaveValue('2');
			await expect(properties.getByRole('alert')).toHaveCount(0);
			await closeClipProperties(properties);
		}
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Track display$/u }).click();
		const settings = preferences.locator('[data-spectrogram-settings]');
		await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
		await settings.getByLabel('Maximum frequency (Hz)', { exact: true }).fill('2000');
		await settings.getByLabel('Window size', { exact: true }).selectOption('2048');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		const track = clip.locator('xpath=ancestor::div[@data-track-row]');
		await track.getByRole('button', { name: 'Track menu', exact: true }).click();
		const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
		await display.focus(); await page.keyboard.press('ArrowRight');
		await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
		await clip.focus(); await clip.press('Control+a');
		await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
		await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('100');
		await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('300');
		await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
		await expect(clip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		const center = track.getByRole('slider', { name: 'Spectral selection center-frequency handle', exact: true });
		const box = await center.boundingBox();
		const lane = await track.locator('[data-track-lane]').boundingBox();
		const bodyTop = Number(await track.locator('[data-track-lane]').getAttribute('data-channel-body-top'));
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, lane.y + bodyTop + (lane.height - bodyTop) * .6, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(512, 0);
	});
}
