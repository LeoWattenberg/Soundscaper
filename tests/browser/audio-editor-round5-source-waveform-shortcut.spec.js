/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('modified Source waveform Space runs the configured command without starting audition', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Space');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const clip = clipByName(editor, toneA.name);
	const original = await clip.getAttribute('aria-label');
	const properties = await openClipProperties(page, editor, clip);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+Alt+Space');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(clip).toHaveAttribute('aria-label', original);
	await expect(properties.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('Source waveform leaves Shift Space to the timeline play-from-cursor command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'shift-space.wav', frequency: 440, duration: 5, channelCount: 1 });
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Shift+Space');
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect(properties.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
	await editor.locator('[data-transport="stop"]').getByRole('button', { name: 'Stop', exact: true }).click();
});
