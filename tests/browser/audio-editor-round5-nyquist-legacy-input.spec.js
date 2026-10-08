/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openNestedCommandMenu, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { exportGuideSamples } from './helpers/guide-audio-results.js';

registerAudioEditorHooks();

test('the published legacy equalizer processes selected audio with one Undo and Redo', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'legacy-equalizer.wav', frequency: 440, duration: 0.2, channelCount: 2 })]);
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Studio Fade Out', exact: true }).click();
	await page.getByRole('dialog', { name: 'Studio Fade Out' }).getByRole('button', { name: 'Cancel', exact: true }).click();
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('Ten Band EQ');
	await catalog.getByRole('button', { name: 'Install Ten Band EQ', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Remove Ten Band EQ', exact: true })).toBeVisible({ timeout: 20_000 });
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(catalog).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Ten Band EQ', exact: true }).click();
	const plugin = page.getByRole('dialog', { name: 'Ten Band EQ', exact: true });
	await plugin.getByRole('spinbutton', { name: /^Band number/u }).fill('5');
	await plugin.getByRole('spinbutton', { name: /^Gain/u }).fill('6');
	await plugin.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(plugin).toBeHidden({ timeout: 20_000 });
	const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
	const applied = await exportGuideSamples(page);
	expect(applied.channels).toHaveLength(2);
	expect(applied.duration).toBeCloseTo(0.2, 3);
	expect(rms(applied.channels[0])).toBeGreaterThan(0.42);
	expect(rms(applied.channels[0])).toBeLessThan(0.51);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportGuideSamples(page);
	expect(rms(undone.channels[0])).toBeCloseTo(0.35 / Math.sqrt(2), 3);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportGuideSamples(page);
	expect(rms(redone.channels[0])).toBeCloseTo(rms(applied.channels[0]), 5);
});
