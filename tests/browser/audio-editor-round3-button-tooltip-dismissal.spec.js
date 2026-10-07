/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Escape dismisses a button tooltip covering the clip title without moving the pointer', async ({ page }, testInfo) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'tooltip-waveform.wav', frequency: 330, duration: 1, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	const trigger = clip.getByRole('slider', { name: 'Fade out', exact: true });
	await trigger.hover();
	const tooltip = editor.locator('.kw-audio-editor__button-tooltip');
	await expect(tooltip).toBeVisible();
	await expect(tooltip.locator('[data-audio-editor-button-tooltip]')).toHaveText('Fade out');
	const bounds = { tooltip: await tooltip.boundingBox(), clip: await clip.locator('.clip-header').boundingBox() };
	await testInfo.attach('tooltip-clip-title-bounds', { body: JSON.stringify(bounds), contentType: 'application/json' });
	expect(bounds.tooltip.x).toBeLessThan(bounds.clip.x + bounds.clip.width);
	expect(bounds.tooltip.x + bounds.tooltip.width).toBeGreaterThan(bounds.clip.x);
	expect(bounds.tooltip.y).toBeLessThan(bounds.clip.y + bounds.clip.height);
	expect(bounds.tooltip.y + bounds.tooltip.height).toBeGreaterThan(bounds.clip.y);
	await page.keyboard.press('Escape');
	await expect(tooltip).toHaveCount(0);
	await expect(trigger).toHaveAttribute('aria-valuenow', '0.002');
	await trigger.hover();
	await expect(tooltip).toHaveCount(0);
	await page.mouse.move(0, 0);
	await trigger.hover();
	await expect(tooltip).toBeVisible();
});

test('a button tooltip remains readable while moving the pointer into its label', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'tooltip-hover.wav', frequency: 330, duration: 1, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Fade out', exact: true }).hover();
	const tooltip = editor.locator('.kw-audio-editor__button-tooltip');
	await expect(tooltip).toBeVisible();
	const bounds = await tooltip.boundingBox();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 6 });
	await expect(tooltip).toBeVisible();
	await page.mouse.move(0, 0);
	await expect(tooltip).toHaveCount(0);
});
